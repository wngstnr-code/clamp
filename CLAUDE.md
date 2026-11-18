# Clamp: instructions for every Claude session

Clamp is our entry for the Dev3pack Global Hackathon (Solana university hackathon, 27 to 29 November 2026).
These rules apply to every session, for both team members. Read this whole file before doing anything else.

## 1. Read first (mandatory, in this order)

1. `CLAUDE.md` (this file)
2. `docs/progress.md`: current status, the next task per person, open blockers
3. `docs/product-spec.md`: what we are building. Source of truth for mechanics, formulas and parameters.
4. `docs/architecture.md`: how it is built (programs, index and oracle, backend, web app, data flow, security model) and the contracts between the two work areas
5. `docs/development-plan.md`: milestones, task checklist, cut lines

Read when relevant:

- `docs/build-and-deploy.md`: toolchain, commands, devnet deployment
- `docs/hackathon.md`: rules, deadline, judging, submission checklist, demo script
- `docs/decisions.md`: why things are the way they are (decision log)
- `docs/research.md`: market, competitors, data sources, user interviews

Status on 2026-11-17: the docs exist, no code exists yet. The team approved the design decisions D-018 to D-045 on 2026-11-17. A decision marked "proposed" or "open" in `docs/decisions.md` is not final: say so when a task depends on one. M0 started on 2026-11-18 on the user's go (D-047). Work goes stage by stage: report after each stage and wait for the user. `docs/progress.md` lists the assumptions that still need a test. The idea itself came from the final idea document `Clamp - Ide Final.pdf` (Indonesian, kept outside the repo). If a file listed here is missing, say so. Do not invent its content.

Before you write code, say in chat (in Indonesian) which task from `docs/progress.md` you are about to do.
If the docs and the code disagree, the code shows what exists and the spec shows what should exist. Tell the user about the mismatch. Do not silently pick one.

## 2. The project in one paragraph

Clamp is a two-way price lock for GPU rental on Solana. One USDC mints one UP claim and one DOWN claim on a GPU rental price index. At the end of the period, `UP value = clamp((average index - lower bound) / (upper bound - lower bound), 0, 1)` and `DOWN value = 1 - UP value`, so a pair is always worth exactly 1 USDC and can be merged back into 1 USDC at any time. Everything is fully collateralized: no margin, no debt, no liquidation. GPU renters buy UP claims to lock their bill (Bill Lock, "Kunci Tagihan" in the idea doc). GPU owners buy DOWN claims to lock their revenue (Revenue Lock, "Kunci Pendapatan"). A vault provides liquidity to one automated pool of UP and DOWN claims. The Clamp Index is the hourly rental price per GPU class, taken from four real providers (Vast.ai, RunPod, Akash, Nosana), recorded on-chain many times a day by a quorum of registered reporters (the oracle network first planned, Switchboard, shut down in September 2026), and averaged over the period for settlement. Settlement is computed on-chain and anyone can trigger it.

## 3. The team (two people)

| Person | Role | Owns |
|---|---|---|
| AG | Frontend (FE) | The web app: pages, components, wallet connection, charts, UI text, design |
| Wangsit | Smart contracts (SC) and backend (BE) | Solana programs and their tests, the SDK, the backend worker (price reporter and cranks), the database, deploy scripts |

Rules for working as two people:

- **Know who you are working with.** Work it out from the task: web app work is AG, program and backend work is Wangsit. Ask once only when the task does not make it clear.
- **Stay in the owner's area.** Do not edit files in the other person's area on your own. If a task needs a change there, tell the user what is needed and why, so they can ask the teammate or agree to make the change.
- **The contract between the two areas lives in `docs/architecture.md`**: program IDL and instruction names, account layouts, events, database tables, API routes, env variable names. Change it there first, then the code. When a shared contract changes, tell the user to inform the teammate and note it in `docs/progress.md`.
- **The frontend uses the real program interface.** AG's code talks to the programs only through `packages/sdk`, which carries the generated IDL and types from Wangsit's build. Do not hand-write a second copy of the interface and do not stub it with fake data.
- **`docs/progress.md` has one section per person** (AG, Wangsit) plus a shared section. Update only the section of the person you are working with and the shared section. This keeps merge conflicts small.
- **Git with two people:** pull before you start. Keep commits small. Never force-push a shared branch and never rewrite history that the teammate may already have.
- Both people are flexible and may help in the other area when they agree to. When that happens, the same rules apply: say it in chat and record it in `docs/progress.md`.

