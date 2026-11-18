# Clamp architecture

Mechanics and formulas are defined in `product-spec.md`. This file explains how the system is built, and it holds the **contract between the two work areas** (section 9). Change the contract here first, then the code.

Status: written on 2026-11-17, before any code. The design choices here were approved by the team on 2026-11-17 (see `decisions.md`). Facts that still need a test are listed in `progress.md` under "Assumptions to verify". Update this file as soon as the code shows something different.

## 1. Overview

```
  GPU price APIs (Vast.ai, RunPod, Akash, Nosana)
        |                 |                  |
        v                 v                  v
  Reporter 1         Reporter 2         Reporter 3        each has its own key and
  (backend worker,   (same code, other  (same code, other  runs on its own platform
   Wangsit)           platform)          platform)
        |                 |                  |
        |  submit_report: prices, capacities, hashes of the raw responses
        v                 v                  v
  +-----------------------------------------------------+
  |  Program `clamp` (Wangsit)                          |
  |  - class config, reports, index state, observations |
  |  - series: mints, collateral, pool numbers          |
  |  - vault: shares, idle USDC, active series          |
  |  - locks: escrow of claims                          |
  +--------------------+--------------------------------+
        ^              |                      ^
        | signed tx    | accounts, events     | cranks: create, seed, settle, sweep, roll
        |              v                      |
  +-----+----------------------+     +--------+---------+     +------------------+
  |  Web app (AG)              |<----|  Backend worker  |---->|  Supabase        |
  |  Next.js on Vercel         |     |  (Wangsit)       |     |  history tables  |
  |  wallet, pages, charts     |<----+------------------+-----|  raw archive     |
  +----------------------------+                              +------------------+
        |
        | bill and earnings (read-only user key)
        v
  Vast.ai and RunPod billing APIs, through the bill proxy route of the backend
```

Rules that shape everything:

- Money logic lives only in the program. The backend never holds user funds or user keys.
- No outside oracle network. Switchboard, the planned one, shut down on 2026-09-25 (D-036). Prices come from registered reporters, and every report leaves public evidence.
- Every crank is permissionless. The worker is only the first one to send it.
- The chain is the source of truth. Supabase is a cache and an archive for charts, history and the proof page.

## 2. Repository layout

```
programs/clamp/           the main Anchor program (Rust)                         Wangsit
programs/test-usdc/       devnet-only faucet for the test USDC mint (Rust)       Wangsit
packages/sdk/             TypeScript SDK: IDL, types, PDA helpers, math, source rules, readers  Wangsit (AG consumes it)
backend/                  worker (reporter and cranks), bill proxy                Wangsit
supabase/                 Supabase CLI config and SQL migrations                  Wangsit
web/                      Next.js web app                                        AG
scripts/                  check-dashes, deploy and setup scripts                 shared
docs/                     these files                                            shared
```

One pnpm workspace at the root (`web`, `backend`, `packages/sdk`). One Cargo workspace for `programs/`.

## 3. Program `clamp`

Language: Rust with Anchor (latest stable when checked on 2026-11-17: `anchor-lang` 1.2.2). One program, one address, one IDL.

### 3.1 Accounts (sketch)

