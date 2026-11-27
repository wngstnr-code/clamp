import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { IndexView } from "../src/index-reader.js";
import { hoursForRest, lockOutcomes, lockSize, lockSizeFromBill, lockValueNow, type LockView } from "../src/lock-reader.js";
import { quoteSell, type SeriesView } from "../src/market-reader.js";
import { escrowPda, lockPda } from "../src/pda.js";

const T = 1_800_000_000;
const U = 1_000_000n;
const MONTH = 2_592_000;

// Spec 10.2: band $0.40 to $0.60 over a month
const series = (over: Partial<SeriesView> = {}): SeriesView => ({
  address: PublicKey.default,
  classId: 1,
  kind: 2,
  seq: 0,
  startTs: T,
  closeTs: T + MONTH - 3_600,
  expiryTs: T + MONTH,
  center: 500_000n,
  lower: 400_000n,
  upper: 600_000n,
  startIndex: 500_000n,
  startCumPrice: 0n,
  startCumValid: 0n,
  tradeFeeBps: 100n,
  protocolShareBps: 2_000n,
  upMint: PublicKey.default,
  downMint: PublicKey.default,
  collateral: PublicKey.default,
  pairsOutstanding: 100n * U,
  poolUp: 100n * U,
  poolDown: 100n * U,
  invUp: 0n,
  invDown: 0n,
  lastRecenterTs: T,
  seeded: true,
  settled: false,
  avg: 0n,
  upValue: 0n,
  coveragePpm: 0,
  swept: false,
  ...over,
});

const index = (lastTs: number, lastPrice: bigint): IndexView => ({
  classId: 1,
  observations: PublicKey.default,
  lastTs,
  lastPrice,
  cumPrice: 0n,
  cumValid: 0n,
  obsIndex: 0,
  obsCount: 1,
  updateCount: 1n,
  reports: [],
});

const lock = (escrowAmount: bigint, side = 0): LockView => ({
  address: PublicKey.default,
  owner: PublicKey.default,
  series: PublicKey.default,
  side,
  claims: escrowAmount,
  escrowAmount,
  paid: 40n * U,
  hours: 400,
  refRate: 500_000n,
  autoRoll: false,
  rentPayer: PublicKey.default,
  createdTs: T,
  escrow: PublicKey.default,
});

const AVGS = [300_000n, 400_000n, 500_000n, 600_000n, 700_000n];
const usd = (x: bigint) => Number(x) / 1e6;

describe("lock size (spec 10.1)", () => {
  it("is hours times the band width at the start: Rina needs 80 UP", () => {
    expect(lockSize(400, series(), T)).toEqual({ claims: 80n * U, fractionLeftPpm: 1_000_000n, lateInPeriod: false });
  });
  it("treats a time before the start as f = 1", () => {
    expect(lockSize(400, series(), T - 100)?.claims).toBe(80n * U);
  });
  it("divides by the part of the period that is left and warns below half", () => {
    const half = lockSize(400, series(), T + MONTH / 2)!;
    expect(half.claims).toBe(160n * U);
    expect(half.lateInPeriod).toBe(false);
    const late = lockSize(100, series(), T + (MONTH * 3) / 4)!;
    expect(late.claims).toBe(80n * U);
    expect(late.fractionLeftPpm).toBe(250_000n);
    expect(late.lateInPeriod).toBe(true);
  });
  it("is null after expiry and refuses bad hours", () => {
    expect(lockSize(400, series(), T + MONTH)).toBeNull();
    expect(() => lockSize(1.5, series(), T)).toThrow();
    expect(() => lockSize(-1, series(), T)).toThrow();
    expect(lockSize(0, series(), T)?.claims).toBe(0n);
  });
});

describe("hours from a bill", () => {
  it("keeps the pace of the last 30 days for the rest of the series", () => {
    expect(hoursForRest(400, series(), T)).toBe(400);
    expect(hoursForRest(400, series(), T + MONTH / 2)).toBe(200);
    const weekly = series({ expiryTs: T + 604_800 });
    expect(hoursForRest(400, weekly, T)).toBe(93); // 400 * 7 / 30, rounded down
    expect(hoursForRest(400, series(), T + MONTH + 1)).toBe(0);
  });
  it("gives the same claims whenever the lock opens (size and pace cancel)", () => {
    for (const now of [T, T + MONTH / 4, T + MONTH / 2]) {
      const h = hoursForRest(400, series(), now);
      expect(lockSize(h, series(), now)?.claims).toBe(80n * U);
    }
  });
});