## 4. Hard deadline

- The hackathon runs **2026-11-27 to 2026-11-29**. Submissions close on **Sunday 2026-11-29**. The exact hour is not confirmed yet: check the hackathon site and record it in `docs/hackathon.md` (with the WIB time).
- The public repo, the deployed program address, the demo video (under 3 minutes, strict) and the live link must exist before that time.
- We are building the full product (the 8 parts in `docs/product-spec.md`), not only an MVP. Build in the agreed order: index, claim market, bill lock, vault, revenue lock, then the rest. If time gets short, follow the cut lines in `docs/development-plan.md`. A smaller product that really works beats a bigger one that is half fake.
- Code written before 27 November is allowed only if the README says clearly what was built before the hackathon and what was built during it. Keep that record honest (see section 8).

## 5. Language and writing rules

- **Chat with the user in Indonesian.** Use simple, everyday words and short sentences. Explain technical terms briefly when you use them.
- **Write every file in English**: code, comments, docs, README, UI text, commit messages, test names.
- **Never use the em dash character (U+2014) anywhere**: not in files, not in chat, not in commit messages. Also avoid the en dash (U+2013). Use a comma, colon, parentheses, "to", or a new sentence instead.
- Before you finish a task, run `node scripts/check-dashes.mjs`. It must report no matches.
- Keep docs short and factual. Prefer tables and checklists over long prose.

## 6. Session workflow

1. Read the files in section 1.
2. Tell the user (Indonesian) what you will do next and why.
3. Work in small steps. Build and test after each meaningful change, then self-review it (section 7).
4. If you change a mechanic or a parameter: update `docs/product-spec.md` first, then the code. Record the reason in `docs/decisions.md`.
5. **Before the session ends, or after each finished milestone, update `docs/progress.md`**: what changed, current status, the exact next step, blockers, and the date. Never leave it stale. The next session, and the teammate, depend on it.
6. Summarize in chat (Indonesian) what was done and what is next.

## 7. Self-review (mandatory, after anything you write)

After you write or change **any** code or doc, review it before moving on. Look for gaps, weaknesses and things you missed. Do not wait for the user to ask.

**Quick review, after every change:** re-read your own diff (`git diff`) and check:

| Area | Questions |
|---|---|
| Spec | Does it match `docs/product-spec.md` exactly (formulas, rounding direction, units, decimals, parameters)? |
| Edge cases | Zero amounts, tiny amounts (dust), maximum values and overflow, first and last holder, empty pool, repeated calls, calls after settlement, time exactly at a period boundary, index exactly at a bound, index outside the band. |
| Security | Who can sign? Is every account checked (owner, seeds and bump, mint, token program)? Can a failed step leave state half-updated? Any way to drain the collateral, the pool, the vault or the fees? Can a stale, missing or manipulated index value reach settlement? |
| Invariants | Do the invariants in `docs/product-spec.md` still hold (a pair is always worth 1 USDC, total collateral covers all claims, parameters fixed after a series is created)? Is there a test for each one touched? |
| Tests | Does every new behavior have a test, including the failure paths (expected errors)? |
| Completeness | Did you cover every item and acceptance criterion of the current task in `docs/development-plan.md`? Any TODO, `unwrap()` on user input, or placeholder left behind? |
| Team contract | Did you change anything the teammate depends on (IDL, account layout, events, database tables, API routes, env names)? If yes, is `docs/architecture.md` updated and the user told? |
| Docs | Are spec, architecture, plan and progress still consistent with what you changed? |
| Hygiene | `node scripts/check-dashes.mjs` passes. No secrets. No AI attribution. English in files. |

**Deep review, periodically:** at the end of every milestone, and before every batch of commits:

1. Run the full test suite and the build.
2. Put `docs/product-spec.md` next to the code and check every rule, one by one.
3. Run a code review of the diff since the last milestone (for example the `/code-review` skill) and fix real findings.
4. Think like an attacker for 5 minutes: try to break the mechanic (index manipulation, settlement timing, rounding, pool pricing, vault share price, griefing).
5. Re-read the docs touched in this milestone for contradictions or stale facts.