```rust
// PDA ["config"]
pub struct Config {
    admin: Pubkey,
    collateral_mint: Pubkey,        // tUSDC on devnet
    treasury: Pubkey,               // token account for protocol fees
    trade_fee_bps: u16,             // copied into each new series
    protocol_share_bps: u16,
    series_alloc_bps: u16,
    bump: u8, _reserved: [u8; 64],
}

// PDA ["class", class_id]
pub struct ClassConfig {
    class_id: u8, name: [u8; 16], enabled: bool,
    reporters: [Pubkey; 5], reporter_count: u8, min_reporters: u8,
    sources: [Source; 6], source_count: u8,
    min_sources: u8, min_total_weight: u8,
    min_price: u64, max_price: u64, max_step_ppm: u32,
    half_width_ppm: [u32; 3],       // daily, weekly, monthly
    current_series: [Pubkey; 3],    // the latest series per kind
    bump: u8, _reserved: [u8; 64],
}
pub struct Source {
    source_id: u8,                  // 1 Vast.ai, 2 RunPod, 3 Akash, 4 Nosana
    has_capacity: bool,             // false: use fixed_weight
    fixed_weight: u8,
}

// PDA ["index", class_id]
pub struct IndexState {
    class_id: u8, last_ts: i64, last_price: u64,
    cum_price: u128, cum_valid: u64,
    obs_index: u16, obs_count: u16, update_count: u64,
    reports: [Report; 5],           // the latest report of each reporter slot
    bump: u8, _reserved: [u8; 64],
}
pub struct Report {
    ts: i64, used: bool,
    prices: [u64; 6],               // by source slot, 0 = the source did not answer
    capacities: [u32; 6],
}

// PDA ["obs", class_id], zero-copy, created at full size by the setup script
// 48 bytes per entry with padding, about 98 KB, rent about 0.69 SOL per class
pub struct Observations { items: [Observation; 2048] }
pub struct Observation { ts: i64, price: u64, cum_price: u128, cum_valid: u64 }

// PDA ["series", class_id, kind, start_ts]
pub struct Series {
    class_id: u8, kind: u8, start_ts: i64, close_ts: i64, expiry_ts: i64,
    center: u64, lower: u64, upper: u64, start_index: u64,
    start_cum_price: u128, start_cum_valid: u64,
    trade_fee_bps: u16, protocol_share_bps: u16,
    up_mint: Pubkey, down_mint: Pubkey,
    collateral: Pubkey,             // USDC token account of the series
    up_vault: Pubkey, down_vault: Pubkey,   // vault-owned claims (pool + inventory)
    pairs_outstanding: u64,
    pool_up: u64, pool_down: u64, inv_up: u64, inv_down: u64,
    last_recenter_ts: i64, seeded: bool,
    settled: bool, avg: u64, up_value: u32, coverage_ppm: u32, settled_ts: i64,
    swept: bool,
    bump: u8, _reserved: [u8; 64],
}

// PDA ["vault"]
pub struct Vault {
    share_mint: Pubkey, idle: Pubkey,       // idle USDC token account
    active_series: [Pubkey; 8], active_count: u8,
    bump: u8, _reserved: [u8; 64],
}

// PDA ["lock", owner, series, side]
pub struct Lock {
    owner: Pubkey, series: Pubkey, side: u8,   // 0 UP, 1 DOWN
    claims: u64, paid: u64,
    hours: u32, ref_rate: u64,                 // display only
    auto_roll: bool, rent_payer: Pubkey, created_ts: i64,
    escrow: Pubkey,                            // token account that holds the claims
    bump: u8, _reserved: [u8; 32],
}
```

Rules for layouts: every account has reserved bytes. Never change the layout of an account type that has live accounts on devnet. If a change is unavoidable, deploy a new program address and let the old series settle.

### 3.2 PDAs

| Account | Seeds |
|---|---|
| Config | `"config"` |
| ClassConfig | `"class"`, `class_id` (u8) |
| IndexState | `"index"`, `class_id` |
| Observations | `"obs"`, `class_id` |
| Series | `"series"`, `class_id`, `kind` (u8), `start_ts` (i64, little endian) |
| UP mint, DOWN mint | `"up"`, series and `"down"`, series |
| Series collateral, UP vault, DOWN vault | `"collateral"`, series and `"upv"`, series and `"downv"`, series |
| Vault, share mint, idle USDC | `"vault"` and `"shares"` and `"idle"` |
| Lock, escrow | `"lock"`, owner, series, `side` and `"escrow"`, lock |

Ids: class `1` = RTX 4090, `2` = H100. Kind `0` = daily, `1` = weekly, `2` = monthly. Side `0` = UP, `1` = DOWN.

### 3.3 Instructions

