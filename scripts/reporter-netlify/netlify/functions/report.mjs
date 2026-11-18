// Clamp Index reporter 3: every 15 minutes, ten minutes after reporter 1.
// reporter-lib.mjs is the bundled Clamp reporter (backend/src/reporter.ts).
import { runReporter } from "../../reporter-lib.mjs";

export default async () => {
  try {
    const results = await runReporter(process.env);
    for (const r of results) {
      console.log(`${r.ok ? "ok  " : "FAIL"} ${r.action} ${r.detail}${r.signature ? ` ${r.signature}` : ""}`);
    }
    return new Response(JSON.stringify(results), { status: results.every((r) => r.ok) ? 200 : 500 });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return new Response("reporter failed", { status: 500 });
  }
};

export const config = { schedule: "10,25,40,55 * * * *" };
