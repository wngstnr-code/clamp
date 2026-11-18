// Mirror of programs/clamp/src/math/median.rs. Same inputs give the same
// outputs; the shared vectors in test/vectors/index-math.json check that.

import { PPM } from "../constants.js";

/** Average of two values, rounded down. */
export function meanFloor(a: bigint, b: bigint): bigint {
  return a / 2n + b / 2n + ((a % 2n) + (b % 2n)) / 2n;
}

/** Median; for an even count the average of the two middle values, rounded down. */
export function median(values: readonly bigint[]): bigint | null {
  const n = values.length;
  if (n === 0) return null;
  const v = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (n % 2 === 1) return v[(n - 1) / 2]!;
  return meanFloor(v[n / 2 - 1]!, v[n / 2]!);
}

/** Weight from capacity tiers (spec 6.1): 0 -> 0, 1..4 -> 1, 5+ -> 2. */
export function sourceWeight(hasCapacity: boolean, capacity: bigint, fixedWeight: number): number {
  if (!hasCapacity) return fixedWeight;
  if (capacity === 0n) return 0;
  if (capacity <= 4n) return 1;
  return 2;
}

export interface Sample {
  price: bigint;
  capacity: bigint;
}

export const MAX_SAMPLES = 5;

/** Combine the fresh reports for one source (spec 6.2 step 3). */
export function combineSource(
  samples: readonly Sample[],
  minPrice: bigint,
  maxPrice: bigint,
  minReporters: number,
): Sample | null {
  const kept = samples
    .slice(0, MAX_SAMPLES)
    .filter((s) => s.price > 0n && s.price >= minPrice && s.price <= maxPrice);
  if (kept.length === 0 || kept.length < minReporters) return null;
  return {
    price: median(kept.map((s) => s.price))!,
    capacity: median(kept.map((s) => s.capacity))!,
  };
}

export interface Weighted {
  price: bigint;
  weight: number;
}

/** Weighted median (spec 6.2 step 5). Weight 0 entries are ignored. */
export function weightedMedian(entries: readonly Weighted[]): bigint | null {
  const sorted = [...entries].sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  const total = sorted.reduce((t, e) => t + e.weight, 0);
  if (total === 0) return null;
  let running = 0;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.weight === 0) continue;
    running += e.weight;
    if (running * 2 === total) {
      const next = sorted.slice(i + 1).find((n) => n.weight > 0);
      return next ? meanFloor(e.price, next.price) : null;
    }
    if (running * 2 > total) return e.price;
  }
  return null;
}

/** Step limit (spec 6.2 step 6). Bounds round inward. `last = 0` passes. */
export function applyStepLimit(candidate: bigint, last: bigint, maxStepPpm: bigint): bigint {
  if (last === 0n) return candidate;
  if (maxStepPpm > PPM) throw new Error("max step above 100%");
  const lo = (last * (PPM - maxStepPpm) + PPM - 1n) / PPM;
  const hi = (last * (PPM + maxStepPpm)) / PPM;
  return candidate < lo ? lo : candidate > hi ? hi : candidate;
}
