# Clamp development plan

Submissions close on **Sunday 2026-11-29**: the dashboard schedules the submission at 12:00 to 14:00 WIB, so plan to be done by 12:00 WIB (see `hackathon.md`). The hackathon window is 2026-11-27 to 2026-11-29. Work before 27 November is allowed and must be listed honestly in the README as "built before the hackathon".

Every milestone has tasks per person and a "done when". Track status in `progress.md`, not here. Dates are targets. Two dates are hard, because the demo needs real history:

| Hard date | What | Why |
|---|---|---|
| **2026-11-20** | The index updates on devnet every 15 minutes | Gives more than a week of real index history by submission |
| **2026-11-21** | The first weekly series is created on devnet | It settles on 2026-11-28, in time for the demo video |

If the weekly series slips, the settled series in the demo is a short (daily) series, and the README says so.

**What is built when (D-048).** M0, M1 and M2 are built before the hackathon. M3 to M7 are built during the hackathon window, 2026-11-27 to 2026-11-29. The README lists M0, M1 and M2 as "built before the hackathon".

Owners: **W** = Wangsit (programs, backend), **AG** = AG (web app), **U** = things only the humans can do.

## M0: Setup and spikes (2026-11-17 to 2026-11-18)

- [ ] W: install the Solana CLI and Anchor, record the versions in `build-and-deploy.md`
- [ ] W: `git init`, pnpm workspace, Cargo workspace, `.gitignore`, `.env.example`, local exclude for `CLAUDE.md` and `.claude/`
- [ ] W: devnet keypairs (deployer, crank, test users), funded from the faucet by the user
- [ ] W: Supabase project, tables of `architecture.md` section 5.1, read-only policies
- [x] W: decide where reporters two and three run and who runs them (`architecture.md` section 3.5, D-054: team-run on GitHub Actions and Netlify).
- [ ] AG: scaffold `web/` (Next.js, Tailwind, TypeScript), wallet connection on devnet, base layout and design direction
- [ ] AG: pick the Solana client and wallet packages, record them in `decisions.md`
- [ ] U: create Vast.ai and RunPod accounts, rent an RTX 4090 for a small real job, create a read-only API key (needed to build and test the bill reader with a real bill)
- [ ] U: start the user interviews and look for one pilot renter and one pilot GPU owner (`research.md` section 6)
- [x] U: confirm the proposed decisions in `decisions.md` (done 2026-11-17, D-040)
- [ ] U: decide when the repo becomes public (D-046)
- [ ] W: try a verifiable build once with an empty program and check it against devnet, so the steps are known before the first real deploy (D-041)

Done when: both people can build and run their area, and a verifiable build has been checked once.

M0 started on 2026-11-18 (D-047).

## M1: Index live (2026-11-18 to 2026-11-20)

- [x] W: `math/median.rs` and `math/twap.rs` with unit tests
- [x] W: `initialize`, `set_class`, `init_index`, `submit_report`, events
- [x] W: source rules for RTX 4090 and H100 in the SDK, tested on saved real responses. Class configs on devnet.
- [x] W: backend tick steps 1 and 2 (report, record), deployed, triggered every 15 minutes. Reporter 1 live with `min_reporters = 1`. (2026-11-18, ahead of the 2026-11-20 hard date)
- [x] W: reporters 2 and 3 live on other platforms, then `min_reporters = 2`
- [x] W: SDK: IDL, PDA helpers, `getIndex`, `getTwap`, `verifyReport`
- [ ] AG: index pages: live number, history chart, per-source table with status, reporter count per update, links to update transactions and raw files
- [ ] AG: landing page first version with the live index number

Done when: the index page shows real on-chain updates for RTX 4090 arriving on their own for 24 hours, each with its source values and reporter count, a missing source is shown as missing, and one report has been checked by hand (raw file, hash, recomputed price, on-chain value).

## M2: Claim market (2026-11-20 to 2026-11-22)

- [x] W: `test-usdc` faucet program and the tUSDC mint
- [x] W: `math/pool.rs`, `math/vault.rs` with unit tests, including the worked example of spec 10.2
- [ ] W: `create_series`, `seed_series`, `mint_pairs`, `merge_pairs`, `buy`, `sell`, `settle_series`, `redeem` (done 2026-11-18)
- [x] W: vault core: `deposit`, NAV, `sweep_series` (also `withdraw`)
- [ ] W: instruction tests for every invariant touched
- [ ] W: backend tick step 3 (create, seed, settle, sweep) and step 4 (mirror)
- [ ] W: recalibrate the half widths from the index history so far
- [ ] W: create the first daily series, then the first **weekly** series (hard date 2026-11-21)
- [ ] AG: faucet page, market pages (series list, mint, merge, buy, sell, redeem), SDK math for quotes

