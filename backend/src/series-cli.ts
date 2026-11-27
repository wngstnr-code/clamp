// Series commands for devnet (keypairs from ~/.config/solana/clamp/):
//   pnpm --filter @clamp/backend series show   <class> <kind> <seq>
//   pnpm --filter @clamp/backend series create <class> <kind> [payer.json]
//   pnpm --filter @clamp/backend series mint   <class> <kind> <seq> <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series merge  <class> <kind> <seq> <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series vault
//   pnpm --filter @clamp/backend series vault-init
//   pnpm --filter @clamp/backend series deposit <usdc> <keypair.json>
//   pnpm --filter @clamp/backend series withdraw <shares> <keypair.json>
//   pnpm --filter @clamp/backend series seed   <class> <kind> <seq>
//   pnpm --filter @clamp/backend series buy|sell <class> <kind> <seq> <side 0|1> <usdc or claims> <keypair.json>
//   pnpm --filter @clamp/backend series redeem <class> <kind> <seq> <side 0|1> <claims> <keypair.json>
//   pnpm --filter @clamp/backend series lock-open  <class> <kind> <seq> <side 0|1> <usdc> <hours> <keypair.json>
//   pnpm --filter @clamp/backend series lock-close <class> <kind> <seq> <side 0|1> <keypair.json>
//   pnpm --filter @clamp/backend series locks [keypair.json]
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
  escrowPda,
  getIndex,
  getLocks,
  getSeries,
  lockPda,
  lockSize,
  lockValueNow,
  getVault,
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
  if (cmd === "vault") {
    const v = await getVault(connection);
    if (!v) throw new Error("vault not initialized");
    const units = (x: bigint | null) => (x === null ? null : Number(x) / 1e6);
    console.log({
      vault: v.address.toBase58(),
      nav: units(v.nav),
      idle: units(v.idle),
      totalShares: units(v.totalShares),
      sharePrice: units(v.sharePrice),
      activeSeries: v.activeSeries.map(
        (s) => `class ${s.classId} kind ${s.kind} seq ${s.seq} ${s.settled ? "settled" : "live"} ${s.address.toBase58()}`,
      ),
    });
    if (v.nav === null) console.log("nav is null: an active series has expired and waits for settlement");
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

  if (cmd === "withdraw") {
    const user = load(b ?? "test-user-2.json");
    const program = clampProgram(connection, new KeypairWallet(user));
    const userCollateral = getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey);
    const before = await connection.getTokenAccountBalance(userCollateral);
    const shares = Math.round(Number(a) * 1e6);
    const sig = await program.methods
      .withdraw(new BN(shares))
      .accountsPartial({
        user: user.publicKey,
        vault: vaultPda(),
        shareMint: sharesMintPda(),
        idle: idlePda(),
        collateralMint: TUSDC_MINT,
        userCollateral,
        userShares: getAssociatedTokenAddressSync(sharesMintPda(), user.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(await activeMetas())
      .rpc();
    const after = await connection.getTokenAccountBalance(userCollateral);
    const paid = Number(after.value.amount) - Number(before.value.amount);
    console.log(`withdrew ${a} shares (${sig}): paid ${paid / 1e6} tUSDC, ${(paid / shares).toFixed(6)} per share`);
    return;
  }

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

  if (cmd === "redeem") {
    const side = Number(d);
    const user = load(process.argv[8] ?? "test-user-1.json");
    const program = clampProgram(connection, new KeypairWallet(user));
    const series = seriesPda(classId, kind, Number(c));
    const acc = seriesAccounts(series);
    const claimMint = side === 0 ? acc.upMint : acc.downMint;
    const userCollateral = getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey);
    const before = await connection.getTokenAccountBalance(userCollateral);
    const sig = await program.methods
      .redeem(side, new BN(Math.round(Number(e) * 1e6)))
      .accountsPartial({
        user: user.publicKey,
        series,
        claimMint,
        userClaims: getAssociatedTokenAddressSync(claimMint, user.publicKey),
        collateral: acc.collateral,
        collateralMint: TUSDC_MINT,
        userCollateral,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    const after = await connection.getTokenAccountBalance(userCollateral);
    const paid = (Number(after.value.amount) - Number(before.value.amount)) / 1e6;
    console.log(`redeem ${e} ${side === 0 ? "UP" : "DOWN"} (${sig}): paid ${paid} tUSDC`);
    return;
  }
  if (cmd === "buy" || cmd === "sell") {
    const [sideArg, amountArg, file] = [d, e, process.argv[8]];
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
  if (cmd === "locks") {
    const owner = load(a ?? "test-user-1.json").publicKey;
    const now = Math.floor(Date.now() / 1000);
    for (const l of await getLocks(connection, owner)) {
      const s = await getSeries(connection, l.series);
      const idx = s ? await getIndex(connection, s.classId) : null;
      const value = s && idx ? lockValueNow(l, s, idx, now) : null;
      console.log({
        lock: l.address.toBase58(),
        series: l.series.toBase58(),
        side: l.side === 0 ? "UP" : "DOWN",
        claims: Number(l.claims) / 1e6,
        escrow: Number(l.escrowAmount) / 1e6,
        paid: Number(l.paid) / 1e6,
        hours: l.hours,
        refRate: usd(l.refRate),
        autoRoll: l.autoRoll,
        valueNow: value && "usdc" in value ? { how: value.how, usdc: Number(value.usdc) / 1e6 } : value,
      });
    }
    return;
  }

  if (cmd === "lock-open" || cmd === "lock-close") {
    const seq = Number(c);
    const side = Number(d);
    const user = load((cmd === "lock-open" ? process.argv[9] : e) ?? "test-user-1.json");
    const program = clampProgram(connection, new KeypairWallet(user));
    const series = seriesPda(classId, kind, seq);
    const acc = seriesAccounts(series);
    const lock = lockPda(user.publicKey, series, side);
    const cfg = await program.account.config.fetch(configPda());
    const ownerCollateral = getAssociatedTokenAddressSync(TUSDC_MINT, user.publicKey);
    const common = {
      owner: user.publicKey,
      config: configPda(),
      vault: vaultPda(),
      idle: idlePda(),
      treasury: cfg.treasury,
      tokens: seriesTokens(series, classId),
      lock,
      escrow: escrowPda(lock),
      ownerCollateral,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    const before = await connection.getTokenAccountBalance(ownerCollateral);
    if (cmd === "lock-open") {
      const usdcIn = new BN(Math.round(Number(e) * 1e6));
      const hours = Number(process.argv[8]);
      const s = await getSeries(connection, series);
      const size = s ? lockSize(hours, s, Math.floor(Date.now() / 1000)) : null;
      const sig = await program.methods
        .openLock(side, usdcIn, new BN(1), hours, new BN(0), false)
        .accountsPartial({
          ...common,
          claimMint: side === 0 ? acc.upMint : acc.downMint,
          systemProgram: SystemProgram.programId,
        } as never)
        .rpc();
      const esc = await connection.getTokenAccountBalance(escrowPda(lock));
      console.log(`lock-open (${sig}): lock ${lock.toBase58()} holds ${esc.value.uiAmountString} claims`);
      if (size) console.log(`sizing for ${hours} h: ${Number(size.claims) / 1e6} claims (f = ${Number(size.fractionLeftPpm) / 1e6})`);
    } else {
      const sig = await program.methods
        .closeLock(new BN(0))
        .accountsPartial({ ...common, rentPayer: user.publicKey } as never)
        .rpc();
      const after = await connection.getTokenAccountBalance(ownerCollateral);
      console.log(`lock-close (${sig}): paid ${(Number(after.value.amount) - Number(before.value.amount)) / 1e6} tUSDC`);
    }
    return;
  }

  throw new Error("usage: series show|create|mint|merge|vault-init|deposit|withdraw|seed|buy|sell|redeem|lock-open|lock-close|locks ...");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
