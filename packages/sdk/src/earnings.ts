// Host earnings parser (M5, Revenue Lock). Turns the answer of
// `POST /earnings/vast` (or the JSON of `vastai show earnings --raw` saved as
// a file) into earnings per machine and per class. Vast.ai reports dollars
// only, no hours: GPU-hours are an estimate from the machine's listed price
// per GPU-hour, marked as such, or typed in by the owner.

import { classOfGpu } from "./bill.js";

export interface VastEarningsAnswer {
  provider: "vast";
  /** Days looked back from today (`last_days`). */
  days: number;
  /** `per_machine` of GET /api/v0/users/{id}/machine-earnings. */
  perMachine: unknown[];
  /** `machines` of GET /api/v0/machines, or null when the key cannot read them. */
  machines: unknown[] | null;
}

export type HoursSource = "listed_price" | "typed" | "job_times";

export interface EarningsLine {
  /** Vast.ai machine id, or Nosana market address. */
  machine: string;
  gpuName: string | null;
  numGpus: number | null;
  classId: number | null;
  /** GPU earnings in micro-USD. */
  gpuEarn: number;
  /** GPU, storage and bandwidth earnings in micro-USD. */
  totalEarn: number;
  /** The machine's listed price per GPU-hour in micro-USD, when the provider gave it. */
  listedRate: number | null;
  /**
   * GPU-hours: gpuEarn / listedRate (an estimate), the owner's typed hours,
   * the job times (Nosana), or null.
   */
  estGpuHours: number | null;
  hoursSource: HoursSource | null;
}

export interface ClassEarnings {
  classId: number;
  gpuEarn: number;
  /** Sum of the estimates, null when one line of the class has none. */
  estGpuHours: number | null;
  /**
   * gpuEarn / estGpuHours in micro-USD per GPU-hour, rounded down, or null.
   * Only an earned rate when `hoursSource` is "typed" or "job_times". With
   * "listed_price" it is the listed price again: show it as the listed rate.
   */
  rate: number | null;
  /** Where the hours of the class came from; "mixed" when lines differ. */
  hoursSource: HoursSource | "mixed" | null;
}

export interface EarningsSummary {
  provider: "vast" | "nosana";
  days: number;
  /** days * 86,400: the window to pass to `hoursForRest`. */
  windowSecs: number;
  lines: EarningsLine[];
  byClass: ClassEarnings[];
  /** Machines with an unknown GPU or one no index covers. */
  unassigned: EarningsLine[];
  totalEarn: number;
}

