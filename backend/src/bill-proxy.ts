// Bill proxy (docs/architecture.md section 5, M3). The provider APIs send no
// CORS header, so the browser cannot call them. These routes forward a fixed
// set of read requests with the user's key and return only the fields the
// bill parser in packages/sdk needs. The key lives in memory for one request:
// it is never stored, never logged and never put in a URL.

import type { RunpodBillAnswer, VastBillAnswer, VastEarningsAnswer } from "@clamp/sdk";

export const BILL_WINDOW_SECS = 30 * 86_400;
const MAX_WINDOW_SECS = 31 * 86_400;
const MAX_PAGES = 10;
const TIMEOUT_MS = 15_000;

export const VAST_BASE = "https://console.vast.ai";
export const RUNPOD_BASE = "https://api.runpod.io";

export type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export class BillError extends Error {
  constructor(
    readonly code: "missing_key" | "bad_range" | "bad_key" | "provider_error" | "provider_unreachable",
    readonly status: number,
    readonly providerStatus?: number,
  ) {
    super(code);
  }
}

/** The bill window from the request body, default the last 30 days. */
export function billWindow(body: unknown, now: number): { from: number; to: number } {
  const b = (body ?? {}) as { from?: unknown; to?: unknown };
  const to = b.to === undefined ? now : b.to;
  const from = b.from === undefined ? (to as number) - BILL_WINDOW_SECS : b.from;
  if (!Number.isInteger(from) || !Number.isInteger(to)) throw new BillError("bad_range", 400);
  const [f, t] = [from as number, to as number];
  if (f < 0 || t <= f || t - f > MAX_WINDOW_SECS || t > now + 3_600) throw new BillError("bad_range", 400);
  return { from: f, to: t };
}

/** The user's key from the request header; the proxy accepts nothing else. */
export function providerKey(header: string | undefined): string {
  const key = header?.trim() ?? "";
  // keys are short tokens: refuse anything that could not be one
  if (!key || key.length > 512 || /\s/.test(key)) throw new BillError("missing_key", 400);
  return key;
}

async function getJson(fetchFn: Fetch, url: string, key: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // a timeout or a network error, never echoed
    throw new BillError("provider_unreachable", 504);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * For a required call: a provider 401 means the key is wrong, and so does a
 * Vast.ai 404 ("Returned when the supplied API key does not match any user",
 * API reference). Anything else is a provider error.
 */
function providerFailure(status: number, provider: "vast" | "runpod"): BillError {
  if (status === 401 || (provider === "vast" && status === 404)) return new BillError("bad_key", 401, status);
  return new BillError("provider_error", 502, status);
}

/** For a best-effort call: a refusal, a timeout or a network error all give null. */
async function tryGetJson(fetchFn: Fetch, url: string, key: string): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  try {
    const r = await getJson(fetchFn, url, key);
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

/** Vast.ai: instance charges of the window (all pages) and the GPU of each instance. */
export async function vastBill(fetchFn: Fetch, key: string, from: number, to: number): Promise<VastBillAnswer> {
  const filters = JSON.stringify({ day: { gte: from, lte: to }, type: { in: ["instance"] } });
  const charges: unknown[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ select_filters: filters, limit: "500" });
    if (after) q.set("after_token", after);
    const r = await getJson(fetchFn, `${VAST_BASE}/api/v0/charges/?${q}`, key);
    if (!r.ok) throw providerFailure(r.status, "vast");
    const body = (r.body ?? {}) as { results?: unknown; next_token?: unknown };
    for (const c of Array.isArray(body.results) ? body.results : []) charges.push(pickVastCharge(c));
    after = typeof body.next_token === "string" ? body.next_token : null;
    if (!after) break;
  }

  // Best effort: a key without instance_read still gets its charges.
  let instances: unknown[] | null = [];
  after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: "25", select_cols: JSON.stringify(["id", "gpu_name", "num_gpus"]) });
    if (after) q.set("after_token", after);
    const r = await tryGetJson(fetchFn, `${VAST_BASE}/api/v1/instances/?${q}`, key);
    if (!r) {
      instances = null;
      break;
    }
    const body = (r.body ?? {}) as { instances?: unknown; next_token?: unknown };
    for (const i of Array.isArray(body.instances) ? body.instances : []) {
      const x = i as { id?: unknown; gpu_name?: unknown; num_gpus?: unknown };
      instances.push({ id: x.id, gpu_name: x.gpu_name, num_gpus: x.num_gpus });
    }
    after = typeof body.next_token === "string" ? body.next_token : null;
    if (!after) break;
  }
  return { provider: "vast", from, to, charges, instances };
}

function pickVastCharge(c: unknown) {
  const x = (c ?? {}) as { type?: unknown; source?: unknown; amount?: unknown; start?: unknown; end?: unknown; items?: unknown };
  return {
    type: x.type,
    source: x.source,
    amount: x.amount,
    start: x.start,
    end: x.end,
    items: (Array.isArray(x.items) ? x.items : []).map((it) => {
      const i = (it ?? {}) as { type?: unknown; description?: unknown; amount?: unknown };
      return { type: i.type, description: i.description, amount: i.amount };
    }),
  };
}