| Instruction | Who | Spec | Notes |
|---|---|---|---|
| `initialize(params)` | admin, once | 13 | Creates Config and Vault |
| `set_class(class_id, params)` | admin | 6, 13 | Creates or updates a ClassConfig (reporters, quorum, sources, bounds, widths). Affects future updates and future series only. |
| `init_index(class_id)` | admin | 6.3 | Binds the pre-created Observations account |
| `submit_report(class_id, prices, capacities, raw_hashes)` | a registered reporter | 6.2, 6.3 | Stores the report, then updates the index when the quorum and the interval allow it |
| `create_series(class_id, kind)` | anyone | 7.1 | Creates the series, its two mints and three token accounts |
| `seed_series()` | anyone, once | 9.2 | Moves the allocation from the vault and re-centers |
| `mint_pairs(amount)` / `merge_pairs(amount)` | user | 7.2 | |
| `buy(side, usdc_in, min_out)` / `sell(side, amount, min_usdc_out)` | user | 8.3, 8.4 | Re-centers first when the index has a newer observation |
| `settle_series()` | anyone | 11 | |
| `redeem(side, amount)` | holder | 11 | |
| `deposit(amount)` / `withdraw(shares)` | user | 9.2 | Remaining accounts: every active series and its IndexState |
| `sweep_series()` | anyone | 9.2 | |
| `open_lock(...)` / `close_lock(min_usdc_out)` / `withdraw_lock_claims()` / `set_auto_roll(on)` | owner | 10.4 | |
| `roll_lock()` | anyone | 10.4 | The caller pays the rent of the new lock. It goes back to that payer when the lock closes. |

There is no instruction that moves collateral, pool or vault funds outside these rules, and none that edits a series.

### 3.4 Module layout

```
programs/clamp/src/
  lib.rs            program entry, instruction list
  state/            one file per account type
  instructions/     one file per instruction
  math/median.rs    median across reporters, weighted median with tiers  (pure, unit tested)
  math/twap.rs      running sums, sums at a time, average (pure, unit tested)
  math/pool.rs      buy, sell, exact-out cost, recenter   (pure, unit tested)
  math/vault.rs     NAV, shares                           (pure, unit tested)
  events.rs, errors.rs
```

All math is integer math with `u128` intermediates and checked operations. Pure modules must not touch accounts, so they can be tested without a validator.

### 3.5 Reporters

- A reporter is a key listed in `ClassConfig.reporters`. It runs the report step of the backend (section 5): fetch the price APIs, apply the public source rules, archive the raw responses, send `submit_report`.
- Reporters are fully automatic. Each one is a scheduled job that runs every 15 minutes without a person. Setting it up once (a key and a schedule) is the only manual step. No person types, edits or approves a number.
- The same code runs for every reporter. What differs is the key and the platform it runs on (D-042): reporter 1 is Wangsit's Vercel worker, reporter 2 is a scheduled GitHub Actions job in AG's account, reporter 3 is run by an outside person. If no outside person is found, the team runs it on a third platform and says so.
- `submit_report` stores the report in the reporter's slot of `IndexState.reports`, emits `ReportSubmitted` with the raw hashes, and then runs the update rule of spec 6.2. A report that cannot trigger an update is still stored and never fails.
- Start with one reporter and `min_reporters = 1` so the index goes live early. Add reporters two and three and raise `min_reporters` to 2 as soon as they run. The index page shows the reporter count of every update, so the early single-reporter days stay visible.
- No program instruction needs anything from outside the chain. There is nothing to verify except the reporter's signature.

Later, outside this version: reporters with a bond that can be challenged, and zkTLS proofs for single reports. A daily zkTLS spot check on the proof page is a stretch goal (`development-plan.md`).

### 3.6 Source rules (`packages/sdk/src/sources/`)

One pure function per source and class: raw API response in, `{ price, capacity }` out. The backend uses them to report. The proof page uses the same functions to recompute a report from the archived raw file.

| Class | Source | Request | Price | Capacity |
|---|---|---|---|---|
| RTX 4090 | Vast.ai | `GET https://console.vast.ai/api/v0/bundles/?q={...}` with `gpu_name eq "RTX 4090"`, `num_gpus eq 1`, `rentable`, `verified`, `type on-demand`, `limit 500` | Median of `offers[].dph_total` | Number of offers |
| RTX 4090 | RunPod | `POST https://api.runpod.io/graphql` with the `gpuTypes` query | `communityPrice` of the type `NVIDIA GeForce RTX 4090` | none |
| RTX 4090 | Akash | `GET https://console-api.akash.network/v1/gpu-prices` | `price.weightedAverage` of the model `rtx4090` | `availability.available` |
| RTX 4090 | Nosana | `GET https://api.nosana.com/api/markets/` | Median of `usd_reward_per_hour` of the markets whose name contains "4090" (six markets on 2026-11-17, $0.29 to $0.50) | none |
| H100 | Vast.ai, RunPod, Akash | same endpoints with the H100 models | set in M1 (Vast.ai lists H100 SXM, NVL and PCIE as separate names, RunPod lists three H100 types, Akash has the model `h100`) | |

