import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import type { SeriesView } from "../src/market-reader.js";
import { nextObservation, type Observation } from "../src/math/twap.js";
import { checkSettlement, computeSettlement, sumsAtTime } from "../src/settlement.js";

const T = 1_800_000_000;
const DAY = 86_400;
const MAX_GAP = 7_200;

/** Observations every 900 s at the given prices, starting before the series. */
function history(prices: bigint[], from = T - 3_600): Observation[] {
  const out: Observation[] = [];
  let prev: Observation | null = null;
  prices.forEach((p, i) => {
    prev = nextObservation(prev, from + i * 900, p, MAX_GAP);
    out.push(prev);
  });
  return out;
}

const series = (obs: Observation[], over: Partial<SeriesView> = {}): SeriesView => {
  const start = sumsAtTime(obs, T)!.sums;
  return {
    address: PublicKey.default,
    classId: 1,
    kind: 0,
    seq: 0,
    startTs: T,
    closeTs: T + DAY - 3_600,
    expiryTs: T + DAY,
    center: 310_000n,
    lower: 279_000n,
    upper: 341_000n,
    startIndex: 310_000n,
    startCumPrice: start.cumPrice,
    startCumValid: start.cumValid,
    tradeFeeBps: 100n,
    protocolShareBps: 2_000n,
    upMint: PublicKey.default,
    downMint: PublicKey.default,
    collateral: PublicKey.default,
    pairsOutstanding: 0n,
    poolUp: 0n,
    poolDown: 0n,
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
  };
};

// a day at 310,000 then the last half at 325,500 (+5%), plus updates after expiry
const prices = [...Array(4 + 48).fill(310_000n), ...Array(48 + 8).fill(325_500n)] as bigint[];
const OBS = history(prices);

describe("settlement proof", () => {
  const settled = (obs: Observation[]) => {
    const s = series(obs);
    const r = computeSettlement(s, sumsAtTime(obs, s.expiryTs)!.sums);
    return { s: { ...s, settled: true, avg: r.avg, upValue: r.upValue, coveragePpm: r.coveragePpm }, r };
  };

  it("recomputes the average, the UP value and the coverage", () => {
    const { r } = settled(OBS);
    // half the day at each price: average 317,750, UP (317,750 - 279,000) / 62,000
    expect(r.avg).toBe(317_750n);
    expect(r.upValue).toBe(625_000n);
    expect(r.coveragePpm).toBe(1_000_000);
  });

  it("matches a series settled the same way, ignoring updates after expiry", () => {
    const { s } = settled(OBS);
    const later = history([...prices, ...Array(20).fill(400_000n)]);
    expect(checkSettlement(s, later)).toMatchObject({ status: "match", startMatches: true, differences: [] });
  });

  it("flags a different stored result", () => {
    const { s } = settled(OBS);
    const c = checkSettlement({ ...s, upValue: s.upValue + 1n }, OBS);
    expect(c.status).toBe("mismatch");
    expect(c.differences[0]).toMatch(/^upValue/);
    expect(checkSettlement({ ...s, startCumValid: s.startCumValid + 1n }, OBS).differences).toContain("start snapshot");
  });

  it("counts only MAX_GAP after an oracle stop and falls back to the start index with no counted time", () => {
    // the oracle stops 2 hours into the day
    const short = history(Array(4 + 8).fill(310_000n));
    const s = series(short);
    const r = computeSettlement(s, sumsAtTime(short, s.expiryTs)!.sums);
    expect(r.countedSecs).toBe(BigInt(7 * 900 + MAX_GAP));
    expect(r.coveragePpm).toBe(Math.floor(((7 * 900 + MAX_GAP) * 1_000_000) / DAY));
    const none = computeSettlement(s, { cumPrice: s.startCumPrice, cumValid: s.startCumValid });
    expect(none.avg).toBe(310_000n);
  });

  it("says when the history is gone or the series is not settled", () => {
    const { s } = settled(OBS);
    expect(checkSettlement(s, OBS.slice(200)).status).toBe("history_gone");
    expect(checkSettlement(s, []).status).toBe("history_gone");
    expect(checkSettlement(series(OBS), OBS).status).toBe("not_settled");
  });
});