/** Runpod: daily pod billing records of the window and the GPU of each pod. */
export async function runpodBill(fetchFn: Fetch, key: string, from: number, to: number): Promise<RunpodBillAnswer> {
  const iso = (t: number) => new Date(t * 1000).toISOString();
  const q = new URLSearchParams({ startTime: iso(from), endTime: iso(to), bucketSize: "day" });
  const r = await getJson(fetchFn, `${RUNPOD_BASE}/v2/billing/pods?${q}`, key);
  if (!r.ok) throw providerFailure(r.status, "runpod");
  const body = (r.body ?? {}) as { records?: unknown };
  const records = (Array.isArray(body.records) ? body.records : []).map((rec) => {
    const x = (rec ?? {}) as Record<string, unknown>;
    return { podId: x.podId, gpuAmount: x.gpuAmount, cpuAmount: x.cpuAmount, diskAmount: x.diskAmount, totalAmount: x.totalAmount };
  });

  // Best effort, like the Vast.ai instances.
  let pods: unknown[] | null = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const pq = new URLSearchParams({ limit: "1000" });
    if (cursor) pq.set("cursor", cursor);
    const p = await tryGetJson(fetchFn, `${RUNPOD_BASE}/v2/pods?${pq}`, key);
    if (!p) {
      pods = null;
      break;
    }
    const pb = (p.body ?? {}) as { pods?: unknown; pagination?: { nextCursor?: unknown } };
    for (const x of Array.isArray(pb.pods) ? pb.pods : []) {
      const y = (x ?? {}) as { id?: unknown; gpu?: { id?: unknown; count?: unknown } | null; cost?: unknown };
      pods.push({ id: y.id, gpu: y.gpu ? { id: y.gpu.id, count: y.gpu.count } : null, cost: y.cost });
    }
    cursor = typeof pb.pagination?.nextCursor === "string" ? pb.pagination.nextCursor : null;
    if (!cursor) break;
  }
  return { provider: "runpod", from, to, records, pods };
}

// ---------------------------------------------------------------- host earnings (M5)

/** Days of host earnings from the request body, default 30, at most 31; and an optional Vast.ai user id. */
export function earningsRequest(body: unknown): { days: number; userId: number | null } {
  const b = (body ?? {}) as { days?: unknown; userId?: unknown };
  const days = b.days === undefined ? 30 : b.days;
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 31) throw new BillError("bad_range", 400);
  const userId = b.userId === undefined || b.userId === null ? null : b.userId;
  if (userId !== null && (!Number.isInteger(userId) || (userId as number) <= 0)) throw new BillError("bad_range", 400);
  return { days: days as number, userId: userId as number | null };
}

/**
 * Vast.ai host earnings of the last `days` days per machine, and the GPU of
 * each machine. The earnings answer also carries the host's name, email,
 * address and tax data: only `per_machine` is passed on. Without a user id
 * in the body the key needs `user_read` to look it up: a refusal there answers
 * `provider_error` with `providerStatus` 403, a wrong key `bad_key`.
 * `last_days` is the parameter of the API reference; whether the API honours
 * it is checked with a real host key (assumption A18).
 */
export async function vastEarnings(
  fetchFn: Fetch,
  key: string,
  days: number,
  userIdIn: number | null,
): Promise<VastEarningsAnswer> {
  let userId = userIdIn;
  if (userId === null) {
    const u = await getJson(fetchFn, `${VAST_BASE}/api/v0/users/current/`, key);
    const id = (u.body as { id?: unknown } | null)?.id;
    if (!u.ok) throw providerFailure(u.status, "vast");
    if (!Number.isInteger(id)) throw new BillError("provider_error", 502, 200);
    userId = id as number;
  }
  const q = new URLSearchParams({ last_days: String(days) });
  const e = await getJson(fetchFn, `${VAST_BASE}/api/v0/users/${userId}/machine-earnings/?${q}`, key);
  if (!e.ok) throw providerFailure(e.status, "vast");
  const per = (e.body as { per_machine?: unknown } | null)?.per_machine;
  const perMachine = (Array.isArray(per) ? per : []).map((p) => {
    const x = (p ?? {}) as Record<string, unknown>;
    return { machine_id: x.machine_id, gpu_earn: x.gpu_earn, sto_earn: x.sto_earn, bwu_earn: x.bwu_earn, bwd_earn: x.bwd_earn };
  });

  // Best effort: a key without machine_read still gets its earnings.
  let machines: unknown[] | null = null;
  const m = await tryGetJson(fetchFn, `${VAST_BASE}/api/v0/machines/?${new URLSearchParams({ user_id: String(userId) })}`, key);
  if (m) {
    const list = (m.body as { machines?: unknown } | null)?.machines;
    machines = (Array.isArray(list) ? list : []).map((x) => {
      const y = (x ?? {}) as Record<string, unknown>;
      return { id: y.id, gpu_name: y.gpu_name, num_gpus: y.num_gpus, listed_gpu_cost: y.listed_gpu_cost };
    });
  }
  return { provider: "vast", days, perMachine, machines };
}