**Record what you found.** Write review findings and fixes in `docs/progress.md` under "Review notes". If you find a weakness you cannot fix now, add it to "Known issues" in `docs/progress.md` with a severity (high, medium, low) and tell the user in chat.

## 8. Guardrails

- **Devnet only, test USDC only.** Never touch mainnet or real funds unless the user explicitly asks. Keep the code mainnet-ready, but do not deploy there.
- **Never write secrets** (private keys, seed phrases, API keys, service keys) into files, chat or logs. Wallet keypairs stay in the local Solana keychain (`~/.config/solana`). Never print them.
- **Claude prepares devnet accounts, the user funds them.** Generate keypairs locally, then the user tops them up with the faucet. You may run deploy and call commands with the local credentials when the user asks you to.
- **One env file only:** `.env` at the repo root (gitignored), template in `.env.example` with names only, never values. Do not create other `.env` files.
- **No mock data, no mock features.** The index uses real prices from real providers. The demo uses real devnet transactions. If a source is down, show it as down: never fill the gap with invented numbers. Fixed test inputs belong in test files only and must never reach the product.
- **The deployed program must be verified.** Every devnet deploy that others rely on is a verifiable build of a repo commit. Log the commit and the program hash in `docs/progress.md`, and keep the verify command in the README working (`docs/build-and-deploy.md` section 3).
- **Reporters are automatic.** Index prices only enter the chain through the scheduled reporter jobs. Never send a report by hand with a typed-in number.
- **User funds are safe by design.** Every claim is fully collateralized. No instruction lets an admin move user collateral. The parameters of a series (band, period, GPU class) cannot change after it is created. The backend never holds user funds or user keys.
- **Money logic lives in the programs.** The backend only reports prices as a registered reporter, sends cranks, keeps history and serves the bill proxy. Settlement must be checkable on-chain by anyone.
- **Provider keys from users are read-only.** A user key for Vast.ai or RunPod is only used to read bills. Ask for the narrowest scope, never log it, and store it only if `docs/product-spec.md` says so.
- **Clamp is our own design.** Do not copy code or text from other hackathon projects (forking one means disqualification). Do not name any other hackathon project as inspiration, in files or in chat. When prior art must be discussed, refer to it in general terms: regulated futures markets, or "prototypes on other chains".
- **Be honest in every claim.** Do not say the product is legal, licensed or audited. Do not say the team are heavy GPU users. Do not overstate how much index history or how many users we have.
- **Keep the before and during record honest.** `docs/progress.md` carries dates. Never change commit dates and never describe earlier work as hackathon work.
- **Commit or push only when the user asks.** Always follow the commit rules in section 9. Do not create GitHub repos, post on X, or submit the hackathon form without explicit approval.
- **Do not expand scope** beyond `docs/development-plan.md` without asking.
- Look before you delete or overwrite anything.

## 9. Commit rules

- **Always split commits.** One logical change per commit. Never bundle unrelated changes into one big commit.
- Typical split for one task: the spec or docs change, the code change, the tests, the progress update. Each one is its own commit.
- Stage files explicitly (`git add <path>`), not `git add -A` or `git add .`, so each commit holds only what belongs to it. If one file mixes two concerns, split them with `git add -p`.
- Message format (Conventional Commits, English, no em dash):
  - `feat(programs): add mint and merge for claim pairs`
  - `test(programs): cover rounding in settlement`
  - `feat(web): add bill lock form`
  - `docs: update progress for M1`
  - Types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `build`, `ci`. Scopes: `programs`, `sdk`, `backend`, `web`, `scripts`.
- Subject line under 72 characters, imperative mood ("add", not "added"). Add a short body when the reason is not obvious.
- Each commit should build and pass tests on its own when possible.
- Run `node scripts/check-dashes.mjs` before committing.
- Never commit secrets, `.env` files, keypair files, `target/`, `node_modules/` or build output.
- **No AI attribution in the repo.** Claude must never appear as a contributor or co-author. Never add `Co-Authored-By: Claude`, "Generated with Claude Code", or similar lines to commit messages, PR descriptions, code comments or docs. Commits use the git identity of the person doing the work (AG or Wangsit) only.
- **`CLAUDE.md` is tracked in git** (changed on 2026-11-18 by the user, D-049), so both team members get the same rules from the repo. Edit it like any other doc, in its own commit.
- If the hackathon form or README asks which AI tools were used, answer only as a short neutral line in the README "Tools used" section, never as contributor credit.

