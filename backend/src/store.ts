// Supabase access for the worker: the raw archive and the history tables.
// Uses the service role key, which bypasses row level security (writes).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rawFileName } from "@clamp/sdk";

import type { RawAnswer } from "./fetch-sources.js";

export const RAW_BUCKET = "raw";

export interface SourceTickRow {
  ts: string;
  class_id: number;
  source_id: number;
  reporter: string;
  price_micro: string | null;
  capacity: number;
  ok: boolean;
  error: string | null;
  raw_path: string | null;
  raw_sha256: string | null;
  signature: string;
}

export interface IndexUpdateRow {
  ts: string;
  class_id: number;
  price_micro: string;
  candidate_micro: string;
  reporter_count: number;
  sources: { id: number; price: string; capacity: number; weight: number }[];
  signature: string;
  slot: number;
}

export class Store {
  constructor(private readonly db: SupabaseClient) {}

  static connect(url: string, serviceKey: string): Store {
    return new Store(createClient(url, serviceKey, { auth: { persistSession: false } }));
  }

  /** Uploads a raw answer under its hash. An existing file is the same file. */
  async archive(answer: RawAnswer): Promise<string> {
    const path = rawFileName(answer.sha256);
    const { error } = await this.db.storage
      .from(RAW_BUCKET)
      .upload(path, answer.bytes, { contentType: "application/json", upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`archive ${path}: ${error.message}`);
    return `${RAW_BUCKET}/${path}`;
  }

  async insertSourceTicks(rows: SourceTickRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.db
      .from("source_ticks")
      .upsert(rows, { onConflict: "reporter,class_id,source_id,ts", ignoreDuplicates: true });
    if (error) throw new Error(`source_ticks: ${error.message}`);
  }

  async insertIndexUpdates(rows: IndexUpdateRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.db
      .from("index_updates")
      .upsert(rows, { onConflict: "signature,class_id", ignoreDuplicates: true });
    if (error) throw new Error(`index_updates: ${error.message}`);
  }

  /** Mirror of the series accounts (architecture 5.1). Never touches `settle_signature`. */
  async upsertSeries(rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.db.from("series").upsert(rows, { onConflict: "address" });
    if (error) throw new Error(`series: ${error.message}`);
  }

  async setSettleSignature(address: string, signature: string): Promise<void> {
    const { error } = await this.db.from("series").update({ settle_signature: signature }).eq("address", address);
    if (error) console.error(`settle signature: ${error.message}`);
  }

  /** Signatures among `signatures` that are already in `source_ticks`. */
  async knownSignatures(signatures: string[]): Promise<Set<string>> {
    if (signatures.length === 0) return new Set();
    const { data, error } = await this.db.from("source_ticks").select("signature").in("signature", signatures);
    if (error) throw new Error(`known signatures: ${error.message}`);
    return new Set((data ?? []).map((r) => r.signature as string));
  }

  /** Raw files, oldest first, skipping the first `offset`. */
  async listRawOldestFirst(limit: number, offset: number): Promise<{ name: string; createdAt: string | null }[]> {
    const { data, error } = await this.db.storage
      .from(RAW_BUCKET)
      .list("", { limit, offset, sortBy: { column: "created_at", order: "asc" } });
    if (error) throw new Error(`list raw: ${error.message}`);
    return (data ?? []).map((f) => ({ name: f.name, createdAt: f.created_at ?? null }));
  }

  /** Hashes among `hashes` that a source row at or after `since` still uses. */
  async hashesUsedSince(hashes: string[], since: Date): Promise<Set<string>> {
    const used = new Set<string>();
    for (let i = 0; i < hashes.length; i += 100) {
      const { data, error } = await this.db
        .from("source_ticks")
        .select("raw_sha256")
        .in("raw_sha256", hashes.slice(i, i + 100))
        .gte("ts", since.toISOString());
      if (error) throw new Error(`used hashes: ${error.message}`);
      for (const r of data ?? []) used.add(r.raw_sha256 as string);
    }
    return used;
  }

  async removeRaw(names: string[]): Promise<void> {
    for (let i = 0; i < names.length; i += 100) {
      const { error } = await this.db.storage.from(RAW_BUCKET).remove(names.slice(i, i + 100));
      if (error) throw new Error(`remove raw: ${error.message}`);
    }
  }

  async logRun(action: string, ok: boolean, detail: string | null, signature: string | null = null): Promise<void> {
    const { error } = await this.db.from("crank_runs").insert({ action, ok, detail, signature });
    if (error) console.error(`crank_runs: ${error.message}`);
  }

  async lastSuccess(prefix: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("crank_runs")
      .select("ts")
      .eq("ok", true)
      .like("action", `${prefix}%`)
      .order("ts", { ascending: false })
      .limit(1);
    if (error) throw new Error(`last success: ${error.message}`);
    return (data?.[0]?.ts as string | undefined) ?? null;
  }
}
