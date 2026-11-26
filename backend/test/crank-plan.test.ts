import { describe, expect, it } from "vitest";

import { expiryWait, planCrank, type ClassState, type SeriesState } from "../src/crank-plan.js";

const NOW = 1_800_000_000;
const DAY = 86_400;

function series(over: Partial<SeriesState>): SeriesState {
  return {
    key: over.key ?? `s${over.kind ?? 0}-${over.seq ?? 0}`,
    classId: 1,
    kind: 0,
    seq: 0,
    closeTs: NOW + DAY - 3_600,
    expiryTs: NOW + DAY,
    seeded: true,
    settled: false,
    swept: false,
    ...over,
  };
}

const cls = (seriesCount: number[], currentExpiry: number[]): ClassState => ({ classId: 1, seriesCount, currentExpiry });
const vault = { activeCount: 1, idle: 1_000_000_000n };
const types = (a: ReturnType<typeof planCrank>) => a.map((x) => x.type);

describe("planCrank", () => {
  it("creates the first daily and weekly series when none exist", () => {
    const actions = planCrank({ now: NOW, classes: [cls([0, 0, 0], [0, 0, 0])], series: [], vault });
    expect(actions).toEqual([
      { type: "create", classId: 1, kind: 0, seq: 0 },
      { type: "create", classId: 1, kind: 1, seq: 0 },
    ]);
  });

  it("does nothing while both series are live and seeded", () => {
    const d = series({ kind: 0 });
    const w = series({ kind: 1, expiryTs: NOW + 7 * DAY, closeTs: NOW + 7 * DAY - 25_200 });
    const actions = planCrank({ now: NOW, classes: [cls([1, 1, 0], [d.expiryTs, w.expiryTs, 0])], series: [d, w], vault });
    expect(actions).toEqual([]);
  });

  it("seeds a live series that is not seeded yet", () => {
    const d = series({ kind: 0, seeded: false });
    const w = series({ kind: 1, expiryTs: NOW + 7 * DAY, closeTs: NOW + 7 * DAY - 25_200 });
    const actions = planCrank({ now: NOW, classes: [cls([1, 1, 0], [d.expiryTs, w.expiryTs, 0])], series: [d, w], vault });
    expect(actions).toEqual([{ type: "seed", series: d }]);
  });

  it("does not seed after close, without a vault, or with no idle USDC", () => {
    const d = series({ kind: 0, seeded: false, closeTs: NOW - 1 });
    const w = series({ kind: 1, seeded: false, expiryTs: NOW + 7 * DAY, closeTs: NOW + 7 * DAY - 25_200 });
    const classes = [cls([1, 1, 0], [d.expiryTs, w.expiryTs, 0])];
    expect(types(planCrank({ now: NOW, classes, series: [d, w], vault }))).toEqual(["seed"]);
    expect(planCrank({ now: NOW, classes, series: [d, w], vault: null })).toEqual([]);
    expect(planCrank({ now: NOW, classes, series: [d, w], vault: { activeCount: 0, idle: 0n } })).toEqual([]);
  });

  it("after expiry: settles, sweeps, then creates the next series", () => {
    const d = series({ kind: 0, expiryTs: NOW - 10, closeTs: NOW - 3_610 });
    const w = series({ kind: 1, expiryTs: NOW + 7 * DAY, closeTs: NOW + 7 * DAY - 25_200 });
    const actions = planCrank({
      now: NOW,
      classes: [cls([1, 1, 0], [d.expiryTs, w.expiryTs, 0])],
      series: [d, w],
      vault: { activeCount: 2, idle: 0n },
    });
    expect(actions).toEqual([
      { type: "settle", series: d },
      { type: "sweep", series: d },
      { type: "create", classId: 1, kind: 0, seq: 1 },
    ]);
  });

  it("sweeps a settled series once and never twice", () => {
    const old = series({ key: "old", settled: true, swept: true, expiryTs: NOW - DAY });
    const done = series({ key: "done", seq: 1, settled: true, swept: false, expiryTs: NOW - 10 });
    const unseeded = series({ key: "empty", seq: 2, settled: true, seeded: false, expiryTs: NOW - 5 });
    const actions = planCrank({
      now: NOW,
      classes: [cls([3, 0, 0], [NOW - 5, 0, 0])],
      series: [old, done, unseeded],
      vault,
      managed: [{ classId: 1, kind: 0 }],
    });
    expect(actions).toEqual([
      { type: "sweep", series: done },
      { type: "create", classId: 1, kind: 0, seq: 3 },
    ]);
  });

  it("respects the limit of 8 active series in the vault", () => {
    const d = series({ kind: 0, seeded: false });
    const actions = planCrank({
      now: NOW,
      classes: [cls([1, 0, 0], [d.expiryTs, 0, 0])],
      series: [d],
      vault: { activeCount: 8, idle: 1n },
      managed: [{ classId: 1, kind: 0 }],
    });
    expect(actions).toEqual([]);
  });
});

describe("expiryWait", () => {
  it("waits for a series that expires within the limit, with a margin", () => {
    const d = series({ kind: 0, expiryTs: NOW + 18 });
    expect(expiryWait([d], NOW)).toBe(20);
  });

  it("does not wait for a far, past or settled expiry", () => {
    expect(expiryWait([series({ expiryTs: NOW + 121 })], NOW)).toBe(0);
    expect(expiryWait([series({ expiryTs: NOW - 1 })], NOW)).toBe(0);
    expect(expiryWait([series({ expiryTs: NOW + 10, settled: true })], NOW)).toBe(0);
    expect(expiryWait([], NOW)).toBe(0);
  });

  it("waits for the last of several within the limit", () => {
    // Seen on 2026-11-25: weekly at +20 s and daily at +49 s. Waiting only for
    // the weekly left the daily to the next tick, 15 minutes late.
    const a = series({ key: "a", expiryTs: NOW + 49 });
    const b = series({ key: "b", expiryTs: NOW + 20 });
    const far = series({ key: "far", expiryTs: NOW + 500 });
    expect(expiryWait([a, b, far], NOW)).toBe(51);
  });
});