## 10. Repository layout (planned, details in `docs/architecture.md` section 2)

```
CLAUDE.md                 rules for every session (this file)
README.md                 judge-facing readme, with a clear "before" and "during" hackathon section (written in M7)
docs/                     plans, spec, architecture, progress, decisions, research
scripts/check-dashes.mjs  fails if any file contains an em dash or en dash
programs/clamp/           the main Anchor program: index, series, pool, vault, locks (Wangsit)
programs/test-usdc/       devnet-only faucet for the test USDC mint (Wangsit)
packages/sdk/             TypeScript SDK: IDL, types, PDA helpers, math, readers (Wangsit, used by AG)
backend/                  worker (price reporter and cranks), bill proxy (Wangsit)
supabase/                 Supabase CLI config and SQL migrations (Wangsit)
web/                      Next.js web app (AG)
```

## 11. Key commands

Full details go in `docs/build-and-deploy.md`. Add each command to this table when it exists and has been run once. Do not list commands that have not been tested.

| Task | Command |
|---|---|
| Check for dashes | `node scripts/check-dashes.mjs` |
| Build programs, IDL and types | `anchor build` |
| Run Rust tests (after `anchor build`) | `cargo test` |
| Format check | `cargo fmt --all -- --check` |
| Verifiable build (Docker running) | `solana-verify build --library-name clamp -b solanafoundation/solana-verifiable-build:4.3.0` |
| Hash of the deployed program | `solana-verify get-program-hash -u devnet <program id>` |
| Apply database migrations | `pnpm exec supabase db push --remote` |
| Copy the IDL into the SDK (after `anchor build`) | `pnpm idl:sync` |
| SDK tests | `pnpm test:sdk` |
| SDK build | `pnpm build:sdk` |
| Devnet setup (idempotent) | `pnpm --filter @clamp/backend setup:devnet` |
| One reporter tick from a laptop | `WORKER_KEYPAIR_PATH=~/.config/solana/clamp/worker.json pnpm --filter @clamp/backend tick` |
| Verify a report transaction | `pnpm --filter @clamp/backend verify <signature>` |
| Deploy the backend | `vercel deploy --prod --yes` (repo root) |
| Backend health | `curl https://clamp-backend.vercel.app/health` |
| Bundle the standalone reporter | `pnpm --filter @clamp/backend bundle:reporter` |
| Set reporters and quorum (admin) | `pnpm --filter @clamp/backend set-reporters <min> <keypair files>...` |
| Claim 1,000 tUSDC for a local keypair (devnet) | `pnpm --filter @clamp/backend faucet-claim <keypair file>` |
| Series on devnet: show, create, mint, merge | `pnpm --filter @clamp/backend series show 1 1 0` (see `backend/src/series-cli.ts`) |
| Prune raw files older than 20 days now (the tick does it daily) | `pnpm --filter @clamp/backend run prune` |
| Read-only SQL on the project | `pnpm exec supabase db query --remote --read-only "<sql>"` |

## 12. Definition of done (for any task)

- It builds, and all tests pass.
- The behavior matches `docs/product-spec.md`.
- `node scripts/check-dashes.mjs` reports nothing.
- Docs touched by the change are updated, including `docs/architecture.md` when a shared contract changed.
- `docs/progress.md` is updated in the right person's section.
- The quick self-review (section 7) is done, and the deep review too if a milestone just finished.

## 13. Hackathon essentials (details in `docs/hackathon.md`)

- Must be built on Solana. Open source is mandatory. The submission needs a devnet or mainnet program address.
- Team size is 1 to 4. We are 2: AG and Wangsit.
- Required at submission: project name, one-liner, program address, description, images, demo video under 3 minutes showing the real product, public repo, live link.
- Judging has two stages, each with a Product and a Technical rubric. Stage 1 picks the top 100. Stage 2 inspects the code, checks founder-market fit and verifies the live demo. Signals that matter: rule compliance, product clarity, real-world impact, demo quality, deployment, repo quality, depth of Solana and SDK use.
- No rubric weights and no judge names are published. Partner tracks may still be announced: check the site again before the hackathon starts.
- AI tools are allowed. Forking another hackathon project is not.
