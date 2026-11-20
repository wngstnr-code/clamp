# Build and deploy

Status on 2026-11-18: the toolchain is installed on Wangsit's machine (section 1). Nothing is built yet. Every command below is marked **not run yet** until someone has run it once on this project. When you run one, fix it if needed, remove the mark, and add it to the "Key commands" table in `CLAUDE.md`.

## 1. Toolchain

| Tool | Pinned version | Installed on Wangsit's machine (2026-11-18) |
|---|---|---|
| Rust (host) | 1.96.0 | yes |
| Solana CLI (Agave) | **4.4.1** | yes, `~/.local/share/solana/install/active_release/bin` |
| cargo-build-sbf | 4.5.0 (ships with the CLI), platform tools v1.57, SBF Rust 1.95.0 | yes |
| Anchor CLI | **1.2.2**, through AVM 1.2.2 | yes, `~/.cargo/bin` |
| solana-verify | **0.5.2** | yes, `~/.cargo/bin` |
| Docker | 29.6.2 (needed by `solana-verify build`) | installed, must be running |
| Node | 24.1.0 | yes |
| pnpm | 10.33.0 | yes |

Install commands (run on 2026-11-18, macOS arm64):

```
sh -c "$(curl -sSfL https://release.anza.xyz/v4.4.1/install)"
cargo install --git https://github.com/otter-sec/anchor --tag v1.2.2 avm --locked --force
avm install 1.2.2 && avm use 1.2.2
cargo install solana-verify --version 0.5.2 --locked
```

Notes: the Anchor repository now lives at `github.com/otter-sec/anchor` (the docs link there). The Solana installer adds its `bin` folder to `~/.zprofile`; open a new terminal after installing. The versions are pinned in the repo (`Anchor.toml`, `rust-toolchain.toml`, `packageManager`) in M0 step 2.

AG needs Node and pnpm for the web app. AG needs the Solana CLI only to make a devnet wallet.

## 2. Accounts, keys and the single env file

- Network: devnet only.
- Keypairs live in the local Solana keychain (`~/.config/solana/`). Never print them, never commit them.

| Keypair | Purpose |
|---|---|
| deployer | Deploys and upgrades the programs, is the config admin |
| worker | Reporter 1 and crank sender. Holds a little SOL and nothing else. Its secret is also set as `WORKER_KEYPAIR` in the backend's Vercel project by the user. |
| reporter 2, reporter 3 | One key per extra reporter, each kept by the person who runs that reporter and set as `WORKER_KEYPAIR` in that reporter's own deployment |
| test users (2 or 3) | Manual tests of renter, owner and depositor flows |

- Claude may create the keypairs. The user funds them from a devnet faucet.

Created on 2026-11-18 on Wangsit's machine, in `~/.config/solana/clamp/` (mode 600, outside the repo). Public addresses only:

| Keypair | File | Address | Funding target (devnet) |
|---|---|---|---|
| deployer | `deployer.json` | `ANyoPJpRbXGBTGkBRJxCN8SisTDJ3Z3NrUCvM9kKHXCF` | about 10 SOL (two program deploys, two Observations accounts at about 0.69 SOL each) |
| worker | `worker.json` | `FxgwWh2iMLftA5PNTKCoXyDv9BN6JbERg16Qj4f8r2Bn` | 1 to 2 SOL (fees for reports and cranks) |
| test user 1 | `test-user-1.json` | `H9n83SRkhNkdMGnbsiY2BLxjn5VhqpbRhqwdvPZu8p6a` | 1 SOL, from M2 on |
| test user 2 | `test-user-2.json` | `EfGgf2DTSc2Uc6XRs9a792nJvwrF8u7tsmHEmjmnRfhY` | 1 SOL, from M2 on |

Check balances: `solana balance <address> --url devnet`.
- One env file: `.env` at the repo root, gitignored. `.env.example` lists the names only. The names are in `architecture.md` section 10.
- `CLAUDE.md` is tracked in git (D-049). `.gitignore` keeps secrets (`.env`, keypair files) and build output out.
- Repo: private GitHub repo `wngstnr-code/clamp`, branch `main`. Clone it with `gh repo clone wngstnr-code/clamp`, then `pnpm install`.

## 3. Programs

Program ids (keypairs kept outside the repo in `~/.config/solana/clamp/`, never committed):

| Program | Id |
|---|---|
| `clamp` | `wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC` |
| `test_usdc` | `5QZihvTBjqZkmbX2gFcQjqnNBBq1AB3W8nRD2VeVUZLP` |

