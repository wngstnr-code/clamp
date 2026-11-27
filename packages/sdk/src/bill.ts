// Bill parser (M3): turns the answer of the bill proxy (or the same JSON
// saved as a file) into GPU-hours, cost and the user's own rate per class.
// Runs the same in the browser and on the server. Never guesses: a line whose
// GPU model or GPU count is unknown stays unassigned, and the web app asks.

import { CLASS_H100, CLASS_RTX4090 } from "./constants.js";

/** Provider GPU names that match an index class exactly (the names the index uses). */
const CLASS_BY_GPU_NAME: Record<string, number> = {
  "RTX 4090": CLASS_RTX4090, // Vast.ai gpu_name
  "NVIDIA GeForce RTX 4090": CLASS_RTX4090, // Runpod gpu.id
  "H100 SXM": CLASS_H100,
  "NVIDIA H100 80GB HBM3": CLASS_H100,
};

/** The index class of a provider GPU name, or null when no index covers it. */
export function classOfGpu(name: string | null): number | null {
  if (!name) return null;
  return CLASS_BY_GPU_NAME[name.trim()] ?? null;
}

export interface BillLine {
  provider: "vast" | "runpod";
  /** Provider id of the instance or pod. */
  contract: string;
  gpuName: string | null;
  numGpus: number | null;
  classId: number | null;
  /** Hours the instance ran (not multiplied by the GPU count). */
  hours: number;
  /** Runpod: hours are GPU cost divided by the pod's hourly rate. */
  hoursEstimated: boolean;
  /** GPU cost in micro-USD (disk and bandwidth excluded). */
  gpuCost: number;
  /** Everything the contract cost in micro-USD. */
  totalCost: number;
}

export interface ClassBill {
  classId: number;
  gpuHours: number;
  gpuCost: number;
  /** The user's own rate: micro-USD per GPU-hour, rounded down. */
  rate: number;
}

export interface BillSummary {
  provider: "vast" | "runpod";
  from: number;
  to: number;
  lines: BillLine[];
  byClass: ClassBill[];
  /** Lines with an unknown GPU, an unknown GPU count or a GPU no index covers. */
  unassigned: BillLine[];
  totalCost: number;
}

const micro = (usd: number) => Math.round(usd * 1e6);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** GPU-hours, cost and rate per class from lines with a known class and GPU count. */
export function summarizeBill(provider: "vast" | "runpod", from: number, to: number, lines: BillLine[]): BillSummary {
  const by = new Map<number, { gpuHours: number; gpuCost: number }>();
  const unassigned: BillLine[] = [];
  for (const l of lines) {
    if (l.classId === null || l.numGpus === null || l.numGpus <= 0 || l.hours <= 0) {
      unassigned.push(l);
      continue;
    }
    const b = by.get(l.classId) ?? { gpuHours: 0, gpuCost: 0 };
    b.gpuHours += l.hours * l.numGpus;
    b.gpuCost += l.gpuCost;
    by.set(l.classId, b);
  }
  const byClass = [...by.entries()]
    .map(([classId, b]) => ({
      classId,
      gpuHours: Math.round(b.gpuHours * 1000) / 1000,
      gpuCost: b.gpuCost,
      rate: Math.floor(b.gpuCost / b.gpuHours),
    }))
    .sort((a, b) => a.classId - b.classId);
  return {
    provider,
    from,
    to,
    lines,
    byClass,
    unassigned,
    totalCost: lines.reduce((s, l) => s + l.totalCost, 0),
  };
}

/** Sets the GPU model and count of a line the provider did not describe (the user's answer). */
export function assignLine(line: BillLine, gpuName: string, numGpus: number): BillLine {
  if (!Number.isInteger(numGpus) || numGpus <= 0) throw new Error("numGpus must be a whole number above 0");
  return { ...line, gpuName, numGpus, classId: classOfGpu(gpuName) };
}

// ---------------------------------------------------------------- Vast.ai

/** "96.000 hours at $0.389/hour" in a gpu charge item of GET /api/v0/charges. */
const VAST_GPU_ITEM = /([\d.]+)\s+hours?\s+at\s+\$([\d.]+)\s*\/\s*hour/i;

export interface VastBillAnswer {
  provider: "vast";
  from: number;
  to: number;
  /** `results` of GET /api/v0/charges (all pages). */
  charges: unknown[];
  /** `instances` of GET /api/v1/instances, or null when the key cannot read them. */
  instances: unknown[] | null;
}

