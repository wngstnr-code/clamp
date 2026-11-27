// Settlement proof (M6, spec 11): recompute a series' settlement from the
// index observations stored on-chain, the same way `settle_series` does
// (programs/clamp/src/instructions/settle.rs and index_view.rs), and compare
// it with what the series account holds. Anyone can run it.

import { Connection, PublicKey } from "@solana/web3.js";

import { MAX_GAP, PPM } from "./constants.js";
import { getObservations } from "./index-reader.js";
import { getSeries, type SeriesView } from "./market-reader.js";
import { bandValuePpm } from "./math/pool.js";
import { average, findAtOrBefore, sumsAt, type Observation, type Sums } from "./math/twap.js";

/** Where the sums of a time came from: as `sums_at_time` in the program. */
export type SumsSource = "exact" | "oldest";

/** Running sums at `x` from an ordered observation list (oldest first), or null before the first update. */
export function sumsAtTime(observations: readonly Observation[], x: number, maxGap = MAX_GAP): { sums: Sums; source: SumsSource } | null {
  const n = observations.length;
  if (n === 0) return null;
  const slot = findAtOrBefore(observations, n - 1, n, x);
  if (slot === null) {
    const o = observations[0]!;
    return { sums: { cumPrice: o.cumPrice, cumValid: o.cumValid }, source: "oldest" };
  }
  return { sums: sumsAt(observations[slot]!, x, maxGap), source: "exact" };
}

export interface Settlement {
  /** Period average, micro-USD per GPU-hour. */
  avg: bigint;
  /** Value of one UP claim in ppm. */
  upValue: bigint;
  coveragePpm: number;
  /** Counted seconds of the period. */
  countedSecs: bigint;
}

/** The settlement of `s` from its start snapshot and the sums at expiry (settle.rs). */
export function computeSettlement(s: SeriesView, end: Sums): Settlement {
  const start: Sums = { cumPrice: s.startCumPrice, cumValid: s.startCumValid };
  // an end older than the start counts as no counted time
  const counted = end.cumValid >= start.cumValid ? end.cumValid - start.cumValid : 0n;
  const avg = counted === 0n ? s.startIndex : (average(start, end) ?? s.startIndex);
  const upValue = bandValuePpm(avg, s.lower, s.upper);
  const duration = BigInt(Math.max(s.expiryTs - s.startTs, 1));
  const cov = (counted * PPM) / duration;
  return { avg, upValue, coveragePpm: Number(cov > PPM ? PPM : cov), countedSecs: counted };
}

export type SettlementStatus =
  /** Recomputed from stored history and equal to the chain. */
  | "match"
  /** Recomputed from stored history and different from the chain. */
  | "mismatch"
  /** The ring no longer holds the period: it cannot be recomputed now. */
  | "history_gone"
  | "not_settled";

export interface SettlementCheck {
  status: SettlementStatus;
  series: SeriesView;
  /** The recomputed result, when the history was there. */
  recomputed: Settlement | null;
  /** The start snapshot recomputed from history equals the one in the series account (null if not checkable). */
  startMatches: boolean | null;
  /** Which fields differ, for `mismatch`. */
  differences: string[];
}

/** Checks a series against an ordered observation list of its class (pure). */
export function checkSettlement(s: SeriesView, observations: readonly Observation[], maxGap = MAX_GAP): SettlementCheck {
  const base = { series: s, recomputed: null, startMatches: null, differences: [] as string[] };
  if (!s.settled) return { ...base, status: "not_settled" };
  const end = sumsAtTime(observations, s.expiryTs, maxGap);
  const startAt = sumsAtTime(observations, s.startTs, maxGap);
  // an "oldest" fallback means the ring lost the time: the program used it too
  // at settlement only if it was already lost then, which this check cannot know
  if (!end || end.source === "oldest") return { ...base, status: "history_gone" };
  const recomputed = computeSettlement(s, end.sums);
  const startMatches =
    startAt && startAt.source === "exact"
      ? startAt.sums.cumPrice === s.startCumPrice && startAt.sums.cumValid === s.startCumValid
      : null;
  const differences: string[] = [];
  if (recomputed.avg !== s.avg) differences.push(`avg ${recomputed.avg} vs ${s.avg}`);
  if (recomputed.upValue !== s.upValue) differences.push(`upValue ${recomputed.upValue} vs ${s.upValue}`);
  if (recomputed.coveragePpm !== s.coveragePpm) differences.push(`coverage ${recomputed.coveragePpm} vs ${s.coveragePpm}`);
  if (startMatches === false) differences.push("start snapshot");
  return { status: differences.length === 0 ? "match" : "mismatch", series: s, recomputed, startMatches, differences };
}

/** Reads a series and its class history from chain and checks the settlement. */
export async function verifySettlement(connection: Connection, series: PublicKey, programId?: PublicKey): Promise<SettlementCheck> {
  const s = await getSeries(connection, series);
  if (!s) throw new Error("series not found");
  const data = await getObservations(connection, s.classId, programId);
  return checkSettlement(s, data?.observations ?? []);
}
