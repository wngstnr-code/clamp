// Mirror of programs/clamp/src/math/pool.rs (spec 8, 10.1, 11). bigint
// throughout; the shared vectors in test/vectors/pool-vault.json check parity.

import { PPM } from "../constants.js";

export const P_MIN_PPM = 20_000n;
export const BPS_DENOM = 10_000n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Integer square root, rounded down. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

export function isqrtCeil(n: bigint): bigint {
  const r = isqrt(n);
  return r * r === n ? r : r + 1n;
}

/** Value of one UP claim for an average, in ppm (spec 11). */
export function bandValuePpm(avg: bigint, lower: bigint, upper: bigint): bigint {
  if (lower >= upper) throw new Error("lower must be below upper");
  if (avg <= lower) return 0n;
  if (avg >= upper) return PPM;
  return ((avg - lower) * PPM) / (upper - lower);
}

/** Projected period average (spec 8.1), or null when nothing is counted and no time is left. */
export function projectedAvg(
  countedPrice: bigint,
  countedSecs: bigint,
  lastPrice: bigint,
  remainingSecs: bigint,
): bigint | null {
  const den = countedSecs + remainingSecs;
  if (den === 0n) return null;
  return (countedPrice + lastPrice * remainingSecs) / den;
}

export const clampPrice = (p: bigint) => (p < P_MIN_PPM ? P_MIN_PPM : p > PPM - P_MIN_PPM ? PPM - P_MIN_PPM : p);
export const poolPaused = (v: bigint) => v < P_MIN_PPM || v > PPM - P_MIN_PPM;

export interface Holdings {
  poolUp: bigint;
  invUp: bigint;
  poolDown: bigint;
  invDown: bigint;
}

/** Re-centering (spec 8.2). */
export function recenter(h: Holdings, pPpm: bigint): Holdings {
  const p = clampPrice(pPpm);
  const tUp = h.poolUp + h.invUp;
  const tDown = h.poolDown + h.invDown;
  const a = (tUp * PPM) / (PPM - p);
  const b = (tDown * PPM) / p;
  const s = a < b ? a : b;
  let poolUp = (s * (PPM - p)) / PPM;
  let poolDown = (s * p) / PPM;
  if (poolUp > tUp) poolUp = tUp;
  if (poolDown > tDown) poolDown = tDown;
  return { poolUp, invUp: tUp - poolUp, poolDown, invDown: tDown - poolDown };
}

export function feeOf(usdc: bigint, feeBps: bigint): bigint {
  if (feeBps > BPS_DENOM) throw new Error("fee above 100%");
  return ceilDiv(usdc * feeBps, BPS_DENOM);
}

/** Splits a fee into [vault part, protocol part]; the protocol part rounds down. */
export function splitFee(fee: bigint, protocolShareBps: bigint): [bigint, bigint] {
  const protocol = (fee * protocolShareBps) / BPS_DENOM;
  return [fee - protocol, protocol];
}

export interface BuyResult {
  fee: bigint;
  pairs: bigint;
  out: bigint;
  newPoolS: bigint;
  newPoolO: bigint;
}

/** Buy of side S with `usdcIn` (spec 8.3). */
export function buy(poolS: bigint, poolO: bigint, usdcIn: bigint, feeBps: bigint): BuyResult {
  if (poolS === 0n || poolO === 0n) throw new Error("empty pool");
  const fee = feeOf(usdcIn, feeBps);
  const x = usdcIn - fee;
  if (x === 0n) throw new Error("nothing left after the fee");
  const newO = poolO + x;
  const newS = ceilDiv(poolS * poolO, newO);
  return { fee, pairs: x, out: poolS + x - newS, newPoolS: newS, newPoolO: newO };
}

const outForPairs = (s: bigint, o: bigint, x: bigint) => s + x - ceilDiv(s * o, o + x);

/** Smallest `usdcIn` whose buy gives at least `a` claims (spec 8.3), fee included. */
export function costExactOut(poolS: bigint, poolO: bigint, a: bigint, feeBps: bigint): bigint {
  if (poolS === 0n || poolO === 0n || a === 0n || feeBps >= BPS_DENOM) throw new Error("invalid input");
  const b = poolS + poolO - a;
  const root = isqrtCeil(b * b + 4n * a * poolO);
  let x = (root - b + 1n) / 2n;
  if (x < 0n) x = 0n;
  while (x > 0n && outForPairs(poolS, poolO, x - 1n) >= a) x -= 1n;
  while (outForPairs(poolS, poolO, x) < a) x += 1n;
  let usdc = ceilDiv(x * BPS_DENOM, BPS_DENOM - feeBps);
  while (usdc > 0n && usdc - 1n - feeOf(usdc - 1n, feeBps) >= x) usdc -= 1n;
  while (usdc - feeOf(usdc, feeBps) < x) usdc += 1n;
  return usdc;
}

export interface SellResult {
  pairs: bigint;
  fee: bigint;
  out: bigint;
  newPoolS: bigint;
  newPoolO: bigint;
}

/** Sell of `a` claims of side S (spec 8.4). */
export function sell(poolS: bigint, poolO: bigint, a: bigint, feeBps: bigint): SellResult {
  if (poolS === 0n || poolO === 0n || a === 0n) throw new Error("invalid input");
  const u = poolS + a;
  const d = poolO;
  const kBefore = poolS * d;
  const sum = u + d;
  let y = (sum - isqrtCeil(sum * sum - 4n * a * d)) / 2n;
  while (y > 0n && (u - y) * (d - y) < kBefore) y -= 1n;
  if (y === 0n) throw new Error("too small to sell");
  const fee = feeOf(y, feeBps);
  return { pairs: y, fee, out: y - fee, newPoolS: u - y, newPoolO: d - y };
}

/** Lock size (spec 10.1) in claim units, rounded down. */
export function lockClaims(
  hours: bigint,
  lower: bigint,
  upper: bigint,
  remainingSecs: bigint,
  durationSecs: bigint,
): bigint {
  if (lower >= upper || remainingSecs === 0n || remainingSecs > durationSecs) throw new Error("invalid input");
  return (hours * (upper - lower) * durationSecs) / remainingSecs;
}
