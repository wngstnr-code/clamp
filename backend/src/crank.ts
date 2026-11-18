// Steps 3 (crank) and 4 (mirror) of a tick (architecture 5). Every action is
// permissionless; the worker only pays fees and rent.

import { CLASSES, classPda, idlePda, vaultPda } from "@clamp/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { createSeries, program, seedSeries, settleSeries, sweepSeries } from "./clamp-tx.js";
import { planCrank, type ClassState, type SeriesState } from "./crank-plan.js";
import type { Store } from "./store.js";
import type { StepResult } from "./tick.js";

const num = (x: { toString(): string }) => Number(x.toString());

interface SeriesAccount {
  classId: number;
  kind: number;
  seq: number;
  startTs: { toString(): string };
  closeTs: { toString(): string };
  expiryTs: { toString(): string };
  center: { toString(): string };
  lower: { toString(): string };
  upper: { toString(): string };
  seeded: boolean;
  settled: boolean;
  swept: boolean;
  avg: { toString(): string };
  upValue: number;
  coveragePpm: number;
}

async function loadState(connection: Connection) {
  const p = program(connection);
  const all = (await p.account.series.all()) as unknown as { publicKey: PublicKey; account: SeriesAccount }[];
  const series: SeriesState[] = all.map(({ publicKey, account: s }) => ({
    key: publicKey.toBase58(),
    classId: s.classId,
    kind: s.kind,
    seq: s.seq,
    closeTs: num(s.closeTs),
    expiryTs: num(s.expiryTs),
    seeded: s.seeded,
    settled: s.settled,
    swept: s.swept,
  }));
  const classes: ClassState[] = [];
  for (const spec of Object.values(CLASSES)) {
    const c = await p.account.classConfig.fetchNullable(classPda(spec.classId));
    if (!c) continue;
    classes.push({
      classId: spec.classId,
      seriesCount: c.seriesCount.map(Number),
      currentExpiry: c.currentExpiry.map(num),
    });
  }
  const vaultAcc = await p.account.vault.fetchNullable(vaultPda());
  const vault = vaultAcc
    ? {
        activeCount: vaultAcc.activeCount,
        idle: BigInt((await connection.getTokenAccountBalance(idlePda())).value.amount),
      }
    : null;
  return { series, classes, vault, accounts: all };
}

/** Step 3: settle, sweep, create, seed. Each action is logged on its own. */
export async function crankStep(connection: Connection, worker: Keypair, store: Store | null): Promise<StepResult[]> {
  const now = Math.floor(Date.now() / 1000);
  const state = await loadState(connection);
  const actions = planCrank({ now, ...state });
  const results: StepResult[] = [];

  const run = async (action: string, f: () => Promise<string>) => {
    try {
      const signature = await f();
      results.push({ action, ok: true, detail: "", signature });
      return signature;
    } catch (e) {
      results.push({ action, ok: false, detail: (e as Error).message.slice(0, 300) });
      return null;
    }
  };

  for (const a of actions) {
    if (a.type === "settle") {
      const sig = await run(`settle:${a.series.key}`, () =>
        settleSeries(connection, worker, new PublicKey(a.series.key), a.series.classId),
      );
      if (sig && store) await store.setSettleSignature(a.series.key, sig);
    } else if (a.type === "sweep") {
      await run(`sweep:${a.series.key}`, () => sweepSeries(connection, worker, new PublicKey(a.series.key), a.series.classId));
    } else if (a.type === "create") {
      let created: PublicKey | null = null;
      await run(`create:${a.classId}:${a.kind}:${a.seq}`, async () => {
        const r = await createSeries(connection, worker, a.classId, a.kind, a.seq);
        created = r.series;
        return r.signature;
      });
      // Seed the new series right away when the vault exists.
      if (created && state.vault) {
        const key: PublicKey = created;
        await run(`seed:${key.toBase58()}`, () => seedSeries(connection, worker, key, a.classId));
      }
    } else if (a.type === "seed") {
      await run(`seed:${a.series.key}`, () => seedSeries(connection, worker, new PublicKey(a.series.key), a.series.classId));
    }
  }
  if (store) for (const r of results) await store.logRun(`crank:${r.action}`, r.ok, r.detail || null, r.signature ?? null);
  return results;
}

/** Step 4: copy every series account into the `series` table. */
export async function mirrorStep(connection: Connection, store: Store): Promise<StepResult> {
  try {
    const { accounts } = await loadState(connection);
    const iso = (x: { toString(): string }) => new Date(num(x) * 1000).toISOString();
    const rows = accounts.map(({ publicKey, account: s }) => ({
      address: publicKey.toBase58(),
      class_id: s.classId,
      kind: s.kind,
      start_ts: iso(s.startTs),
      close_ts: iso(s.closeTs),
      expiry_ts: iso(s.expiryTs),
      center: s.center.toString(),
      lower: s.lower.toString(),
      upper: s.upper.toString(),
      settled: s.settled,
      avg: s.settled ? s.avg.toString() : null,
      up_value: s.settled ? s.upValue : null,
      coverage_ppm: s.settled ? s.coveragePpm : null,
      updated_at: new Date().toISOString(),
    }));
    await store.upsertSeries(rows);
    const result = { action: "mirror", ok: true, detail: `${rows.length} series` };
    await store.logRun(result.action, true, result.detail);
    return result;
  } catch (e) {
    const result = { action: "mirror", ok: false, detail: (e as Error).message.slice(0, 300) };
    await store.logRun(result.action, false, result.detail);
    return result;
  }
}
