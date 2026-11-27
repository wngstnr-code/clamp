// Shapes follow the examples in the Vast.ai and Runpod API references
// (docs.vast.ai show-charges, docs.runpod.io get-pod-billing-history and list-pods).
import { describe, expect, it } from "vitest";

import { assignLine, classOfGpu, parseBillFile, parseRunpodBill, parseVastBill } from "../src/bill.js";

const FROM = 1_800_000_000;
const TO = FROM + 30 * 86_400;

const vastCharge = (id: number, items: { type: string; description: string; amount: number }[], amount: number) => ({
  start: FROM,
  end: TO,
  type: "instance",
  source: `instance-${id}`,
  description: `Instance ${id} Charges`,
  amount,
  items: items.map((i) => ({ start: FROM, end: TO, source: null, metadata: {}, items: [], ...i })),
});

const vastAnswer = {
  provider: "vast" as const,
  from: FROM,
  to: TO,
  charges: [
    vastCharge(
      111,
      [
        { type: "gpu", description: "96.000 hours at $0.389/hour", amount: 37.344 },
        { type: "disk", description: "10 GB for 96 hours", amount: 1.077 },
      ],
      38.421,
    ),
    // a 2 x RTX 4090 instance whose price changed once
    vastCharge(
      222,
      [
        { type: "gpu", description: "10.000 hours at $0.700/hour", amount: 7.0 },
        { type: "gpu", description: "5.500 hours at $0.800/hour", amount: 4.4 },
        { type: "bwd", description: "2 GB download", amount: 0.02 },
      ],
      11.42,
    ),
    vastCharge(333, [{ type: "gpu", description: "4.000 hours at $1.900/hour", amount: 7.6 }], 7.6),
    vastCharge(444, [{ type: "gpu", description: "3.000 hours at $0.300/hour", amount: 0.9 }], 0.9),
    { type: "volume", source: "volume-9", amount: 2.5, items: [] },
  ],
  instances: [
    { id: 111, gpu_name: "RTX 4090", num_gpus: 1 },
    { id: 222, gpu_name: "RTX 4090", num_gpus: 2 },
    { id: 333, gpu_name: "H100 SXM", num_gpus: 1 },
  ],
};

describe("GPU classes", () => {
  it("match the exact names the index uses and nothing else", () => {
    expect(classOfGpu("RTX 4090")).toBe(1);
    expect(classOfGpu("NVIDIA GeForce RTX 4090")).toBe(1);
    expect(classOfGpu("H100 SXM")).toBe(2);
    expect(classOfGpu("H100 PCIE")).toBeNull();
    expect(classOfGpu("RTX 3090")).toBeNull();
    expect(classOfGpu(null)).toBeNull();
  });
});

describe("Vast.ai bill", () => {
  const bill = parseVastBill(vastAnswer);
  it("reads hours and GPU cost per instance, without disk or bandwidth", () => {
    const l111 = bill.lines.find((l) => l.contract === "111")!;
    expect(l111).toMatchObject({ hours: 96, gpuCost: 37_344_000, totalCost: 38_421_000, numGpus: 1, classId: 1 });
    const l222 = bill.lines.find((l) => l.contract === "222")!;
    expect(l222).toMatchObject({ hours: 15.5, gpuCost: 11_400_000, numGpus: 2 });
    expect(bill.lines.some((l) => l.contract === "9")).toBe(false);
  });
  it("sums GPU-hours per class and gives the user's rate per GPU-hour", () => {
    // RTX 4090: 96 + 15.5 x 2 = 127 GPU-hours for 48.744 USD
    expect(bill.byClass).toEqual([
      { classId: 1, gpuHours: 127, gpuCost: 48_744_000, rate: Math.floor(48_744_000 / 127) },
      { classId: 2, gpuHours: 4, gpuCost: 7_600_000, rate: 1_900_000 },
    ]);
    expect(bill.byClass[0]!.rate).toBe(383_811);
  });
  it("leaves an instance with no GPU data unassigned until the user names it", () => {
    expect(bill.unassigned.map((l) => l.contract)).toEqual(["444"]);
    expect(bill.totalCost).toBe(38_421_000 + 11_420_000 + 7_600_000 + 900_000);
    const fixed = assignLine(bill.unassigned[0]!, "RTX 4090", 1);
    expect(fixed.classId).toBe(1);
    expect(() => assignLine(bill.unassigned[0]!, "RTX 4090", 0)).toThrow();
  });
  it("leaves every line unassigned when the key cannot read instances", () => {
    const b = parseVastBill({ ...vastAnswer, instances: null });
    expect(b.byClass).toEqual([]);
    expect(b.unassigned).toHaveLength(4);
  });
});

