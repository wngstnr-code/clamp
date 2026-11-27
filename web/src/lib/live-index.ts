import { getIndex } from "@clamp/sdk";
import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./config";

export type LiveIndex = { price: number; ts: number } | null;

/** Class ids on chain (architecture.md section 3.1). */
export const CLASS = { rtx4090: 1, h100: 2 } as const;

/**
 * Reads the latest on-chain index of a class. Returns null when the chain cannot be read,
 * so the page shows "not available" instead of a made-up number.
 */
export async function readIndex(classId: number): Promise<LiveIndex> {
  try {
    const index = await getIndex(new Connection(RPC_URL, "confirmed"), classId);
    if (!index || index.updateCount === 0n) return null;
    return { price: Number(index.lastPrice) / 1e6, ts: index.lastTs };
  } catch {
    return null;
  }
}

/** "$0.3636" style price per GPU hour, four decimals like the index itself. */
export const usd4 = (v: number) => `$${v.toFixed(4)}`;
