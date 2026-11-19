// Sets the band half widths of every class to the values in the SDK class
// specs (admin only, devnet). Applies to series created after this call; a
// live series keeps its band. Every other class parameter is kept as it is on
// chain.
//   pnpm --filter @clamp/backend set-half-widths

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BN, CLASSES, KeypairWallet, classPda, clampProgram, configPda } from "@clamp/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const KEY_DIR = join(homedir(), ".config", "solana", "clamp");
const load = (name: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEY_DIR, name), "utf8")) as number[]));

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  if (!rpc.includes("devnet")) throw new Error("devnet only");
  const connection = new Connection(rpc, "confirmed");
  const admin = load("deployer.json");
  const program = clampProgram(connection, new KeypairWallet(admin));

  for (const spec of Object.values(CLASSES)) {
    const current = await program.account.classConfig.fetch(classPda(spec.classId));
    const sig = await program.methods
      .setClass(spec.classId, {
        name: current.name,
        enabled: current.enabled,
        reporters: current.reporters.slice(0, current.reporterCount),
        minReporters: current.minReporters,
        sources: current.sources.slice(0, current.sourceCount),
        minSources: current.minSources,
        minTotalWeight: current.minTotalWeight,
        minPrice: new BN(current.minPrice.toString()),
        maxPrice: new BN(current.maxPrice.toString()),
        maxStepPpm: current.maxStepPpm,
        halfWidthPpm: spec.halfWidthPpm,
      })
      .accountsPartial({ admin: admin.publicKey, config: configPda(), classConfig: classPda(spec.classId) })
      .rpc();
    const after = await program.account.classConfig.fetch(classPda(spec.classId));
    console.log(
      `class ${spec.classId}: half widths ${current.halfWidthPpm.join("/")} -> ${after.halfWidthPpm.join("/")} ppm, ` +
        `reporters ${after.reporterCount} quorum ${after.minReporters} (${sig})`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
