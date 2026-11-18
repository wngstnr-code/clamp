// Source rules on real API responses saved on 2026-11-18. The expected values
// were computed separately (Python) from the same files.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { H100, RTX4090 } from "../src/sources/classes.js";
import { akashRule, nosanaRule, runpodRule, toMicro, vastRequest, vastRule } from "../src/sources/rules.js";
import { sourceWeight, weightedMedian } from "../src/math/median.js";

const dir = join(import.meta.dirname, "fixtures", "2026-11-18");
const raw = (name: string) => readFileSync(join(dir, name), "utf8");

const FILES = ["vast-rtx4090.json", "runpod.json", "akash.json", "nosana.json"];
const FILES_H100 = ["vast-h100.json", "runpod.json", "akash.json", "nosana.json"];

describe("RTX 4090 on real data", () => {
  const results = RTX4090.sources.map((s, i) => s.rule(raw(FILES[i]!)));

  it("reads each source", () => {
    expect(results.map((r) => [r.ok, r.price, r.capacity])).toEqual([
      [true, 484_711n, 57],
      [true, 340_000n, 0],
      [true, 340_000n, 0], // Akash lists the price but 0 GPUs are available
      [true, 363_600n, 0],
    ]);
  });

  it("gives the expected index price", () => {
    const entries = RTX4090.sources.map((s, i) => ({
      price: results[i]!.price,
      weight: sourceWeight(s.hasCapacity, BigInt(results[i]!.capacity), s.fixedWeight),
    }));
    expect(entries.map((e) => e.weight)).toEqual([2, 2, 0, 1]);
    expect(weightedMedian(entries)).toBe(363_600n);
  });
});

describe("H100 (SXM plus Nosana) on real data", () => {
  const results = H100.sources.map((s, i) => s.rule(raw(FILES_H100[i]!)));

  it("reads each source", () => {
    expect(results.map((r) => [r.ok, r.price, r.capacity])).toEqual([
      [true, 2_402_222n, 3],
      [true, 2_690_000n, 0],
      [true, 2_730_000n, 14],
      [true, 1_193_150n, 0],
    ]);
  });

  it("gives the expected index price", () => {
    const entries = H100.sources.map((s, i) => ({
      price: results[i]!.price,
      weight: sourceWeight(s.hasCapacity, BigInt(results[i]!.capacity), s.fixedWeight),
    }));
    expect(entries.map((e) => e.weight)).toEqual([1, 2, 2, 1]);
    expect(weightedMedian(entries)).toBe(2_690_000n);
  });
});

describe("rules fail cleanly on broken answers", () => {
  const broken = ["", "not json", "null", "[]", "{}", '{"offers": 5}', '{"data": {}}', '{"models": [{}]}'];

  it.each(broken)("vast %j", (r) => {
    const out = (() => {
      try {
        return vastRule(r, "RTX 4090");
      } catch {
        return null;
      }
    })();
    expect(out === null || (!out.ok && out.price === 0n)).toBe(true);
  });

  it("missing GPU types and markets", () => {
    expect(runpodRule(raw("runpod.json"), "NVIDIA B300").ok).toBe(false);
    expect(akashRule(raw("akash.json"), "h100", "PCIe").ok).toBe(false);
    expect(nosanaRule(raw("nosana.json"), "B300").ok).toBe(false);
    expect(vastRule('{"offers": []}', "RTX 4090")).toMatchObject({ ok: false, price: 0n, capacity: 0 });
  });

  it("ignores offers of other models, multi-GPU offers and bad prices", () => {
    const offers = {
      offers: [
        { gpu_name: "RTX 4090", num_gpus: 1, dph_total: 0.4 },
        { gpu_name: "RTX 4090", num_gpus: 2, dph_total: 0.1 },
        { gpu_name: "RTX 3090", num_gpus: 1, dph_total: 0.1 },
        { gpu_name: "RTX 4090", num_gpus: 1, dph_total: -1 },
        { gpu_name: "RTX 4090", num_gpus: 1, dph_total: "0.1" },
        { gpu_name: "RTX 4090", num_gpus: 1, dph_total: 0.5, rentable: false },
      ],
    };
    expect(vastRule(JSON.stringify(offers), "RTX 4090")).toEqual({ ok: true, price: 400_000n, capacity: 1 });
  });

  it("converts USD to micro-USD by rounding", () => {
    expect(toMicro(0.4847111111)).toBe(484_711n);
    expect(toMicro(2.69)).toBe(2_690_000n);
    expect(toMicro(0)).toBeNull();
    expect(toMicro(Number.NaN)).toBeNull();
    expect(toMicro("1")).toBeNull();
  });
});

describe("requests", () => {
  it("encodes the Vast.ai search the same way as the saved fixture request", () => {
    const req = vastRequest("RTX 4090");
    const q = JSON.parse(new URL(req.url).searchParams.get("q")!);
    expect(q).toEqual({
      gpu_name: { eq: "RTX 4090" },
      num_gpus: { eq: 1 },
      rentable: { eq: true },
      verified: { eq: true },
      type: "on-demand",
      limit: 500,
    });
  });
});
