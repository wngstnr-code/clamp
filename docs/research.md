# Research summary

Facts collected on 2026-11-16 and 2026-11-17. Numbers from third parties carry their source. Re-check anything that goes into the pitch.

## 1. Market facts

| Fact | Source |
|---|---|
| H100 rental price rose 22% in the month to 2026-09-07 | Akash report |
| A long-term rental index rose almost 40% in five months, from $1.70 per hour (October 2025) to $2.35 (March 2026) | Same report |
| On 2026-11-16 and 2026-11-17 one H100 hour cost a median $2.17 on Vast.ai, $2.69 on RunPod (community) and $2.55 to $3.16 on Akash | Our own API pulls |
| Regulated compute futures are sized at 730 GPU-hours per contract and need a broker account | Exchange press release |
| 73% of organizations report AI costs above budget | Secondary source (a summary of the State of FinOps 2026 report). Do not state it as first-hand. |

## 2. Alternatives and competitors

| Alternative | Weakness for small users | Clamp |
|---|---|---|
| Regulated compute futures | Broker needed, 730 GPU-hours per contract, data center classes only | Any size, a wallet is enough, an RTX 4090 class |
| Prediction markets | Yes or no bets, size does not follow a bill | Size computed from the real bill |
| Long-term rental contracts | Locked to one provider, paid even when unused | Free to switch provider |
| Doing nothing | The budget breaks when prices rise | Cost locked inside the band |

On Solana we found no product for hedging compute prices. The closest is GPU tokenization, which is not a hedge. Other chains have a few testnet prototypes. What Clamp does differently: size from the real bill, settlement on a period average, an index that leaves out empty sources, and both sides served at once.

Seen in search results on 2026-11-17, **not yet read at the source, verify before the pitch**:

| Claim | Why it matters |
|---|---|
| GPU compute futures on H100 and H200 launched on a second regulated exchange on 2026-05-19 | The regulated market is moving fast. Our point stays "too large and too hard to reach for a small renter", so the contract size and access rules must be checked. |
| A regulated prediction market launched GPU compute forward curves for hedging | The closest thing to Clamp for small users. Read how it is sized and who can use it. |
| One H100 rental index stood at $2.88 per hour on 2026-10-24 against $2.00 on 2025-12-09 | A newer and stronger number for "prices move" than the ones in section 1 |
| Several published GPU price indexes disagree widely with each other | Supports showing our sources and rule in the open |

Recheck competitors on Solana before submission and note the date in `progress.md`.

## 3. Data sources (all checked live on 2026-11-16 and 2026-11-17)

| Source | Endpoint | Auth | What we take | RTX 4090 | H100 |
|---|---|---|---|---|---|
| Vast.ai | `GET https://console.vast.ai/api/v0/bundles/?q={...}` | none | Offers: `dph_total`, `num_gpus`, `gpu_name` | Median $0.537 (64 or more offers) | SXM median $2.17 (6 offers), NVL 3 offers, PCIE 4 offers |
| RunPod | `POST https://api.runpod.io/graphql`, query `gpuTypes { id displayName memoryInGb securePrice communityPrice }` | none | List prices | $0.34 community, $0.89 secure | SXM $2.69 and $4.39, PCIe $1.99 and $2.89 |
| Akash | `GET https://console-api.akash.network/v1/gpu-prices` | none | `price.min/max/avg/weightedAverage/med`, `availability.available/total` | $0.34 (0 of 1 available) | $2.55 to $3.16, weighted $2.73 (14 of 56 available) |
| Nosana | `GET https://api.nosana.com/api/markets/` | none | 48 markets, `usd_reward_per_hour` | $0.29 to $0.35 | none seen |

Notes:

- The first Vast.ai pull used the default limit of 64 offers. Use `limit 500` and `num_gpus eq 1`.
- Nosana prices are set per market, not bid. That is why its weight is fixed at 1. On 2026-11-17 six markets had "4090" in the name, from $0.29 to $0.50 per hour (the $0.50 one is a confidential-computing market).
- `GET https://api.nosana.com/api/jobs` returns jobs with `market` and `node` addresses. It takes `?node=<address>` and `?market=<address>` as filters (tested). Finished jobs have `state` 2 and carry `timeStart`, `timeEnd` and `usdRewardPerHour`, so host earnings are the sum of hours times rate. `/api/stats` works. `/api/nodes` needs auth.

## 4. Billing and earnings APIs

| Provider | Endpoint | Gives |
|---|---|---|
| Vast.ai | `GET /api/v0/charges` (needs `select_filters`) | Charges per instance: items of type gpu, disk, bandwidth, with text like "96.000 hours at $0.389/hour". The GPU model is not a field. |
| Vast.ai | `/api/v0/users/{user_id}/invoices/` | Invoices |
| Vast.ai | Scoped API keys | Permission groups include `billing_read` (search invoices, show invoices, show earnings) and `instance_read`. Created in the console or with `vastai create api-key --permissions`. The charges endpoint is not in the published permission list. |
| Vast.ai | Instances endpoint | `gpu_name`, `num_gpus`, `dph_total`, `start_date`, `end_date`, `duration` for instances that still exist |
| Vast.ai | `GET /api/v0/users/{user_id}/machine-earnings` | Host earnings for a time range, per machine if wanted (listed under `billing_read`) |
| RunPod | `GET https://api.runpod.io/v2/billing/pods`, bearer auth (parameters `startTime`, `endTime`, `bucketSize`, `lastN`, `podId`) | Records with `podId`, `totalAmount`, `gpuAmount`, `cpuAmount`, `diskAmount` |

