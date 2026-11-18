import { createHash } from "node:crypto";

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { archiveMessage, signArchive, verifyArchive } from "../src/archive-auth.js";
import { HttpArchiver } from "../src/archiver.js";

const sha = createHash("sha256").update("raw answer").digest("hex");

describe("archive signatures", () => {
  const kp = Keypair.generate();

  it("verifies a signature made with a Solana keypair", () => {
    const sig = signArchive(kp, sha, 1_800_000_000);
    expect(verifyArchive(kp.publicKey.toBytes(), sha, 1_800_000_000, sig)).toBe(true);
  });

  it("rejects another key, another hash, another time and garbage", () => {
    const sig = signArchive(kp, sha, 1_800_000_000);
    expect(verifyArchive(Keypair.generate().publicKey.toBytes(), sha, 1_800_000_000, sig)).toBe(false);
    expect(verifyArchive(kp.publicKey.toBytes(), sha.replace(/^./, "0"), 1_800_000_000, sig)).toBe(false);
    expect(verifyArchive(kp.publicKey.toBytes(), sha, 1_800_000_001, sig)).toBe(false);
    expect(verifyArchive(kp.publicKey.toBytes(), sha, 1_800_000_000, "not base64!")).toBe(false);
    expect(verifyArchive(new Uint8Array(5), sha, 1_800_000_000, sig)).toBe(false);
  });

  it("signs exactly the documented message", () => {
    expect(archiveMessage(sha, 7)).toBe(`clamp-archive:${sha}:7`);
  });
});

describe("HttpArchiver", () => {
  it("sends the bytes with a verifiable signature", async () => {
    const kp = Keypair.generate();
    const bytes = new TextEncoder().encode("raw answer");
    let seen: { headers: Headers; body: Uint8Array } | null = null;
    const fake: typeof fetch = async (_url, init) => {
      seen = { headers: new Headers(init?.headers), body: new Uint8Array(init?.body as Uint8Array) };
      return Response.json({ path: `raw/${sha}.json`, sha256: sha });
    };
    const path = await new HttpArchiver("https://x/archive", kp, fake).archive({ key: "k", bytes, sha256: sha, status: 200 });
    expect(path).toBe(`raw/${sha}.json`);
    const h = seen!.headers;
    expect(h.get("x-reporter")).toBe(kp.publicKey.toBase58());
    expect(verifyArchive(kp.publicKey.toBytes(), sha, Number(h.get("x-timestamp")), h.get("x-signature")!)).toBe(true);
    expect(Buffer.from(seen!.body).toString()).toBe("raw answer");
  });

  it("fails loudly when the archive refuses", async () => {
    const fake: typeof fetch = async () => Response.json({ error: "not a registered reporter" }, { status: 403 });
    await expect(
      new HttpArchiver("https://x/archive", Keypair.generate(), fake).archive({ key: "k", bytes: new Uint8Array(1), sha256: sha, status: 200 }),
    ).rejects.toThrow(/403 not a registered reporter/);
  });
});
