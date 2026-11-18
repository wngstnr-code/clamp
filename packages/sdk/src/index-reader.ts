// Readers for the Clamp Index: live state, the observation ring, the period
// average. Everything here reads the chain only.

import { Connection, PublicKey } from "@solana/web3.js";

import { MAX_GAP, OBS_CARDINALITY } from "./constants.js";
import { average, findAtOrBefore, sumsAt, type Observation } from "./math/twap.js";
import { indexPda } from "./pda.js";

const OBS_SLOT_SIZE = 40;
const DISCRIMINATOR = 8;

export interface ReportView {
  reporter: PublicKey;
  ts: number;
  used: boolean;
  prices: bigint[];
  capacities: number[];
}

export interface IndexView {
  classId: number;
  observations: PublicKey;
  lastTs: number;
  lastPrice: bigint;
  cumPrice: bigint;
  cumValid: bigint;
  obsIndex: number;
  obsCount: number;
  updateCount: bigint;
  reports: ReportView[];
}

/**
 * Decodes an IndexState account. Layout (Borsh, after the 8-byte
 * discriminator): docs/architecture.md section 3.1.
 */
export function decodeIndexState(data: Uint8Array): IndexView {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = DISCRIMINATOR;
  const u8 = () => v.getUint8(o++);
  const u16 = () => ((o += 2), v.getUint16(o - 2, true));
  const u32 = () => ((o += 4), v.getUint32(o - 4, true));
  const u64 = () => ((o += 8), v.getBigUint64(o - 8, true));
  const i64 = () => ((o += 8), Number(v.getBigInt64(o - 8, true)));
  const u128 = () => {
    const lo = u64();
    const hi = u64();
    return (hi << 64n) | lo;
  };
  const key = () => ((o += 32), new PublicKey(data.slice(o - 32, o)));

  const classId = u8();
  const observations = key();
  const lastTs = i64();
  const lastPrice = u64();
  const cumPrice = u128();
  const cumValid = u64();
  const obsIndex = u16();
  const obsCount = u16();
  const updateCount = u64();
  const reports: ReportView[] = [];
  for (let r = 0; r < 5; r++) {
    const reporter = key();
    const ts = i64();
    const used = u8() === 1;
    const prices = Array.from({ length: 6 }, u64);
    const capacities = Array.from({ length: 6 }, u32);
    reports.push({ reporter, ts, used, prices, capacities });
  }
  return {
    classId,
    observations,
    lastTs,
    lastPrice,
    cumPrice,
    cumValid,
    obsIndex,
    obsCount,
    updateCount,
    reports,
  };
}

/** Decodes the zero-copy Observations ring (40 bytes per entry). */
export function decodeObservations(data: Uint8Array): Observation[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: Observation[] = [];
  for (let i = 0; i < OBS_CARDINALITY; i++) {
    const o = DISCRIMINATOR + i * OBS_SLOT_SIZE;
    const lo = v.getBigUint64(o + 16, true);
    const hi = v.getBigUint64(o + 24, true);
    out.push({
      ts: Number(v.getBigInt64(o, true)),
      price: v.getBigUint64(o + 8, true),
      cumPrice: (hi << 64n) | lo,
      cumValid: v.getBigUint64(o + 32, true),
    });
  }
  return out;
}

/** Live index state of a class. `null` when the index does not exist yet. */
export async function getIndex(connection: Connection, classId: number, programId?: PublicKey) {
  const info = await connection.getAccountInfo(indexPda(classId, programId), "confirmed");
  return info ? decodeIndexState(info.data) : null;
}

/** Filled observations of a class, oldest first. */
export async function getObservations(
  connection: Connection,
  classId: number,
  programId?: PublicKey,
): Promise<{ index: IndexView; observations: Observation[] } | null> {
  const index = await getIndex(connection, classId, programId);
  if (!index) return null;
  const info = await connection.getAccountInfo(index.observations, "confirmed");
  if (!info) throw new Error("observations account missing");
  const ring = decodeObservations(info.data);
  const count = index.obsCount;
  const oldest = (index.obsIndex + OBS_CARDINALITY + 1 - count) % OBS_CARDINALITY;
  const ordered = Array.from({ length: count }, (_, i) => ring[(oldest + i) % OBS_CARDINALITY]!);
  return { index, observations: ordered };
}

export interface TwapView {
  /** Micro-USD per GPU-hour, rounded down. `null` when no time was counted. */
  average: bigint | null;
  /** Seconds of the range that the oracle covered. */
  countedSecs: bigint;
  spanSecs: number;
}

/** Period average between two unix times, from an ordered observation list. */
export function twapFromObservations(
  observations: readonly Observation[],
  from: number,
  to: number,
  maxGap = MAX_GAP,
): TwapView {
  if (to < from) throw new Error("to is before from");
  const n = observations.length;
  const a = findAtOrBefore(observations, n - 1, n, from);
  const b = findAtOrBefore(observations, n - 1, n, to);
  if (a === null || b === null) throw new Error("range starts before the stored history");
  const start = sumsAt(observations[a]!, from, maxGap);
  const end = sumsAt(observations[b]!, to, maxGap);
  return {
    average: average(start, end),
    countedSecs: end.cumValid - start.cumValid,
    spanSecs: to - from,
  };
}

/** Period average of a class between two unix times, read from chain. */
export async function getTwap(
  connection: Connection,
  classId: number,
  from: number,
  to: number,
  programId?: PublicKey,
): Promise<TwapView> {
  const data = await getObservations(connection, classId, programId);
  if (!data || data.observations.length === 0) throw new Error("no index history");
  return twapFromObservations(data.observations, from, to);
}
