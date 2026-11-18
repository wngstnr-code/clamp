// Sending submit_report and reading transactions back.

import { BN, KeypairWallet, classPda, clampProgram, getIndex, indexPda } from "@clamp/sdk";
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

import type { ClassReport } from "./fetch-sources.js";

export async function sendReport(connection: Connection, worker: Keypair, report: ClassReport): Promise<string> {
  const index = await getIndex(connection, report.classId);
  if (!index) throw new Error(`index of class ${report.classId} does not exist on chain`);
  const program = clampProgram(connection, new KeypairWallet(worker));
  const ix = await program.methods
    .submitReport(
      report.classId,
      report.prices.map((p) => new BN(p.toString())),
      report.capacities,
      report.rawHashes,
    )
    .accountsPartial({
      reporter: worker.publicKey,
      classConfig: classPda(report.classId),
      indexState: indexPda(report.classId),
      observations: index.observations,
    })
    .instruction();
  return sendAndConfirmTransaction(connection, new Transaction().add(ix), [worker], {
    commitment: "confirmed",
  });
}

export async function readLogs(connection: Connection, signature: string) {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta?.logMessages) throw new Error(`logs of ${signature} not found`);
  return { logs: tx.meta.logMessages, slot: tx.slot, failed: tx.meta.err !== null };
}
