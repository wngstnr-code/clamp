// verifyReport: anyone can check a report against its public raw files.
// For each source slot: download the raw file named by its hash, hash it,
// recompute price and capacity with the public rule, compare with the chain.

import { Connection } from "@solana/web3.js";

import { classSpec } from "./sources/classes.js";
import { clampEventParser } from "./program.js";

/** Raw files are content-addressed: `<base>/<sha256 hex>.json` (D-053). */
export function rawFileName(hashHex: string): string {
  return `${hashHex}.json`;
}

/** Public base URL of the raw archive in a Supabase project. */
export function supabaseRawBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/raw`;
}

export function toHex(bytes: Uint8Array | number[]): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

export type SlotStatus =
  | "match"
  | "not_reported" // price 0 and no hash: the source did not answer
  | "raw_missing" // no archive had the file
  | "hash_mismatch"
  | "price_mismatch";

export interface SlotCheck {
  slot: number;
  sourceId: number;
  status: SlotStatus;
  hash: string;
  onChainPrice: bigint;
  onChainCapacity: number;
  recomputedPrice?: bigint;
  recomputedCapacity?: number;
  rawUrl?: string;
}

export interface ReportCheck {
  classId: number;
  reporter: string;
  ts: number;
  ok: boolean;
  slots: SlotCheck[];
}

interface ReportSubmittedEvent {
  classId: number;
  reporter: { toBase58(): string };
  ts: { toString(): string };
  prices: { toString(): string }[];
  capacities: number[];
  rawHashes: number[][];
}

/**
 * Checks every `ReportSubmitted` event in a transaction.
 *
 * `rawBases` are archive base URLs tried in order (for example the Supabase
 * bucket of reporter 1 and the public archives of reporters 2 and 3).
 */
export async function verifyReport(
  connection: Connection,
  signature: string,
  rawBases: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ReportCheck[]> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) throw new Error("transaction or logs not found");

  const checks: ReportCheck[] = [];
  for (const event of clampEventParser().parseLogs(tx.meta.logMessages)) {
    if (event.name !== "reportSubmitted") continue;
    const e = event.data as unknown as ReportSubmittedEvent;
    checks.push(await checkReport(e, rawBases, fetchImpl));
  }
  return checks;
}

async function checkReport(
  e: ReportSubmittedEvent,
  rawBases: string[],
  fetchImpl: typeof fetch,
): Promise<ReportCheck> {
  const spec = classSpec(e.classId);
  const slots: SlotCheck[] = [];
  for (let i = 0; i < spec.sources.length; i++) {
    const source = spec.sources[i]!;
    const hash = toHex(e.rawHashes[i] ?? []);
    const onChainPrice = BigInt(e.prices[i]!.toString());
    const onChainCapacity = e.capacities[i] ?? 0;
    const base: SlotCheck = { slot: i, sourceId: source.sourceId, status: "match", hash, onChainPrice, onChainCapacity };
    if (/^0+$/.test(hash)) {
      slots.push({ ...base, status: onChainPrice === 0n ? "not_reported" : "raw_missing" });
      continue;
    }
    let raw: Uint8Array | null = null;
    let rawUrl: string | undefined;
    for (const b of rawBases) {
      const url = `${b.replace(/\/$/, "")}/${rawFileName(hash)}`;
      const res = await fetchImpl(url);
      if (res.ok) {
        raw = new Uint8Array(await res.arrayBuffer());
        rawUrl = url;
        break;
      }
    }
    if (!raw) {
      slots.push({ ...base, status: "raw_missing" });
      continue;
    }
    if ((await sha256Hex(raw)) !== hash) {
      slots.push({ ...base, status: "hash_mismatch", rawUrl });
      continue;
    }
    const result = source.rule(new TextDecoder().decode(raw));
    const same = result.price === onChainPrice && result.capacity === onChainCapacity;
    slots.push({
      ...base,
      status: same ? "match" : "price_mismatch",
      recomputedPrice: result.price,
      recomputedCapacity: result.capacity,
      rawUrl,
    });
  }
  return {
    classId: e.classId,
    reporter: e.reporter.toBase58(),
    ts: Number(e.ts.toString()),
    ok: slots.every((s) => s.status === "match" || s.status === "not_reported"),
    slots,
  };
}
