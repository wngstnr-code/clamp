import { CLASS_H100, CLASS_RTX4090, classPda, clampProgram, SOURCE_NAMES } from "@clamp/sdk";
import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./config";

/** URL slug of each class on the index pages. */
export const CLASSES = [
  { id: CLASS_RTX4090, slug: "rtx-4090", name: "RTX 4090" },
  { id: CLASS_H100, slug: "h100", name: "H100" },
] as const;
export type ClassInfo = (typeof CLASSES)[number];
export const classBySlug = (slug: string) => CLASSES.find((c) => c.slug === slug);

export const SOURCE_IDS = [1, 2, 3, 4] as const;
export const sourceName = (id: number) => SOURCE_NAMES[id] ?? `Source ${id}`;

/** An update counts as late after this long without a new one (design choice, not in the spec). */
export const LATE_AFTER_S = 40 * 60;

export type UpdateSource = { id: number; price: number; weight: number; capacity: number };
export type Update = { ts: number; price: number; reporters: number; sources: UpdateSource[]; signature: string };
export type Tick = { ts: number; sourceId: number; rawUrl: string | null };
export type OpenSeries = { kind: number; closeTs: number };

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** One read of the public Supabase mirror. Null when it cannot be read, so nothing is made up. */
async function supa<T>(path: string): Promise<T | null> {
  if (!SUPA_URL || !SUPA_KEY) return null;
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      console.error(`supabase read failed: ${path.split("?")[0]} HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`supabase read failed: ${path.split("?")[0]}`, e);
    return null;
  }
}

const iso = (ts: number) => new Date(ts * 1000).toISOString();
const unix = (s: string) => Math.floor(Date.parse(s) / 1000);

type UpdateRow = {
  ts: string;
  price_micro: number;
  reporter_count: number;
  signature: string;
  sources: { id: number; price: string; weight: number; capacity?: number }[];
};

/** Accepted on-chain updates of a class since `since` (unix s), newest first. */
export async function readUpdates(classId: number, since: number, limit = 1000): Promise<Update[] | null> {
  const rows = await supa<UpdateRow[]>(
    `index_updates?select=ts,price_micro,reporter_count,signature,sources&class_id=eq.${classId}` +
      `&ts=gte.${iso(since)}&order=ts.desc&limit=${limit}`,
  );
  return (
    rows?.map((r) => ({
      ts: unix(r.ts),
      price: r.price_micro / 1e6,
      reporters: r.reporter_count,
      signature: r.signature,
      sources: SOURCE_IDS.map((id) => {
        const s = r.sources.find((x) => x.id === id);
        return { id, price: s ? Number(s.price) / 1e6 : 0, weight: s?.weight ?? 0, capacity: s?.capacity ?? 0 };
      }),
    })) ?? null
  );
}

/** The newest updates of a class, however old. */
export const readLatestUpdates = (classId: number, limit: number) => readUpdates(classId, 0, limit);

/** What the reporters fetched per source between two times, with the public raw file of each read. */
export async function readTicks(classId: number, from: number, to: number): Promise<Tick[] | null> {
  const rows = await supa<{ ts: string; source_id: number; raw_path: string | null }[]>(
    `source_ticks?select=ts,source_id,raw_path&class_id=eq.${classId}&ok=eq.true` +
      `&ts=gte.${iso(from)}&ts=lte.${iso(to)}&order=ts.desc&limit=2000`,
  );
  return (
    rows?.map((r) => ({
      ts: unix(r.ts),
      sourceId: r.source_id,
      rawUrl: r.raw_path && SUPA_URL ? `${SUPA_URL}/storage/v1/object/public/${r.raw_path}` : null,
    })) ?? null
  );
}

/** Series of a class that still trade (not settled, not closed yet). */
export async function readOpenSeries(classId: number, now: number): Promise<OpenSeries[] | null> {
  const rows = await supa<{ kind: number; close_ts: string }[]>(
    `series?select=kind,close_ts&class_id=eq.${classId}&settled=eq.false&close_ts=gt.${iso(now)}&order=close_ts.asc`,
  );
  return rows?.map((r) => ({ kind: r.kind, closeTs: unix(r.close_ts) })) ?? null;
}

/** How many reporters are registered for a class, and how many must agree. Null when the chain cannot be read. */
export async function readReporters(classId: number): Promise<{ registered: number; min: number } | null> {
  try {
    const cfg = await clampProgram(new Connection(RPC_URL, "confirmed")).account.classConfig.fetch(classPda(classId));
    return { registered: cfg.reporterCount, min: cfg.minReporters };
  } catch {
    return null;
  }
}

/**
 * Averages the updates into `n` equal time buckets between `from` and `to`. A bucket with no update
 * stays null and is drawn as a gap: missing data is shown as missing.
 */
export function bucket(updates: Update[], from: number, to: number, n: number): (number | null)[] {
  const sums = Array.from({ length: n }, () => ({ sum: 0, count: 0 }));
  const step = (to - from) / n;
  for (const u of updates) {
    if (u.ts < from || u.ts > to) continue;
    const b = sums[Math.min(n - 1, Math.floor((u.ts - from) / step))]!;
    b.sum += u.price;
    b.count += 1;
  }
  return sums.map((b) => (b.count ? b.sum / b.count : null));
}

/** Change from the oldest update in the window to `now`, in percent. Null without data. */
export function change(updates: Update[], now: number | undefined): number | null {
  const oldest = updates.at(-1);
  if (!oldest || now === undefined || oldest.price === 0) return null;
  return ((now - oldest.price) / oldest.price) * 100;
}

/**
 * Sources with no price in the newest update (the provider did not answer), each with the time
 * of the last update that had a price from it, or null when none in the list did.
 */
export function notAnswering(updates: Update[]): { id: number; since: number | null }[] {
  const newest = updates[0];
  if (!newest) return [];
  return newest.sources
    .filter((s) => s.price === 0)
    .map((s) => ({ id: s.id, since: updates.find((u) => u.sources.find((x) => x.id === s.id)!.price > 0)?.ts ?? null }));
}

export const SERIES_KIND = ["Daily", "Weekly", "Monthly"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
/** "12:40" in UTC. */
export const hhmm = (ts: number) => {
  const d = new Date(ts * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** "25 Nov" in UTC. */
export const dayMonth = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** "12:40 UTC" today, "25 Nov 12:40 UTC" otherwise. */
export const when = (ts: number, now: number) =>
  Math.abs(ts - now) < 20 * 3600 && dayMonth(ts) === dayMonth(now) ? `${hhmm(ts)} UTC` : `${dayMonth(ts)} ${hhmm(ts)} UTC`;

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** How many accepted updates a class had since `since` (unix s). Null when the mirror cannot be read. */
export async function countUpdates(classId: number, since: number): Promise<number | null> {
  if (!SUPA_URL || !SUPA_KEY) return null;
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/index_updates?select=id&class_id=eq.${classId}&ts=gte.${iso(since)}&limit=1`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: "count=exact" },
      next: { revalidate: 60 },
    });
    const total = res.headers.get("content-range")?.split("/")[1];
    return res.ok && total && total !== "*" ? Number(total) : null;
  } catch {
    return null;
  }
}
