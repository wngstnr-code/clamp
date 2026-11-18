// Turns the clamp events of one transaction into database rows.

import { classSpec, clampEventParser, toHex } from "@clamp/sdk";

import type { IndexUpdateRow, SourceTickRow } from "./store.js";

interface Num {
  toString(): string;
}

interface ReportSubmitted {
  classId: number;
  reporter: { toBase58(): string };
  ts: Num;
  prices: Num[];
  capacities: number[];
  rawHashes: number[][];
}

interface IndexUpdated {
  classId: number;
  ts: Num;
  price: Num;
  candidate: Num;
  reporterCount: number;
  sources: { sourceId: number; price: Num; capacity: number; weight: number }[];
}

export interface ParsedTx {
  ticks: SourceTickRow[];
  updates: IndexUpdateRow[];
}

const iso = (ts: Num) => new Date(Number(ts.toString()) * 1000).toISOString();

/**
 * Rows for every `ReportSubmitted` and `IndexUpdated` event in the logs.
 * `own` adds the local error text and raw paths for this worker's report.
 */
export function rowsFromLogs(
  logs: string[],
  signature: string,
  slot: number,
  own?: { classId: number; errors: (string | null)[]; rawPaths: (string | null)[] },
): ParsedTx {
  const ticks: SourceTickRow[] = [];
  const updates: IndexUpdateRow[] = [];
  for (const event of clampEventParser().parseLogs(logs)) {
    if (event.name === "reportSubmitted") {
      const e = event.data as unknown as ReportSubmitted;
      const mine = own && own.classId === e.classId ? own : undefined;
      const n = classSpec(e.classId).sources.length;
      for (let i = 0; i < n; i++) {
        const price = BigInt(e.prices[i]!.toString());
        const hash = toHex(e.rawHashes[i] ?? []);
        const hasHash = !/^0+$/.test(hash);
        ticks.push({
          ts: iso(e.ts),
          class_id: e.classId,
          source_id: classSpec(e.classId).sources[i]!.sourceId,
          reporter: e.reporter.toBase58(),
          price_micro: price > 0n ? price.toString() : null,
          capacity: e.capacities[i] ?? 0,
          ok: price > 0n,
          error: price > 0n ? null : (mine?.errors[i] ?? "no price reported"),
          raw_path: mine?.rawPaths[i] ?? null,
          raw_sha256: hasHash ? hash : null,
          signature,
        });
      }
    } else if (event.name === "indexUpdated") {
      const e = event.data as unknown as IndexUpdated;
      updates.push({
        ts: iso(e.ts),
        class_id: e.classId,
        price_micro: e.price.toString(),
        candidate_micro: e.candidate.toString(),
        reporter_count: e.reporterCount,
        sources: e.sources
          .filter((s) => s.sourceId > 0)
          .map((s) => ({ id: s.sourceId, price: s.price.toString(), capacity: s.capacity, weight: s.weight })),
        signature,
        slot,
      });
    }
  }
  return { ticks, updates };
}
