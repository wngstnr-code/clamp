# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log. Each person's sessions update only their own section and the shared sections.

## Current status

| Item | Value |
|---|---|
| Phase | **M1: the index is live on devnet and updates every 15 minutes (reporter 1).** Earlier: M0 in progress (started 2026-11-18 on the user's go). Steps 1 (toolchain), 2 (repo skeleton, private GitHub repo `wngstnr-code/clamp`) 3 (empty programs that build and pass tests) 4 (devnet keypairs, funded) 5 (verifiable build of the empty `clamp`, deployed to devnet, hashes match) and 6 (Supabase project, schema and bucket) done. Step 7: reporter 3 decided (D-050, team-run on a third platform first). **M0 done for Wangsit.** Next: M1. Work goes stage by stage: after each stage, report and wait. |
| Current milestone | M1 Index live (Wangsit). AG still on M0. |
| Deadline | Sunday 2026-11-29, hour not confirmed |
| Hard dates | Index live on devnet by 2026-11-20. First weekly series created by 2026-11-21. |
| Days left | 11 (as of 2026-11-18) |

## Next step (exact)

### Shared

1. The user decides when the repo becomes public (D-046).
2. AG clones the repo once it is on GitHub (`CLAUDE.md` is in git, D-049).

### Wangsit (programs and backend)

1. ~~Install the Solana CLI and Anchor~~ (done 2026-11-18: Agave 4.4.1, Anchor 1.2.2, solana-verify 0.5.2).
2. ~~`git init`, workspaces, `.gitignore`, `.env.example`~~ (done 2026-11-18, pushed to the private repo). Step 3 done: empty `clamp` and `test-usdc` programs, `Anchor.toml`, Cargo workspace. Step 4 done: deployer, worker and two test users in `~/.config/solana/clamp/` (addresses in `build-and-deploy.md` section 2). Next: the user funds deployer and worker, then the verifiable build spike (step 5, Docker must run).
3. ~~Try a verifiable build once with an empty program and check it against devnet~~ (done 2026-11-18, hashes match). Step 6 done: Supabase project `clamp` (Singapore) linked, first migration applied, access checked. The user filled `.env` (Supabase URL, anon key, service role key), checked: anon read 200, anon write 401, service read 200.
4. ~~M1 stage 1: `math/median.rs` and `math/twap.rs`~~ (done 2026-11-18, 25 unit tests). ~~M1 stage 2: index accounts and instructions~~ (done 2026-11-18, 14 LiteSVM tests). ~~M1 stage 3: SDK and source rules~~ (done 2026-11-18). M1 stage 4 code done (2026-11-18): `backend/` with report and record steps, dry run on live data works. M1 stage 5 done (2026-11-18): the M1 program is on devnet (verifiable, hashes match), setup done, first updates sent from a laptop and verified. **The index runs on its own since 2026-11-18 11:00 UTC**: pg_cron calls `https://clamp-backend.vercel.app/cron/tick` every 15 minutes (reporter 1, quorum 1). Next: M1 stage 6, reporters 2 and 3 (raw archive per reporter, then quorum 2).

### AG (web app)

1. Scaffold `web/` and connect a devnet wallet.
3. Start the index page from the real program interface (ready since 2026-11-18, M1 stage 2). What is final for the index pages:
   - **IDL and types:** `packages/sdk/src/idl/clamp.json` and `clamp.ts` (copies of the Anchor build, refreshed by Wangsit on every program change). Use them only through `packages/sdk` (CLAUDE.md section 3), never a hand-written copy.
   - **Accounts to read:** `ClassConfig` (PDA `["class", class_id]`: name, reporters, `min_reporters`, sources, bounds), `IndexState` (PDA `["index", class_id]`: `last_price`, `last_ts`, `update_count`, `reports[]` with each reporter's latest prices), `Observations` (address in `IndexState.observations`, ring of 2,048 entries, newest at `obs_index`, `obs_count` filled). Layouts in `architecture.md` section 3.1.
   - **Events:** `ReportSubmitted` (per reporter: prices, capacities, raw hashes by source slot) and `IndexUpdated` (price, candidate before the step limit, `reporter_count`, per source `{source_id, price, capacity, weight}`, weight 0 = left out). Fields in `architecture.md` section 3.7.
   - **Units:** prices are micro-USD per GPU-hour (`340000` = $0.34), timestamps are unix seconds. Class 1 = RTX 4090, 2 = H100. Source 1 Vast.ai, 2 RunPod, 3 Akash, 4 Nosana.
   - **History for charts:** the Supabase tables `index_updates` and `source_ticks` (public read with the anon key, `architecture.md` section 5.1). They fill once reporter 1 runs (M1 stage 4).
   - Readers in `packages/sdk` (since M1 stage 3): `getIndex`, `getObservations`, `getTwap`, `twapFromObservations`, `verifyReport`, PDA helpers, class specs with a `description` per source for the index page (`RTX4090`, `H100`, `SOURCE_NAMES`). Build with `pnpm build:sdk`.
   - Not deployed yet: the devnet program still holds the empty M0 build until M1 stage 5.

### The humans

1. Create Vast.ai and RunPod accounts, rent an RTX 4090 for a small real job, make a read-only API key. Then run the two key tests in "Assumptions to verify" (A6, A8).
2. Start interviews and look for one pilot renter and one pilot GPU owner (`research.md` section 6).
3. **Register now (both AG and Wangsit, each with their own email)** at https://app.dev3pack.xyz/hackathon/register. Wait for acceptance (check spam), sign up at hack.dev3pack.xyz/auth/sign-up, then create one team in the dashboard and join it with the code (`hackathon.md` section 1). The exact submission hour will appear in the dashboard.

## Blockers and open questions

| Question | Owner | Status |
|---|---|---|
| Confirm the proposed decisions D-018 to D-039 | both | closed: all approved on 2026-11-17 (D-040), plus D-041 to D-045 |
| When the repo becomes public | user | open (D-046). Recommendation: private now, public on 2026-11-27. Others can verify the program against the source only after that. |
| When M0 starts | user | open (D-047) |
| Hackathon registration for AG and Wangsit (applications are reviewed) | user | Wangsit applied on 2026-11-17, waiting for acceptance. AG has not applied yet. Needed before anything can be submitted. |
| Exact submission hour on 2026-11-29 | user | open. FAQ says the UTC hour will be confirmed in the dashboard. The official site and FAQ give no hour. One third-party list says 23:59 "anywhere on earth" (that is 2026-11-30 18:59 WIB). Not confirmed, so plan for the evening of 2026-11-29 WIB and ask the organizers. |
| Partner tracks: does one fit without changing the product? | user | open, not announced yet |
| Name: keep Clamp although `clamp.finance` is a live crypto accounting product with the same name? | user | closed: keep it for the hackathon, no domain bought, hosted on a Vercel address (D-037) |
| X handle for the project | user | open (could not be checked without an X login) |
| Who runs reporters two and three | both | closed 2026-11-18 (D-054): team-run, reporter 2 on GitHub Actions, reporter 3 on Netlify. |
| Legal status of the product | nobody | open, stated honestly, devnet only |
| Pilot renter and pilot GPU owner | user | open |

## Assumptions to verify

The docs rely on these. Write the result here and fix the docs if the answer is no.

### Closed without code (2026-11-17)

| # | Assumption | Result |
|---|---|---|
| A1 to A4 | Switchboard can carry our four sources | **Dead.** Switchboard shut down on 2026-09-25. Replaced by our own reporters (D-036). These four assumptions no longer exist. |
| A7 | The GPU model of a rental can be found | Yes for instances that still exist: the Vast.ai instances endpoint returns `gpu_name`, `num_gpus`, `dph_total`, `start_date`, `end_date`, `duration` (docs). For destroyed instances the user confirms the class in the app. |
| A9 | Nosana host earnings can be computed from job history | Yes, tested on live data: `GET https://api.nosana.com/api/jobs?node=<address>` filters by host, `?market=<address>` by market. Finished jobs (`state` 2) carry `timeStart`, `timeEnd` and `usdRewardPerHour`. Earnings = sum of hours times rate. |
| A10 | Supabase can call the tick every 15 minutes | Yes by the docs: Supabase Cron runs jobs from every second to once a year and can make HTTP requests. Plan limits are not stated on that page, so watch the first day. Fallback stays a scheduled GitHub Actions job. |
| A11 | The observation account can be created at full size | Yes by platform rule: a top-level `createAccount` may allocate up to 10 MB. Only growth inside a program call is limited to 10 KB per instruction. Size about 98 KB, rent about 0.69 SOL per class on devnet. |
| A13 | The four price requests work as written in `architecture.md` section 3.6 | Yes, all four were run by hand and returned usable data. |
| A14 | Which client library the web app should use | `@anchor-lang/core` 1.2.2 depends on `@solana/web3.js` 1.x (D-038). |

### Still open (need an account, a key or code)

| # | Assumption | Tested in | If it fails | Status |
|---|---|---|---|---|
| A5 | Reporters on free schedulers report reliably every 15 minutes | M1 | Longer interval. `MAX_GAP` already keeps the average honest. | open |
| A6 | A scoped Vast.ai key with `billing_read` and `instance_read` can read `GET /api/v0/charges` | The humans, once the account exists: call it with the scoped key | Use invoices and earnings only (both are listed under `billing_read`) | open. The charges endpoint is in no published permission group. |
| A8 | A RunPod key with read-only rights can call `GET https://api.runpod.io/v2/billing/pods` | The humans, once the account exists | Cut RunPod bill reading (cut line 4) | open. Endpoint and bearer auth confirmed in the docs. Key scopes not found. |
| A12 | Compute use of `create_series`, `buy` with re-centering, `settle_series` and `submit_report` stays within limits | M1, M2 | Split instructions | open |
| A15 | The installed Anchor and Solana CLI versions work together | M0 | Pin the pair the Anchor release notes name | open |
| A16 | A zkTLS proof of the Vast.ai request can be made and checked in the browser within the free plan | Stretch (D-039) | Drop the stretch goal | open |
| A17 | A verifiable build works on this machine (Apple silicon, Docker), the on-chain hash on devnet matches it, and `verify-from-repo` works against devnet | M0 | Build on a Linux machine or in CI. If explorers show no badge on devnet, the hash match and the README command are the proof. | partly closed 2026-11-18: the Docker build works on this machine (with `-b` image 4.3.0) and the devnet hash matches. `verify-from-repo` waits for the public repo. |

## Milestone checklist

| Milestone | Status |
|---|---|
| M0 Setup | Wangsit part done 2026-11-18 (toolchain, repo, programs, keypairs, verifiable build, Supabase). AG part open (scaffold `web/`, wallet, client packages). |
| M1 Index live | not started |
| M2 Claim market | not started |
| M3 Bill Lock | not started |
| M4 Vault complete | not started |
| M5 Revenue Lock | not started |
| M6 Proof, SDK, auto-roll, Nosana | not started |
| M7 Submission | not started |

## Review notes

### Gap review before code (2026-11-17)

| Finding | Severity | Fix |
|---|---|---|
| **Switchboard, the oracle the whole index design stood on, shut down on 2026-09-25.** Its Crossbar and docs hosts no longer resolve. The earlier check that "closed" the oracle question read the examples repo and the package types and missed this. | high | Own reporters with a quorum, public raw files and on-chain hashes (D-036). Spec 6.2, architecture 3.5 and 3.6, plan M1 rewritten. |
| A live crypto product named Clamp exists at `clamp.finance` (accounting for finance teams). The earlier search said no crypto project had the name. | medium | Proposal to keep the name for the hackathon with a non-colliding domain (D-037). The user decides. |
| zkTLS for every report is not affordable: the free plan allows 100 fetches a month, we would need about 20,000. | info | zkTLS only as a daily spot check, as a stretch goal (D-039). |
| New market facts seen in search results: GPU compute futures have launched on a second regulated exchange, and a regulated prediction market now offers GPU compute forward curves for hedging. | medium | Added to `research.md` section 2 as "verify before the pitch". The pitch must explain why small renters still cannot use them. |

### Docs review (2026-11-17)

| Finding | Fix |
|---|---|
| The idea doc said the bill is read in the browser and the key never reaches our server. A check showed the Vast.ai and RunPod APIs block browser calls from other origins. | Bills go through a stateless proxy or an invoice file (D-030). The app must say this plainly. |
| The idea said "median with capacity weighting" without a rule. Raw capacity as weight would let Vast.ai alone decide the RTX 4090 index. | Capacity tiers 0, 1, 2 (D-020). |
| A plain pool would keep a stale price on devnet, because nobody arbitrages it. | Re-centering to the index-implied fair value once per index update (D-024). |
| A weekly series cannot settle before the deadline unless it starts by 2026-11-21. | Hard dates in the plan, and a labeled short (daily) series (D-023). |
| The pool price near expiry could be picked off when the outcome is almost known. | Trading closes at `close_ts`, and the pool pauses when fair value leaves `[P_MIN, 1 - P_MIN]`. |

## Known issues and limits

| Issue | Severity | Note |
|---|---|---|
| The oracle is our own reporters. On devnet they are run by the team. | high | Stated openly. Quorum, public raw files and on-chain hashes make every report checkable. Mainnet needs outside reporters with a bond or zkTLS proofs. Expect this question from judges (`hackathon.md` section 9). |
| No user validation yet. Nobody has confirmed they would lock. | high | Interviews and pilots are in the plan |
| Scope is large for two people in 12 days | high | Cut lines in `development-plan.md` |
| The program is upgradeable and the admin sets the reporter list | medium | Stated in the README. Mainnet needs a timelock or a frozen program. |
| The Vast.ai median is biased upward (cheap offers get rented first) | medium | The index level is not any one user's price. The app shows the user's rate next to the index. |
| H100 supply is thin (6 Vast.ai offers on 2026-11-17) | medium | RTX 4090 is the primary class |
| RunPod and Nosana are posted prices that move rarely | low | Fixed weights, median |
| Traders who see an API price before the on-chain update can trade ahead of it | medium | Slippage, the 1% fee, the step limit, and the allocation cap bound the loss. Simulate it in M2. |
| The band half widths are starting values without data behind them | medium | Recalibrate in M2 |
| The legal status is not resolved | medium | Devnet and test tokens only |
| The provider key passes through our proxy | low | Read-only scope, never stored, invoice file as the other way |
| The name is shared with another crypto product | low | D-037 |

## Devnet deployments

| Thing | Address | Date |
|---|---|---|
| Program `clamp` (M1 index, verifiable build of commit `677f254`, hash `0e65886cea8b90e9ee67e5c270046cc70d158dfb92cb05b9f717d7f47528a8af`, upgrade authority = deployer) | `wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC` | 2026-11-18 |
| Earlier `clamp` build (empty M0 program, commit `6f0c0ef`, hash `c950400b...`) | same address, replaced | 2026-11-18 |
| Program `test-usdc` | not deployed yet (M2) | |
| tUSDC mint (6 decimals, mint authority = deployer until the faucet takes it over in M2) | `7Cy32ram7nmVKVzty5Bw1Px3t9Dp2cTjXC1PmbEJdt4L` | 2026-11-18 |
| Treasury (tUSDC token account of the deployer) | `Hjfg7Qysrx2NaidVmiLxgmCUT6o9mfnbG8tCsrrJkvif` | 2026-11-18 |
| Config | `7yFBESGPYcdomHUBCwgE33im7fGYdu4GqPCzoDLqKZk2` | 2026-11-18 |
| Class 1 RTX 4090: ClassConfig, IndexState | `DNu7f1q7gH6Je7DzBszCDouadGYfZnTUhYxsAhU5stpa`, `AALSnfuAPegBmMthTWJ8KEXFEbz8LcgdfDbw997j3sTq` | 2026-11-18 |
| Class 2 H100: ClassConfig, IndexState | `2ADhvfNd62U51EKMmPWFYNVRWbHjjxxed2S1wth3HaSW`, `8ZAzFLdgjjnhQzb7rHUy3ELsVqyrLqNxtKSjtZv6uH62` | 2026-11-18 |
| Reporters | class 1 and 2: worker `FxgwWh2iMLftA5PNTKCoXyDv9BN6JbERg16Qj4f8r2Bn` only, `min_reporters = 1` | 2026-11-18 |
| First index updates | RTX 4090 $0.3636 (tx `5v9i2za1...`), H100 $2.71 (tx `e9hoHr6S...`), both checked with `pnpm verify`: every source matches its public raw file | 2026-11-18 |

## Repository

Not a git repo yet. No remote yet. Decide in M0 when the repo becomes public (it must be public before the deadline).

## Session log

### 2026-11-18, M1 backend live (Wangsit)

- Vercel project `clamp-backend` created by Claude with the user's approval (root `backend/`, Node 24, Hono, Git repo connected). The user set `WORKER_KEYPAIR`, `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` from a terminal (values read from files, never shown). `CRON_SECRET` is kept in `~/.config/solana/clamp/cron-secret.txt`.
- Two runtime fixes: pinned `rpc-websockets` 9.3.10 (9.3.9 `require()`s the ESM-only uuid 14, rejected by the Vercel runtime), and `export default app` in `src/app.ts` (Vercel's chosen entry).
- pg_cron job `clamp-tick` every 15 minutes (migration, secret read from Supabase Vault). The 10:45 UTC run was refused (401) because the Vault entry was created 25 s later; the 11:00 UTC run succeeded: RTX 4090 $0.3636, H100 $2.69.

### 2026-11-18, M1 stage 5 (Wangsit)

- Verifiable build of the M1 program (commit `677f254`, hash `0e65886c...`), upgraded on devnet (program grew from 54 KB to 354 KB), on-chain hash equals the local hash.
- `pnpm setup:devnet` (`backend/src/setup-devnet.ts`, idempotent, devnet only): tUSDC mint, treasury, `initialize`, `set_class` for RTX 4090 and H100 (reporter = worker, quorum 1), Observations accounts plus `init_index`. Observations rent is 0.417 SOL per class (less than estimated).
- First tick from a laptop: RTX 4090 $0.3636, H100 $2.71. Supabase holds 8 source rows, 2 index updates and the crank log. `pnpm verify <signature>` matched every source of both reports against the public raw files. The SDK reads the index from devnet.
- Fixed: the record step counted setup transactions (no events) as new.

### 2026-11-18, M1 stage 4 (Wangsit)

- `backend/` (Hono, Node 24): `fetch-sources.ts` (each distinct request once, 15 s timeout, rules applied), `store.ts` (content-addressed raw upload, idempotent upserts, crank log), `events.ts` (event rows), `chain.ts` (`submit_report`), `tick.ts` (report and record steps), `app.ts` (routes with Bearer `CRON_SECRET`), `cli.ts` (tick, report, record, dry-run).
- SDK: `BN` (from bn.js) and `KeypairWallet` exported, because Node loads `@anchor-lang/core` as CommonJS without those named exports.
- `pnpm dry-run` on live data: RTX 4090 Vast.ai $0.50 (55 offers), RunPod $0.34, Akash $0.34 (0 available), Nosana $0.3636; H100 $2.40, $2.69, $2.73 (13 available), $1.19. 8 backend tests pass.

### 2026-11-18, M1 stage 3 (Wangsit)

- Saved the real answers of all four price APIs (`packages/sdk/test/fixtures/2026-11-18/`). Nosana now lists H100 markets. The user chose H100 = SXM plus Nosana (D-053).
- `packages/sdk`: constants, PDA helpers, typed program client, the index math mirrored from Rust, source rules and class specs, `getIndex`, `getObservations`, `getTwap`, `verifyReport` (content-addressed raw files, D-053). 60 Vitest tests: shared vectors, rules on real data (RTX 4090 $0.3636, H100 $2.69, values checked separately in Python), broken answers, account decoders against Anchor's coder, and `verifyReport` with honest, wrong-price, missing, tampered and not-reported slots.
- Rust reads the same vectors (`tests/test_vectors.rs`, 6 tests): program and SDK compute the same numbers.

### 2026-11-18, M1 stage 2 (Wangsit)

- Program: `Config`, `ClassConfig`, `IndexState`, `Observations` and the instructions `initialize`, `set_class`, `init_index`, `submit_report` with the events `ReportSubmitted` and `IndexUpdated`, following spec 6.2 and 6.3.
- Contract changes (D-051, D-052, `architecture.md` 3.1 to 3.3 and 3.7 updated): Observations is a keypair account bound in `IndexState.observations` with 40-byte entries; `IndexState.reports[i].reporter` added; `initialize` only by the upgrade authority and without the Vault; sources fixed per class. **AG: the IDL and the event fields for the index pages are now real (`target/idl/clamp.json`).**
- 14 LiteSVM tests, each failure path checked against its exact error: upgrade authority only, params ranges, admin only, sources locked, ring size and owner and binding (including another class's valid ring), unregistered reporter, unused slots, disabled class, weighted median, interval, step limit both ways, quorum of 2 with a median per source, stale reports, used reports, too few sources or weight, out-of-bounds prices, a replaced reporter, the max gap, and a ring wrap after 2,050 updates. An update costs about 15,000 compute units.

### 2026-11-18, M1 stage 1 (Wangsit)

- Pure math in `programs/clamp/src/math/`: median and weighted median with capacity tiers, combining reporters per source with sanity bounds and quorum, step limit (bounds round inward), running sums, sums at a time, period average, coverage, and a binary search in the observation ring. 25 unit tests, including a randomized check of the weighted median against an expanded plain median and a check of the ring search against a linear scan for every ring state. Clippy clean with `-D warnings`.
- Spec 6.2 now states the rounding of the two middle values and of the step limit bounds.

### 2026-11-18, M0 steps 1 to 7 (Wangsit)

- Step 7: the user chose to start reporter 3 as a team-run job on a third platform (D-050). `.env` filled by the user and checked (the format `NAME =value` was normalized to `NAME=value`).

- Step 6: the user created the Supabase project `clamp` (Singapore, automatic API grants off, automatic RLS on) and logged the CLI in. Supabase CLI 3.2.0 added as a root dev dependency. First migration: `source_ticks`, `index_updates`, `series`, `crank_runs` with RLS (public read, service role write), check constraints, unique keys, and the public `raw` bucket. Verified with the anon key (read 200, write 401) and read-only SQL. Migrations live in `supabase/` at the root, not `backend/supabase/` as first planned.

- Step 5: Docker runs through Colima (Rosetta). `solana-verify build` failed with its default image (3.0.1, Cargo too old) and worked with `-b solanafoundation/solana-verifiable-build:4.3.0`. Deployed the empty `clamp` to devnet; the on-chain hash equals the local hash (`c950400b...`). Balances after funding and the deploy: deployer about 15.7 SOL, worker about 2 SOL, test users 1 SOL each. The Solana CLI default keypair is now the deployer.

- Step 4: created the deployer, worker and two test user keypairs (public addresses in `build-and-deploy.md`). All have 0 SOL until the user funds them.

- Step 3: Cargo workspace, `Anchor.toml` (Anchor 1.2.2, Solana 4.4.1, pnpm, devnet), empty `clamp` and `test-usdc` programs with fixed program ids, one LiteSVM test per program (the program loads under its id). `anchor build`, `cargo test` and `cargo fmt --check` pass. LiteSVM stays on 0.15.0 through the template lock file (newer needs rustc 1.98.1). The Solana CLI was pointing to mainnet and now points to devnet.

- Step 2: `git init` on `main`, `.gitignore` (secrets and build output only), `.env.example`, pnpm workspace, `rust-toolchain.toml` (1.96.0), `.nvmrc`. `CLAUDE.md` is now tracked (D-049). Three commits pushed to the private repo `wngstnr-code/clamp`. `Anchor.toml` and the Cargo workspace move to step 3, together with the programs.

- The user gave the go for M0 and asked to work stage by stage, reporting after each stage.
- Installed Agave 4.4.1, AVM and Anchor 1.2.2, solana-verify 0.5.2. Versions and commands are in `build-and-deploy.md` section 1.
- Docker is installed but was not running. It must run for the verifiable build (step 5).
- Timing decided (D-048): M0 to M2 before the hackathon, M3 to M7 during it.

### 2026-11-17, decisions (Wangsit)

- The user approved all 28 listed decisions (D-018 to D-039 and the plan points), with these changes: the deployed program must be verified (D-041), the repo-public date stays open (D-046), M0 waits for the user's go (D-047).
- Answered the question on reporters: they are automatic scheduled jobs, never manual (D-042).
- Removed the "proposed" marks from the spec and updated the architecture, plan, deploy guide, hackathon notes and `CLAUDE.md`.
- Updated the idea document `Clamp - Ide Final.pdf` (oracle, bill reading, short series, verified program).

### 2026-11-17, gap review (Wangsit)

- Checked every open question and assumption that needs no code. Results are in "Assumptions to verify" and "Review notes" above.
- Largest finding: Switchboard is gone. Replaced the oracle design with our own reporters (D-036) in the spec, the architecture, the plan and `CLAUDE.md`.
- Other results: Nosana earnings are computable (tested live), the four price requests work, the web client packages are settled, the observation account size is fine, a name collision exists, the submission hour is still not official.
- Not done, on purpose: no install, no `git init`, no accounts created. Those start M0.

### 2026-11-17, docs (Wangsit)

- Wrote `CLAUDE.md` in the style of the earlier project, with a team section (AG frontend, Wangsit programs and backend). Copied `scripts/check-dashes.mjs`.
- Wrote the docs: `product-spec.md`, `architecture.md`, `development-plan.md`, `decisions.md`, `hackathon.md`, `research.md`, `build-and-deploy.md`, this file.
- Design choices made at this stage are logged as proposed (D-018 to D-035).

### 2026-11-16 to 2026-11-17 (Wangsit)

- Researched the hackathon, the market and past winners. Looked at about 300 winning projects from other ecosystems.
- Chose the idea, the name and the final product form. The full idea document is `Clamp - Ide Final.pdf` (Indonesian, 11 pages, kept outside the repo).
- Checked four price sources live and the billing APIs.
