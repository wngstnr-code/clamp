// Local runs: `pnpm --filter @clamp/backend tick | report | record | dry-run | prune`.
// Reads the repo root .env. The worker key comes from WORKER_KEYPAIR or, for
// local runs, WORKER_KEYPAIR_PATH (a keypair file). Nothing secret is printed.

import { SOURCE_NAMES, supabaseRawBase, verifyReport } from "@clamp/sdk";
import { Connection } from "@solana/web3.js";

import { loadEnv } from "./env.js";
import { allClasses, buildReport, fetchAll } from "./fetch-sources.js";
import { Store } from "./store.js";
import { crankStep, mirrorStep } from "./crank.js";
import { pruneStep } from "./prune.js";
import { recordStep, reportStep, tick } from "./tick.js";

const usd = (micro: bigint) => `$${(Number(micro) / 1_000_000).toFixed(4)}`;

async function dryRun() {
  const classes = allClasses();
  const answers = await fetchAll(classes);
  for (const spec of classes) {
    const report = buildReport(spec, answers);
    console.log(`\n${spec.name} (class ${spec.classId})`);
    for (const s of report.slots) {
      const name = SOURCE_NAMES[s.sourceId] ?? s.sourceId;
      const value = s.ok ? `${usd(s.price)}  capacity ${s.capacity}` : `no price: ${s.error}`;
      console.log(`  ${String(name).padEnd(8)} ${value}  sha256 ${s.sha256?.slice(0, 12) ?? "-"}`);
    }
  }
  console.log("\nDry run: nothing archived, nothing sent.");
}

/** Recomputes a report transaction from its public raw files. */
async function verify(signature: string | undefined) {
  if (!signature) throw new Error("usage: verify <transaction signature>");
  const env = loadEnv();
  if (!env.supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  const checks = await verifyReport(new Connection(env.rpcUrl, "confirmed"), signature, [supabaseRawBase(env.supabaseUrl)]);
  for (const c of checks) {
    console.log(`class ${c.classId} reporter ${c.reporter} ts ${c.ts}: ${c.ok ? "OK" : "MISMATCH"}`);
    for (const s of c.slots) {
      const name = String(SOURCE_NAMES[s.sourceId] ?? s.sourceId).padEnd(8);
      const re = s.recomputedPrice === undefined ? "" : ` recomputed ${s.recomputedPrice} cap ${s.recomputedCapacity}`;
      console.log(`  ${name} ${s.status.padEnd(14)} chain ${s.onChainPrice} cap ${s.onChainCapacity}${re}`);
    }
  }
  if (checks.length === 0) console.log("no report events in this transaction");
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

async function main() {
  const [command, flag] = process.argv.slice(2);
  if (command === "report" && flag === "--dry-run") return dryRun();
  if (command === "verify") return verify(flag);

  const env = loadEnv();
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const store = Store.connect(env.supabaseUrl, env.supabaseServiceKey);
  const connection = new Connection(env.rpcUrl, "confirmed");

  if (command === "record") {
    console.log(await recordStep(connection, store));
    return;
  }
  if (command === "prune") {
    console.log(await pruneStep(store, new Date(), true));
    return;
  }
  if (command === "mirror") {
    console.log(await mirrorStep(connection, store));
    return;
  }
  if (!env.worker) throw new Error("WORKER_KEYPAIR or WORKER_KEYPAIR_PATH is required");
  console.log(`reporter ${env.worker.publicKey.toBase58()} on ${env.rpcUrl}`);
  const results =
    command === "report"
      ? await reportStep(connection, env.worker, store, store)
      : command === "crank"
        ? await crankStep(connection, env.worker, store)
        : await tick(connection, env.worker, store);
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.action} ${r.detail}${r.signature ? ` ${r.signature}` : ""}`);
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