const micro = (usd: number) => Math.round(usd * 1e6);
const num = (x: unknown): number | null => {
  const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Earnings and estimated GPU-hours per class from lines with a known class. */
export function summarizeEarnings(days: number, lines: EarningsLine[], provider: "vast" | "nosana" = "vast"): EarningsSummary {
  const by = new Map<number, { gpuEarn: number; hours: number | null; source: HoursSource | "mixed" | null | undefined }>();
  const unassigned: EarningsLine[] = [];
  for (const l of lines) {
    if (l.classId === null) {
      unassigned.push(l);
      continue;
    }
    const b = by.get(l.classId) ?? { gpuEarn: 0, hours: 0, source: undefined };
    b.gpuEarn += l.gpuEarn;
    b.hours = b.hours === null || l.estGpuHours === null ? null : b.hours + l.estGpuHours;
    b.source = b.source === undefined || b.source === l.hoursSource ? l.hoursSource : "mixed";
    by.set(l.classId, b);
  }
  const byClass = [...by.entries()]
    .map(([classId, b]) => ({
      classId,
      gpuEarn: b.gpuEarn,
      estGpuHours: b.hours === null ? null : Math.round(b.hours * 1000) / 1000,
      rate: b.hours ? Math.floor(b.gpuEarn / b.hours) : null,
      hoursSource: b.hours === null ? null : (b.source ?? null),
    }))
    .sort((a, b) => a.classId - b.classId);
  return { provider, days, windowSecs: days * 86_400, lines, byClass, unassigned, totalEarn: lines.reduce((s, l) => s + l.totalEarn, 0) };
}

/**
 * The owner's answer for a machine: its GPU, the GPU count and, optionally,
 * the GPU-hours it was rented in the window (shown as typed in).
 */
export function assignMachine(line: EarningsLine, gpuName: string, numGpus: number, gpuHours?: number): EarningsLine {
  if (!Number.isInteger(numGpus) || numGpus <= 0) throw new Error("numGpus must be a whole number above 0");
  if (gpuHours !== undefined && !(Number.isFinite(gpuHours) && gpuHours >= 0)) throw new Error("gpuHours must be 0 or more");
  const typed = gpuHours === undefined ? {} : { estGpuHours: gpuHours, hoursSource: "typed" as const };
  return { ...line, gpuName, numGpus, classId: classOfGpu(gpuName), ...typed };
}

/** Parses the Vast.ai host earnings answer (or the same JSON from a file). */
export function parseVastEarnings(answer: VastEarningsAnswer): EarningsSummary {
  const machines = new Map<string, { name: string | null; count: number | null; rate: number | null }>();
  for (const m of answer.machines ?? []) {
    const r = (m ?? {}) as { id?: unknown; gpu_name?: unknown; num_gpus?: unknown; listed_gpu_cost?: unknown };
    if (r.id === undefined || r.id === null) continue;
    const rate = num(r.listed_gpu_cost);
    machines.set(String(r.id), {
      name: typeof r.gpu_name === "string" ? r.gpu_name : null,
      count: num(r.num_gpus),
      rate: rate !== null && rate > 0 ? micro(rate) : null,
    });
  }
  const sums = new Map<string, { gpu: number; total: number }>();
  for (const p of answer.perMachine) {
    const r = (p ?? {}) as Record<string, unknown>;
    if (r.machine_id === undefined || r.machine_id === null) continue;
    const id = String(r.machine_id);
    const gpu = micro(num(r.gpu_earn) ?? 0);
    const total = gpu + micro(num(r.sto_earn) ?? 0) + micro(num(r.bwu_earn) ?? 0) + micro(num(r.bwd_earn) ?? 0);
    const s = sums.get(id) ?? { gpu: 0, total: 0 };
    s.gpu += gpu;
    s.total += total;
    sums.set(id, s);
  }
  const lines: EarningsLine[] = [...sums.entries()].map(([id, s]) => {
    const m = machines.get(id);
    const listedRate = m?.rate ?? null;
    return {
      machine: id,
      gpuName: m?.name ?? null,
      numGpus: m?.count ?? null,
      classId: classOfGpu(m?.name ?? null),
      gpuEarn: s.gpu,
      totalEarn: s.total,
      listedRate,
      estGpuHours: listedRate ? Math.round((s.gpu / listedRate) * 1000) / 1000 : null,
      hoursSource: listedRate ? ("listed_price" as const) : null,
    };
  });
  return summarizeEarnings(answer.days, lines);
}

/**
 * Parses an earnings file the owner picked, in the browser only: a saved
 * proxy answer or the raw JSON of `vastai show earnings --raw` (an object with
 * `per_machine`). A raw file says neither its window nor the machines, so the
 * caller passes `days` and every line is unassigned.
 */
export function parseEarningsFile(text: string, days?: number): EarningsSummary {
  const data = JSON.parse(text) as { provider?: unknown; perMachine?: unknown; per_machine?: unknown } | null;
  if (data?.provider === "vast" && Array.isArray(data.perMachine)) {
    return parseVastEarnings(data as unknown as VastEarningsAnswer);
  }
  if (data?.provider === undefined && Array.isArray(data?.per_machine)) {
    if (days === undefined || !Number.isInteger(days) || days < 1) {
      throw new Error("a raw earnings file needs the number of days it covers");
    }
    return parseVastEarnings({ provider: "vast", days, perMachine: data.per_machine, machines: null });
  }
  throw new Error("unknown earnings file: expected Vast.ai machine earnings JSON");
}
