// Where a reporter puts its raw answers. Reporter 1 writes to the Supabase
// bucket directly; reporters 2 and 3 upload through POST /archive (D-054).

import type { Keypair } from "@solana/web3.js";

import { signArchive } from "./archive-auth.js";
import type { RawAnswer } from "./fetch-sources.js";

export interface Archiver {
  /** Stores the answer under its hash and returns the archive path. */
  archive(answer: RawAnswer): Promise<string>;
}

export const DEFAULT_ARCHIVE_URL = "https://clamp-backend.vercel.app/archive";

export class HttpArchiver implements Archiver {
  constructor(
    private readonly url: string,
    private readonly reporter: Keypair,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async archive(answer: RawAnswer): Promise<string> {
    const ts = Math.floor(Date.now() / 1000);
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-reporter": this.reporter.publicKey.toBase58(),
        "x-timestamp": String(ts),
        "x-signature": signArchive(this.reporter, answer.sha256, ts),
      },
      body: answer.bytes as BodyInit,
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
    if (!res.ok || !body.path) throw new Error(`archive upload failed: HTTP ${res.status} ${body.error ?? ""}`);
    return body.path;
  }
}
