// verifyReport end to end with a fake connection and a fake archive:
// a ReportSubmitted event is encoded into transaction logs exactly as the
// program emits it, and the archive serves the real saved API responses.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { CLAMP_IDL } from "../src/program.js";
import { RTX4090 } from "../src/sources/classes.js";
import { verifyReport } from "../src/verify.js";

const dir = join(import.meta.dirname, "fixtures", "2026-11-18");
const files = ["vast-rtx4090.json", "runpod.json", "akash.json", "nosana.json"].map((f) =>
  readFileSync(join(dir, f)),
);
const hashes = files.map((f) => createHash("sha256").update(f).digest());
const BASE = "https://archive.example/raw";

function eventLogs(prices: bigint[], capacities: number[], rawHashes: Buffer[]): string[] {
  const event = CLAMP_IDL.events.find((e) => e.name === "reportSubmitted")!;
  const parts: Buffer[] = [Buffer.from(event.discriminator)];
  parts.push(Buffer.of(1)); // class_id
  parts.push(Buffer.from(Keypair.generate().publicKey.toBytes())); // reporter
  const ts = Buffer.alloc(8);
  ts.writeBigInt64LE(1_800_000_000n);
  parts.push(ts);
  for (let i = 0; i < 6; i++) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(prices[i] ?? 0n);
    parts.push(b);
  }
  for (let i = 0; i < 6; i++) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(capacities[i] ?? 0);
    parts.push(b);
  }
  for (let i = 0; i < 6; i++) parts.push(rawHashes[i] ?? Buffer.alloc(32));
  const id = CLAMP_IDL.address;
  return [
    `Program ${id} invoke [1]`,
    "Program log: Instruction: SubmitReport",
    `Program data: ${Buffer.concat(parts).toString("base64")}`,
    `Program ${id} success`,
  ];
}

const fakeConnection = (logs: string[]) =>
  ({ getTransaction: async () => ({ meta: { logMessages: logs } }) }) as unknown as Connection;

const archive: typeof fetch = async (input) => {
  const url = String(input);
  const i = hashes.findIndex((h) => url === `${BASE}/${h.toString("hex")}.json`);
  return i >= 0 ? new Response(files[i]) : new Response("not found", { status: 404 });
};

const honest = RTX4090.sources.map((s, i) => s.rule(files[i]!.toString("utf8")));

describe("verifyReport", () => {
  it("accepts an honest report", async () => {
    const logs = eventLogs(
      honest.map((r) => r.price),
      honest.map((r) => r.capacity),
      hashes,
    );
    const [check] = await verifyReport(fakeConnection(logs), "sig", [BASE], archive);
    expect(check!.ok).toBe(true);
    expect(check!.slots.map((s) => s.status)).toEqual(["match", "match", "match", "match"]);
    expect(check!.slots[0]!.recomputedPrice).toBe(484_711n);
  });

  it("flags a price that does not follow from the raw file", async () => {
    const prices = honest.map((r) => r.price);
    prices[1] = 300_000n; // RunPod really said 0.34
    const logs = eventLogs(prices, honest.map((r) => r.capacity), hashes);
    const [check] = await verifyReport(fakeConnection(logs), "sig", [BASE], archive);
    expect(check!.ok).toBe(false);
    expect(check!.slots[1]!.status).toBe("price_mismatch");
  });

  it("flags a missing raw file and a hash that matches no file", async () => {
    const wrong = [...hashes];
    wrong[2] = createHash("sha256").update("something else").digest();
    const logs = eventLogs(honest.map((r) => r.price), honest.map((r) => r.capacity), wrong);
    const [check] = await verifyReport(fakeConnection(logs), "sig", [BASE], archive);
    expect(check!.slots[2]!.status).toBe("raw_missing");
    expect(check!.ok).toBe(false);
  });

  it("flags a file whose content does not match its hash", async () => {
    const tampered: typeof fetch = async (input) => {
      const res = await archive(input);
      return String(input).includes(hashes[0]!.toString("hex")) ? new Response("{}") : res;
    };
    const logs = eventLogs(honest.map((r) => r.price), honest.map((r) => r.capacity), hashes);
    const [check] = await verifyReport(fakeConnection(logs), "sig", [BASE], tampered);
    expect(check!.slots[0]!.status).toBe("hash_mismatch");
  });

  it("treats a source that did not answer as not reported", async () => {
    const prices = honest.map((r) => r.price);
    const caps = honest.map((r) => r.capacity);
    const h = [...hashes];
    prices[3] = 0n;
    caps[3] = 0;
    h[3] = Buffer.alloc(32);
    const [check] = await verifyReport(fakeConnection(eventLogs(prices, caps, h)), "sig", [BASE], archive);
    expect(check!.slots[3]!.status).toBe("not_reported");
    expect(check!.ok).toBe(true);
  });
});
