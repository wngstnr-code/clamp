import { describe, expect, it } from "vitest";

import { planRolls, type ClassState, type LockState, type SeriesState } from "../src/crank-plan.js";

const NOW = 1_800_000_000;
const DAY = 86_400;

const s = (over: Partial<SeriesState>): SeriesState => ({
  key: "old",
  classId: 1,
  kind: 0,
  seq: 0,
  closeTs: NOW - 3_700,
  expiryTs: NOW - 100,
  seeded: true,
  settled: true,
  swept: false,
  upValue: 500_000,
  ...over,
});
const OLD = s({});
const NEW = s({ key: "new", seq: 1, closeTs: NOW + DAY - 3_700, expiryTs: NOW + DAY - 100, settled: false, upValue: 0 });
const cls: ClassState = { classId: 1, seriesCount: [2, 0, 0], currentExpiry: [NEW.expiryTs, 0, 0], currentSeries: ["new", "", ""] };
const lock = (over: Partial<LockState> = {}): LockState => ({
  key: "L",
  owner: "O",
  series: "old",
  side: 0,
  hours: 10,
  autoRoll: true,
  escrowAmount: 10_000_000n,
  rentPayer: "O",
  createdTs: NOW - DAY,
  ...over,
});
const plan = (locks: LockState[], series = [OLD, NEW], classes = [cls]) => planRolls({ now: NOW, classes, series, locks });

describe("planRolls", () => {
  it("rolls an auto-roll lock of a settled series into the current series", () => {
    expect(plan([lock()])).toEqual([{ lock: lock(), oldSeries: OLD, newSeries: NEW }]);
  });

  it("skips what the program would refuse", () => {
    expect(plan([lock({ autoRoll: false })])).toEqual([]);
    expect(plan([lock({ hours: 0 })])).toEqual([]);
    expect(plan([lock({ escrowAmount: 0n })])).toEqual([]);
    // UP worth 0, and DOWN worth 0
    expect(plan([lock()], [s({ upValue: 0 }), NEW])).toEqual([]);
    expect(plan([lock({ side: 1 })], [s({ upValue: 1_000_000 }), NEW])).toEqual([]);
    // a payout below 1 tUSDC (dust would drain the worker's rent)
    expect(plan([lock({ escrowAmount: 1n })])).toEqual([]);
    expect(plan([lock({ escrowAmount: 1_999_998n })])).toEqual([]);
    expect(plan([lock({ escrowAmount: 2_000_000n })])).toHaveLength(1);
    // the lock's series is not settled yet
    expect(plan([lock()], [s({ settled: false }), NEW])).toEqual([]);
  });

  it("waits for a current series that is seeded and still trading", () => {
    expect(plan([lock()], [OLD, { ...NEW, seeded: false }])).toEqual([]);
    expect(plan([lock()], [OLD, { ...NEW, closeTs: NOW }])).toEqual([]);
    expect(plan([lock()], [OLD, NEW], [{ ...cls, currentSeries: ["old", "", ""] }])).toEqual([]);
    expect(plan([lock()], [OLD, NEW], [{ ...cls, currentSeries: undefined }])).toEqual([]);
  });

  it("rolls into the series of the lock's own kind, oldest lock first, with no cap in the plan", () => {
    const weekly = s({ key: "w", kind: 1, settled: false, closeTs: NOW + 5 * DAY, expiryTs: NOW + 7 * DAY });
    const both = { ...cls, currentSeries: ["new", "w", ""] };
    expect(plan([lock()], [OLD, NEW, weekly], [both])[0]?.newSeries.key).toBe("new");
    const many = Array.from({ length: 15 }, (_, i) => lock({ key: `L${i}`, createdTs: NOW - i }));
    const p = plan(many);
    expect(p).toHaveLength(15);
    expect(p[0]?.lock.key).toBe("L14");
  });
});