## 5. Technical checks (2026-11-17)

| Check | Result |
|---|---|
| Can a browser on another origin call the Vast.ai API? | No. The preflight answer has no `Access-Control-Allow-Origin` header. The RunPod GraphQL API has none either. Bills go through a proxy route or an invoice file (D-030). |
| Is Switchboard usable? | **No.** Many news reports say it announced its shutdown on 2026-09-19 and ended support on 2026-09-25, naming Pyth and RedStone as replacements. Our own check agrees: `crossbar.switchboard.xyz` and `docs.switchboard.xyz` have no DNS record, the explorer refuses connections, and the last package release was 2026-07-30. The announcement itself (an X post) was not read directly. |
| Can Pyth or RedStone replace it? | Not for us. No GPU rental price feed was found, and neither lets a user define a feed from any API. |
| Is zkTLS a replacement? | Not for every report. The free plan of the provider we looked at allows 100 fetches a month, the first paid plan costs $2,000 a month, and we would need about 20,000 fetches a month for one reporter. Fine for a daily spot check (D-039). |
| What replaces it? | Our own reporters (D-036). |
| Latest versions | `anchor-lang` 1.2.2 (TypeScript client `@anchor-lang/core` 1.2.2, built on `@solana/web3.js` 1.x), Agave v4.4.1, `litesvm` 0.18.2, Next.js 16.4.6, `@supabase/supabase-js` 2.119.0 |
| Can the scheduler call our worker? | Supabase Cron runs jobs from every second to once a year and can make HTTP requests (its docs). |
| Is the name free? | `clamp.finance` is a live crypto accounting product named Clamp. `clamp.xyz` is parked for sale. `useclamp.com` and `useclamp.xyz` are registered. No DNS records on 2026-11-17 for `clamp.markets`, `clamp.fi`, `clamp.so`, `clamp.trade`, `getclamp.xyz`, `clampindex.xyz`, `clamp.fyi` (no record is a hint, not proof that a name is free). |
| Exact submission hour | Not on the official site or FAQ. A third-party list says 2026-11-29 23:59 "anywhere on earth". Not confirmed. |

## 6. User interviews and pilots

Fill one row per person. No names in the repo without permission. Use initials or a role.

| Date | Who (role) | Side | GPU and provider | Hours and bill per month | Did prices hurt them? | Would they lock? | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Questions to ask: what do you rent and where, how many hours, what was the last bill, has the price changed on you, what happens to your budget if it rises 20%, would you pay about one fifth of the bill up front to fix it, and what would stop you.

Pilot users: none yet (target: one renter, one GPU owner).

## 7. Legal note

Clamp is a derivative on a price index. Its legal status is not resolved in any country we looked at. The hackathon version runs on devnet with test tokens and makes no claim of being legal, licensed or audited.

## 8. Sources

- Hackathon site and FAQ: https://hack.dev3pack.xyz/ and https://hack.dev3pack.xyz/faq
- Hackathon announcements: https://x.com/dev3pack
- H100 rental price 2026 (Akash): https://akash.network/the-bid/h100-rental-price-2026-cost-per-hour/
- Compute futures press release: https://www.cmegroup.com/media-room/press-releases/2026/8/11/cme_group_and_silicondatatolaunchcomputefuturesonoctober5tounloc.html
- Vast.ai API keys and permissions: https://docs.vast.ai/guides/reference/api-keys.md and https://docs.vast.ai/api-reference/permissions.md
- Vast.ai charges: https://docs.vast.ai/api-reference/billing/show-charges.md
- RunPod billing: https://docs.runpod.io/api-reference-v2/billing/get-pod-billing-history.md
- Switchboard shutdown: https://solanacompass.com/news/switchboard-oracle-protocol-shuts-down-giving-solana-defi-six-days-to-migrate and https://cryptobriefing.com/switchboard-oracle-shuts-down-migration/
- Nosana jobs API: https://api.nosana.com/api/jobs
- Vast.ai earnings: https://docs.vast.ai/api-reference/billing/show-earnings.md
- Supabase Cron: https://supabase.com/docs/guides/cron
- GPU tokenization on Solana: https://solanacompass.com/projects/compute-labs
- GPU cost and use survey: https://venturebeat.com/vb-pulse-infrastructure-and-compute-report
- University GPU shortage: https://digitallearning.eletsonline.com/2026/11/university-gpu-crunch-ai/
- GPU access gap editorial: https://www.nature.com/articles/s43588-026-01013-w