All four requests were run by hand on 2026-11-17 and returned usable data.

### 3.7 Events

Anchor events, one per state change: `ReportSubmitted` (class, reporter, ts, per-source price, capacity and raw hash), `IndexUpdated` (class, ts, price, candidate, reporter count, per-source price and weight), `SeriesCreated`, `SeriesSeeded`, `PairsMinted`, `PairsMerged`, `Trade` (series, user, side, direction, usdc, claims, fee, pool numbers after), `Recentered`, `SeriesSettled` (avg, up_value, coverage), `Redeemed`, `VaultDeposit`, `VaultWithdraw`, `SeriesSwept`, `LockOpened`, `LockClosed`, `LockRolled`. The proof page and the worker read them from transaction logs.

## 4. Program `test-usdc` (devnet only)

A tiny program that is the mint authority of `tUSDC` (6 decimals). `claim()` mints 1,000 tUSDC to the caller, at most once per 24 hours per wallet (PDA `"faucet"`, wallet). It is never deployed to mainnet. The main program has no test-only instruction in its deployed build.

## 5. Backend (`backend/`)

TypeScript on Node. One small HTTP app (Hono) deployed as its own Vercel project. No user accounts, no sessions.

| Route | Called by | Does |
|---|---|---|
| `POST /cron/tick` | Supabase `pg_cron` every 15 minutes, with the `CRON_SECRET` header | Runs one tick (below) |
| `POST /cron/report` | The scheduler of another reporter | Runs only step 1 of the tick, with that reporter's key |
| `POST /bill/vast`, `POST /bill/runpod` | The web app | Bill proxy: forwards a read request to the provider with the user's key from the request header and returns the answer. Stores and logs nothing. |
| `GET /health` | Anyone | Time of the last successful tick |

One tick, in order (each step is independent and logged in `crank_runs`):

1. **Report**: fetch the four price APIs, apply the source rules, store the raw responses in the storage bucket `raw` and one row per source in `source_ticks`, then send `submit_report` for each class with the hashes of the raw responses.
2. **Record**: read the events of the last transactions of each class and store accepted index updates in `index_updates`.
3. **Crank**: `settle_series` for expired series, `sweep_series`, `create_series` plus `seed_series` when a kind has no live series, `roll_lock` for locks with auto-roll.
4. **Mirror**: upsert the `series` table from chain.

The same code runs locally with `pnpm --filter backend tick` (or `report` for step 1 only). The worker signs with a devnet-only keypair that holds a little SOL and nothing else. That key is reporter 1 and also sends the cranks.

Why the bill proxy exists: checked on 2026-11-17, the Vast.ai and RunPod APIs do not send an `Access-Control-Allow-Origin` header to foreign origins, so a browser cannot call them directly. The proxy is stateless. The web app says plainly that the key passes through our server in memory and is never stored. For users who do not want that, the web app also accepts an invoice file that is parsed in the browser only.

### 5.1 Database (Supabase, schema `public`)

Row level security: everyone can read, only the service role (the worker) can write. Schema in `supabase/migrations/` (first migration applied to the project on 2026-11-18). The tables carry check constraints for the units of spec section 5, and unique keys that make the record and mirror steps idempotent: `source_ticks (reporter, class_id, source_id, ts)`, `index_updates (signature, class_id)`, `series (address)`.

| Table | Columns | Purpose |
|---|---|---|
| `source_ticks` | `id`, `ts`, `class_id`, `source_id`, `reporter`, `price_micro`, `capacity`, `ok`, `error`, `raw_path`, `raw_sha256`, `signature` | What each reporter saw from each source at each tick, with the report transaction |
| `index_updates` | `id`, `ts`, `class_id`, `price_micro`, `candidate_micro`, `reporter_count`, `sources` (json: id, price, weight), `signature`, `slot` | Every accepted on-chain update, from the transaction events |
| `series` | `address`, `class_id`, `kind`, `start_ts`, `close_ts`, `expiry_ts`, `center`, `lower`, `upper`, `settled`, `avg`, `up_value`, `coverage_ppm`, `settle_signature` | Mirror of the chain for lists |
| `crank_runs` | `id`, `ts`, `action`, `ok`, `detail`, `signature` | Worker log |

