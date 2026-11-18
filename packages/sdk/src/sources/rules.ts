// Source rules (architecture 3.6): raw API response in, price and capacity out.
// Pure functions. The reporters use them to report and the proof page uses
// them to recompute a report from its archived raw file.

import { median } from "../math/median.js";

/** One HTTP request a reporter sends to a source. */
export interface SourceRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/** Outcome of a rule. `price = 0n` means the source gave no usable price. */
export interface SourceResult {
  ok: boolean;
  /** Micro-USD per GPU-hour. */
  price: bigint;
  /** Units rentable now (0 when the source publishes none). */
  capacity: number;
  error?: string;
}

const fail = (error: string): SourceResult => ({ ok: false, price: 0n, capacity: 0, error });

/** USD per hour (JSON number) to micro-USD, rounded to the nearest unit. */
export function toMicro(usd: unknown): bigint | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return null;
  return BigInt(Math.round(usd * 1_000_000));
}

function parse(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// ---------------------------------------------------------------- Vast.ai

export const VAST_URL = "https://console.vast.ai/api/v0/bundles/";

/** Search for rentable, verified, on-demand, single-GPU offers of one model. */
export function vastRequest(gpuName: string): SourceRequest {
  const q = {
    gpu_name: { eq: gpuName },
    num_gpus: { eq: 1 },
    rentable: { eq: true },
    verified: { eq: true },
    type: "on-demand",
    limit: 500,
  };
  return { url: `${VAST_URL}?q=${encodeURIComponent(JSON.stringify(q))}`, method: "GET" };
}

/** Median `dph_total` of matching offers; capacity = number of offers. */
export function vastRule(raw: string, gpuName: string): SourceResult {
  const data = parse(raw);
  if (!isObject(data) || !Array.isArray(data.offers)) return fail("no offers array");
  const prices: bigint[] = [];
  for (const o of data.offers) {
    if (!isObject(o)) continue;
    if (o.gpu_name !== gpuName || o.num_gpus !== 1 || o.rentable === false) continue;
    const p = toMicro(o.dph_total);
    if (p !== null) prices.push(p);
  }
  if (prices.length === 0) return fail("no matching offers");
  return { ok: true, price: median(prices)!, capacity: prices.length };
}

// ---------------------------------------------------------------- RunPod

export const RUNPOD_REQUEST: SourceRequest = {
  url: "https://api.runpod.io/graphql",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    query: "query { gpuTypes { id displayName memoryInGb securePrice communityPrice } }",
  }),
};

/** `communityPrice` of one GPU type id. RunPod publishes no capacity. */
export function runpodRule(raw: string, typeId: string): SourceResult {
  const data = parse(raw);
  const types =
    isObject(data) && isObject(data.data) && Array.isArray(data.data.gpuTypes)
      ? data.data.gpuTypes
      : null;
  if (!types) return fail("no gpuTypes array");
  const t = types.find((x) => isObject(x) && x.id === typeId);
  if (!isObject(t)) return fail(`type ${typeId} not listed`);
  const p = toMicro(t.communityPrice);
  if (p === null) return fail("no community price");
  return { ok: true, price: p, capacity: 0 };
}

// ---------------------------------------------------------------- Akash

export const AKASH_REQUEST: SourceRequest = {
  url: "https://console-api.akash.network/v1/gpu-prices",
  method: "GET",
};

/**
 * `price.weightedAverage` of one NVIDIA model (and interface, when given);
 * capacity = `availability.available`. Exactly one entry must match.
 */
export function akashRule(raw: string, model: string, iface?: string): SourceResult {
  const data = parse(raw);
  if (!isObject(data) || !Array.isArray(data.models)) return fail("no models array");
  const matches = data.models.filter(
    (m) =>
      isObject(m) &&
      m.vendor === "nvidia" &&
      m.model === model &&
      (iface === undefined || m.interface === iface),
  );
  if (matches.length !== 1) return fail(`expected one ${model} entry, found ${matches.length}`);
  const m = matches[0] as Record<string, unknown>;
  const price = isObject(m.price) ? toMicro(m.price.weightedAverage) : null;
  if (price === null) return fail("no weighted average");
  const available = isObject(m.availability) ? m.availability.available : undefined;
  if (typeof available !== "number" || !Number.isInteger(available) || available < 0) {
    return fail("no availability");
  }
  return { ok: true, price, capacity: available };
}

// ---------------------------------------------------------------- Nosana

export const NOSANA_REQUEST: SourceRequest = {
  url: "https://api.nosana.com/api/markets/",
  method: "GET",
};

/** Median `usd_reward_per_hour` of markets whose name contains `needle`. */
export function nosanaRule(raw: string, needle: string): SourceResult {
  const data = parse(raw);
  if (!Array.isArray(data)) return fail("no market list");
  const prices: bigint[] = [];
  for (const m of data) {
    if (!isObject(m) || typeof m.name !== "string" || !m.name.includes(needle)) continue;
    const p = toMicro(m.usd_reward_per_hour);
    if (p !== null) prices.push(p);
  }
  if (prices.length === 0) return fail(`no ${needle} markets`);
  return { ok: true, price: median(prices)!, capacity: 0 };
}