Before the first build on a fresh clone, copy the program keypairs into `target/deploy/` so Anchor keeps the same ids (only the person who deploys needs them):

```
mkdir -p target/deploy
cp ~/.config/solana/clamp/clamp-program-keypair.json target/deploy/clamp-keypair.json
cp ~/.config/solana/clamp/test_usdc-program-keypair.json target/deploy/test_usdc-keypair.json
```

Run on 2026-11-18:

```
# build both programs, the IDL (target/idl) and the TS types (target/types)
anchor build

# unit tests and LiteSVM instruction tests (needs the .so files from anchor build)
cargo test

# format check
cargo fmt --all -- --check
```

Not run yet:

```
# deploy to devnet
anchor deploy --provider.cluster devnet
```

Dependency note: LiteSVM is pinned to 0.15.0 with the `Cargo.lock` from the Anchor 1.2.2 template. Newer LiteSVM pulls Agave 4.4.1 crates that need rustc 1.98.1, and the host toolchain is 1.96.0. Do not run a blanket `cargo update`. The Solana CLI on Wangsit's machine points to devnet (`solana config set --url devnet`).

Deploy order on devnet:

1. Deploy `test-usdc` (verifiable build with `--library-name test_usdc`), create the tUSDC mint. `setup:devnet` moves the mint authority to the faucet PDA `["mint_authority"]` once the faucet is deployed.
2. Deploy `clamp`, call `initialize` with the tUSDC mint and the treasury account, signed by the upgrade authority (the deployer).
3. Create the `Observations` account per class with a fresh keypair at full size (81,928 bytes, 0.417 SOL rent each on 2026-11-18), owned by the `clamp` program, all zero (D-051). The setup script does this with a system `create_account` instruction.
4. Call `set_class` with the reporter keys and `min_reporters = 1`, then `init_index`.
5. Start the worker. Check the first `submit_report` and the first index update on an explorer. Check one report by hand: raw file, hash, recomputed price, on-chain value.
5b. Start reporters 2 and 3 on their own platforms, add their keys with `set_class`, raise `min_reporters` to 2.
6. Deposit test USDC into the vault, then let the worker create and seed the first series.

After every deploy, write the program ids, the mint and the main account addresses into `progress.md` ("Devnet deployments") and into `.env.example` as comments where they are public.

Upgrades: never change the layout of an account type that has live accounts. See `architecture.md` section 3.1.

### Verified build (required, D-041)

Tested on 2026-11-18 with the empty `clamp` program (Apple silicon, Colima with Rosetta, image runs as linux/amd64 under emulation, about 3 minutes per program).

1. Commit the code (and tag it for a release deploy).
2. Docker must run. On Wangsit's machine Docker is Colima, not Docker Desktop:

```
colima start --cpu 4 --memory 8 --vm-type vz --vz-rosetta
```

3. Build reproducibly. **Always pass the base image.** Without `-b`, `solana-verify` picks the image from the `solana-program` crate version in `Cargo.lock` (3.0.1), whose Cargo 1.84 cannot build our dependencies (`edition2024`). The newest image on 2026-11-18 is 4.3.0 (container Rust 1.97.1).

```
solana-verify build --library-name clamp -b solanafoundation/solana-verifiable-build:4.3.0
```

4. Deploy exactly that file (the output in `target/deploy/` is overwritten by a plain `anchor build`, so deploy right after the verifiable build):

```
solana program deploy target/deploy/clamp.so \
  --program-id ~/.config/solana/clamp/clamp-program-keypair.json \
  --keypair ~/.config/solana/clamp/deployer.json \
  --upgrade-authority ~/.config/solana/clamp/deployer.json \
  --url devnet
```

5. Compare the hashes. They must be equal:

```
solana-verify get-executable-hash target/deploy/clamp.so
solana-verify get-program-hash -u devnet wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC
```

6. Once the repo is public (D-046), anyone can run the check from the source (not run yet, needs the public repo):

```
solana-verify verify-from-repo -u devnet \
  --program-id wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC \
  https://github.com/wngstnr-code/clamp \
  --commit-hash <commit> --library-name clamp \
  -b solanafoundation/solana-verifiable-build:4.3.0
```

Put this command in the README. Log the commit, the program hash and the date in `progress.md` under "Devnet deployments".

