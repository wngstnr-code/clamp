import { describe, expect, it } from "vitest";

import { prunable, RAW_KEEP_DAYS } from "../src/prune.js";

const NOW = new Date("2027-01-01T00:00:00Z");
const CUTOFF = new Date(NOW.getTime() - RAW_KEEP_DAYS * 86_400_000);
const H = (c: string) => c.repeat(64);
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("prunable", () => {
  it("removes old files that no recent row uses", () => {
    const files = [{ name: `${H("a")}.json`, createdAt: ago(40) }];
    expect(prunable(files, new Set(), CUTOFF)).toEqual([`${H("a")}.json`]);
  });

  it("keeps recent files, files still used, and files without a date", () => {
    const files = [
      { name: `${H("a")}.json`, createdAt: ago(10) },
      { name: `${H("b")}.json`, createdAt: ago(40) },
      { name: `${H("c")}.json`, createdAt: null },
      { name: `${H("d")}.json`, createdAt: ago(31) },
    ];
    expect(prunable(files, new Set([H("b")]), CUTOFF)).toEqual([`${H("d")}.json`]);
  });

  it("keeps a file created exactly at the cutoff", () => {
    expect(prunable([{ name: `${H("e")}.json`, createdAt: CUTOFF.toISOString() }], new Set(), CUTOFF)).toEqual([]);
  });
});
