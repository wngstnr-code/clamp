import { parseRunpodBill, parseVastBill, parseVastEarnings } from "@clamp/sdk";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";
import { BillError, billWindow, earningsRequest, providerKey, runpodBill, vastBill, vastEarnings, type Fetch } from "../src/bill-proxy.js";

const KEY = "test-key-not-real";
const NOW = 1_800_000_000;

/** A fake provider: answers by URL prefix and records every call. */
function fakeFetch(routes: [string, (url: URL) => { status: number; body: unknown } | "throw"][]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn: Fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const u = new URL(url);
    for (const [prefix, answer] of routes) {
      if (url.startsWith(prefix)) {
        const a = answer(u);
        if (a === "throw") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        return new Response(JSON.stringify(a.body), { status: a.status });
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { fn, calls };
}

describe("request checks", () => {
  it("takes the last 30 days by default and refuses bad windows", () => {
    expect(billWindow({}, NOW)).toEqual({ from: NOW - 30 * 86_400, to: NOW });
    expect(billWindow({ from: NOW - 86_400, to: NOW }, NOW)).toEqual({ from: NOW - 86_400, to: NOW });
    for (const bad of [{ from: NOW, to: NOW }, { from: NOW - 40 * 86_400 }, { to: NOW + 7_200 }, { from: "x" }, { from: -1, to: 5 }]) {
      expect(() => billWindow(bad, NOW)).toThrow(BillError);
    }
  });
  it("needs a key in the header and nothing that could not be a key", () => {
    expect(providerKey(` ${KEY} `)).toBe(KEY);
    for (const bad of [undefined, "", "a b", "x".repeat(513)]) expect(() => providerKey(bad)).toThrow(BillError);
  });
});

describe("Vast.ai", () => {
  const charge = (id: number) => ({
    type: "instance",
    source: `instance-${id}`,
    amount: 1,
    description: "kept out",
    metadata: { label: "kept out" },
    items: [{ type: "gpu", description: "2.000 hours at $0.500/hour", amount: 1, metadata: {} }],
  });

  it("sends the key only as a bearer header, follows pages and keeps only parser fields", async () => {
    const { fn, calls } = fakeFetch([
      ["https://console.vast.ai/api/v0/charges/", (u) =>
        u.searchParams.get("after_token")
          ? { status: 200, body: { results: [charge(2)], next_token: null } }
          : { status: 200, body: { results: [charge(1)], next_token: "p2" } }],
      ["https://console.vast.ai/api/v1/instances/", () => ({
        status: 200,
        body: { instances: [{ id: 1, gpu_name: "RTX 4090", num_gpus: 1, ssh_host: "kept out" }], next_token: null },
      })],
    ]);
    const answer = await vastBill(fn, KEY, NOW - 86_400, NOW);
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.url).not.toContain(KEY);
      expect(c.headers.Authorization).toBe(`Bearer ${KEY}`);
    }
    const filters = JSON.parse(new URL(calls[0]!.url).searchParams.get("select_filters")!);
    expect(filters).toEqual({ day: { gte: NOW - 86_400, lte: NOW }, type: { in: ["instance"] } });
    expect(JSON.stringify(answer)).not.toContain("kept out");
    expect(answer.charges).toHaveLength(2);
    const bill = parseVastBill(answer);
    expect(bill.byClass).toEqual([{ classId: 1, gpuHours: 2, gpuCost: 1_000_000, rate: 500_000 }]);
    expect(bill.unassigned.map((l) => l.contract)).toEqual(["2"]);
  });

  it("returns charges without instances when the key cannot read them", async () => {
    const { fn } = fakeFetch([
      ["https://console.vast.ai/api/v0/charges/", () => ({ status: 200, body: { results: [charge(1)], next_token: null } })],
      ["https://console.vast.ai/api/v1/instances/", () => ({ status: 403, body: { error: "auth_error" } })],
    ]);
    expect((await vastBill(fn, KEY, NOW - 86_400, NOW)).instances).toBeNull();
  });

  it("answers bad_key for the Vast.ai 404 of an unknown key, provider_error otherwise", async () => {
    const bad = fakeFetch([["https://console.vast.ai/api/v0/charges/", () => ({ status: 404, body: { msg: "Invalid user key" } })]]);
    await expect(vastBill(bad.fn, KEY, NOW - 86_400, NOW)).rejects.toMatchObject({ code: "bad_key", status: 401, providerStatus: 404 });
    const down = fakeFetch([["https://console.vast.ai/api/v0/charges/", () => ({ status: 500, body: {} })]]);
    await expect(vastBill(down.fn, KEY, NOW - 86_400, NOW)).rejects.toMatchObject({ code: "provider_error", status: 502, providerStatus: 500 });
  });
});

