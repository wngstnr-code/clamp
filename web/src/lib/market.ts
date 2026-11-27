import { type IndexView, MAX_GAP, poolForTrade, PPM, type SeriesView, seriesFairValue } from "@clamp/sdk";

/** Pure helpers for the market pages, usable on the server and in the browser. */

export const CLASS_NAMES: Record<number, string> = { 1: "RTX 4090", 2: "H100" };
export const KIND_NAMES = ["Daily", "Weekly", "Monthly"] as const;

export const seriesName = (s: Pick<SeriesView, "classId" | "kind">) =>
  `${CLASS_NAMES[s.classId] ?? `Class ${s.classId}`} ${KIND_NAMES[s.kind] ?? ""}`.trim();
/** Daily series carry a "Short series" label everywhere (architecture.md section 7). */
export const isShort = (s: Pick<SeriesView, "kind">) => s.kind === 0;

/** Micro-USD (or micro-tUSDC) to a number of dollars. */
export const micro = (v: bigint) => Number(v) / 1e6;
/** ppm to a 0..1 number. */
export const ppm = (v: bigint) => Number(v) / Number(PPM);

/**
 * Pool price of UP and DOWN in tUSDC, as the next trade would see it (re-centered on the
 * fair value when the index moved since the last trade). They add up to 1.
 */
export function poolPrices(s: SeriesView, index: IndexView, now: number) {
  const pool = poolForTrade(s, index, now);
  const total = pool.poolUp + pool.poolDown;
  const up = total > 0n ? Number(pool.poolDown) / Number(total) : ppm(pool.fairValue);
  return { up, down: 1 - up };
}

/**
 * The period average counted so far, without projecting the rest of the period
 * (what UP and DOWN would pay if the period ended now). Null before anything is counted.
 */
export function averageSoFar(s: SeriesView, index: IndexView, now: number): bigint | null {
  if (s.settled) return s.avg;
  let at = Math.min(now, s.expiryTs);
  if (at < index.lastTs) at = index.lastTs;
  const counted = BigInt(Math.min(at - index.lastTs, MAX_GAP));
  const cumPrice = index.cumPrice + index.lastPrice * counted - s.startCumPrice;
  const cumValid = index.cumValid + counted - s.startCumValid;
  return cumValid > 0n && cumPrice > 0n ? cumPrice / cumValid : null;
}

/** UP value (0..1) for an average: clamp((avg - lower) / (upper - lower), 0, 1). */
export function upValueAt(s: SeriesView, avg: bigint) {
  if (avg <= s.lower) return 0;
  if (avg >= s.upper) return 1;
  return Number(avg - s.lower) / Number(s.upper - s.lower);
}

/** Fair value of UP in 0..1, the program's own valuation (spec 8.1). */
export const fairUp = (s: SeriesView, index: IndexView, now: number) => ppm(seriesFairValue(s, index, now));

/** "3h 20m", "1d 20h", "12m". */
export function timeLeft(seconds: number) {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "0.4825" style claim price. */
export const p4 = (v: number) => v.toFixed(4);
/** "1,000.00" style token amount. */
export const amount2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