/** Parses the Vast.ai answer of `POST /bill/vast` (or the same JSON from a file). */
export function parseVastBill(answer: VastBillAnswer): BillSummary {
  const gpuOf = new Map<string, { name: string | null; count: number | null }>();
  for (const i of answer.instances ?? []) {
    const r = i as { id?: unknown; gpu_name?: unknown; num_gpus?: unknown };
    if (r.id === undefined) continue;
    gpuOf.set(String(r.id), {
      name: typeof r.gpu_name === "string" ? r.gpu_name : null,
      count: isNum(r.num_gpus) ? r.num_gpus : null,
    });
  }
  const lines: BillLine[] = [];
  for (const c of answer.charges) {
    const r = c as { type?: unknown; source?: unknown; amount?: unknown; items?: unknown };
    if (r.type !== "instance") continue;
    const source = typeof r.source === "string" ? r.source : "";
    const id = source.startsWith("instance-") ? source.slice("instance-".length) : source;
    let hours = 0;
    let gpuCost = 0;
    for (const it of Array.isArray(r.items) ? r.items : []) {
      const item = it as { type?: unknown; description?: unknown; amount?: unknown };
      if (item.type !== "gpu") continue;
      const m = typeof item.description === "string" ? VAST_GPU_ITEM.exec(item.description) : null;
      if (m) hours += Number(m[1]);
      if (isNum(item.amount)) gpuCost += micro(item.amount);
    }
    const gpu = gpuOf.get(id);
    lines.push({
      provider: "vast",
      contract: id,
      gpuName: gpu?.name ?? null,
      numGpus: gpu?.count ?? null,
      classId: classOfGpu(gpu?.name ?? null),
      hours: Math.round(hours * 1000) / 1000,
      hoursEstimated: false,
      gpuCost,
      totalCost: isNum(r.amount) ? micro(r.amount) : gpuCost,
    });
  }
  return summarizeBill("vast", answer.from, answer.to, lines);
}

// ---------------------------------------------------------------- Runpod

export interface RunpodBillAnswer {
  provider: "runpod";
  from: number;
  to: number;
  /** `records` of GET /v2/billing/pods. */
  records: unknown[];
  /** `pods` of GET /v2/pods, or null when the key cannot read them. */
  pods: unknown[] | null;
}

/** Parses the Runpod answer of `POST /bill/runpod` (or the same JSON from a file). */
export function parseRunpodBill(answer: RunpodBillAnswer): BillSummary {
  const sums = new Map<string, { gpu: number; compute: number; total: number }>();
  for (const rec of answer.records) {
    const r = rec as { podId?: unknown; gpuAmount?: unknown; cpuAmount?: unknown; totalAmount?: unknown };
    if (typeof r.podId !== "string") continue;
    const s = sums.get(r.podId) ?? { gpu: 0, compute: 0, total: 0 };
    const gpu = isNum(r.gpuAmount) ? r.gpuAmount : 0;
    const cpu = isNum(r.cpuAmount) ? r.cpuAmount : 0;
    s.gpu += gpu;
    s.compute += gpu + cpu;
    s.total += isNum(r.totalAmount) ? r.totalAmount : gpu + cpu;
    sums.set(r.podId, s);
  }
  const pods = new Map<string, { name: string | null; count: number | null; cost: number | null }>();
  for (const p of answer.pods ?? []) {
    const r = p as { id?: unknown; gpu?: { id?: unknown; count?: unknown } | null; cost?: unknown };
    if (typeof r.id !== "string") continue;
    pods.set(r.id, {
      name: typeof r.gpu?.id === "string" ? r.gpu.id : null,
      count: isNum(r.gpu?.count) ? r.gpu.count : null,
      cost: isNum(r.cost) && r.cost > 0 ? r.cost : null,
    });
  }
  const lines: BillLine[] = [];
  for (const [podId, s] of sums) {
    if (s.gpu <= 0) continue; // CPU pods and storage only
    const pod = pods.get(podId);
    // the pod's hourly rate covers its compute (GPU and CPU), not disk
    const hours = pod?.cost ? s.compute / pod.cost : 0;
    lines.push({
      provider: "runpod",
      contract: podId,
      gpuName: pod?.name ?? null,
      numGpus: pod?.count ?? null,
      classId: classOfGpu(pod?.name ?? null),
      hours: Math.round(hours * 1000) / 1000,
      hoursEstimated: true,
      gpuCost: micro(s.gpu),
      totalCost: micro(s.total),
    });
  }
  return summarizeBill("runpod", answer.from, answer.to, lines);
}

/**
 * Parses a bill file the user picked, in the browser, without any network
 * call. Accepts a saved proxy answer, the raw JSON of Vast.ai
 * `GET /api/v0/charges` (for example `vastai show invoices-v1 --charges --raw`,
 * an object with `results` or a plain array) or of Runpod
 * `GET /v2/billing/pods` (an object with `records`). Raw files carry no GPU
 * model, so their lines stay unassigned until the user names the GPU.
 */
export function parseBillFile(text: string, from = 0, to = 0): BillSummary {
  const data = JSON.parse(text) as unknown;
  const obj = (data ?? {}) as { provider?: unknown; results?: unknown; records?: unknown };
  if (obj.provider === "vast") return parseVastBill(data as VastBillAnswer);
  if (obj.provider === "runpod") return parseRunpodBill(data as RunpodBillAnswer);
  if (Array.isArray(data)) return parseVastBill({ provider: "vast", from, to, charges: data, instances: null });
  if (Array.isArray(obj.results)) return parseVastBill({ provider: "vast", from, to, charges: obj.results, instances: null });
  if (Array.isArray(obj.records)) return parseRunpodBill({ provider: "runpod", from, to, records: obj.records, pods: null });
  throw new Error("unknown bill file: expected Vast.ai charges or Runpod pod billing JSON");
}
