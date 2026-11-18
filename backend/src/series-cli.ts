// Series commands for devnet (keypairs from ~/.config/solana/clamp/):
//   pnpm --filter @clamp/backend series show   <class> <kind> <seq>
//   pnpm --filter @clamp/backend series create <class> <kind> [payer.json]
//   pnpm --filter @clamp/backend series mint   <class> <kind> <seq> <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series merge  <class> <kind> <seq> <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series vault-init
//   pnpm --filter @clamp/backend series deposit <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series seed   <class> <kind> <seq>
//   pnpm --filter @clamp/backend series buy|sell <class> <kind> <seq> <side 0|1> <usdc or claims> <keypair.json>
// kind: 0 daily, 1 weekly, 2 monthly. Amounts in whole tUSDC.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  BN,
  KeypairWallet,
  TUSDC_MINT,
  classPda,
  clampProgram,
  configPda,
  getIndex,
  idlePda,
  indexPda,
  sharesMintPda,
  vaultPda,
  seriesAccounts,
  seriesPda,
} from "@clamp/sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, SystemProgram, type AccountMeta } from "@solana/web3.js";

import { createSeries, seedSeries, seriesTokens } from "./clamp-tx.js";

const KEY_DIR = join(homedir(), ".config", "solana", "clamp");
const load = (f: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEY_DIR, f), "utf8")) as number[]));
const usd = (micro: { toString(): string }) => `$${(Number(micro.toString()) / 1e6).toFixed(4)}`;
const iso = (ts: { toString(): string }) => new Date(Number(ts.toString()) * 1000).toISOString();

