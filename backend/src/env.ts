// Environment for the worker. Names follow docs/architecture.md section 10.
// Secrets are set in the Vercel dashboard by the user and never logged.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { Keypair } from "@solana/web3.js";

export interface Env {
  rpcUrl: string;
  supabaseUrl: string | null;
  supabaseServiceKey: string | null;
  cronSecret: string | null;
  worker: Keypair | null;
}

function parseKeypair(json: string): Keypair {
  const bytes = JSON.parse(json) as unknown;
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error("keypair must be a JSON array of 64 numbers");
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

/**
 * Reads the worker keypair from `WORKER_KEYPAIR` (JSON array, as in a Solana
 * keypair file). For local runs only, `WORKER_KEYPAIR_PATH` may point to the
 * keypair file instead (`~` is expanded).
 */
function loadWorker(): Keypair | null {
  const inline = process.env.WORKER_KEYPAIR;
  if (inline) return parseKeypair(inline);
  const path = process.env.WORKER_KEYPAIR_PATH;
  if (path) return parseKeypair(readFileSync(path.replace(/^~/, homedir()), "utf8"));
  return null;
}

export function loadEnv(): Env {
  return {
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
    cronSecret: process.env.CRON_SECRET || null,
    worker: loadWorker(),
  };
}
