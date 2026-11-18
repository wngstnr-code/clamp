// One tick (docs/architecture.md section 5): step 1 report, step 2 record.
// Steps 3 (crank) and 4 (mirror) live in crank.ts.

import { indexPda, type ClassSpec } from "@clamp/sdk";
import { Connection, Keypair } from "@solana/web3.js";

import { readLogs, sendReport } from "./chain.js";
import type { Archiver } from "./archiver.js";
import { crankStep, mirrorStep } from "./crank.js";
import { rowsFromLogs } from "./events.js";
import { allClasses, buildReport, fetchAll, requestKey, type ClassReport } from "./fetch-sources.js";
import type { Store } from "./store.js";

export interface StepResult {
  action: string;
  ok: boolean;
  detail: string;
  signature?: string;
}

const summary = (r: ClassReport) =>
  r.slots.map((s) => `${s.sourceId}:${s.ok ? s.price.toString() : `none (${s.error})`}`).join(" ");

/**
 * Step 1: fetch, archive, report each class on chain, store the rows.
 * `db` is null for reporters 2 and 3: they only archive and report, and the
 * record step of reporter 1 stores their events.
 */
export async function reportStep(
  connection: Connection,
  worker: Keypair,
  archiver: Archiver,
  db: Store | null,
  classes: ClassSpec[] = allClasses(),
  fetchImpl: typeof fetch = fetch,
): Promise<StepResult[]> {
  const answers = await fetchAll(classes, fetchImpl);

  // Archive every raw answer before it is referenced on chain.
  const paths = new Map<string, string>();
  for (const [key, answer] of answers) {
    if (answer instanceof Error) continue;
    paths.set(key, await archiver.archive(answer));
  }

  const results: StepResult[] = [];
  for (const spec of classes) {
    const action = `report:${spec.classId}`;
    const report = buildReport(spec, answers);
    try {
      const signature = await sendReport(connection, worker, report);
      const { logs, slot } = await readLogs(connection, signature);
      const parsed = rowsFromLogs(logs, signature, slot, {
        classId: spec.classId,
        errors: report.slots.map((s) => s.error),
        rawPaths: spec.sources.map((s, i) =>
          report.slots[i]?.sha256 ? (paths.get(requestKey(s.request)) ?? null) : null,
        ),
      });
      if (db) {
        await db.insertSourceTicks(parsed.ticks);
        await db.insertIndexUpdates(parsed.updates);
      }
      const updated = parsed.updates.length > 0 ? ` updated to ${parsed.updates[0]!.price_micro}` : " stored";
      results.push({ action, ok: true, detail: `${summary(report)};${updated}`, signature });
    } catch (e) {
      results.push({ action, ok: false, detail: `${summary(report)}; ${(e as Error).message}` });
    }
  }
  if (db) for (const r of results) await db.logRun(r.action, r.ok, r.detail, r.signature ?? null);
  return results;
}

/**
 * Step 2: store the events of report transactions sent by any reporter
 * (including reporters 2 and 3) that are not in the database yet.
 */
export async function recordStep(
  connection: Connection,
  store: Store,
  classes: ClassSpec[] = allClasses(),
): Promise<StepResult> {
  let added = 0;
  try {
    for (const spec of classes) {
      const sigs = (await connection.getSignaturesForAddress(indexPda(spec.classId), { limit: 100 }, "confirmed"))
        .filter((s) => s.err === null)
        .map((s) => s.signature);
      const known = await store.knownSignatures(sigs);
      for (const signature of sigs.filter((s) => !known.has(s))) {
        const { logs, slot, failed } = await readLogs(connection, signature);
        if (failed) continue;
        const parsed = rowsFromLogs(logs, signature, slot);
        // Setup transactions (init_index, set_class) touch the index but carry no events.
        if (parsed.ticks.length === 0 && parsed.updates.length === 0) continue;
        await store.insertSourceTicks(parsed.ticks);
        await store.insertIndexUpdates(parsed.updates);
        added += 1;
      }
    }
    const result = { action: "record", ok: true, detail: `${added} new report transactions` };
    await store.logRun(result.action, result.ok, result.detail);
    return result;
  } catch (e) {
    const result = { action: "record", ok: false, detail: `${added} recorded before error: ${(e as Error).message}` };
    await store.logRun(result.action, result.ok, result.detail);
    return result;
  }
}

/** One tick: report, record, crank, mirror (architecture 5). */
export async function tick(connection: Connection, worker: Keypair, store: Store): Promise<StepResult[]> {
  const report = await reportStep(connection, worker, store, store);
  const record = await recordStep(connection, store);
  const crank = await crankStep(connection, worker, store);
  const mirror = await mirrorStep(connection, store);
  return [...report, record, ...crank, mirror];
}