describe("outcome table (spec 10.2)", () => {
  it("matches Rina's table: net cost $200 inside the band", () => {
    const rows = lockOutcomes(0, 80n * U, 40n * U, 400, 400_000n, 600_000n, AVGS);
    expect(rows.map((r) => usd(r.gpu))).toEqual([120, 160, 200, 240, 280]);
    expect(rows.map((r) => usd(r.claimValue))).toEqual([0, 0, 40, 80, 80]);
    expect(rows.map((r) => usd(r.gainLoss))).toEqual([-40, -40, 0, 40, 40]);
    expect(rows.map((r) => usd(r.net))).toEqual([160, 200, 200, 200, 240]);
  });
  it("matches Budi's revenue lock: net revenue $200 inside the band", () => {
    const rows = lockOutcomes(1, 80n * U, 40n * U, 400, 400_000n, 600_000n, AVGS);
    expect(rows.map((r) => usd(r.net))).toEqual([160, 200, 200, 200, 240]);
    expect(rows.map((r) => usd(r.claimValue))).toEqual([80, 80, 40, 0, 0]);
  });
});

describe("value of a lock now (close_lock mirror)", () => {
  it("sells before close_ts like quoteSell", () => {
    const v = lockValueNow(lock(10n * U), series(), index(T, 500_000n), T + 60);
    const q = quoteSell(series(), index(T, 500_000n), 0, 10n * U, T + 60);
    expect(q.blocked).toBeNull();
    expect(v).toEqual({ how: "sell", usdc: q.blocked === null ? q.out : 0n, fee: q.blocked === null ? q.fee : 0n });
  });
  it("waits between close_ts and settlement", () => {
    expect(lockValueNow(lock(U), series(), index(T, 500_000n), T + MONTH - 3_600)).toEqual({ how: "waits_for_settlement" });
  });
  it("redeems after settlement, rounded down, for both sides", () => {
    const s = series({ settled: true, upValue: 333_333n });
    expect(lockValueNow(lock(3n), s, index(T, 1n), T + MONTH)).toEqual({ how: "redeem", usdc: 0n });
    expect(lockValueNow(lock(80n * U), s, index(T, 1n), T + MONTH)).toEqual({ how: "redeem", usdc: 26_666_640n });
    expect(lockValueNow(lock(80n * U, 1), s, index(T, 1n), T + MONTH)).toEqual({ how: "redeem", usdc: 53_333_360n });
  });
  it("reports a paused pool instead of a price", () => {
    const v = lockValueNow(lock(U), series(), index(T, 900_000n), T + 60);
    expect(v).toEqual({ how: "blocked", blocked: "paused" });
  });
});

describe("lock PDAs", () => {
  it("differ by side and derive the escrow from the lock", () => {
    const owner = new PublicKey("FxgwWh2iMLftA5PNTKCoXyDv9BN6JbERg16Qj4f8r2Bn");
    const s = new PublicKey("9m7i36dV81UfUG9Th5GYUjnZu9Y8rYaPUQUh48kiBF3c");
    expect(lockPda(owner, s, 0).equals(lockPda(owner, s, 1))).toBe(false);
    expect(escrowPda(lockPda(owner, s, 0)).equals(escrowPda(lockPda(owner, s, 0)))).toBe(true);
  });
});

describe("lock size from a bill", () => {
  it("equals hours * W for a month-long series, whenever it opens", () => {
    for (const now of [T, T + MONTH / 4, T + MONTH / 2]) {
      expect(lockSizeFromBill(400, series(), now)?.claims).toBe(80n * U);
    }
    // hours of a full period, whenever the lock opens (what roll_lock reuses)
    expect(lockSizeFromBill(400, series(), T + MONTH / 2)?.hours).toBe(400);
  });
  it("keeps a small bill in a short series instead of rounding it to 0", () => {
    const daily = series({ expiryTs: T + 86_400 });
    const late = T + 86_400 - 2_160; // 0.6 h left
    expect(hoursForRest(120, daily, late)).toBe(0);
    const size = lockSizeFromBill(120, daily, late)!;
    // 120 h a month = 4 h a day: 4 * 0.20 = 0.8 claims
    expect(size.claims).toBe(800_000n);
    expect(size.lateInPeriod).toBe(true);
    expect(size.hours).toBe(4);
  });
  it("stores at least 1 hour for a lock, so a small bill can still roll", () => {
    const daily = series({ expiryTs: T + 86_400 });
    expect(lockSizeFromBill(10, daily, T)?.hours).toBe(1); // 10 h a month = 0.33 h a day
    expect(lockSizeFromBill(0, daily, T)).toMatchObject({ claims: 0n, hours: 0 });
  });
  it("takes the window of the bill and refuses bad input", () => {
    // 7 days of 100 h: the same pace as 30 days of 428.57 h
    expect(lockSizeFromBill(100, series(), T, 7 * 86_400)?.claims).toBe((100_000n * 200_000n * 2_592_000n) / (1000n * 604_800n));
    expect(lockSizeFromBill(400, series(), T + MONTH)).toBeNull();
    expect(() => lockSizeFromBill(-1, series(), T)).toThrow();
    expect(() => lockSizeFromBill(1, series(), T, 0)).toThrow();
  });
});