Note: the host build (`anchor build`) uses cargo-build-sbf 4.5.0 and gives a different binary than the Docker build. Only the Docker build is deployed.

Open point: whether explorers show a "verified" badge for devnet programs is not known yet (A17). The hash match and the README command are the proof either way.

## 3b. SDK (`packages/sdk`)

Run on 2026-11-18:

```
pnpm idl:sync      # copy target/idl and target/types into packages/sdk/src/idl (after anchor build)
pnpm test:sdk      # vitest: shared math vectors, source rules on saved real responses, decoders, verifyReport
pnpm build:sdk     # tsc into packages/sdk/dist
```

Dependencies (pinned): `@anchor-lang/core` 1.2.2, `@solana/web3.js` 1.99.0 (Anchor's TypeScript client needs 1.x), TypeScript 6.0.3, Vitest 5.0.5.

## 4. Backend

Run on 2026-11-18 (from `backend/`):

```
pnpm dry-run      # fetch all sources, print each class's report, archive and send nothing
pnpm test         # vitest: request dedupe, failures, report arguments, event rows
pnpm typecheck
```

Run on 2026-11-18 against devnet (with `WORKER_KEYPAIR_PATH=~/.config/solana/clamp/worker.json` in front, or in `.env`):

```
pnpm setup:devnet       # steps 1 to 4 of the deploy order below, idempotent, devnet only
pnpm tick               # one tick: report (archive raw files, submit_report per class, rows) then record
pnpm record             # step 2 only
pnpm verify <signature> # recompute a report from its public raw files and compare with the chain
```

`pnpm report` (step 1 only) uses the same code as `tick`.

Local runs read the root `.env`. Set `WORKER_KEYPAIR_PATH=~/.config/solana/clamp/worker.json` there for local runs (a path, not the key).

- Hosted as its own Vercel project `clamp-backend` with the root directory `backend/`, Node 24. Vercel serves the Hono app exported by `backend/src/index.ts`. The build command (`pnpm build`) builds the SDK first. Secrets are set in the Vercel dashboard by the user.
- Database: Supabase project `clamp`, ref `qsszurelcfrzlswkhnkd`, region Southeast Asia (Singapore), URL `https://qsszurelcfrzlswkhnkd.supabase.co`. Migrations live in `supabase/migrations/` at the repo root. The Supabase CLI is a pinned dev dependency (3.2.0), so run it with `pnpm exec supabase` (Homebrew failed on Wangsit's machine because of old Xcode command line tools).
- Login and link (run once per machine, in a normal terminal, because login opens a browser): `pnpm exec supabase login`, then `pnpm exec supabase link --project-ref qsszurelcfrzlswkhnkd`.
- Run on 2026-11-18: `pnpm exec supabase db push --remote` (applied the first migration). Checked with the anon key: all four tables readable (HTTP 200), insert refused (HTTP 401). The `raw` bucket exists and is public.
- Live on 2026-11-18: `https://clamp-backend.vercel.app` (project `clamp-backend`, root `backend/`, Node 24, framework Hono, Git repo connected, branch `main`). Vercel uses `backend/src/app.ts` as the entry, so it must `export default app`.
- Env on Vercel (production): `SOLANA_RPC_URL`, `NEXT_PUBLIC_SUPABASE_URL` (set by Claude), `WORKER_KEYPAIR`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (set by the user from a terminal, one line at a time, values read from files so nothing is shown).
- Deploy: `vercel deploy --prod --yes` from the repo root (the link lives in `.vercel/` at the root; `.vercelignore` keeps `.env`, keypairs and build output out of the upload). A push to `main` should also deploy, but the first push after connecting the repo did not trigger a build, so deploy from the CLI when in doubt. The ignored build step skips builds when nothing in `backend/`, `packages/sdk/` or `pnpm-lock.yaml` changed.
- Known runtime trap: `rpc-websockets` 9.3.9 `require()`s the ESM-only `uuid` 14, which the Vercel runtime rejects (`ERR_REQUIRE_ESM`) while local Node 24 accepts it. The root `package.json` pins `rpc-websockets` to 9.3.10 through `pnpm.overrides`. Check a change like this locally with `node --no-experimental-require-module --import tsx -e "import('./src/app.ts')"` from `backend/`.
- Checks: `curl https://clamp-backend.vercel.app/health` (last successful report). A tick by hand: `curl -X POST -H "Authorization: Bearer $(cat ~/.config/solana/clamp/cron-secret.txt)" https://clamp-backend.vercel.app/cron/tick` (about 15 s).
- Schedule: migration `supabase/migrations/20261118110000_schedule_tick.sql` enables `pg_cron` and `pg_net` and schedules `clamp-tick` every 15 minutes. It reads the secret from Supabase Vault by name, so the secret is never in a file in the repo. The user created the Vault entry once (run from the repo root, the value is read from the local file):

```
pnpm exec supabase db query --remote "select vault.create_secret('$(cat ~/.config/solana/clamp/cron-secret.txt)', 'clamp_cron_secret')"
```

- Check the schedule: `select * from cron.job_run_details order by start_time desc limit 5` and `select status_code, content from net._http_response order by created desc limit 5` (read-only queries with `pnpm exec supabase db query --remote --read-only`).
- `CRON_SECRET` is kept locally in `~/.config/solana/clamp/cron-secret.txt` (mode 600, outside the repo).

### Reporters 2 and 3 (D-054)

```
pnpm --filter @clamp/backend bundle:reporter      # builds backend/dist/reporter.mjs (SDK first)
REPORTER_KEYPAIR="$(cat ~/.config/solana/clamp/reporter-2.json)" node backend/dist/reporter.mjs   # one run, tested 2026-11-18
pnpm --filter @clamp/backend set-reporters 1 worker.json reporter-2.json reporter-3.json         # admin: reporter list and quorum (run 2026-11-18)
```

Hosting (live 2026-11-18):

| Reporter | Where | Schedule (UTC minutes) | Update |
|---|---|---|---|
| 1 | Vercel backend, called by pg_cron | 0, 15, 30, 45 | `vercel deploy --prod --yes` |
| 2 | GitHub Actions in the public repo `wngstnr-code/clamp-reporter` (secret `REPORTER_KEYPAIR`, set by the user with `gh secret set`), started by the pg_cron job `clamp-reporter-2` through `workflow_dispatch` (GitHub's own schedule never fired for this repo). Dispatch token: fine-grained, Actions read and write on that repo only, 90 days (expires 2027-02-16), in Supabase Vault as `github_dispatch_token`. Replace it with `select vault.update_secret((select id from vault.secrets where name = 'github_dispatch_token'), '<token>')`; test a token first with a POST to `/repos/wngstnr-code/clamp-reporter/actions/workflows/report.yml/dispatches` (expect 204). | 5, 20, 35, 50 | `scripts/publish-reporter.sh "<message>"` (bundles, copies the template from `scripts/reporter-repo/`, commits, pushes) |
| 3 | Netlify scheduled function, site `clamp-reporter` (`https://clamp-reporter.netlify.app`, Free legacy plan, env `REPORTER_KEYPAIR` set by the user with `netlify env:set`) | 10, 25, 40, 55 | `scripts/deploy-reporter-netlify.sh` (needs `npx netlify-cli@27.16.2 login` once; the site link lives in `scripts/reporter-netlify/.netlify/`, not in git) |

A manual run of reporter 2: `gh workflow run report -R wngstnr-code/clamp-reporter`. Reporter 3 cannot be called by URL in production; check its logs at `https://app.netlify.com/projects/clamp-reporter/logs/functions`.

The reporter needs only `REPORTER_KEYPAIR` (keypair file content) and optionally `SOLANA_RPC_URL` and `ARCHIVE_URL`. It uploads raw files to `https://clamp-backend.vercel.app/archive`, signed with its key, and holds no backend secret.

## 5. Web app

Run on 2026-11-19. `dev` and `build` build the SDK first, because `@clamp/sdk` resolves to its `dist/`.

```
pnpm --filter web dev
pnpm --filter web build
pnpm --filter web typecheck
```

- `web/next.config.ts` loads the root `.env` (one env file for the repo). Without `NEXT_PUBLIC_SOLANA_RPC_URL` the app uses the public devnet endpoint.
- `fs` is aliased to an empty module in the browser bundle: Anchor's browser build `require`s it in `NodeWallet`, which the app never uses.
- Not deployed yet. Planned: Vercel with the root directory `web/`. Only `NEXT_PUBLIC_` variables reach the browser.

## 6. Text check

```
node scripts/check-dashes.mjs
```

Run on 2026-11-17: passes. It must report no matches before any task is called done and before every commit.

## 7. RPC

The public devnet endpoint is rate limited. The web app and the worker read the endpoint from the env file, so a provider endpoint can be used without a code change.
