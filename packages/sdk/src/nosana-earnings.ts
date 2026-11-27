// Nosana host earnings (M6) from the public job history: no key, and the API
// allows browser origins (checked 2026-11-27), so the web app calls it
// directly. A finished job on the owner's node earned
// (timeEnd - timeStart) / 3600 * usdRewardPerHour. The GPU class comes from
// the market name with the same rule as the index ("4090", "H100").

import { CLASS_H100, CLASS_RTX4090 } from "./constants.js";
import { summarizeEarnings, type EarningsLine, type EarningsSummary } from "./earnings.js";

export const NOSANA_API = "https://api.nosana.com/api";
/** The jobs API refuses a larger page. */
export const NOSANA_PAGE = 50;

/** Market name to index class, the same needles as the index's Nosana rule. */
export function nosanaClassOfMarket(name: string | null): number | null {
  if (!name) return null;
  if (name.includes("4090")) return CLASS_RTX4090;
  if (name.includes("H100")) return CLASS_H100;
  return null;
}

export interface NosanaEarnings extends EarningsSummary {
  node: string;
  from: number;
  to: number;
  /** Finished jobs counted in the earnings. */
  jobs: number;
  /**
   * Finished jobs with a failed status, left out of the earnings and hours:
   * whether Nosana pays a host for them is not checked yet, and a lock sized
   * on unpaid hours would be too large.
   */
  failedJobs: number;
  failedHours: number;
  /** The page limit was reached before the start of the window: earnings are a lower bound. */
  truncated: boolean;
}

interface Job {
  id?: unknown;
  address?: unknown;
  market?: unknown;
  node?: unknown;
  state?: unknown;
  jobStatus?: unknown;
  timeStart?: unknown;
  timeEnd?: unknown;
  usdRewardPerHour?: unknown;
}

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Earnings of `node` in [from, to] from finished jobs and the market list (pure). */
export function nosanaEarningsFromJobs(
  node: string,
  jobs: unknown[],
  markets: unknown[],
  from: number,
  to: number,
  truncated = false,
): NosanaEarnings {
  const names = new Map<string, string>();
  for (const m of markets) {
    const x = (m ?? {}) as { address?: unknown; name?: unknown };
    if (typeof x.address === "string" && typeof x.name === "string") names.set(x.address, x.name);
  }
  const by = new Map<string, { secs: number; earn: number }>();
  let count = 0;
  let failed = 0;
  let failedSecs = 0;
  // a job finishing while the pages are read shifts the list: drop repeats
  const seen = new Set<string>();
  for (const j of jobs as Job[]) {
    if (j.node !== node || j.state !== 2 || typeof j.market !== "string") continue;
    const id = typeof j.address === "string" ? j.address : j.id !== undefined ? String(j.id) : null;
    if (id !== null) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const start = n(j.timeStart);
    const end = n(j.timeEnd);
    const rate = n(j.usdRewardPerHour);
    if (start === null || end === null || rate === null || end <= start) continue;
    // the part of the job inside the window
    const secs = Math.min(end, to) - Math.max(start, from);
    if (secs <= 0) continue;
    if (j.jobStatus === "failed") {
      failed += 1;
      failedSecs += secs;
      continue;
    }
    count += 1;
    const b = by.get(j.market) ?? { secs: 0, earn: 0 };
    b.secs += secs;
    b.earn += (secs / 3_600) * rate;
    by.set(j.market, b);
  }
  const lines: EarningsLine[] = [...by.entries()].map(([market, b]) => {
    const name = names.get(market) ?? null;
    const earn = Math.round(b.earn * 1e6);
    return {
      machine: market,
      gpuName: name,
      numGpus: 1,
      classId: nosanaClassOfMarket(name),
      gpuEarn: earn,
      totalEarn: earn,
      listedRate: null,
      estGpuHours: Math.round((b.secs / 3_600) * 1000) / 1000,
      hoursSource: "job_times",
    };
  });
  const days = Math.max(1, Math.round((to - from) / 86_400));
  const summary = summarizeEarnings(days, lines, "nosana");
  return {
    ...summary,
    windowSecs: to - from,
    node,
    from,
    to,
    jobs: count,
    failedJobs: failed,
    failedHours: Math.round((failedSecs / 3_600) * 1000) / 1000,
    truncated,
  };
}

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nosana API ${res.status}`);
  return res.json();
};

/**
 * Reads the finished jobs of a Nosana node for the last `days` days (newest
 * first, page by page until the window starts) and sums its earnings.
 */
export async function getNosanaEarnings(
  node: string,
  opts: { days?: number; now?: number; maxPages?: number; fetchJson?: FetchJson } = {},
): Promise<NosanaEarnings> {
  const days = opts.days ?? 30;
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error("days must be 1 to 31");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(node)) throw new Error("not a Solana address");
  const get = opts.fetchJson ?? defaultFetch;
  const to = opts.now ?? Math.floor(Date.now() / 1000);
  const from = to - days * 86_400;
  const maxPages = opts.maxPages ?? 40;
  const marketsAnswer = await get(`${NOSANA_API}/markets/`);
  const markets = Array.isArray(marketsAnswer) ? marketsAnswer : [];
  const jobs: unknown[] = [];
  let truncated = true;
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ node, state: "COMPLETED", limit: String(NOSANA_PAGE), offset: String(page * NOSANA_PAGE) });
    const answer = (await get(`${NOSANA_API}/jobs?${q}`)) as { jobs?: unknown };
    const list = Array.isArray(answer?.jobs) ? answer.jobs : [];
    jobs.push(...list);
    const oldestEnd = list.reduce<number>((m, j) => Math.min(m, n((j as Job).timeEnd) ?? Infinity), Infinity);
    if (list.length < NOSANA_PAGE || oldestEnd < from) {
      truncated = false;
      break;
    }
  }
  return nosanaEarningsFromJobs(node, jobs, markets, from, to, truncated);
}
