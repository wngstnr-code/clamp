// Locks (spec 10): readers, sizing and the outcome table. The value of a lock
// now mirrors what `close_lock` does: sell before close_ts, redeem after
// settlement, nothing in between.

import { Connection, PublicKey } from "@solana/web3.js";

import { PPM, SIDE_UP } from "./constants.js";
import type { IndexView } from "./index-reader.js";
import { quoteSell, type QuoteBlock, type SeriesView } from "./market-reader.js";
import { bandValuePpm, lockClaims } from "./math/pool.js";
import { clampProgram } from "./program.js";

const big = (x: { toString(): string }) => BigInt(x.toString());

/** Seconds in the bill window the web app reads (the last 30 days). */
export const BILL_WINDOW_SECS = 30 * 86_400;

export interface LockView {
  address: PublicKey;
  owner: PublicKey;
  series: PublicKey;
  side: number;
  /** Claims bought by `open_lock` (claim units, 6 decimals). */
  claims: bigint;
  /** Claims in the escrow now: what `close_lock` sells or redeems. */
  escrowAmount: bigint;
  /** Collateral paid, fees included (micro-USDC). */
  paid: bigint;
  hours: number;
  /** The owner's own rate from the bill, micro-USD per GPU-hour (display only). */
  refRate: bigint;
  autoRoll: boolean;
  rentPayer: PublicKey;
  createdTs: number;
  escrow: PublicKey;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLockView(address: PublicKey, l: any, escrowAmount: bigint): LockView {
  return {
    address,
    owner: l.owner,
    series: l.series,
    side: l.side,
    claims: big(l.claims),
    escrowAmount,
    paid: big(l.paid),
    hours: l.hours,
    refRate: big(l.refRate),
    autoRoll: l.autoRoll,
    rentPayer: l.rentPayer,
    createdTs: Number(l.createdTs.toString()),
    escrow: l.escrow,
  };
}

/** The amount of SPL token accounts (bytes 64 to 72), 0 for a missing account. */
async function tokenAmounts(connection: Connection, accounts: PublicKey[]): Promise<bigint[]> {
  const out: bigint[] = [];
  for (let i = 0; i < accounts.length; i += 100) {
    const infos = await connection.getMultipleAccountsInfo(accounts.slice(i, i + 100));
    for (const info of infos) out.push(info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n);
  }
  return out;
}

/** One lock by address, with its escrow balance, or null. */
export async function getLock(connection: Connection, address: PublicKey): Promise<LockView | null> {
  const l = await clampProgram(connection).account.lock.fetchNullable(address);
  if (!l) return null;
  const [amount] = await tokenAmounts(connection, [l.escrow]);
  return toLockView(address, l, amount ?? 0n);
}

/** Every open lock of `owner` (of everyone without an owner), newest first, with escrow balances. */
export async function getLocks(connection: Connection, owner?: PublicKey): Promise<LockView[]> {
  const all = await clampProgram(connection).account.lock.all(
    owner ? [{ memcmp: { offset: 8, bytes: owner.toBase58() } }] : [],
  );
  const amounts = await tokenAmounts(
    connection,
    all.map((a) => a.account.escrow),
  );
  return all
    .map((a, i) => toLockView(a.publicKey, a.account, amounts[i] ?? 0n))
    .sort((a, b) => b.createdTs - a.createdTs);
}

/**
 * GPU-hours expected in the rest of the series, from the hours of a bill
 * window (default the last 30 days) at the same pace. Rounded down. Pass
 * the summary's `windowSecs` for a bill or an earnings summary.
 */
export function hoursForRest(billHours: number, s: SeriesView, now: number, windowSecs = BILL_WINDOW_SECS): number {
  if (!(billHours >= 0) || windowSecs <= 0) throw new Error("invalid input");
  const rest = Math.max(0, s.expiryTs - Math.max(now, s.startTs));
  return Math.floor((billHours * rest) / windowSecs);
}

export interface LockSize {
  /** Claims to buy (claim units, 6 decimals), spec 10.1: hours * W / f. */
  claims: bigint;
  /** The part of the period that is left, in ppm (f). */
  fractionLeftPpm: bigint;
  /** f < 0.5: the web app must warn (spec 10.1). */
  lateInPeriod: boolean;
}

/**
 * Lock size for `hours` expected in the rest of the series (spec 10.1).
 * Before the start, f = 1. Null when the series has expired.
 */
export function lockSize(hours: number, s: SeriesView, now: number): LockSize | null {
  if (!Number.isInteger(hours) || hours < 0) throw new Error("hours must be a whole number of 0 or more");
  const duration = BigInt(s.expiryTs - s.startTs);
  const remaining = BigInt(Math.min(s.expiryTs - now, s.expiryTs - s.startTs));
  if (remaining <= 0n) return null;
  const claims = lockClaims(BigInt(hours), s.lower, s.upper, remaining, duration);
  const fractionLeftPpm = (remaining * PPM) / duration;
  return { claims, fractionLeftPpm, lateInPeriod: fractionLeftPpm < PPM / 2n };
}

export interface BillLockSize extends LockSize {
  /**
   * GPU-hours of a full period of this series at the bill's pace, rounded to
   * a whole hour: the value to pass as `open_lock`'s `hours` (spec 10.1,
   * D-063), so that `roll_lock` buys `hours * W` for the next full period.
   */
  hours: number;
}

/**
 * Lock size straight from a bill: `billHours` used in a window of
 * `windowSecs` (default 30 days), the same pace for the rest of the series
 * (spec 10.1). The claims do not depend on when the lock opens
 * (`hours_rest / f = billHours * duration / window`) and are not cut by
 * rounding the hours, so a small bill still gets a lock in a daily series.
 * Null when the series has expired.
 */
export function lockSizeFromBill(billHours: number, s: SeriesView, now: number, windowSecs = BILL_WINDOW_SECS): BillLockSize | null {
  if (!(billHours >= 0) || !Number.isFinite(billHours) || windowSecs <= 0) throw new Error("invalid input");
  const duration = s.expiryTs - s.startTs;
  const remaining = Math.min(s.expiryTs - now, duration);
  if (remaining <= 0) return null;
  // milli-hours keep three decimals of the bill
  const milli = BigInt(Math.round(billHours * 1000));
  const claims = (milli * (s.upper - s.lower) * BigInt(duration)) / (1000n * BigInt(windowSecs));
  const fractionLeftPpm = (BigInt(remaining) * PPM) / BigInt(duration);
  return {
    claims,
    fractionLeftPpm,
    lateInPeriod: fractionLeftPpm < PPM / 2n,
    hours: Math.round((billHours * duration) / windowSecs),
  };
}

export type LockValueNow =
  | { how: "sell"; usdc: bigint; fee: bigint }
  | { how: "redeem"; usdc: bigint }
  | { how: "waits_for_settlement" }
  | { how: "blocked"; blocked: Exclude<QuoteBlock, null> };

/** What `close_lock` would pay for the escrow now (spec 10.4). */
export function lockValueNow(lock: LockView, s: SeriesView, index: IndexView, now: number): LockValueNow {
  const amount = lock.escrowAmount;
  if (s.settled) {
    const value = lock.side === SIDE_UP ? s.upValue : PPM - s.upValue;
    return { how: "redeem", usdc: (amount * value) / PPM };
  }
  if (now >= s.closeTs) return { how: "waits_for_settlement" };
  if (amount === 0n) return { how: "sell", usdc: 0n, fee: 0n };
  const q = quoteSell(s, index, lock.side, amount, now);
  if (q.blocked) return { how: "blocked", blocked: q.blocked };
  return { how: "sell", usdc: q.out, fee: q.fee };
}

export interface OutcomeRow {
  /** Period average, micro-USD per GPU-hour. */
  avg: bigint;
  /** GPU bill (UP) or GPU revenue (DOWN) at that average: hours * avg. */
  gpu: bigint;
  /** Value of the claims at settlement. */
  claimValue: bigint;
  /** claimValue - paid. */
  gainLoss: bigint;
  /** UP: bill minus gain (net cost). DOWN: revenue plus gain (net revenue). */
  net: bigint;
}

/**
 * The outcome table of spec 10.2 for a lock of `claims` bought for `paid`
 * over `hours`, at each period average in `avgs`. All amounts micro-USD.
 */
export function lockOutcomes(
  side: number,
  claims: bigint,
  paid: bigint,
  hours: number,
  lower: bigint,
  upper: bigint,
  avgs: bigint[],
): OutcomeRow[] {
  return avgs.map((avg) => {
    const up = bandValuePpm(avg, lower, upper);
    const value = side === SIDE_UP ? up : PPM - up;
    const claimValue = (claims * value) / PPM;
    const gainLoss = claimValue - paid;
    const gpu = BigInt(hours) * avg;
    const net = side === SIDE_UP ? gpu - gainLoss : gpu + gainLoss;
    return { avg, gpu, claimValue, gainLoss, net };
  });
}
