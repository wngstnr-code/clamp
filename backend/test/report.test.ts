// The report step without network or chain: saved real API answers go in,
// the submit_report arguments and the database rows come out.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CLAMP_IDL, H100, RTX4090 } from "@clamp/sdk";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { rowsFromLogs } from "../src/events.js";
import { buildReport, fetchAll, requestKey } from "../src/fetch-sources.js";

const dir = join(import.meta.dirname, "..", "..", "packages", "sdk", "test", "fixtures", "2026-11-18");
const file = (name: string) => readFileSync(join(dir, name));

/** Serves the saved answers by request, like the real APIs did on 2026-11-18. */
function savedApis(overrides: Record<string, () => Response> = {}): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const byUrl = (url: string) => {
    if (url.includes("vast.ai")) return url.includes("H100") ? "vast-h100.json" : "vast-rtx4090.json";
    if (url.includes("runpod")) return "runpod.json";
    if (url.includes("akash")) return "akash.json";
    return "nosana.json";
  };
  const fake: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    for (const [needle, make] of Object.entries(overrides)) if (url.includes(needle)) return make();
    return new Response(file(byUrl(url)));
  };
  return { fetch: fake, calls };
}

describe("fetchAll", () => {
  it("sends each distinct request once for both classes", async () => {
    const apis = savedApis();
    const answers = await fetchAll([RTX4090, H100], apis.fetch);
    // Vast.ai twice (two models), RunPod, Akash and Nosana once each
    expect(apis.calls).toHaveLength(5);
    expect(answers.size).toBe(5);
    const runpod = answers.get(requestKey(RTX4090.sources[1]!.request));
    expect(runpod).not.toBeInstanceOf(Error);
    expect((runpod as { sha256: string }).sha256).toBe(
      createHash("sha256").update(file("runpod.json")).digest("hex"),
    );
  });

  it("maps HTTP errors and network failures to errors", async () => {
    const apis = savedApis({
      runpod: () => new Response("busy", { status: 503 }),
      nosana: () => {
        throw new Error("network down");
      },
    });
    const answers = await fetchAll([RTX4090], apis.fetch);
    expect(answers.get(requestKey(RTX4090.sources[1]!.request))).toEqual(new Error("HTTP 503"));
    expect(answers.get(requestKey(RTX4090.sources[3]!.request))).toEqual(new Error("network down"));
  });
});

describe("buildReport", () => {
  it("gives the submit_report arguments for RTX 4090", async () => {
    const answers = await fetchAll([RTX4090], savedApis().fetch);
    const r = buildReport(RTX4090, answers);
    expect(r.prices).toEqual([484_711n, 340_000n, 340_000n, 363_600n, 0n, 0n]);
    expect(r.capacities).toEqual([57, 0, 0, 0, 0, 0]);
    expect(r.rawHashes).toHaveLength(6);
    expect(r.rawHashes[0]).toEqual([...createHash("sha256").update(file("vast-rtx4090.json")).digest()]);
    expect(r.rawHashes[4]).toEqual(Array(32).fill(0));
  });

  it("reports price 0 with no hash when a request failed", async () => {
    const apis = savedApis({ nosana: () => new Response("x", { status: 500 }) });
    const r = buildReport(RTX4090, await fetchAll([RTX4090], apis.fetch));
    expect(r.prices[3]).toBe(0n);
    expect(r.rawHashes[3]).toEqual(Array(32).fill(0));
    expect(r.slots[3]).toMatchObject({ ok: false, error: "HTTP 500", sha256: null });
  });

  it("reports price 0 but keeps the hash when the answer has no usable price", async () => {
    const apis = savedApis({ "vast.ai": () => new Response('{"offers": []}') });
    const r = buildReport(RTX4090, await fetchAll([RTX4090], apis.fetch));
    expect(r.prices[0]).toBe(0n);
    expect(r.slots[0]!.ok).toBe(false);
    expect(r.slots[0]!.sha256).toBe(createHash("sha256").update('{"offers": []}').digest("hex"));
  });

  it("does not throw on an answer that is not JSON", async () => {
    const apis = savedApis({ akash: () => new Response("<html>maintenance</html>") });
    const r = buildReport(RTX4090, await fetchAll([RTX4090], apis.fetch));
    expect(r.slots[2]).toMatchObject({ ok: false, price: 0n });
    expect(r.slots[2]!.error).toMatch(/rule failed/);
  });
});

describe("rowsFromLogs", () => {
  function logsFor(prices: bigint[], caps: number[], hashes: number[][], reporter = Keypair.generate().publicKey) {
    const ev = CLAMP_IDL.events.find((e) => e.name === "reportSubmitted")!;
    const parts: Buffer[] = [Buffer.from(ev.discriminator), Buffer.of(1), Buffer.from(reporter.toBytes())];
    const ts = Buffer.alloc(8);
    ts.writeBigInt64LE(1_800_000_000n);
    parts.push(ts);
    for (const p of prices) {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(p);
      parts.push(b);
    }
    for (const c of caps) {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(c);
      parts.push(b);
    }
    for (const h of hashes) parts.push(Buffer.from(h));
    return {
      reporter,
      logs: [
        `Program ${CLAMP_IDL.address} invoke [1]`,
        `Program data: ${Buffer.concat(parts).toString("base64")}`,
        `Program ${CLAMP_IDL.address} success`,
      ],
    };
  }

  it("turns a report event into one row per class source", async () => {
    const r = buildReport(RTX4090, await fetchAll([RTX4090], savedApis({ nosana: () => new Response("x", { status: 500 }) }).fetch));
    const { logs, reporter } = logsFor(r.prices, r.capacities, r.rawHashes);
    const rows = rowsFromLogs(logs, "sig1", 42, {
      classId: 1,
      errors: r.slots.map((s) => s.error),
      rawPaths: r.slots.map((s) => (s.sha256 ? `raw/${s.sha256}.json` : null)),
    });
    expect(rows.updates).toEqual([]);
    expect(rows.ticks).toHaveLength(4);
    expect(rows.ticks[0]).toMatchObject({
      ts: "2027-01-15T08:00:00.000Z",
      class_id: 1,
      source_id: 1,
      reporter: reporter.toBase58(),
      price_micro: "484711",
      capacity: 57,
      ok: true,
      error: null,
      signature: "sig1",
    });
    expect(rows.ticks[0]!.raw_path).toBe(`raw/${rows.ticks[0]!.raw_sha256}.json`);
    expect(rows.ticks[3]).toMatchObject({ ok: false, price_micro: null, error: "HTTP 500", raw_sha256: null, raw_path: null });
  });

  it("marks another reporter's missing price without local detail", async () => {
    const zero = Array(32).fill(0);
    const { logs } = logsFor([0n, 340_000n, 0n, 0n, 0n, 0n], [0, 0, 0, 0, 0, 0], Array(6).fill(zero));
    const rows = rowsFromLogs(logs, "sig2", 1);
    expect(rows.ticks.map((t) => t.ok)).toEqual([false, true, false, false]);
    expect(rows.ticks[0]!.error).toBe("no price reported");
    // no hash, no file
    expect(rows.ticks.every((t) => t.raw_path === null)).toBe(true);
  });
});
