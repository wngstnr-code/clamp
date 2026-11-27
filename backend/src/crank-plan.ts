// Step 3 of a tick, the decision part (pure, tested without a network):
// which permissionless cranks are due for the managed series.

export interface ManagedSeries {
  classId: number;
  kind: number;
}

/**
 * Series the crank keeps alive: RTX 4090 daily (short series) and weekly, and
 * H100 daily (D-061: its index moves, the RTX 4090 index is held by a posted
 * price for now).
 */
export const MANAGED: ManagedSeries[] = [
  { classId: 1, kind: 0 },
  { classId: 1, kind: 1 },
  { classId: 2, kind: 0 },
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
  /** Settled value of one UP claim in ppm (0 until settled). */
  upValue?: number;
}

export interface ClassState {
  classId: number;
  /** `series_count` per kind: the next series of a kind gets this seq. */
  seriesCount: number[];
  /** Expiry of the latest series per kind, 0 = none. */
  currentExpiry: number[];
  /** `current_series` per kind (base58), when known. */
  currentSeries?: string[];
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

/** A tick waits at most this long for a series that is about to expire. */
export const EXPIRY_WAIT = 120;

/**
 * Seconds to wait so a series expiring right after the tick is settled and
 * replaced in this tick, not 15 minutes later (which would also push every
 * later series 15 minutes back). Waits for the last such series, so two
 * series expiring seconds apart are both handled in this tick. 0 when nothing
 * expires within `limit`. The result includes a 2 second margin for the chain
 * clock.
 */
export function expiryWait(series: SeriesState[], now: number, limit = EXPIRY_WAIT): number {
  let last = 0;
  for (const s of series) {
    if (!s.settled && s.expiryTs > now && s.expiryTs - now <= limit) last = Math.max(last, s.expiryTs);
  }
  return last === 0 ? 0 : last - now + 2;
}

// ---------------------------------------------------------------- roll (M6)

export interface LockState {
  key: string;
  owner: string;
  series: string;
  side: number;
  hours: number;
  autoRoll: boolean;
  escrowAmount: bigint;
  rentPayer: string;
}

export interface RollAction {
  lock: LockState;
  oldSeries: SeriesState;
  newSeries: SeriesState;
}

/** Rolls per tick, at most (each is one transaction of about 100,000 CU). */
export const MAX_ROLLS_PER_TICK = 10;

/**
 * Locks to roll now (spec 10.4, D-063): auto-roll on, the lock's series
 * settled, claims worth more than 0, hours above 0, and the current series
 * of the same class and kind seeded and still trading. Locks the program
 * would refuse are left out, so the crank does not send failing transactions.
 */
export function planRolls(
  input: { now: number; classes: ClassState[]; series: SeriesState[]; locks: LockState[] },
  max = MAX_ROLLS_PER_TICK,
): RollAction[] {
  const byKey = new Map(input.series.map((s) => [s.key, s]));
  const out: RollAction[] = [];
  for (const lock of input.locks) {
    if (out.length >= max) break;
    if (!lock.autoRoll || lock.hours <= 0 || lock.escrowAmount <= 0n) continue;
    const old = byKey.get(lock.series);
    if (!old || !old.settled) continue;
    const up = old.upValue ?? 0;
    const value = lock.side === 0 ? up : 1_000_000 - up;
    if ((lock.escrowAmount * BigInt(value)) / 1_000_000n <= 0n) continue;
    const cls = input.classes.find((c) => c.classId === old.classId);
    const currentKey = cls?.currentSeries?.[old.kind];
    const next = currentKey ? byKey.get(currentKey) : undefined;
    if (!next || next.key === old.key || !next.seeded || next.settled || input.now >= next.closeTs) continue;
    out.push({ lock, oldSeries: old, newSeries: next });
  }
  return out;
}