describe("Runpod bill", () => {
  const bill = parseRunpodBill({
    provider: "runpod",
    from: FROM,
    to: TO,
    records: [
      { podId: "p1", gpuAmount: 11.1, cpuAmount: 0, diskAmount: 1.24, totalAmount: 12.34 },
      { podId: "p1", gpuAmount: 6.66, cpuAmount: 0, diskAmount: 0.5, totalAmount: 7.16 },
      { podId: "cpu", gpuAmount: 0, cpuAmount: 3, diskAmount: 0, totalAmount: 3 },
      { podId: "gone", gpuAmount: 2, cpuAmount: 0, diskAmount: 0, totalAmount: 2 },
    ],
    pods: [
      { id: "p1", gpu: { id: "NVIDIA GeForce RTX 4090", count: 1 }, cost: 0.37 },
      { id: "cpu", gpu: null, cost: 0.1 },
    ],
  });
  it("estimates hours from the pod's hourly rate and marks them estimated", () => {
    const p1 = bill.lines.find((l) => l.contract === "p1")!;
    expect(p1).toMatchObject({ hours: 48, hoursEstimated: true, gpuCost: 17_760_000, totalCost: 19_500_000, classId: 1 });
    expect(bill.byClass).toEqual([{ classId: 1, gpuHours: 48, gpuCost: 17_760_000, rate: 370_000 }]);
  });
  it("skips CPU pods and keeps terminated pods unassigned", () => {
    expect(bill.lines.some((l) => l.contract === "cpu")).toBe(false);
    expect(bill.unassigned.map((l) => l.contract)).toEqual(["gone"]);
  });
});

describe("bill files (parsed in the browser)", () => {
  it("reads a saved proxy answer the same as the API", () => {
    expect(parseBillFile(JSON.stringify(vastAnswer))).toEqual(parseVastBill(vastAnswer));
    expect(parseVastBill(vastAnswer).windowSecs).toBe(30 * 86_400);
  });
  it("reads raw Vast.ai charges with the window the user gives, all unassigned", () => {
    const raw = { success: true, results: vastAnswer.charges, next_token: null };
    const b = parseBillFile(JSON.stringify(raw), { from: FROM, to: FROM + 7 * 86_400 });
    expect(b.provider).toBe("vast");
    expect(b.windowSecs).toBe(7 * 86_400);
    expect(b.unassigned).toHaveLength(4);
    expect(parseBillFile(JSON.stringify(vastAnswer.charges), { from: FROM, to: TO }).lines).toHaveLength(4);
  });
  it("refuses a raw file without its window", () => {
    const raw = JSON.stringify({ results: vastAnswer.charges });
    expect(() => parseBillFile(raw)).toThrow(/window/);
    expect(() => parseBillFile(raw, { from: TO, to: FROM })).toThrow(/window/);
  });
  it("reads raw Runpod pod billing and refuses anything else", () => {
    const b = parseBillFile(JSON.stringify({ records: [{ podId: "x", gpuAmount: 1, totalAmount: 1 }], metadata: {} }), { from: FROM, to: TO });
    expect(b.provider).toBe("runpod");
    expect(() => parseBillFile(JSON.stringify({ hello: 1 }))).toThrow(/unknown bill file/);
    expect(() => parseBillFile("not json")).toThrow();
  });
  it("refuses a saved earnings answer with a clear error", () => {
    const earnings = { provider: "vast", days: 30, perMachine: [], machines: null };
    expect(() => parseBillFile(JSON.stringify(earnings))).toThrow(/unknown bill file/);
  });
});
