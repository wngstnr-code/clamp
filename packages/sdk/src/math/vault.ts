// Mirror of programs/clamp/src/math/vault.rs (spec 9).

import { PPM } from "../constants.js";
import { BPS_DENOM } from "./pool.js";

export const MIN_FIRST_DEPOSIT = 10_000_000n;
export const LOCKED_SHARES = 1_000n;

export function seriesValue(tUp: bigint, tDown: bigint, vPpm: bigint, roundUp: boolean): bigint {
  if (vPpm > PPM) throw new Error("value above 1");
  const num = tUp * vPpm + tDown * (PPM - vPpm);
  return roundUp ? (num + PPM - 1n) / PPM : num / PPM;
}

export const nav = (idle: bigint, seriesValues: bigint[]) => seriesValues.reduce((a, v) => a + v, idle);

/** [shares to the depositor, shares locked forever]. */
export function depositShares(amount: bigint, totalShares: bigint, navUp: bigint): [bigint, bigint] {
  if (amount === 0n) throw new Error("zero amount");
  if (totalShares === 0n) {
    if (amount < MIN_FIRST_DEPOSIT) throw new Error("first deposit below 10 USDC");
    return [amount - LOCKED_SHARES, LOCKED_SHARES];
  }
  if (navUp === 0n) throw new Error("vault has no value");
  const shares = (amount * totalShares) / navUp;
  if (shares === 0n) throw new Error("deposit too small");
  return [shares, 0n];
}

export function withdrawAmount(shares: bigint, totalShares: bigint, navDown: bigint): bigint {
  if (shares === 0n || shares > totalShares) throw new Error("invalid shares");
  return (shares * navDown) / totalShares;
}

export function seriesAllocation(navDown: bigint, idle: bigint, allocBps: bigint): bigint {
  if (allocBps > BPS_DENOM) throw new Error("allocation above 100%");
  const share = (navDown * allocBps) / BPS_DENOM;
  return share < idle ? share : idle;
}