Storage bucket `raw` (public read, JSON only, 5 MB per file): `raw/<class>/<source>/<unix ts>-<reporter>.json`, the exact bytes that were hashed.

Reporters fetch at slightly different moments, so their numbers can differ a little. That is why the program takes the median across reporters. The proof page checks the settlement math against on-chain data, and for any single report it checks file hash, recomputed price and on-chain value against each other.

## 6. SDK (`packages/sdk`)

- The generated IDL and types of both programs (copied from the Anchor build).
- PDA helpers for every row of section 3.2.
- The same math as the program in TypeScript (`median`, `twap`, `pool`, `vault`), tested against the same vectors as the Rust code, for quotes in the UI and for the proof page.
- The source rules of section 3.6.
- Readers: `getIndex(class)`, `getTwap(class, from, to)`, `getSeries`, `getLocks(owner)`, `getVault`, `verifyReport(signature)` and `verifySettlement(series)`.
- This is also the public SDK of product part 6. A Rust reader for other programs is a stretch goal.

## 7. Web app (`web/`)

Next.js (App Router) + Tailwind CSS + TypeScript, hosted on Vercel. Recommended packages (D-038, AG confirms in M0): `@solana/web3.js` 1.x with `@solana/wallet-adapter-react`, because the Anchor TypeScript client of the current release (`@anchor-lang/core` 1.2.2) is built on `@solana/web3.js` 1.x. Mixing in the newer `@solana/kit` would mean two client libraries in one app.

Data: on-chain reads and transactions through the SDK and an RPC endpoint. History and lists from Supabase with the public anon key. Nothing is hard-coded and nothing is faked: when a source or the index is down, the page says so.

| Page | Content |
|---|---|
| Landing `/` | What Clamp is, the live index number, how it works, links into the app |
| Index `/index` and `/index/[class]` | Live index, chart of history, per-source values and status at the last update, link to each update transaction |
| Bill Lock `/lock/bill` | Connect a rental account (key or invoice file), bill summary by class, user rate next to the index, proposed hours and claims, the four warnings of spec 10.3, lock in one click |
| Revenue Lock `/lock/revenue` | Same flow with earnings (Vast.ai host earnings, later Nosana job history), buys DOWN |
| Market `/market` and `/market/[series]` | Series list, band, time left, pool price, fair value, mint, merge, buy, sell, redeem |
| Vault `/vault` | Share price, NAV parts per series, deposit, withdraw, what can be withdrawn now |
| Positions `/positions` | The wallet's locks and loose claims, value now, outcome table, close, auto-roll switch, redeem |
| Proof `/proof/[series]` | Recomputes the settlement in the browser from the on-chain updates, shows coverage, per-update source values and the raw archive |
| Faucet `/faucet` | Claim tUSDC, link to a devnet SOL faucet. Always labeled as test tokens. |

Short series (daily) carry a "Short series" label everywhere.

## 8. Security model

| Threat | Mitigation |
|---|---|
| Index manipulation through one source | Weighted median over sources, empty sources left out, sanity bounds, step limit, period average for settlement |
| A reporter lies or breaks | Quorum of 2 of 3 with a median per source, sanity bounds, step limit. Every report has its raw file in public and the file hash on-chain, so a lie can be shown by anyone. |
| All reporters collude (they are the team on devnet) | Not prevented. Stated openly in the README and the spec. Evidence stays public, and the APIs are public, so anyone can run the same rules and compare. Mainnet needs outside reporters with a bond or zkTLS proofs. |
| Fake or replayed reports | Only registered reporter keys can report. A report is used in at most one update and expires after `REPORT_WINDOW`. |
| One source or all reporters go down | A missing source is left out, minimum sources and weight, `MAX_GAP` so dead time is not counted, settlement falls back to recorded data only |
| Settlement depends on who calls it | Result is computed from the observation ring at `expiry_ts`, same for everyone |
| Pool drained by informed traders | Constant-product slippage between index updates, 1% fee, pool pauses when the outcome is almost certain and after `close_ts`, vault loss per series capped by its allocation |
| Vault share price games | NAV uses the index, not the pool price. Locked first shares. Rounding in favor of the vault. |
| Rounding drain | All rounding favors the collateral and the vault. Invariant tests. |
| Wrong accounts passed in | Every account is checked by seeds, owner, mint and stored address. Token program is checked. |
| Admin abuse | No instruction touches user funds or a live series. Trust points (upgrade authority, reporter list) are stated in the README. |
| The upgrade authority deploys code nobody has seen | Every deploy is a verifiable build of a repo commit (D-041). The README gives the command that compares the on-chain program with the source. Each deploy is logged in `progress.md` with its commit and program hash. |
| User provider keys | Read-only scope asked for, passed through the proxy in memory only, never stored or logged |
| Worker key leak | Devnet-only key with a little SOL. Cranks are permissionless, so the key has no special power there. As a reporter it is one voice of the quorum, and the admin can remove it from the list. |
| Program bug | Small pure math modules with unit tests, instruction tests, invariant tests, spec read next to the code. An audit is needed before any mainnet use. |

