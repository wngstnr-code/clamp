// Step 5 of a tick: prune the raw archive (docs/architecture.md section 5).
// Raw files are content-addressed, so one file can serve reports far apart in
// time. A file is removed only when it is older than RAW_KEEP_DAYS and no
// source row of the last RAW_KEEP_DAYS uses its hash. Its hash stays on-chain.

import type { Store } from "./store.js";
import type { StepResult } from "./tick.js";

export const RAW_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
/** Files listed per page, and pages per run (the archive adds about 600 a day). */
const PAGE = 1_000;
const MAX_PAGES = 5;

export interface RawFile {
  name: string;
  createdAt: string | null;
}

const hashOf = (name: string) => name.replace(/\.json$/, "");

/** Files older than `cutoff` whose hash is not in `used`. */
export function prunable(files: RawFile[], used: Set<string>, cutoff: Date): string[] {
  return files
    .filter((f) => f.createdAt !== null && new Date(f.createdAt) < cutoff && !used.has(hashOf(f.name)))
    .map((f) => f.name);
}

/** Runs at most once a day. Returns null when it is not due yet. */
export async function pruneStep(store: Store, now = new Date(), force = false): Promise<StepResult | null> {
  try {
    const last = await store.lastSuccess("prune");
    if (!force && last && now.getTime() - new Date(last).getTime() < DAY_MS - 3_600_000) return null;
    const cutoff = new Date(now.getTime() - RAW_KEEP_DAYS * DAY_MS);
    let removed = 0;
    let kept = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const files = await store.listRawOldestFirst(PAGE, kept);
      const old = files.filter((f) => f.createdAt !== null && new Date(f.createdAt) < cutoff);
      if (old.length === 0) break;
      const used = await store.hashesUsedSince(old.map((f) => hashOf(f.name)), cutoff);
      const names = prunable(old, used, cutoff);
      await store.removeRaw(names);
      removed += names.length;
      kept += old.length - names.length;
      if (old.length < files.length || files.length < PAGE) break;
    }
    const result = { action: "prune", ok: true, detail: `${removed} raw files removed, ${kept} old files still used` };
    await store.logRun(result.action, true, result.detail);
    return result;
  } catch (e) {
    const result = { action: "prune", ok: false, detail: (e as Error).message.slice(0, 300) };
    await store.logRun(result.action, false, result.detail);
    return result;
  }
}
