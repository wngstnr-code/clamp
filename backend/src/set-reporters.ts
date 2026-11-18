// Sets the reporter list and quorum of every class (admin only, devnet).
//   pnpm --filter @clamp/backend set-reporters <min_reporters> <keypair file>...
// Keypair files are read from ~/.config/solana/clamp/ (only public keys are used).
// All other class parameters are taken from the class specs in the SDK, so the
// sources stay exactly as created (set_class refuses a change).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BN, CLASSES, KeypairWallet, classPda, clampProgram, configPda } from "@clamp/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const KEY_DIR = join(homedir(), ".config", "solana", "clamp");
const load = (name: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEY_DIR, name), "utf8")) as number[]));

async function main() {
  const [minArg, ...files] = process.argv.slice(2);
  const minReporters = Number(minArg);
  if (!Number.isInteger(minReporters) || minReporters < 1 || files.length < minReporters) {
    throw new Error("usage: set-reporters <min_reporters> <keypair file>...");
  }
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  if (!rpc.includes("devnet")) throw new Error("devnet only");
  const connection = new Connection(rpc, "confirmed");
  const admin = load("deployer.json");
  const reporters: PublicKey[] = files.map((f) => load(f).publicKey);
  const program = clampProgram(connection, new KeypairWallet(admin));

  for (const spec of Object.values(CLASSES)) {
    const current = await program.account.classConfig.fetch(classPda(spec.classId));
    const sig = await program.methods
      .setClass(spec.classId, {
        name: current.name,
        enabled: current.enabled,
        reporters,
        minReporters,
        sources: current.sources.slice(0, current.sourceCount),
        minSources: current.minSources,
        minTotalWeight: current.minTotalWeight,
        minPrice: new BN(current.minPrice.toString()),
        maxPrice: new BN(current.maxPrice.toString()),
        maxStepPpm: current.maxStepPpm,
        halfWidthPpm: current.halfWidthPpm,
      })
      .accountsPartial({ admin: admin.publicKey, config: configPda(), classConfig: classPda(spec.classId) })
      .rpc();
    console.log(`class ${spec.classId}: ${reporters.length} reporters, quorum ${minReporters} (${sig})`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
