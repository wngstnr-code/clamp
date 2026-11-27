// Transaction senders for the clamp program, shared by the crank and the CLI.

import {
  KeypairWallet,
  TUSDC_MINT,
  classPda,
  clampProgram,
  configPda,
  escrowPda,
  getIndex,
  idlePda,
  indexPda,
  lockPda,
  seriesAccounts,
  seriesPda,
  vaultPda,
} from "@clamp/sdk";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, type AccountMeta } from "@solana/web3.js";

export type ClampProgram = ReturnType<typeof clampProgram>;

export const program = (connection: Connection, signer?: Keypair) =>
  clampProgram(connection, signer ? new KeypairWallet(signer) : undefined);

export function seriesTokens(series: PublicKey, classId: number) {
  const acc = seriesAccounts(series);
  return {
    series,
    indexState: indexPda(classId),
    upMint: acc.upMint,
    downMint: acc.downMint,
    upVault: acc.upVault,
    downVault: acc.downVault,
    collateral: acc.collateral,
    collateralMint: TUSDC_MINT,
  };
}

/** The vault's active series and their IndexStates, in vault order (for the NAV). */
export async function activeMetas(p: ClampProgram): Promise<AccountMeta[]> {
  const vault = await p.account.vault.fetchNullable(vaultPda());
  if (!vault) return [];
  const metas: AccountMeta[] = [];
  for (const key of vault.activeSeries.slice(0, vault.activeCount)) {
    const s = await p.account.series.fetch(key);
    metas.push({ pubkey: key, isSigner: false, isWritable: false });
    metas.push({ pubkey: indexPda(s.classId), isSigner: false, isWritable: false });
  }
  return metas;
}

export async function createSeries(
  connection: Connection,
  payer: Keypair,
  classId: number,
  kind: number,
  seq: number,
): Promise<{ series: PublicKey; signature: string }> {
  const p = program(connection, payer);
  const series = seriesPda(classId, kind, seq);
  const index = await getIndex(connection, classId);
  if (!index) throw new Error(`no index for class ${classId}`);
  const acc = seriesAccounts(series);
  const signature = await p.methods
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
  return { series, signature };
}

export async function seedSeries(connection: Connection, payer: Keypair, series: PublicKey, classId: number) {
  const p = program(connection, payer);
  return p.methods
    .seedSeries()
    .accountsPartial({
      config: configPda(),
      vault: vaultPda(),
      idle: idlePda(),
      tokens: seriesTokens(series, classId),
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .remainingAccounts(await activeMetas(p))
    .rpc();
}

export async function settleSeries(connection: Connection, payer: Keypair, series: PublicKey, classId: number) {
  const p = program(connection, payer);
  const index = await getIndex(connection, classId);
  if (!index) throw new Error(`no index for class ${classId}`);
  return p.methods
    .settleSeries()
    .accountsPartial({ series, indexState: indexPda(classId), observations: index.observations })
    .rpc();
}

export async function sweepSeries(connection: Connection, payer: Keypair, series: PublicKey, classId: number) {
  const p = program(connection, payer);
  return p.methods
    .sweepSeries()
    .accountsPartial({
      vault: vaultPda(),
      idle: idlePda(),
      tokens: seriesTokens(series, classId),
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
}

/** `roll_lock` (spec 10.4): the caller pays the rent of a new lock and gets it back when it closes. */
export async function rollLock(
  connection: Connection,
  payer: Keypair,
  r: { owner: PublicKey; side: number; oldSeries: PublicKey; newSeries: PublicKey; classId: number; rentPayer: PublicKey },
) {
  const p = program(connection, payer);
  const cfg = await p.account.config.fetch(configPda());
  const oldLock = lockPda(r.owner, r.oldSeries, r.side);
  const newLock = lockPda(r.owner, r.newSeries, r.side);
  const acc = seriesAccounts(r.newSeries);
  return p.methods
    .rollLock()
    .accountsPartial({
      caller: payer.publicKey,
      config: configPda(),
      vault: vaultPda(),
      idle: idlePda(),
      treasury: cfg.treasury,
      oldTokens: seriesTokens(r.oldSeries, r.classId),
      newTokens: seriesTokens(r.newSeries, r.classId),
      classConfig: classPda(r.classId),
      oldLock,
      oldEscrow: escrowPda(oldLock),
      oldRentPayer: r.rentPayer,
      newLock,
      newClaimMint: r.side === 0 ? acc.upMint : acc.downMint,
      newEscrow: escrowPda(newLock),
      ownerCollateral: getAssociatedTokenAddressSync(TUSDC_MINT, r.owner),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .rpc();
}
