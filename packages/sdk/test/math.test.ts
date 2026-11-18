import { describe, expect, it } from "vitest";

import vectors from "./vectors/index-math.json" with { type: "json" };
import {
  applyStepLimit,
  combineSource,
  median,
  sourceWeight,
  weightedMedian,
} from "../src/math/median.js";
import { average, nextObservation, sumsAt, type Observation } from "../src/math/twap.js";
import { twapFromObservations } from "../src/index-reader.js";

const b = (x: string) => BigInt(x);
const opt = (x: string | null) => (x === null ? null : BigInt(x));

describe("shared vectors: median.rs mirror", () => {
  it.each(vectors.median)("median %#", (v) => {
    expect(median(v.values.map(b))).toBe(opt(v.expected));
  });

  it.each(vectors.source_weight)("source weight %#", (v) => {
    expect(sourceWeight(v.has_capacity, b(v.capacity), v.fixed_weight)).toBe(v.expected);
  });

  it.each(vectors.combine_source)("combine source %#", (v) => {
    const samples = v.samples.map(([p, c]) => ({ price: b(p!), capacity: b(c!) }));
    const got = combineSource(samples, b(v.min_price), b(v.max_price), v.min_reporters);
    expect(got).toEqual(v.expected ? { price: b(v.expected[0]!), capacity: b(v.expected[1]!) } : null);
  });

  it.each(vectors.weighted_median)("weighted median %#", (v) => {
    const entries = v.entries.map(([p, w]) => ({ price: b(p as string), weight: w as number }));
    expect(weightedMedian(entries)).toBe(opt(v.expected));
  });

  it.each(vectors.step_limit)("step limit %#", (v) => {
    expect(applyStepLimit(b(v.candidate), b(v.last), b(v.max_step_ppm))).toBe(b(v.expected));
  });
});

describe("shared vectors: twap.rs mirror", () => {
  const t = vectors.twap;
  const built: Observation[] = [];
  for (const u of t.updates) {
    built.push(nextObservation(built.at(-1) ?? null, u.ts, b(u.price), t.max_gap));
  }

  it("builds the expected observations", () => {
    expect(built).toEqual(
      t.observations.map((o) => ({
        ts: o.ts,
        price: b(o.price),
        cumPrice: b(o.cum_price),
        cumValid: b(o.cum_valid),
      })),
    );
  });

  it.each(t.averages)("average %#", (a) => {
    const view = twapFromObservations(built, a.from, a.to, t.max_gap);
    expect(view.average).toBe(opt(a.expected));
    expect(view.countedSecs).toBe(b(a.counted));
  });

  it("rejects ranges before the history and reversed ranges", () => {
    expect(() => twapFromObservations(built, 9_999, 12_000)).toThrow();
    expect(() => twapFromObservations(built, 12_000, 11_000)).toThrow();
    expect(() => average(sumsAt(built[1]!, 11_800, 7_200), sumsAt(built[0]!, 10_000, 7_200))).toThrow();
  });
});
