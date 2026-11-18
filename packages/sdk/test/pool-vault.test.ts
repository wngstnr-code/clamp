// The SDK pool and vault math against vectors written by the Rust program math
// (programs/clamp/tests/test_vectors.rs). Same input, same output, or both fail.

import { describe, expect, it } from "vitest";

import v from "./vectors/pool-vault.json" with { type: "json" };
import {
  bandValuePpm,
  buy,
  costExactOut,
  lockClaims,
  projectedAvg,
  recenter,
  sell,
  splitFee,
} from "../src/math/pool.js";
import { depositShares, seriesAllocation, seriesValue, withdrawAmount } from "../src/math/vault.js";

const b = (x: string) => BigInt(x);
const tryOr = <T>(f: () => T): T | null => {
  try {
    return f();
  } catch {
    return null;
  }
};
const str = (x: bigint | null) => (x === null ? null : x.toString());

describe("pool math matches Rust", () => {
  it("buy", () => {
    for (const c of v.buy) {
      const r = tryOr(() => buy(b(c.s), b(c.o), b(c.usdc), BigInt(c.fee_bps)));
      expect(r && { fee: str(r.fee), pairs: str(r.pairs), out: str(r.out), new_s: str(r.newPoolS), new_o: str(r.newPoolO) }).toEqual(c.result);
    }
  });
  it("sell", () => {
    for (const c of v.sell) {
      const r = tryOr(() => sell(b(c.s), b(c.o), b(c.a), BigInt(c.fee_bps)));
      expect(r && { pairs: str(r.pairs), fee: str(r.fee), out: str(r.out), new_s: str(r.newPoolS), new_o: str(r.newPoolO) }).toEqual(c.result);
    }
  });
  it("cost for an exact number of claims", () => {
    for (const c of v.cost_exact_out) {
      expect(str(tryOr(() => costExactOut(b(c.s), b(c.o), b(c.a), BigInt(c.fee_bps))))).toEqual(c.result);
    }
  });
  it("recenter", () => {
    for (const c of v.recenter) {
      const [pu, iu, pd, id] = c.h.map(b) as [bigint, bigint, bigint, bigint];
      const r = tryOr(() => recenter({ poolUp: pu, invUp: iu, poolDown: pd, invDown: id }, b(c.p)));
      expect(r && [r.poolUp, r.invUp, r.poolDown, r.invDown].map(String)).toEqual(c.result);
    }
  });
  it("band value, projected average, fee split, lock size", () => {
    for (const c of v.band_value) expect(str(tryOr(() => bandValuePpm(b(c.avg), b(c.lower), b(c.upper))))).toEqual(c.result);
    for (const c of v.projected_avg) {
      expect(str(tryOr(() => projectedAvg(b(c.counted_price), b(c.counted_secs), b(c.last), b(c.remaining))))).toEqual(c.result);
    }
    for (const c of v.split_fee) expect(tryOr(() => splitFee(b(c.fee), BigInt(c.protocol_bps)).map(String))).toEqual(c.result);
    for (const c of v.lock_claims) {
      expect(str(tryOr(() => lockClaims(b(c.hours), b(c.lower), b(c.upper), b(c.remaining), b(c.duration))))).toEqual(c.result);
    }
  });
});

describe("vault math matches Rust", () => {
  it("series value, deposits, withdrawals, allocation", () => {
    for (const c of v.series_value) {
      expect(str(tryOr(() => seriesValue(b(c.up), b(c.down), b(c.v), false)))).toEqual(c.down_rounded);
      expect(str(tryOr(() => seriesValue(b(c.up), b(c.down), b(c.v), true)))).toEqual(c.up_rounded);
    }
    for (const c of v.deposit_shares) {
      expect(tryOr(() => depositShares(b(c.amount), b(c.total), b(c.nav_up)).map(String))).toEqual(c.result);
    }
    for (const c of v.withdraw_amount) expect(str(tryOr(() => withdrawAmount(b(c.shares), b(c.total), b(c.nav_down))))).toEqual(c.result);
    for (const c of v.series_allocation) expect(str(tryOr(() => seriesAllocation(b(c.nav), b(c.idle), BigInt(c.bps))))).toEqual(c.result);
  });
});