describe("Runpod", () => {
  it("reads pod billing and pods over pages", async () => {
    const { fn, calls } = fakeFetch([
      ["https://api.runpod.io/v2/billing/pods", () => ({
        status: 200,
        body: { records: [{ podId: "p1", gpuAmount: 3.7, cpuAmount: 0, diskAmount: 0.1, totalAmount: 3.8 }], metadata: {} },
      })],
      ["https://api.runpod.io/v2/pods", (u) =>
        u.searchParams.get("cursor")
          ? { status: 200, body: { pods: [{ id: "p1", gpu: { id: "NVIDIA GeForce RTX 4090", count: 1 }, cost: 0.37, env: { SECRET: "kept out" } }], pagination: { nextCursor: null } } }
          : { status: 200, body: { pods: [], pagination: { nextCursor: "c2" } } }],
    ]);
    const answer = await runpodBill(fn, KEY, NOW - 86_400, NOW);
    expect(calls.every((c) => !c.url.includes(KEY) && c.headers.Authorization === `Bearer ${KEY}`)).toBe(true);
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get("startTime")).toBe(new Date((NOW - 86_400) * 1000).toISOString());
    expect(q.get("bucketSize")).toBe("day");
    expect(JSON.stringify(answer)).not.toContain("kept out");
    expect(parseRunpodBill(answer).byClass).toEqual([{ classId: 1, gpuHours: 10, gpuCost: 3_700_000, rate: 370_000 }]);
  });
});

