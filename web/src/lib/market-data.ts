import { getIndex, type IndexView, listSeries, type SeriesView } from "@clamp/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "./config";

/** Server-side reads of the market from chain. Null when the chain cannot be read, so nothing is made up. */

export async function readMarket(): Promise<{ series: SeriesView[]; indexes: Map<number, IndexView | null> } | null> {
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const series = await listSeries(connection);
    const classIds = [...new Set(series.map((s) => s.classId))];
    const indexes = new Map(await Promise.all(classIds.map(async (id) => [id, await getIndex(connection, id)] as const)));
    return { series, indexes };
  } catch (e) {
    console.error("market read failed:", e);
    return null;
  }
}

/** A valid base58 address, or null. */
export function parseAddress(s: string): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    return null;
  }
}
