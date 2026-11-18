// Step 3 of a tick, the decision part (pure, tested without a network):
// which permissionless cranks are due for the managed series.

export interface ManagedSeries {
  classId: number;
  kind: number;
}

/** Series the crank keeps alive: RTX 4090 daily (short series) and weekly. */
export const MANAGED: ManagedSeries[] = [
  { classId: 1, kind: 0 },
  { classId: 1, kind: 1 },
];

export interface SeriesState {
  key: string;
  classId: number;
  kind: number;
  seq: number;
  closeTs: number;
  expiryTs: number;
  seeded: boolean;
  settled: boolean;
  swept: boolean;
}

export interface ClassState {
  classId: number;
  /** `series_count` per kind: the next series of a kind gets this seq. */
  seriesCount: number[];
  /** Expiry of the latest series per kind, 0 = none. */
  currentExpiry: number[];
}

export type CrankAction =
  | { type: "settle"; series: SeriesState }
  | { type: "sweep"; series: SeriesState }
  | { type: "create"; classId: number; kind: number; seq: number }
  | { type: "seed"; series: SeriesState };

export interface CrankInput {
  now: number;
  classes: ClassState[];
  /** Every series account of the program. */
  series: SeriesState[];
  /** Vault: active list size and idle USDC (micro units). Null = no vault yet. */
  vault: { activeCount: number; idle: bigint } | null;
  managed?: ManagedSeries[];
}

const MAX_ACTIVE = 8;

/**
 * Actions in the order they must run: settle expired series, sweep settled
 * vault series (frees idle USDC), create the next managed series, seed the
 * current managed series that are not seeded yet.
 */
export function planCrank(input: CrankInput): CrankAction[] {
  const { now, classes, series, vault } = input;
  const managed = input.managed ?? MANAGED;
  const actions: CrankAction[] = [];

  for (const s of series) {
    if (!s.settled && now >= s.expiryTs) actions.push({ type: "settle", series: s });
  }
  for (const s of series) {
    const settledNow = s.settled || now >= s.expiryTs;
    if (settledNow && s.seeded && !s.swept) actions.push({ type: "sweep", series: s });
  }

  let active = vault?.activeCount ?? 0;
  active -= actions.filter((a) => a.type === "sweep").length;
  let idleLeft = vault ? vault.idle > 0n : false;

  for (const m of managed) {
    const cls = classes.find((c) => c.classId === m.classId);
    if (!cls) continue;
    const expiry = cls.currentExpiry[m.kind] ?? 0;
    const count = cls.seriesCount[m.kind] ?? 0;
    let current = series.find((s) => s.classId === m.classId && s.kind === m.kind && s.seq === count - 1);
    if (expiry === 0 || now >= expiry) {
      actions.push({ type: "create", classId: m.classId, kind: m.kind, seq: count });
      current = undefined; // the new series is seeded on the next tick
    }
    if (current && !current.seeded && !current.settled && now < current.closeTs && vault && active < MAX_ACTIVE && idleLeft) {
      actions.push({ type: "seed", series: current });
      active += 1;
      idleLeft = true; // the allocation is a share of NAV, more may remain
    }
  }
  return actions;
}
