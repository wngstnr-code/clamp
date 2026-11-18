import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { IndexView } from "../src/index-reader.js";
import { poolForTrade, quoteBuy, quoteCostFor, quoteSell, seriesFairValue, type SeriesView } from "../src/market-reader.js";
import { buy } from "../src/math/pool.js";

const T = 1_800_000_000;
const U = 1_000_000n;

const series = (over: Partial<SeriesView> = {}): SeriesView => ({
  address: PublicKey.default,
  classId: 1,
  kind: 0,
  seq: 0,
  startTs: T,
  closeTs: T + 86_400 - 3_600,
  expiryTs: T + 86_400,
  center: 310_000n,
  lower: 279_000n,
  upper: 341_000n,
  startIndex: 310_000n,
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

const index = (lastTs: number, lastPrice: bigint, cumPrice = 0n, cumValid = 0n): IndexView => ({
  classId: 1,
  observations: PublicKey.default,
  lastTs,
  lastPrice,
  cumPrice,
  cumValid,
  obsIndex: 0,
  obsCount: 1,
  updateCount: 1n,
  reports: [],
});

describe("fair value (valuation.rs mirror)", () => {
  it("is 0.5 when the index stays at the band center", () => {
    expect(seriesFairValue(series(), index(T, 310_000n), T + 600)).toBe(500_000n);
  });
  it("uses the last price for the time that is left", () => {
    // index jumped to the upper bound right at the start: projected average = upper
    expect(seriesFairValue(series(), index(T, 341_000n), T)).toBe(1_000_000n);
    // half the period at the center, then the upper bound for the rest: 0.75
    const half = 43_200;
    const idx = index(T + half, 341_000n, 310_000n * BigInt(half), BigInt(half));
    expect(seriesFairValue(series(), idx, T + half)).toBe(750_000n);
  });
  it("returns the settled value once settled", () => {
    expect(seriesFairValue(series({ settled: true, upValue: 123n }), index(T, 1n), T)).toBe(123n);
  });
});

describe("quotes", () => {
  it("match the pool math when no re-centering is due", () => {
    const q = quoteBuy(series(), index(T, 310_000n), 0, 10n * U, T + 60);
    expect(q.blocked).toBeNull();
    if (q.blocked === null) expect(q.out).toBe(buy(100n * U, 100n * U, 10n * U, 100n).out);
    expect(q.blocked === null && q.out).toBe(18_908_189n);
  });
  it("re-center first after a newer index update", () => {
    const s = series();
    // the index rises 5% (fair value about 0.75), as in the Rust market test
    const idx = index(T + 600, 325_500n, 310_000n * 600n, 600n);
    const pool = poolForTrade(s, idx, T + 700);
    expect(pool.fairValue > 700_000n && pool.fairValue < 800_000n).toBe(true);
    expect(pool.poolDown > pool.poolUp).toBe(true);
    const q = quoteBuy(s, idx, 0, 10n * U, T + 700);
    expect(q.blocked === null && q.out < 18_908_189n).toBe(true);
  });
  it("refuse unseeded, closed and paused pools", () => {
    expect(quoteBuy(series({ seeded: false }), index(T, 310_000n), 0, U, T).blocked).toBe("not_seeded");
    expect(quoteSell(series(), index(T, 310_000n), 0, U, T + 86_400 - 3_600).blocked).toBe("closed");
    expect(quoteCostFor(series(), index(T, 341_000n), 0, U, T).blocked).toBe("paused");
  });
  it("cost for an exact number of claims buys at least that many", () => {
    const q = quoteCostFor(series(), index(T, 310_000n), 1, 5n * U, T + 60);
    expect(q.blocked).toBeNull();
    if (q.blocked === null) expect(buy(100n * U, 100n * U, q.usdcIn, 100n).out >= 5n * U).toBe(true);
  });
});
