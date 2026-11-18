// Entry of the bundled reporter (dist/reporter.mjs), used by the GitHub
// Actions schedule of reporter 2. Prints one line per class, no secrets.

import { runReporter } from "./reporter.js";

runReporter()
  .then((results) => {
    for (const r of results) {
      console.log(`${r.ok ? "ok  " : "FAIL"} ${r.action} ${r.detail}${r.signature ? ` ${r.signature}` : ""}`);
    }
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
