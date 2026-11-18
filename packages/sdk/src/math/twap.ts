// Mirror of programs/clamp/src/math/twap.rs (spec 6.3).

export interface Observation {
  ts: number;
  price: bigint;
  cumPrice: bigint;
  cumValid: bigint;
}

export interface Sums {
  cumPrice: bigint;
  cumValid: bigint;
}

function countedSecs(from: number, to: number, maxGap: number): bigint {
  if (to < from || maxGap < 0) throw new Error("time goes backwards");
  return BigInt(Math.min(to - from, maxGap));
}

/** The observation stored by an accepted update. */
export function nextObservation(
  prev: Observation | null,
  t: number,
  price: bigint,
  maxGap: number,
): Observation {
  if (!prev) return { ts: t, price, cumPrice: 0n, cumValid: 0n };
  const counted = countedSecs(prev.ts, t, maxGap);
  return {
    ts: t,
    price,
    cumPrice: prev.cumPrice + prev.price * counted,
    cumValid: prev.cumValid + counted,
  };
}

/** Running sums at time `x` from the last observation at or before it. */
export function sumsAt(a: Observation, x: number, maxGap: number): Sums {
  const counted = countedSecs(a.ts, x, maxGap);
  return { cumPrice: a.cumPrice + a.price * counted, cumValid: a.cumValid + counted };
}

/** Time-weighted average, rounded down. `null` when no time was counted. */
export function average(start: Sums, end: Sums): bigint | null {
  const valid = end.cumValid - start.cumValid;
  const total = end.cumPrice - start.cumPrice;
  if (valid < 0n || total < 0n) throw new Error("reversed range");
  if (valid === 0n) return null;
  return total / valid;
}

/**
 * Last observation with `ts <= x` in a ring (`newest` slot, `count` filled).
 * Returns the physical slot or `null`.
 */
export function findAtOrBefore(
  ring: readonly Observation[],
  newest: number,
  count: number,
  x: number,
): number | null {
  const capacity = ring.length;
  if (count === 0 || capacity === 0 || count > capacity || newest >= capacity) return null;
  const oldest = (newest + capacity + 1 - count) % capacity;
  const slot = (logical: number) => (oldest + logical) % capacity;
  if (ring[slot(0)]!.ts > x) return null;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = lo + Math.ceil((hi - lo) / 2);
    if (ring[slot(mid)]!.ts <= x) lo = mid;
    else hi = mid - 1;
  }
  return slot(lo);
}
