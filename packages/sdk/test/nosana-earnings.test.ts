// Job and market shapes as returned by api.nosana.com on 2026-11-27.
import { describe, expect, it } from "vitest";

import { getNosanaEarnings, nosanaClassOfMarket, nosanaEarningsFromJobs } from "../src/nosana-earnings.js";

const NODE = "ChipN63q3baupE7hGQgUzrHQP3YvHEf4YEw2KkPbPZNt";
const M4090 = "M4090aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const M3090 = "CA5pMpqkYFKtme7K31pNB1s62X2SdhEv1nN9RdxKCpuQ";
const markets = [
  { address: M4090, name: "NVIDIA 4090", usd_reward_per_hour: 0.32 },
  { address: M3090, name: "NVIDIA 3090", usd_reward_per_hour: 0.1745 },
];
const NOW = 1_800_000_000;
const FROM = NOW - 30 * 86_400;
const job = (over: Record<string, unknown>) => ({
  node: NODE,
  market: M4090,
  state: 2,
  jobStatus: "success",
  timeStart: NOW - 7_200,
  timeEnd: NOW - 3_600,
  usdRewardPerHour: 0.32,
  ...over,
});

describe("Nosana host earnings", () => {
  it("maps market names with the index rule", () => {
    expect(nosanaClassOfMarket("NVIDIA 4090")).toBe(1);
    expect(nosanaClassOfMarket("NVIDIA H100")).toBe(2);
    expect(nosanaClassOfMarket("NVIDIA 3090")).toBeNull();
    expect(nosanaClassOfMarket(null)).toBeNull();
  });

  it("sums hours times rate per market, inside the window only", () => {
    const e = nosanaEarningsFromJobs(
      NODE,
      [
        job({}), // 1 h at 0.32
        job({ timeStart: NOW - 3_600, timeEnd: NOW, jobStatus: "failed" }), // 1 h
        job({ timeStart: FROM - 1_800, timeEnd: FROM + 1_800 }), // half inside
        job({ timeStart: FROM - 7_200, timeEnd: FROM - 3_600 }), // before the window
        job({ node: "other" }),
        job({ state: 1 }),
        job({ market: M3090, usdRewardPerHour: 0.1745 }),
      ],
      markets,
      FROM,
      NOW,
    );
    // the failed job is left out of the earnings and shown on its own
    expect(e.jobs).toBe(3);
    expect(e.failedJobs).toBe(1);
    expect(e.failedHours).toBe(1);
    expect(e.byClass).toEqual([{ classId: 1, gpuEarn: 480_000, estGpuHours: 1.5, rate: 320_000, hoursSource: "job_times" }]);
    expect(e.unassigned.map((l) => l.gpuName)).toEqual(["NVIDIA 3090"]);
    expect(e.provider).toBe("nosana");
    expect(e.windowSecs).toBe(30 * 86_400);
    expect(e.truncated).toBe(false);
  });

  it("pages until the window starts, and says when the page limit cut it short", async () => {
    const urls: string[] = [];
    const page = (offset: number) =>
      Array.from({ length: 50 }, (_, i) => job({ address: `J${offset + i}`, timeStart: NOW - (offset + i + 2) * 40_000, timeEnd: NOW - (offset + i + 1) * 40_000 }));
    const fetchJson = async (url: string) => {
      urls.push(url);
      if (url.endsWith("/markets/")) return markets;
      const offset = Number(new URL(url).searchParams.get("offset"));
      return { jobs: page(offset), totalJobs: 1_000 };
    };
    const e = await getNosanaEarnings(NODE, { now: NOW, fetchJson });
    // 40,000 s per job: the window of 30 days starts inside the second page
    expect(urls.filter((u) => u.includes("/jobs?"))).toHaveLength(2);
    const q = new URL(urls[1]!).searchParams;
    expect([q.get("node"), q.get("state"), q.get("limit"), q.get("offset")]).toEqual([NODE, "COMPLETED", "50", "0"]);
    expect(e.truncated).toBe(false);
    const cut = await getNosanaEarnings(NODE, { now: NOW, fetchJson, maxPages: 1 });
    expect(cut.truncated).toBe(true);
  });

  it("counts a job that shows up on two pages once", () => {
    const a = job({ address: "J1" });
    const e = nosanaEarningsFromJobs(NODE, [a, job({ address: "J2", timeStart: NOW - 3_600, timeEnd: NOW }), a], markets, FROM, NOW);
    expect(e.jobs).toBe(2);
    expect(e.byClass[0]?.estGpuHours).toBe(2);
  });

  it("refuses a bad node or window", async () => {
    await expect(getNosanaEarnings("not-an-address", { fetchJson: async () => [] })).rejects.toThrow();
    await expect(getNosanaEarnings(NODE, { days: 0, fetchJson: async () => [] })).rejects.toThrow();
  });
});
