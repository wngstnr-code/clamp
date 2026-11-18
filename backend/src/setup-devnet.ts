// One-time devnet setup (docs/build-and-deploy.md section 3, deploy order).
// Safe to run again: every step checks the chain and skips what exists.
//
//   1. tUSDC mint (6 decimals, mint authority = deployer until the faucet
//      program takes it over in M2) and the treasury token account
//   2. initialize (Config), signed by the upgrade authority
//   3. per class: set_class (reporter = worker, quorum 1), then a fresh
//      Observations account and init_index in one transaction
//
// Keypairs are read from ~/.config/solana/clamp/ and never printed.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  BN,
  CLASSES,
  CLAMP_PROGRAM_ID,
  KeypairWallet,
  TEST_USDC_PROGRAM_ID,
  classPda,
  clampProgram,
  configPda,
  indexPda,
} from "@clamp/sdk";
import { AuthorityType, createMint, getMint, getOrCreateAssociatedTokenAccount, setAuthority } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const KEY_DIR = join(homedir(), ".config", "solana", "clamp");
const OBS_SIZE = 8 + 2_048 * 40;
const BPF_LOADER_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function loadKeypair(name: string): Keypair {
  const bytes = JSON.parse(readFileSync(join(KEY_DIR, name), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/** Loads a keypair file, creating it (mode 600) when missing. */
function loadOrCreateKeypair(name: string): Keypair {
  const path = join(KEY_DIR, name);
  if (!existsSync(path)) {
    const kp = Keypair.generate();
    writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    return kp;
  }
  return loadKeypair(name);
}

const exists = async (connection: Connection, key: PublicKey) =>
  (await connection.getAccountInfo(key, "confirmed")) !== null;

function nameBytes(name: string): number[] {
  const bytes = Array<number>(16).fill(0);
  const raw = Buffer.from(name);
  for (let i = 0; i < Math.min(16, raw.length); i++) bytes[i] = raw[i]!;
  return bytes;
}

async function main() {
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  if (!rpc.includes("devnet")) throw new Error(`refusing to run against ${rpc}: devnet only`);
  const connection = new Connection(rpc, "confirmed");
  const deployer = loadKeypair("deployer.json");
  const worker = loadKeypair("worker.json").publicKey;
  const program = clampProgram(connection, new KeypairWallet(deployer));
  console.log(`deployer ${deployer.publicKey.toBase58()}`);
  console.log(`worker   ${worker.toBase58()}`);

  // 1. tUSDC mint and treasury
  const mintKp = loadOrCreateKeypair("tusdc-mint.json");
  if (!(await exists(connection, mintKp.publicKey))) {
    await createMint(connection, deployer, deployer.publicKey, null, 6, mintKp, { commitment: "confirmed" });
    console.log("created tUSDC mint");
  }
  const treasury = await getOrCreateAssociatedTokenAccount(connection, deployer, mintKp.publicKey, deployer.publicKey);
  console.log(`tUSDC mint ${mintKp.publicKey.toBase58()}`);

  // 1b. hand the mint authority to the faucet program (M2), once it is deployed
  const faucetAuthority = PublicKey.findProgramAddressSync([Buffer.from("mint_authority")], TEST_USDC_PROGRAM_ID)[0];
  const mintInfo = await getMint(connection, mintKp.publicKey, "confirmed");
  const faucetDeployed = (await connection.getAccountInfo(TEST_USDC_PROGRAM_ID, "confirmed"))?.executable === true;
  if (mintInfo.mintAuthority?.equals(deployer.publicKey) && faucetDeployed) {
    const sig = await setAuthority(connection, deployer, mintKp.publicKey, deployer, AuthorityType.MintTokens, faucetAuthority);
    console.log(`mint authority -> faucet ${faucetAuthority.toBase58()} (${sig})`);
  } else {
    console.log(`mint authority ${mintInfo.mintAuthority?.toBase58() ?? "none"}`);
  }
  console.log(`treasury   ${treasury.address.toBase58()}`);

  // 2. initialize
  const config = configPda();
  if (!(await exists(connection, config))) {
    const programData = PublicKey.findProgramAddressSync([CLAMP_PROGRAM_ID.toBuffer()], BPF_LOADER_UPGRADEABLE)[0];
    const sig = await program.methods
      .initialize({ tradeFeeBps: 100, protocolShareBps: 2_000, seriesAllocBps: 1_000 })
      .accountsPartial({
        admin: deployer.publicKey,
        config,
        collateralMint: mintKp.publicKey,
        treasury: treasury.address,
        program: CLAMP_PROGRAM_ID,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`initialize ${sig}`);
  }
  console.log(`config     ${config.toBase58()}`);

  // 3. classes and indexes
  for (const spec of Object.values(CLASSES)) {
    const classKey = classPda(spec.classId);
    if (!(await exists(connection, classKey))) {
      const sig = await program.methods
        .setClass(spec.classId, {
          name: nameBytes(spec.name),
          enabled: true,
          reporters: [worker],
          minReporters: 1,
          sources: spec.sources.map((s) => ({
            sourceId: s.sourceId,
            hasCapacity: s.hasCapacity,
            fixedWeight: s.fixedWeight,
          })),
          minSources: spec.minSources,
          minTotalWeight: spec.minTotalWeight,
          minPrice: new BN(spec.minPrice.toString()),
          maxPrice: new BN(spec.maxPrice.toString()),
          maxStepPpm: spec.maxStepPpm,
          halfWidthPpm: spec.halfWidthPpm,
        })
        .accountsPartial({ admin: deployer.publicKey, config, classConfig: classKey })
        .rpc();
      console.log(`set_class ${spec.classId} ${sig}`);
    }

    const indexKey = indexPda(spec.classId);
    if (!(await exists(connection, indexKey))) {
      const obs = loadOrCreateKeypair(`obs-${spec.classId}.json`);
      const lamports = await connection.getMinimumBalanceForRentExemption(OBS_SIZE);
      const tx = new Transaction();
      if (!(await exists(connection, obs.publicKey))) {
        tx.add(
          SystemProgram.createAccount({
            fromPubkey: deployer.publicKey,
            newAccountPubkey: obs.publicKey,
            lamports,
            space: OBS_SIZE,
            programId: CLAMP_PROGRAM_ID,
          }),
        );
      }
      tx.add(
        await program.methods
          .initIndex(spec.classId)
          .accountsPartial({
            admin: deployer.publicKey,
            config,
            classConfig: classKey,
            indexState: indexKey,
            observations: obs.publicKey,
          })
          .instruction(),
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer, obs], { commitment: "confirmed" });
      console.log(`init_index ${spec.classId} ${sig} (rent ${lamports / 1e9} SOL)`);
    }
    console.log(`class ${spec.classId} ${spec.name}: class ${classKey.toBase58()} index ${indexKey.toBase58()}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
