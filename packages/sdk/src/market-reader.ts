// Readers and quotes for the claim market (spec 7 to 9). The pure functions
// mirror programs/clamp/src/instructions/valuation.rs and trade.rs, so a
// quote equals what the program does with the same chain state.

import { Connection, PublicKey } from "@solana/web3.js";

import { MAX_GAP, PPM, SIDE_UP } from "./constants.js";
import { getIndex, type IndexView } from "./index-reader.js";
import { buy, costExactOut, poolPaused, projectedAvg, recenter, sell, bandValuePpm, type Holdings } from "./math/pool.js";
import { seriesValue } from "./math/vault.js";
import { classPda, idlePda, sharesMintPda, vaultPda } from "./pda.js";
import { clampProgram } from "./program.js";

const big = (x: { toString(): string }) => BigInt(x.toString());
const num = (x: { toString(): string }) => Number(x.toString());

export interface SeriesView {
  address: PublicKey;
  classId: number;
  kind: number;
  seq: number;
  startTs: number;
  closeTs: number;
  expiryTs: number;
  center: bigint;
  lower: bigint;
  upper: bigint;
  startIndex: bigint;
  startCumPrice: bigint;
  startCumValid: bigint;
  tradeFeeBps: bigint;
  protocolShareBps: bigint;
  upMint: PublicKey;
  downMint: PublicKey;
  collateral: PublicKey;
  pairsOutstanding: bigint;
  poolUp: bigint;
  poolDown: bigint;
  invUp: bigint;
  invDown: bigint;
  lastRecenterTs: number;
  seeded: boolean;
  settled: boolean;
  avg: bigint;
  upValue: bigint;
  coveragePpm: number;
  swept: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSeriesView(address: PublicKey, s: any): SeriesView {
  return {
    address,
    classId: s.classId,
    kind: s.kind,
    seq: s.seq,
    startTs: num(s.startTs),
    closeTs: num(s.closeTs),
    expiryTs: num(s.expiryTs),
    center: big(s.center),
    lower: big(s.lower),
    upper: big(s.upper),
    startIndex: big(s.startIndex),
    startCumPrice: big(s.startCumPrice),
    startCumValid: big(s.startCumValid),
    tradeFeeBps: BigInt(s.tradeFeeBps),
    protocolShareBps: BigInt(s.protocolShareBps),
    upMint: s.upMint,
    downMint: s.downMint,
    collateral: s.collateral,
    pairsOutstanding: big(s.pairsOutstanding),
    poolUp: big(s.poolUp),
    poolDown: big(s.poolDown),
    invUp: big(s.invUp),
    invDown: big(s.invDown),
    lastRecenterTs: num(s.lastRecenterTs),
    seeded: s.seeded,
    settled: s.settled,
    avg: big(s.avg),
    upValue: BigInt(s.upValue),
    coveragePpm: s.coveragePpm,
    swept: s.swept,
  };
}

export async function getSeries(connection: Connection, address: PublicKey): Promise<SeriesView | null> {
  const s = await clampProgram(connection).account.series.fetchNullable(address);
  return s ? toSeriesView(address, s) : null;
}

/** Every series of the program, newest first, optionally of one class and kind. */
export async function listSeries(connection: Connection, filter?: { classId?: number; kind?: number }) {
  const all = await clampProgram(connection).account.series.all();
  return all
    .map((a) => toSeriesView(a.publicKey, a.account))
    .filter((s) => (filter?.classId === undefined || s.classId === filter.classId) && (filter?.kind === undefined || s.kind === filter.kind))
    .sort((a, b) => b.startTs - a.startTs);
}

/** The latest series of a class and kind, or null when none was created yet. */
export async function currentSeries(connection: Connection, classId: number, kind: number) {
  const cls = await clampProgram(connection).account.classConfig.fetchNullable(classPda(classId));
  const key = cls?.currentSeries[kind];
  if (!key || key.equals(PublicKey.default)) return null;
  return getSeries(connection, key);
}

/**
 * Fair value of one UP claim at `now` in ppm (spec 8.1), as the program
 * computes it: the average so far with the last index price for the rest.
 */
export function seriesFairValue(s: SeriesView, index: IndexView, now: number): bigint {
  if (s.settled) return s.upValue;
  let at = Math.min(now, s.expiryTs);
  if (at < index.lastTs) at = index.lastTs;
  const counted = BigInt(Math.min(at - index.lastTs, MAX_GAP));
  const cumPrice = index.cumPrice + index.lastPrice * counted;
  const cumValid = index.cumValid + counted;
  const countedPrice = cumPrice > s.startCumPrice ? cumPrice - s.startCumPrice : 0n;
  const countedSecs = cumValid > s.startCumValid ? cumValid - s.startCumValid : 0n;
  const remaining = BigInt(Math.max(s.expiryTs - now, 0));
  const avg = projectedAvg(countedPrice, countedSecs, index.lastPrice, remaining) ?? s.startIndex;
  return bandValuePpm(avg, s.lower, s.upper);
}

/** The pool a trade at `now` would use: re-centered when the index has a newer update (spec 8.2). */
export function poolForTrade(s: SeriesView, index: IndexView, now: number): Holdings & { fairValue: bigint } {
  const fairValue = seriesFairValue(s, index, now);
  const h: Holdings = { poolUp: s.poolUp, invUp: s.invUp, poolDown: s.poolDown, invDown: s.invDown };
  const pool = index.lastTs > s.lastRecenterTs ? recenter(h, fairValue) : h;
  return { ...pool, fairValue };
}

export type QuoteBlock = "not_seeded" | "closed" | "paused" | null;

export function tradeBlock(s: SeriesView, fairValue: bigint, now: number): QuoteBlock {
  if (!s.seeded) return "not_seeded";
  if (s.settled || now >= s.closeTs) return "closed";
  if (poolPaused(fairValue)) return "paused";
  return null;
}

/** Claims a buy of `usdcIn` would get (fee included), or why it cannot trade. */
export function quoteBuy(s: SeriesView, index: IndexView, side: number, usdcIn: bigint, now: number) {
  const pool = poolForTrade(s, index, now);
  const blocked = tradeBlock(s, pool.fairValue, now);
  if (blocked) return { blocked } as const;
  const [ps, po] = side === SIDE_UP ? [pool.poolUp, pool.poolDown] : [pool.poolDown, pool.poolUp];
  const r = buy(ps, po, usdcIn, s.tradeFeeBps);
  return { blocked: null, out: r.out, fee: r.fee, fairValue: pool.fairValue } as const;
}

/** USDC a sale of `claims` would pay (fee taken), or why it cannot trade. */
export function quoteSell(s: SeriesView, index: IndexView, side: number, claims: bigint, now: number) {
  const pool = poolForTrade(s, index, now);
  const blocked = tradeBlock(s, pool.fairValue, now);
  if (blocked) return { blocked } as const;
  const [ps, po] = side === SIDE_UP ? [pool.poolUp, pool.poolDown] : [pool.poolDown, pool.poolUp];
  const r = sell(ps, po, claims, s.tradeFeeBps);
  return { blocked: null, out: r.out, fee: r.fee, fairValue: pool.fairValue } as const;
}

/** USDC needed (fee included) to buy exactly `claims` of a side (spec 8.3). */
export function quoteCostFor(s: SeriesView, index: IndexView, side: number, claims: bigint, now: number) {
  const pool = poolForTrade(s, index, now);
  const blocked = tradeBlock(s, pool.fairValue, now);
  if (blocked) return { blocked } as const;
  const [ps, po] = side === SIDE_UP ? [pool.poolUp, pool.poolDown] : [pool.poolDown, pool.poolUp];
  return { blocked: null, usdcIn: costExactOut(ps, po, claims, s.tradeFeeBps), fairValue: pool.fairValue } as const;
}

export interface VaultView {
  address: PublicKey;
  shareMint: PublicKey;
  idle: bigint;
  activeSeries: SeriesView[];
  totalShares: bigint;
  lockedShares: bigint;
  /** NAV rounded down (what a withdrawal uses), null if a series needs settlement. */
  nav: bigint | null;
  /** Micro-USDC per whole share (1e6 units), from `nav`. */
  sharePrice: bigint | null;
}

/** The vault with its NAV valued the way `withdraw` values it (spec 9.1). */
export async function getVault(connection: Connection, now = Math.floor(Date.now() / 1000)): Promise<VaultView | null> {
  const program = clampProgram(connection);
  const v = await program.account.vault.fetchNullable(vaultPda());
  if (!v) return null;
  const [idleBal, supply] = await Promise.all([
    connection.getTokenAccountBalance(idlePda(), "confirmed"),
    connection.getTokenSupply(sharesMintPda(), "confirmed"),
  ]);
  const idle = BigInt(idleBal.value.amount);
  const lockedShares = big(v.lockedShares);
  const totalShares = BigInt(supply.value.amount) + lockedShares;
  const active: SeriesView[] = [];
  let nav: bigint | null = idle;
  const indexes = new Map<number, IndexView | null>();
  for (const key of v.activeSeries.slice(0, v.activeCount)) {
    const s = await getSeries(connection, key);
    if (!s) continue;
    active.push(s);
    if (!indexes.has(s.classId)) indexes.set(s.classId, await getIndex(connection, s.classId));
    const index = indexes.get(s.classId);
    if (nav === null || !index) continue;
    if (!s.settled && now >= s.expiryTs) {
      nav = null; // the program refuses until the series is settled
      continue;
    }
    const value = s.settled ? s.upValue : seriesFairValue(s, index, now);
    nav += seriesValue(s.poolUp + s.invUp, s.poolDown + s.invDown, value, false);
  }
  return {
    address: vaultPda(),
    shareMint: v.shareMint,
    idle,
    activeSeries: active,
    totalShares,
    lockedShares,
    nav,
    sharePrice: nav === null || totalShares === 0n ? null : (nav * PPM) / totalShares,
  };
}
