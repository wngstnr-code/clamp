import { clusterApiUrl } from "@solana/web3.js";

/** Public RPC endpoint. Falls back to the public devnet endpoint when `.env` does not set one. */
export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