async function main() {
  const [cmd, a, b, c, d, e] = process.argv.slice(2);
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  if (!rpc.includes("devnet")) throw new Error("devnet only");
  const connection = new Connection(rpc, "confirmed");
  const classId = Number(a);
  const kind = Number(b);

  if (cmd === "show") {
    const program = clampProgram(connection);
    const s = await program.account.series.fetch(seriesPda(classId, kind, Number(c)));
    console.log({
      series: seriesPda(classId, kind, Number(c)).toBase58(),
      band: `${usd(s.lower)} to ${usd(s.upper)} (center ${usd(s.center)})`,
      start: iso(s.startTs),
      close: iso(s.closeTs),
      expiry: iso(s.expiryTs),
      pairsOutstanding: Number(s.pairsOutstanding.toString()) / 1e6,
      settled: s.settled,
      avg: s.settled ? usd(s.avg) : null,
      upValue: s.settled ? s.upValue / 1e6 : null,
    });
    return;
  }

  if (cmd === "create") {
    const payer = load(c ?? "worker.json");
    const cls = await clampProgram(connection).account.classConfig.fetch(classPda(classId));
    const seq = cls.seriesCount[kind] ?? 0;
    const { series, signature } = await createSeries(connection, payer, classId, kind, seq);
    console.log(`created class ${classId} kind ${kind} seq ${seq}: ${series.toBase58()} (${signature})`);
    return;
  }

  if (cmd === "mint" || cmd === "merge") {
    const seq = Number(c);
    const amount = new BN(Math.round(Number(d) * 1e6));
    const user = load(e ?? "test-user-1.json");
    const program = clampProgram(connection, new KeypairWallet(user));
    const series = seriesPda(classId, kind, seq);
    const acc = seriesAccounts(series);
    const accounts = {
      user: user.publicKey,
      series,
      upMint: acc.upMint,
      downMint: acc.downMint,
      collateral: acc.collateral,
      collateralMint: TUSDC_MINT,
      userCollateral: getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey),
      userUp: getAssociatedTokenAddressSync(acc.upMint, user.publicKey),
      userDown: getAssociatedTokenAddressSync(acc.downMint, user.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const m = cmd === "mint" ? program.methods.mintPairs(amount) : program.methods.mergePairs(amount);
    const sig = await m.accountsPartial(accounts).rpc();
    const up = await connection.getTokenAccountBalance(accounts.userUp);
    const col = await connection.getTokenAccountBalance(accounts.userCollateral);
    console.log(`${cmd} ${d} tUSDC: ${sig}`);
    console.log(`user holds ${up.value.uiAmountString} UP and DOWN, ${col.value.uiAmountString} tUSDC`);
    return;
  }
  if (cmd === "vault-init") {
    const admin = load("deployer.json");
    const program = clampProgram(connection, new KeypairWallet(admin));
    const sig = await program.methods
      .initVault()
      .accountsPartial({
        admin: admin.publicKey,
        config: configPda(),
        vault: vaultPda(),
        shareMint: sharesMintPda(),
        idle: idlePda(),
        collateralMint: TUSDC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`vault ${vaultPda().toBase58()} (${sig})`);
    return;
  }

  /** The vault's active series and their IndexStates, for the NAV. */
  const activeMetas = async (): Promise<AccountMeta[]> => {
    const program = clampProgram(connection);
    const vault = await program.account.vault.fetch(vaultPda());
    const metas: AccountMeta[] = [];
    for (const key of vault.activeSeries.slice(0, vault.activeCount)) {
      const s = await program.account.series.fetch(key);
      metas.push({ pubkey: key, isSigner: false, isWritable: false });
      metas.push({ pubkey: indexPda(s.classId), isSigner: false, isWritable: false });
    }
    return metas;
  };

  if (cmd === "deposit") {
    const user = load(b ?? "test-user-2.json");
    const program = clampProgram(connection, new KeypairWallet(user));
    const sig = await program.methods
      .deposit(new BN(Math.round(Number(a) * 1e6)))
      .accountsPartial({
        user: user.publicKey,
        vault: vaultPda(),
        shareMint: sharesMintPda(),
        idle: idlePda(),
        collateralMint: TUSDC_MINT,
        userCollateral: getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey),
        userShares: getAssociatedTokenAddressSync(sharesMintPda(), user.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(await activeMetas())
      .rpc();
    const idle = await connection.getTokenAccountBalance(idlePda());
    console.log(`deposited ${a} tUSDC (${sig}); vault idle ${idle.value.uiAmountString} tUSDC`);
    return;
  }

  if (cmd === "seed") {
    const payer = load("worker.json");
    const series = seriesPda(classId, kind, Number(c));
    const sig = await seedSeries(connection, payer, series, classId);
    const s = await clampProgram(connection).account.series.fetch(series);
    console.log(`seeded ${series.toBase58()} (${sig}): pool UP ${Number(s.poolUp.toString()) / 1e6}, DOWN ${Number(s.poolDown.toString()) / 1e6}`);
    return;
  }

  if (cmd === "buy" || cmd === "sell") {
    const [, , , , , sideArg, amountArg, file] = process.argv.slice(2);
    const side = Number(sideArg);
    const user = load(file ?? "test-user-1.json");
    const program = clampProgram(connection, new KeypairWallet(user));
    const series = seriesPda(classId, kind, Number(c));
    const acc = seriesAccounts(series);
    const claimMint = side === 0 ? acc.upMint : acc.downMint;
    const userClaims = getAssociatedTokenAddressSync(claimMint, user.publicKey);
    const amount = new BN(Math.round(Number(amountArg) * 1e6));
    const cfg = await program.account.config.fetch(configPda());
    const builder = cmd === "buy" ? program.methods.buy(side, amount, new BN(1)) : program.methods.sell(side, amount, new BN(1));
    const sig = await builder
      .accountsPartial({
        user: user.publicKey,
        config: configPda(),
        vault: vaultPda(),
        idle: idlePda(),
        treasury: cfg.treasury,
        tokens: seriesTokens(series, classId),
        userCollateral: getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey),
        userClaims,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never)
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(user.publicKey, userClaims, user.publicKey, claimMint),
      ])
      .rpc();
    const bal = await connection.getTokenAccountBalance(userClaims);
    console.log(`${cmd} (${sig}): user holds ${bal.value.uiAmountString} ${side === 0 ? "UP" : "DOWN"}`);
    return;
  }
  throw new Error("usage: series show|create|mint|merge|vault-init|deposit|seed|buy|sell ...");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
