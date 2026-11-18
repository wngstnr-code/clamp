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

1. Deploy `test-usdc`, create the tUSDC mint.
2. Deploy `clamp`, call `initialize` with the tUSDC mint and the treasury account.
3. Create the `Observations` account per class at full size (about 98 KB, about 0.69 SOL rent each).
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

## 4. Backend

All not run yet.

```
pnpm install
pnpm --filter backend tick        # one tick from the local machine
pnpm --filter backend report      # only the report step (what reporters 2 and 3 run)
pnpm --filter backend dev         # local HTTP server
```

- Hosted as its own Vercel project with the root directory `backend/`. Secrets are set in the Vercel dashboard by the user.
- Database: a Supabase project. Migrations live in `backend/supabase/migrations/`.
- Schedule: Supabase `pg_cron` with `pg_net` calls the tick route every 15 minutes. Example to adapt (not run yet):

```sql
select cron.schedule(
  'clamp-tick',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://<backend host>/cron/tick',
       headers := jsonb_build_object('x-cron-secret', '<secret>')
     ) $$
);
```

The real secret is typed into the Supabase dashboard by the user. It is never committed.

## 5. Web app

All not run yet.

```
pnpm --filter web dev
pnpm --filter web build
```

Hosted on Vercel with the root directory `web/`. Only `NEXT_PUBLIC_` variables reach the browser.

## 6. Text check

```
node scripts/check-dashes.mjs
```

Run on 2026-11-17: passes. It must report no matches before any task is called done and before every commit.

## 7. RPC

The public devnet endpoint is rate limited. The web app and the worker read the endpoint from the env file, so a provider endpoint can be used without a code change.
