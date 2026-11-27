// Shapes follow the Vast.ai API reference (show-earnings, show-machines).
import { describe, expect, it } from "vitest";

import { assignMachine, parseEarningsFile, parseVastEarnings, summarizeEarnings } from "../src/earnings.js";

const answer = {
  provider: "vast" as const,
  days: 30,
  perMachine: [
    { machine_id: 10, gpu_earn: 120.0, sto_earn: 3.5, bwu_earn: 0.25, bwd_earn: 0.25 },
    { machine_id: 20, gpu_earn: 50.0, sto_earn: 0, bwu_earn: 0, bwd_earn: 0 },
    { machine_id: 30, gpu_earn: 9.0, sto_earn: 0, bwu_earn: 0, bwd_earn: 0 },
    { machine_id: 40, gpu_earn: 4.0, sto_earn: 0, bwu_earn: 0, bwd_earn: 0 },
  ],
  machines: [
    { id: "10", gpu_name: "RTX 4090", num_gpus: 4, listed_gpu_cost: 0.3 },
    { id: 20, gpu_name: "RTX 4090", num_gpus: 1, listed_gpu_cost: "0.25" },
    { id: 30, gpu_name: "RTX 4090", num_gpus: 1 },
    { id: 40, gpu_name: "RTX 3090", num_gpus: 1, listed_gpu_cost: 0.2 },
  ],
};

describe("Vast.ai host earnings", () => {
  const e = parseVastEarnings(answer);
  it("reads earnings per machine and estimates GPU-hours from the listed price", () => {
    expect(e.lines.find((l) => l.machine === "10")).toMatchObject({
      classId: 1,
      numGpus: 4,
      gpuEarn: 120_000_000,
      totalEarn: 124_000_000,
      listedRate: 300_000,
      estGpuHours: 400,
      hoursSource: "listed_price",
    });
    expect(e.lines.find((l) => l.machine === "20")?.estGpuHours).toBe(200);
    expect(e.lines.find((l) => l.machine === "30")?.estGpuHours).toBeNull();
  });
  it("gives no class estimate when one machine of the class has no price", () => {
    expect(e.byClass).toEqual([{ classId: 1, gpuEarn: 179_000_000, estGpuHours: null, listedRate: null }]);
    const priced = parseVastEarnings({ ...answer, perMachine: answer.perMachine.slice(0, 2) });
    expect(priced.byClass).toEqual([{ classId: 1, gpuEarn: 170_000_000, estGpuHours: 600, listedRate: 283_333 }]);
  });
  it("keeps a GPU no index covers unassigned", () => {
    expect(e.unassigned.map((l) => l.machine)).toEqual(["40"]);
    expect(e.totalEarn).toBe(124_000_000 + 50_000_000 + 9_000_000 + 4_000_000);
    expect(assignMachine(e.unassigned[0]!, "RTX 4090", 1).classId).toBe(1);
    expect(() => assignMachine(e.unassigned[0]!, "RTX 4090", 1, -1)).toThrow();
    expect(() => assignMachine(e.unassigned[0]!, "RTX 4090", 0)).toThrow();
  });
  it("leaves every machine unassigned when the key cannot read machines", () => {
    const b = parseVastEarnings({ ...answer, machines: null });
    expect(b.byClass).toEqual([]);
    expect(b.unassigned).toHaveLength(4);
  });
});

describe("typed hours", () => {
  it("let an assigned machine count toward the class estimate", () => {
    const raw = parseVastEarnings({ ...answer, perMachine: answer.perMachine.slice(0, 2), machines: null });
    const lines = raw.unassigned.map((l) => assignMachine(l, "RTX 4090", 1, l.machine === "10" ? 400 : 200));
    expect(lines.every((l) => l.hoursSource === "typed")).toBe(true);
    expect(summarizeEarnings(30, lines).byClass).toEqual([{ classId: 1, gpuEarn: 170_000_000, estGpuHours: 600, listedRate: 283_333 }]);
  });
});

describe("earnings files", () => {
  it("read a saved proxy answer and the raw CLI JSON with its days", () => {
    expect(parseEarningsFile(JSON.stringify(answer))).toEqual(parseVastEarnings(answer));
    const raw = { summary: { total_gpu: 183 }, per_machine: answer.perMachine, per_day: [] };
    const b = parseEarningsFile(JSON.stringify(raw), 7);
    expect(b.days).toBe(7);
    expect(b.windowSecs).toBe(7 * 86_400);
    expect(b.unassigned).toHaveLength(4);
  });
  it("refuse a raw file without its days, a bill file and anything else", () => {
    const raw = JSON.stringify({ per_machine: answer.perMachine });
    expect(() => parseEarningsFile(raw)).toThrow(/days/);
    expect(() => parseEarningsFile(raw, 0)).toThrow(/days/);
    const bill = { provider: "vast", from: 0, to: 1, charges: [], instances: null };
    expect(() => parseEarningsFile(JSON.stringify(bill))).toThrow(/unknown earnings file/);
    expect(() => parseEarningsFile(JSON.stringify({ x: 1 }))).toThrow(/unknown earnings file/);
  });
});
