// Series commands for devnet (keypairs from ~/.config/solana/clamp/):
//   pnpm --filter @clamp/backend series show   <class> <kind> <seq>
//   pnpm --filter @clamp/backend series create <class> <kind> [payer.json]
//   pnpm --filter @clamp/backend series mint   <class> <kind> <seq> <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series merge  <class> <kind> <seq> <usdc> <keypair.json>
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
  indexPda,
  seriesAccounts,
  seriesPda,
} from "@clamp/sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, SystemProgram } from "@solana/web3.js";

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
    const program = clampProgram(connection, new KeypairWallet(payer));
    const cls = await program.account.classConfig.fetch(classPda(classId));
    const seq = cls.seriesCount[kind] ?? 0;
    const series = seriesPda(classId, kind, seq);
    const index = await getIndex(connection, classId);
    if (!index) throw new Error("no index");
    const acc = seriesAccounts(series);
    const sig = await program.methods
      .createSeries(classId, kind)
      .accountsPartial({
        creator: payer.publicKey,
        config: configPda(),
        classConfig: classPda(classId),
        indexState: indexPda(classId),
        observations: index.observations,
        series,
        collateralMint: TUSDC_MINT,
        upMint: acc.upMint,
        downMint: acc.downMint,
        collateral: acc.collateral,
        upVault: acc.upVault,
        downVault: acc.downVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`created class ${classId} kind ${kind} seq ${seq}: ${series.toBase58()} (${sig})`);
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
  throw new Error("usage: series show|create|mint|merge ...");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
