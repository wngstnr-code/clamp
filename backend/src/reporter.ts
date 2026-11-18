// Standalone reporter for reporters 2 and 3 (D-054): fetch the sources,
// upload the raw answers to the shared archive (signed), send submit_report.
// It holds no backend secret. Env: REPORTER_KEYPAIR (keypair file content),
// SOLANA_RPC_URL (devnet), ARCHIVE_URL (default: the Clamp backend).

import { Connection, Keypair } from "@solana/web3.js";

import { DEFAULT_ARCHIVE_URL, HttpArchiver } from "./archiver.js";
import { reportStep, type StepResult } from "./tick.js";

export async function runReporter(env: Record<string, string | undefined> = process.env): Promise<StepResult[]> {
  const secret = env.REPORTER_KEYPAIR;
  if (!secret) throw new Error("REPORTER_KEYPAIR is not set");
  const bytes = JSON.parse(secret) as number[];
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error("REPORTER_KEYPAIR must be a JSON array of 64 numbers");
  const reporter = Keypair.fromSecretKey(Uint8Array.from(bytes));
  const rpc = env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  if (!rpc.includes("devnet")) throw new Error("devnet only");
  const archiver = new HttpArchiver(env.ARCHIVE_URL || DEFAULT_ARCHIVE_URL, reporter);
  return reportStep(new Connection(rpc, "confirmed"), reporter, archiver, null);
}