Done when: on devnet a short series has gone from creation to settlement and redeem with real transactions, and the pair invariant holds in tests.

## M3: Bill Lock (2026-11-27 to 2026-11-28)

- [ ] W: `open_lock`, `close_lock`, `withdraw_lock_claims`, `set_auto_roll`, tests
- [ ] W: bill proxy routes for Vast.ai and RunPod, bill parser (hours, cost and rate per class)
- [ ] W: SDK: `getLocks`, lock sizing helper
- [ ] AG: Bill Lock page: connect by key or invoice file, bill summary, rate next to the index, proposed size, warnings, one-click lock
- [ ] AG: positions page: locks, outcome table, close

Done when: a real Vast.ai bill is read with a read-only key, and a lock sized from it is opened and closed on devnet.

## M4: Vault complete (2026-11-28)

- [ ] W: `withdraw`, allocation cap, active series list checks, vault tests (share games, rounding)
- [ ] AG: vault page: share price, NAV parts, deposit, withdraw, available now

Done when: a second wallet deposits, a series runs and is swept, and both depositors withdraw their correct share.

## M5: Revenue Lock (2026-11-28)

- [ ] W: earnings reader for Vast.ai hosts
- [ ] AG: Revenue Lock page (mirror of Bill Lock, buys DOWN)

Done when: an owner flow opens a DOWN lock on devnet, sized from real earnings data or, if no pilot owner is available yet, from hours typed in by the user (shown as typed in).

## M6: Proof, SDK, auto-roll, Nosana (2026-11-28 to 2026-11-29)

- [ ] W: `verifySettlement` in the SDK, `roll_lock` with tests, roll step in the tick
- [ ] W: Nosana host earnings from the public job history (the API was tested on 2026-11-17, see `research.md` section 3)
- [ ] W: SDK readme with a short example
- [ ] AG: proof page, auto-roll switch, Nosana earnings in Revenue Lock

Done when: the proof page recomputes a settled series and matches the chain, and one lock has rolled into a new series on its own.

## M7: Submission (2026-11-27 to 2026-11-29)

- [ ] Both: full run of the demo flow on devnet and at phone width, fix what breaks
- [ ] W: README with exact "do X, see Y" steps, a "built before" and "built during" section, honest limits, tools used
- [ ] W: license file (MIT), repo public, final deploy as a verifiable build, program addresses and the verify command in the README
- [ ] W: run the verify command from a clean clone and paste its output into `progress.md`
- [ ] AG: screenshots, final polish, live link
- [ ] Both: demo video under 3 minutes following `hackathon.md` section 7
- [ ] U: submit the form. Apply to the accelerator if wanted (deadline 2026-12-03).
- [ ] Final check: `node scripts/check-dashes.mjs`, all tests pass, hosted demo works, deep review done

## Stretch goals (only after M6 works)

| Priority | Item | Why |
|---|---|---|
| 1 | A daily zkTLS proof per class for the Vast.ai request, checked on the proof page (D-039) | Outside evidence that a report matches the provider's real answer |
| 2 | Rust reader crate for the index | Makes "other programs can read the index" concrete |
| 3 | Reference list prices from providers without a price API, shown on the index page only (not in the on-chain index) | More context for users |
| 4 | A third GPU class | Shows the design scales |

## Cut lines (if we fall behind)

Drop in this order:

1. Stretch goals
2. Nosana earnings (keep Vast.ai earnings)
3. Auto-roll
4. RunPod bill reading (keep Vast.ai)
5. H100 class in the market (keep it on the index page)
6. Monthly series in the web app
7. Revenue Lock reading earnings by API (the owner types in hours, clearly shown as typed in)

If the second and third reporter are not live in time, the index runs with one reporter and the README, the index page and the pitch say so.

Never cut: a verified program (D-041), the real on-chain index from real sources, the public raw file and on-chain hash for every report, mint, merge, settle and redeem with real devnet transactions, one settled series, a real bill read in Bill Lock, the proof page for that settled series, README steps, the demo video.

## Non-code work that decides the result

| Task | Owner | Target |
|---|---|---|
| 10 or more interviews with GPU renters, with their bill numbers | U | before 2026-11-27 |
| One named pilot renter and one named pilot GPU owner who try it on devnet | U | before 2026-11-27 |
| A small real GPU bill of our own from testing | U | M0 |
| Check the hackathon site for partner tracks and the exact deadline hour | U | 2026-11-26 |
