// Step 1a of a tick: fetch every source once and compute each class's report.
// Pure apart from the injected fetch, so it is tested without a network.

import { CLASSES, MAX_SOURCES, sha256Hex, type ClassSpec, type SourceRequest } from "@clamp/sdk";

/** One raw API answer, exactly as received. */
export interface RawAnswer {
  key: string;
  bytes: Uint8Array;
  sha256: string;
  status: number;
}

export interface SlotReport {
  sourceId: number;
  ok: boolean;
  price: bigint;
  capacity: number;
  error: string | null;
  /** Hash of the raw answer, or null when the request itself failed. */
  sha256: string | null;
}

export interface ClassReport {
  classId: number;
  slots: SlotReport[];
  /** Arguments for submit_report, padded to MAX_SOURCES. */
  prices: bigint[];
  capacities: number[];
  rawHashes: number[][];
}

const U32_MAX = 4_294_967_295;
const TIMEOUT_MS = 15_000;

export const requestKey = (r: SourceRequest) => `${r.method} ${r.url} ${r.body ?? ""}`;

/** Fetches each distinct request once. A failed request maps to an Error. */
export async function fetchAll(
  specs: ClassSpec[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, RawAnswer | Error>> {
  const requests = new Map<string, SourceRequest>();
  for (const spec of specs) for (const s of spec.sources) requests.set(requestKey(s.request), s.request);

  const out = new Map<string, RawAnswer | Error>();
  await Promise.all(
    [...requests].map(async ([key, req]) => {
      try {
        const res = await fetchImpl(req.url, {
          method: req.method,
          headers: { "user-agent": "clamp-index/0.1", ...req.headers },
          body: req.body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (!res.ok) {
          out.set(key, new Error(`HTTP ${res.status}`));
          return;
        }
        out.set(key, { key, bytes, sha256: await sha256Hex(bytes), status: res.status });
      } catch (e) {
        out.set(key, e instanceof Error ? e : new Error(String(e)));
      }
    }),
  );
  return out;
}

const hexToBytes = (hex: string) => Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));

/** Applies the public rules to the answers. Same input, same report. */
export function buildReport(spec: ClassSpec, answers: Map<string, RawAnswer | Error>): ClassReport {
  const decoder = new TextDecoder();
  const slots: SlotReport[] = spec.sources.map((s) => {
    const answer = answers.get(requestKey(s.request));
    if (!answer || answer instanceof Error) {
      return {
        sourceId: s.sourceId,
        ok: false,
        price: 0n,
        capacity: 0,
        error: answer instanceof Error ? answer.message : "not fetched",
        sha256: null,
      };
    }
    let result;
    try {
      result = s.rule(decoder.decode(answer.bytes));
    } catch (e) {
      result = { ok: false, price: 0n, capacity: 0, error: `rule failed: ${(e as Error).message}` };
    }
    return {
      sourceId: s.sourceId,
      ok: result.ok,
      price: result.ok ? result.price : 0n,
      capacity: result.ok ? Math.min(result.capacity, U32_MAX) : 0,
      error: result.ok ? null : (result.error ?? "rule failed"),
      sha256: answer.sha256,
    };
  });

  const pad = <T>(xs: T[], fill: T) => [...xs, ...Array<T>(MAX_SOURCES - xs.length).fill(fill)];
  return {
    classId: spec.classId,
    slots,
    prices: pad(slots.map((s) => s.price), 0n),
    capacities: pad(slots.map((s) => s.capacity), 0),
    rawHashes: pad(
      slots.map((s) => (s.sha256 ? hexToBytes(s.sha256) : Array<number>(32).fill(0))),
      Array<number>(32).fill(0),
    ),
  };
}

export const allClasses = () => Object.values(CLASSES);