describe("routes", () => {
  it("refuse a call without a key and allow the browser preflight", async () => {
    const res = await app.request("/bill/vast", { method: "POST", body: "{}" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_key", providerStatus: null });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const pre = await app.request("/bill/runpod", {
      method: "OPTIONS",
      headers: { Origin: "https://example.org", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-provider-key" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-provider-key");
  });
  it("refuse a bad window before calling the provider", async () => {
    const res = await app.request("/bill/runpod", {
      method: "POST",
      headers: { "X-Provider-Key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: 5, to: 4 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_range", providerStatus: null });
  });
});

describe("Vast.ai host earnings", () => {
  const PII = { username: "host", email: "host@example.org", fullname: "A Host", address1: "Street 1", taxinfo: "T-1", current: { balance: 99 } };
  const routes = (machinesStatus = 200): [string, (u: URL) => { status: number; body: unknown } | "throw"][] => [
    ["https://console.vast.ai/api/v0/users/current/", () => ({ status: 200, body: { id: 77, ...PII } })],
    ["https://console.vast.ai/api/v0/users/77/machine-earnings/", () => ({
      status: 200,
      body: { ...PII, summary: { total_gpu: 30 }, per_machine: [{ machine_id: 5, gpu_earn: 30, sto_earn: 1, bwu_earn: 0, bwd_earn: 0 }], per_day: [] },
    })],
    ["https://console.vast.ai/api/v0/machines/", () => machinesStatus === 0 ? "throw" : ({
      status: machinesStatus,
      body: { machines: [{ id: 5, gpu_name: "RTX 4090", num_gpus: 2, listed_gpu_cost: 0.3, public_ipaddr: "1.2.3.4" }] },
    })],
  ];

  it("checks the request", () => {
    expect(earningsRequest({})).toEqual({ days: 30, userId: null });
    expect(earningsRequest({ days: 7, userId: 77 })).toEqual({ days: 7, userId: 77 });
    for (const bad of [{ days: 0 }, { days: 32 }, { days: 1.5 }, { userId: -1 }, { userId: "77" }]) {
      expect(() => earningsRequest(bad)).toThrow(BillError);
    }
  });

  it("looks up the user id, passes on earnings per machine only and never the host's personal data", async () => {
    const { fn, calls } = fakeFetch(routes());
    const answer = await vastEarnings(fn, KEY, 30, null);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v0/users/current/",
      "/api/v0/users/77/machine-earnings/",
      "/api/v0/machines/",
    ]);
    expect(calls.every((c) => !c.url.includes(KEY) && c.headers.Authorization === `Bearer ${KEY}`)).toBe(true);
    expect(new URL(calls[1]!.url).searchParams.get("last_days")).toBe("30");
    const text = JSON.stringify(answer);
    for (const secret of ["host@example.org", "A Host", "Street 1", "T-1", "1.2.3.4", "balance"]) expect(text).not.toContain(secret);
    expect(parseVastEarnings(answer).byClass).toEqual([{ classId: 1, gpuEarn: 30_000_000, estGpuHours: 100, listedRate: 300_000 }]);
  });

  it("skips the lookup with a given user id and keeps earnings when machines are not readable", async () => {
    const { fn, calls } = fakeFetch(routes(403));
    const answer = await vastEarnings(fn, KEY, 7, 77);
    expect(calls[0]!.url).toContain("/users/77/machine-earnings/");
    expect(answer.machines).toBeNull();
    expect(answer.perMachine).toHaveLength(1);
  });

  it("keeps earnings when the machines call times out", async () => {
    const { fn } = fakeFetch(routes(0));
    const answer = await vastEarnings(fn, KEY, 30, null);
    expect(answer.machines).toBeNull();
    expect(answer.perMachine).toHaveLength(1);
  });

  it("reports a failed user lookup so the web app can ask for the user id", async () => {
    const { fn } = fakeFetch([["https://console.vast.ai/api/v0/users/current/", () => ({ status: 403, body: {} })]]);
    await expect(vastEarnings(fn, KEY, 30, null)).rejects.toMatchObject({ code: "provider_error", providerStatus: 403 });
  });

  it("has a route with the same checks", async () => {
    const res = await app.request("/earnings/vast", { method: "POST", headers: { "X-Provider-Key": KEY }, body: JSON.stringify({ days: 99 }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_range", providerStatus: null });
    const pre = await app.request("/earnings/vast", {
      method: "OPTIONS",
      headers: { Origin: "https://example.org", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-provider-key" },
    });
    expect(pre.status).toBe(204);
  });
});

describe("review fixes", () => {
  it("a timeout of a best-effort call keeps what was read", async () => {
    const vast = fakeFetch([
      ["https://console.vast.ai/api/v0/charges/", () => ({ status: 200, body: { results: [], next_token: null } })],
      ["https://console.vast.ai/api/v1/instances/", () => "throw"],
    ]);
    expect((await vastBill(vast.fn, KEY, NOW - 86_400, NOW)).instances).toBeNull();
    const runpod = fakeFetch([
      ["https://api.runpod.io/v2/billing/pods", () => ({ status: 200, body: { records: [], metadata: {} } })],
      ["https://api.runpod.io/v2/pods", () => "throw"],
    ]);
    expect((await runpodBill(runpod.fn, KEY, NOW - 86_400, NOW)).pods).toBeNull();
  });

  it("a timeout of a required call still fails", async () => {
    const { fn } = fakeFetch([["https://console.vast.ai/api/v0/charges/", () => "throw"]]);
    await expect(vastBill(fn, KEY, NOW - 86_400, NOW)).rejects.toThrow(/timeout/);
  });

  it("a wrong key answers bad_key, a missing right answers provider_error 403", async () => {
    const wrong = fakeFetch([["https://console.vast.ai/api/v0/users/current/", () => ({ status: 401, body: {} })]]);
    await expect(vastEarnings(wrong.fn, KEY, 30, null)).rejects.toMatchObject({ code: "bad_key", status: 401 });
    const noRight = fakeFetch([["https://console.vast.ai/api/v0/users/current/", () => ({ status: 403, body: {} })]]);
    await expect(vastEarnings(noRight.fn, KEY, 30, null)).rejects.toMatchObject({ code: "provider_error", providerStatus: 403 });
    const bill = fakeFetch([["https://api.runpod.io/v2/billing/pods", () => ({ status: 401, body: {} })]]);
    await expect(runpodBill(bill.fn, KEY, NOW - 86_400, NOW)).rejects.toMatchObject({ code: "bad_key" });
  });
});
