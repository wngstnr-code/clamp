// HTTP routes (docs/architecture.md section 5).

import { timingSafeEqual } from "node:crypto";

import { CLASSES, classPda, clampProgram, sha256Hex } from "@clamp/sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { BillError, billWindow, earningsRequest, providerKey, runpodBill, vastBill, vastEarnings, type Fetch } from "./bill-proxy.js";
import { ARCHIVE_MAX_AGE_SECS, ARCHIVE_MAX_BYTES, verifyArchive } from "./archive-auth.js";
import { loadEnv } from "./env.js";
import { Store } from "./store.js";
import { crankStep, mirrorStep } from "./crank.js";
import { recordStep, reportStep, tick } from "./tick.js";

const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

function authorized(header: string | undefined, secret: string | null): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function context() {
  const env = loadEnv();
  if (!env.worker) throw new Error("WORKER_KEYPAIR is not set");
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("Supabase is not configured");
  return {
    env,
    worker: env.worker,
    connection: new Connection(env.rpcUrl, "confirmed"),
    store: Store.connect(env.supabaseUrl, env.supabaseServiceKey),
  };
}

/** Registered reporter keys of every class, cached for a minute. */
let reporterCache: { at: number; keys: Set<string> } | null = null;
async function registeredReporters(connection: Connection): Promise<Set<string>> {
  if (reporterCache && Date.now() - reporterCache.at < 60_000) return reporterCache.keys;
  const program = clampProgram(connection);
  const keys = new Set<string>();
  for (const spec of Object.values(CLASSES)) {
    const cls = await program.account.classConfig.fetchNullable(classPda(spec.classId));
    if (!cls) continue;
    for (const r of cls.reporters.slice(0, cls.reporterCount)) keys.add(r.toBase58());
  }
  reporterCache = { at: Date.now(), keys };
  return keys;
}

export const app = new Hono();

/**
 * Bill proxy (M3). Any origin may call it: it holds no session and no secret
 * of ours, and it only works with the caller's own provider key. The key and
 * the answer are never logged or stored.
 */
const providerCors = cors({ origin: "*", allowMethods: ["POST"], allowHeaders: ["Content-Type", "X-Provider-Key"], maxAge: 600 });
app.use("/bill/*", providerCors);
app.use("/earnings/*", providerCors);
for (const [provider, read] of [
  ["vast", vastBill],
  ["runpod", runpodBill],
] as const) {
  app.post(`/bill/${provider}`, async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const key = providerKey(c.req.header("x-provider-key"));
      const body = await c.req.json().catch(() => ({}));
      const { from, to } = billWindow(body, Math.floor(Date.now() / 1000));
      return c.json(await read(fetch as Fetch, key, from, to));
    } catch (e) {
      if (e instanceof BillError) {
        return c.json({ error: e.code, providerStatus: e.providerStatus ?? null }, e.status as 400 | 401 | 502);
      }
      // a timeout or a network error: say so without echoing anything of the request
      return c.json({ error: "provider_unreachable" }, 504);
    }
  });
}

/** Host earnings proxy (M5, Revenue Lock): same rules as the bill proxy. */
app.post("/earnings/vast", async (c) => {
  c.header("Cache-Control", "no-store");
  try {
    const key = providerKey(c.req.header("x-provider-key"));
    const { days, userId } = earningsRequest(await c.req.json().catch(() => ({})));
    return c.json(await vastEarnings(fetch as Fetch, key, days, userId));
  } catch (e) {
    if (e instanceof BillError) {
      return c.json({ error: e.code, providerStatus: e.providerStatus ?? null }, e.status as 400 | 401 | 502);
    }
    return c.json({ error: "provider_unreachable" }, 504);
  }
});

/**
 * Shared raw archive (D-054). The file is stored under the SHA-256 of the
 * bytes, so nobody can change a file behind an on-chain hash. Only signed
 * uploads from registered reporters are accepted.
 */
app.post("/archive", async (c) => {
  const env = loadEnv();
  if (!env.supabaseUrl || !env.supabaseServiceKey) return c.json({ error: "not configured" }, 500);
  const reporter = c.req.header("x-reporter") ?? "";
  const ts = Number(c.req.header("x-timestamp"));
  const signature = c.req.header("x-signature") ?? "";
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(ts) || Math.abs(now - ts) > ARCHIVE_MAX_AGE_SECS) return c.json({ error: "stale timestamp" }, 400);

  let key: PublicKey;
  try {
    key = new PublicKey(reporter);
  } catch {
    return c.json({ error: "bad reporter key" }, 400);
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > ARCHIVE_MAX_BYTES) return c.json({ error: "bad size" }, 413);
  const sha256 = await sha256Hex(bytes);
  if (!verifyArchive(key.toBytes(), sha256, ts, signature)) return c.json({ error: "bad signature" }, 401);

  const connection = new Connection(env.rpcUrl, "confirmed");
  if (!(await registeredReporters(connection)).has(key.toBase58())) return c.json({ error: "not a registered reporter" }, 403);

  const store = Store.connect(env.supabaseUrl, env.supabaseServiceKey);
  const path = await store.archive({ key: sha256, bytes, sha256, status: 200 });
  return c.json({ path, sha256 });
});

app.get("/health", async (c) => {
  const env = loadEnv();
  if (!env.supabaseUrl || !env.supabaseServiceKey) return c.json({ ok: false, error: "not configured" }, 500);
  const store = Store.connect(env.supabaseUrl, env.supabaseServiceKey);
  const lastReport = await store.lastSuccess("report");
  return c.json({ ok: true, lastReport, reporter: env.worker?.publicKey.toBase58() ?? null });
});

app.post("/cron/tick", async (c) => {
  if (!authorized(c.req.header("authorization"), loadEnv().cronSecret)) return c.json({ error: "unauthorized" }, 401);
  const { connection, worker, store } = context();
  return c.json(json(await tick(connection, worker, store)));
});

app.post("/cron/report", async (c) => {
  if (!authorized(c.req.header("authorization"), loadEnv().cronSecret)) return c.json({ error: "unauthorized" }, 401);
  const { connection, worker, store } = context();
  return c.json(json(await reportStep(connection, worker, store, store)));
});

app.post("/cron/record", async (c) => {
  if (!authorized(c.req.header("authorization"), loadEnv().cronSecret)) return c.json({ error: "unauthorized" }, 401);
  const { connection, store } = context();
  return c.json(json(await recordStep(connection, store)));
});

app.post("/cron/crank", async (c) => {
  if (!authorized(c.req.header("authorization"), loadEnv().cronSecret)) return c.json({ error: "unauthorized" }, 401);
  const { connection, worker, store } = context();
  const crank = await crankStep(connection, worker, store);
  return c.json(json([...crank, await mirrorStep(connection, store)]));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// Vercel picks src/app.ts as the entry and needs the app as the default export.
export default app;
