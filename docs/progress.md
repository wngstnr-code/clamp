# Progress

Update this file at the end of every session and after every milestone. Newest entries go on top of the session log. Each person's sessions update only their own section and the shared sections.

## Current status

| Item | Value |
|---|---|
| Phase | **M0 in progress** (started 2026-11-18 on the user's go). Steps 1 (toolchain), 2 (repo skeleton, private GitHub repo `wngstnr-code/clamp`) 3 (empty programs that build and pass tests) 4 (devnet keypairs, funded) 5 (verifiable build of the empty `clamp`, deployed to devnet, hashes match) and 6 (Supabase project, schema and bucket) done. Step 7: reporter 3 decided (D-050, team-run on a third platform first). **M0 done for Wangsit.** Next: M1. Work goes stage by stage: after each stage, report and wait. |
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
4. ~~M1 stage 1: `math/median.rs` and `math/twap.rs`~~ (done 2026-11-18, 25 unit tests). Next: M1 stage 2, the index accounts and instructions (`initialize`, `set_class`, `init_index`, `submit_report`).

### AG (web app)

1. Scaffold `web/` and connect a devnet wallet.
2. Set up the scheduled reporter job in AG's GitHub account once the report step exists (reporter 2, D-042).
3. Start the layout of the index page. It gets real data as soon as reporter 1 writes to Supabase (M1).

### The humans

1. Create Vast.ai and RunPod accounts, rent an RTX 4090 for a small real job, make a read-only API key. Then run the two key tests in "Assumptions to verify" (A6, A8).
2. Start interviews and look for one pilot renter and one pilot GPU owner (`research.md` section 6).
3. **Register now (both AG and Wangsit, each with their own email)** at https://app.dev3pack.xyz/hackathon/register. Wait for acceptance (check spam), sign up at hack.dev3pack.xyz/auth/sign-up, then create one team in the dashboard and join it with the code (`hackathon.md` section 1). The exact submission hour will appear in the dashboard.
4. Find one outside person willing to run a reporter (a scheduled job with a key).

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
| Who runs reporters two and three | both | closed: reporter 2 is AG, reporter 3 an outside person (D-042). Still open: finding that person. |
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
| Program `clamp` (empty M0 build, verifiable, commit `6f0c0ef`, hash `c950400bc1cb0c7018f33937fe8192247dec5b8ce0f16439898fa9f0d6470682`, upgrade authority = deployer) | `wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC` | 2026-11-18 |
| Program `test-usdc` | | |
| tUSDC mint | | |
| Config, Vault | | |
| Reporter keys (public) | | |

## Repository

Not a git repo yet. No remote yet. Decide in M0 when the repo becomes public (it must be public before the deadline).

## Session log

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
