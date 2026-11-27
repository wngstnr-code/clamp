import {
  BN,
  clampProgram,
  configPda,
  idlePda,
  indexPda,
  sharesMintPda,
  type SeriesView,
  seriesAccounts,
  SIDE_UP,
  TUSDC_MINT,
  vaultPda,
} from "@clamp/sdk";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { type AccountMeta, type Connection, SystemProgram, Transaction } from "@solana/web3.js";

/**
 * Transactions of the trade panel, built the same way as `backend/src/series-cli.ts`.
 * Amounts are in micro units (1 tUSDC = 1 claim = 1,000,000). Each call returns the signature.
 */

const bn = (v: bigint) => new BN(v.toString());

// The SDK types its wallet as Anchor's NodeWallet (with a `payer` keypair). A browser wallet has no
// keypair, but the program client only calls publicKey, signTransaction and signAllTransactions.
const program = (connection: Connection, wallet: AnchorWallet) =>
  clampProgram(connection, wallet as unknown as Parameters<typeof clampProgram>[1]);

export function userAccounts(s: SeriesView, owner: AnchorWallet["publicKey"]) {
  return {
    collateral: getAssociatedTokenAddressSync(TUSDC_MINT, owner),
    up: getAssociatedTokenAddressSync(s.upMint, owner),
    down: getAssociatedTokenAddressSync(s.downMint, owner),
  };
}

export async function mintOrMerge(connection: Connection, wallet: AnchorWallet, s: SeriesView, merge: boolean, amount: bigint) {
  const p = program(connection, wallet);
  const acc = seriesAccounts(s.address);
  const user = userAccounts(s, wallet.publicKey);
  const m = merge ? p.methods.mergePairs(bn(amount)) : p.methods.mintPairs(bn(amount));
  return m
    .accountsPartial({
      user: wallet.publicKey,
      series: s.address,
      upMint: acc.upMint,
      downMint: acc.downMint,
      collateral: acc.collateral,
      collateralMint: TUSDC_MINT,
      userCollateral: user.collateral,
      userUp: user.up,
      userDown: user.down,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/** A pool trade. `amount` is tUSDC paid in for a buy, claims sold for a sell; `minOut` protects against a moved price. */
export async function trade(
  connection: Connection,
  wallet: AnchorWallet,
  s: SeriesView,
  isBuy: boolean,
  side: number,
  amount: bigint,
  minOut: bigint,
) {
  const p = program(connection, wallet);
  const acc = seriesAccounts(s.address);
  const claimMint = side === SIDE_UP ? acc.upMint : acc.downMint;
  const user = userAccounts(s, wallet.publicKey);
  const userClaims = side === SIDE_UP ? user.up : user.down;
  const cfg = await p.account.config.fetch(configPda());
  const builder = isBuy ? p.methods.buy(side, bn(amount), bn(minOut)) : p.methods.sell(side, bn(amount), bn(minOut));
  return builder
    .accountsPartial({
      user: wallet.publicKey,
      config: configPda(),
      vault: vaultPda(),
      idle: idlePda(),
      treasury: cfg.treasury,
      tokens: {
        series: s.address,
        indexState: indexPda(s.classId),
        upMint: acc.upMint,
        downMint: acc.downMint,
        upVault: acc.upVault,
        downVault: acc.downVault,
        collateral: acc.collateral,
        collateralMint: TUSDC_MINT,
      },
      userCollateral: user.collateral,
      userClaims,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .preInstructions([createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, userClaims, wallet.publicKey, claimMint)])
    .rpc();
}

/** Redeems every claim the wallet holds in a settled series, both sides in one transaction. */
export async function redeemAll(connection: Connection, wallet: AnchorWallet, s: SeriesView, up: bigint, down: bigint) {
  const p = program(connection, wallet);
  const acc = seriesAccounts(s.address);
  const user = userAccounts(s, wallet.publicKey);
  const tx = new Transaction();
  for (const [side, amount, mint, claims] of [
    [0, up, acc.upMint, user.up],
    [1, down, acc.downMint, user.down],
  ] as const) {
    if (amount <= 0n) continue;
    tx.add(
      await p.methods
        .redeem(side, bn(amount))
        .accountsPartial({
          user: wallet.publicKey,
          series: s.address,
          claimMint: mint,
          userClaims: claims,
          collateral: acc.collateral,
          collateralMint: TUSDC_MINT,
          userCollateral: user.collateral,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );
  }
  return p.provider.sendAndConfirm!(tx);
}

/** "12.5" to 12_500_000n; null when it is not a positive amount with at most 6 decimals. */
export function parseAmount(text: string): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const v = BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  return v > 0n ? v : null;
}

/** Deposit tUSDC into the vault (`deposit = true`, amount in micro-tUSDC) or withdraw shares (amount in share units). */
export async function vaultMove(connection: Connection, wallet: AnchorWallet, deposit: boolean, amount: bigint) {
  const p = program(connection, wallet);
  const vault = await p.account.vault.fetch(vaultPda());
  // The NAV needs every active series and its index state, in vault order (as backend/src/clamp-tx.ts).
  const metas: AccountMeta[] = [];
  for (const key of vault.activeSeries.slice(0, vault.activeCount)) {
    const s = await p.account.series.fetch(key);
    metas.push({ pubkey: key, isSigner: false, isWritable: false });
    metas.push({ pubkey: indexPda(s.classId), isSigner: false, isWritable: false });
  }
  const m = deposit ? p.methods.deposit(bn(amount)) : p.methods.withdraw(bn(amount));
  return m
    .accountsPartial({
      user: wallet.publicKey,
      vault: vaultPda(),
      shareMint: sharesMintPda(),
      idle: idlePda(),
      collateralMint: TUSDC_MINT,
      userCollateral: getAssociatedTokenAddressSync(TUSDC_MINT, wallet.publicKey),
      userShares: getAssociatedTokenAddressSync(sharesMintPda(), wallet.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(metas)
    .rpc();
}
