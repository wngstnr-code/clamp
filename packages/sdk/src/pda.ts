// PDA helpers for docs/architecture.md section 3.2.

import { PublicKey } from "@solana/web3.js";

import { CLAMP_PROGRAM_ID, TEST_USDC_PROGRAM_ID } from "./constants.js";

const pda = (seeds: (Buffer | Uint8Array)[], programId = CLAMP_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];

export const configPda = (programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("config")], programId);

export const classPda = (classId: number, programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("class"), Uint8Array.of(classId)], programId);

export const indexPda = (classId: number, programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("index"), Uint8Array.of(classId)], programId);

/** Series PDA: `["series", class_id, kind, seq (u32 LE)]` (D-056). `seq` is `ClassConfig.series_count[kind]` at creation. */
export const seriesPda = (classId: number, kind: number, seq: number, programId = CLAMP_PROGRAM_ID) => {
  const seqBytes = new Uint8Array(4);
  new DataView(seqBytes.buffer).setUint32(0, seq, true);
  return pda([Buffer.from("series"), Uint8Array.of(classId), Uint8Array.of(kind), seqBytes], programId);
};

/** Accounts owned by a series: its two claim mints and three token accounts. */
export const seriesAccounts = (series: PublicKey, programId = CLAMP_PROGRAM_ID) => ({
  upMint: pda([Buffer.from("up"), series.toBuffer()], programId),
  downMint: pda([Buffer.from("down"), series.toBuffer()], programId),
  collateral: pda([Buffer.from("collateral"), series.toBuffer()], programId),
  upVault: pda([Buffer.from("upv"), series.toBuffer()], programId),
  downVault: pda([Buffer.from("downv"), series.toBuffer()], programId),
});

/** Faucet PDAs of the test-usdc program. */
export const faucetMintAuthority = (programId = TEST_USDC_PROGRAM_ID) =>
  pda([Buffer.from("mint_authority")], programId);
export const faucetRecord = (wallet: PublicKey, programId = TEST_USDC_PROGRAM_ID) =>
  pda([Buffer.from("faucet"), wallet.toBuffer()], programId);

/** Vault PDAs (spec 9): the vault, its share mint and its idle collateral account. */
export const vaultPda = (programId = CLAMP_PROGRAM_ID) => pda([Buffer.from("vault")], programId);
export const sharesMintPda = (programId = CLAMP_PROGRAM_ID) => pda([Buffer.from("shares")], programId);
export const idlePda = (programId = CLAMP_PROGRAM_ID) => pda([Buffer.from("idle")], programId);

/** Lock PDA (spec 10): `["lock", owner, series, side]`. */
export const lockPda = (owner: PublicKey, series: PublicKey, side: number, programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("lock"), owner.toBuffer(), series.toBuffer(), Uint8Array.of(side)], programId);
/** The escrow token account of a lock: `["escrow", lock]`, authority the lock. */
export const escrowPda = (lock: PublicKey, programId = CLAMP_PROGRAM_ID) =>
  pda([Buffer.from("escrow"), lock.toBuffer()], programId);
