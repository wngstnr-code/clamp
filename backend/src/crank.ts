// Steps 3 (crank) and 4 (mirror) of a tick (architecture 5). Every action is
// permissionless; the worker only pays fees and rent.

import { CLASSES, TUSDC_MINT, classPda, getLocks, idlePda, vaultPda } from "@clamp/sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { createSeries, program, rollLock, seedSeries, settleSeries, sweepSeries } from "./clamp-tx.js";
import { expiryWait, planCrank, planRolls, type ClassState, type LockState, type SeriesState } from "./crank-plan.js";
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
    upValue: s.upValue,
  }));
  const classes: ClassState[] = [];
  for (const spec of Object.values(CLASSES)) {
    const c = await p.account.classConfig.fetchNullable(classPda(spec.classId));
    if (!c) continue;
    classes.push({
      classId: spec.classId,
      seriesCount: c.seriesCount.map(Number),
      currentExpiry: c.currentExpiry.map(num),
      currentSeries: c.currentSeries.map((k: PublicKey) => k.toBase58()),
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

/** The cluster's clock (what the program checks), the local clock as a fallback. */
async function chainNow(connection: Connection): Promise<number> {
  try {
    const t = await connection.getBlockTime(await connection.getSlot("confirmed"));
    if (t) return t;
  } catch {
    // fall through
  }
  return Math.floor(Date.now() / 1000);
}

/** Step 3: settle, sweep, create, seed. Each action is logged on its own. */
export async function crankStep(connection: Connection, worker: Keypair, store: Store | null): Promise<StepResult[]> {
  let now = await chainNow(connection);
  let state = await loadState(connection);
  const wait = expiryWait(state.series, now);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait * 1000));
    now = await chainNow(connection);
    state = await loadState(connection);
  }
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
  // Rolls (M6) run on fresh state: a series settled and its successor seeded
  // in this tick are already visible.
  await rollStep(connection, worker, run);

  if (store) for (const r of results) await store.logRun(`crank:${r.action}`, r.ok, r.detail || null, r.signature ?? null);
  return results;
}

async function rollStep(
  connection: Connection,
  worker: Keypair,
  run: (action: string, f: () => Promise<string>) => Promise<string | null>,
) {
  const now = await chainNow(connection);
  const state = await loadState(connection);
  const locks: LockState[] = (await getLocks(connection)).map((l) => ({
    key: l.address.toBase58(),
    owner: l.owner.toBase58(),
    series: l.series.toBase58(),
    side: l.side,
    hours: l.hours,
    autoRoll: l.autoRoll,
    escrowAmount: l.escrowAmount,
    rentPayer: l.rentPayer.toBase58(),
  }));
  for (const r of planRolls({ now, classes: state.classes, series: state.series, locks })) {
    const owner = new PublicKey(r.lock.owner);
    // the owner's tUSDC account receives the rest; without it the roll would fail
    const ata = getAssociatedTokenAddressSync(TUSDC_MINT, owner);
    if (!(await connection.getAccountInfo(ata))) continue;
    await run(`roll:${r.lock.key}`, () =>
      rollLock(connection, worker, {
        owner,
        side: r.lock.side,
        oldSeries: new PublicKey(r.oldSeries.key),
        newSeries: new PublicKey(r.newSeries.key),
        classId: r.oldSeries.classId,
        rentPayer: new PublicKey(r.lock.rentPayer),
      }),
    );
  }
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
