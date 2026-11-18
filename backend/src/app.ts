// HTTP routes (docs/architecture.md section 5). The bill proxy routes arrive in M3.

import { timingSafeEqual } from "node:crypto";

import { Connection } from "@solana/web3.js";
import { Hono } from "hono";

import { loadEnv } from "./env.js";
import { Store } from "./store.js";
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

export const app = new Hono();

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
  return c.json(json(await reportStep(connection, worker, store)));
});

app.post("/cron/record", async (c) => {
  if (!authorized(c.req.header("authorization"), loadEnv().cronSecret)) return c.json({ error: "unauthorized" }, 401);
  const { connection, store } = context();
  return c.json(json(await recordStep(connection, store)));
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// Vercel picks src/app.ts as the entry and needs the app as the default export.
export default app;