## 9. Contract between the two work areas

This is what AG's code may rely on and what Wangsit must keep stable. Any change here is announced to the teammate and noted in `progress.md`.

| Thing | Where it is defined | Rule |
|---|---|---|
| Program interface | The IDL exported in `packages/sdk` | The web app imports types and builders from the SDK only. No hand-written copy. |
| Account fields and PDAs | Sections 3.1 and 3.2 | Field names and seeds do not change without notice |
| Events | Section 3.7 | Names and fields are stable once a page reads them |
| Units | `product-spec.md` section 5 | The SDK exposes helpers to convert to display values |
| Database tables | Section 5.1 | Column names are stable. New columns are fine. |
| Backend routes | Section 5 | Request and response shapes are written in `backend/README.md` when built |
| Env names | Section 10 | Same names in `.env`, `.env.example` and both Vercel projects |

Until a part of the program exists on devnet, AG builds the pages that read real data that already exists (the index history first) and the static layout of the rest. No page ships with invented numbers.

## 10. Env variables (one `.env` at the repo root, names only in `.env.example`)

| Name | Used by | Secret |
|---|---|---|
| `SOLANA_RPC_URL` | backend, scripts | no (may hold a provider key, keep it out of git) |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | web | no |
| `NEXT_PUBLIC_CLAMP_PROGRAM_ID`, `NEXT_PUBLIC_TEST_USDC_PROGRAM_ID`, `NEXT_PUBLIC_USDC_MINT` | web, backend | no |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | no |
| `NEXT_PUBLIC_BACKEND_URL` | web | no |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | **yes** |
| `WORKER_KEYPAIR` | backend | **yes** (devnet only). Reporter 1 and crank sender. Every other reporter sets its own key under the same name in its own deployment. |
| `CRON_SECRET` | backend, Supabase cron job | **yes** |

Secrets are set in the Vercel and Supabase dashboards by the user. They are never written into a file in the repo, into chat or into logs.

## 11. Testing strategy

| Level | Tool | What |
|---|---|---|
| Unit (Rust) | `cargo test` | Weighted median, running sums and averages, pool buy, sell, exact-out and recenter, NAV and shares, settlement values, the worked example of spec 10.2 |
| Math parity | Shared JSON test vectors | The SDK math gives the same numbers as the Rust math |
| Instruction tests | LiteSVM (Rust) | Full flows: create, seed, mint, merge, buy, sell, settle, redeem, deposit, withdraw, sweep, lock, close, roll. Every invariant of spec 14. Failure paths. Tests register their own keypairs as reporters, so no test-only code is needed in the program. |
| Attack scenarios | Same | Unregistered reporter, stale report, report used twice, lying reporter against the quorum, too few sources, step limit, trade after close, double settle, wrong accounts, vault share games, rounding |
| Source rules | Unit tests on saved real responses | Each rule gives the expected price and capacity, and fails cleanly on a broken response |
| Verified build | `solana-verify` (or the verifiable build of the installed Anchor version) | The hash of the on-chain program equals the hash built from the tagged commit |
| Devnet end to end | Scripts | Real reports from real API calls into `submit_report`, one real short series from creation to redeem |
| Web | Manual on devnet, phone width too | The demo flow of `hackathon.md` |
