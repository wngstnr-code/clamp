# Clamp product spec

This file is the source of truth for what Clamp does. If code or other docs disagree with it, fix them or update this file on purpose (and log the reason in `decisions.md`).

Status of this file: sections 1 to 4 and 15 come from the final idea. Sections 5 to 14 turn that idea into exact rules. All of it was approved by the team on 2026-11-17 (`decisions.md`, D-018 to D-045). Numbers marked **(initial)** are starting values that get recalibrated from real index history.

## 1. Summary

Clamp is a two-way price lock for GPU rental on Solana.

- 1 USDC mints one **UP claim** and one **DOWN claim** for a series (a GPU class and a period).
- At the end of the period a pair is always worth exactly 1 USDC. UP is worth more when the average rental price went up, DOWN when it went down.
- GPU renters buy UP to lock their bill (**Bill Lock**, "Kunci Tagihan" in the idea doc).
- GPU owners buy DOWN to lock their revenue (**Revenue Lock**, "Kunci Pendapatan").
- Everything is fully collateralized. There is no margin, no debt and no liquidation. The most a user can lose is what they paid.
- The price comes from the **Clamp Index**: real hourly rental prices from four providers, recorded on-chain many times a day.

Tagline: "Lock your GPU rental price."

## 2. Problem and users

- GPU rental prices move sharply. One report shows H100 rental up 22% in a month (to 2026-09-07). A long-term rental index rose almost 40% in five months (from $1.70 to $2.35 per hour).
- Small renters have fixed budgets: research grants, thesis funds, small AI teams that sell at fixed prices.
- The existing tools do not fit them. Regulated compute futures are sized at 730 GPU-hours per contract and need a broker account.

| User | Problem | What Clamp gives |
|---|---|---|
| GPU renters with a fixed budget (researchers, students, small AI teams) | The bill grows when rental prices rise | Next period's bill is locked (Bill Lock) |
| Small GPU owners who rent out their GPUs | Revenue falls when rental prices fall | Next period's revenue is locked (Revenue Lock) |
| Vault depositors | Idle USDC | Trade fees for providing liquidity, with a risk cap per series |
| Other developers | No GPU price that a Solana program can read | An open on-chain GPU price index |

First users: researchers and students on our own campus (renter side) and GPU hosts in online communities of Solana GPU networks (owner side). Long-term payers: small commercial AI teams.

## 3. Glossary

| Term | Meaning |
|---|---|
| Class | A GPU type with its own index. `1` = RTX 4090 (primary), `2` = H100 (second). |
| Clamp Index | One number per class: USD per GPU-hour, combined from several sources |
| Series | One class plus one period. Has its own band, claims, pool and collateral. |
| Kind | Length of a series: `daily` (24 h, short series), `weekly` (7 days), `monthly` (30 days) |
| Band | `lower` and `upper` price of a series, fixed when the series is created |
| UP claim, DOWN claim | Two tokens of a series. Their end values always add up to 1 USDC. |
| Pair | 1 UP + 1 DOWN. Minted from 1 USDC, merged back into 1 USDC. |
| Collateral | USDC locked in the series account. Always equals the pairs outstanding. |
| Pool | The automated market of one series that sells and buys UP and DOWN |
| Vault | Where depositors put USDC. The vault is the only liquidity provider of every pool. |
| Lock | A user position opened through Bill Lock or Revenue Lock. Holds claims in escrow. |
| Settlement | The step after expiry that fixes the end value of UP and DOWN |
| Reporter | A registered key that fetches the price APIs and sends what it saw to the program |
| Crank | A transaction anyone may send to move the system forward (create, seed, settle, sweep, roll) |

## 4. The eight product parts

| No | Part | For | Content |
|---|---|---|---|
| 1 | Clamp Index | Everyone | Price per class from four sources, recorded on-chain, period average computed on-chain, public page with chart and history |
| 2 | Claim market | Everyone | Mint a pair from 1 USDC, merge it back, trade one side in the pool, redeem after expiry |
| 3 | Bill Lock | Renters | Connect the rental account, read the real bill, see how close the bill follows the index, lock in one click |
| 4 | Revenue Lock | GPU owners | Mirror of Bill Lock: read real earnings, lock by buying DOWN |
| 5 | Vault | Depositors | Fills the pools so there is always a price, shares trade fees, risk cap per series |
| 6 | Proof page and SDK | Judges, developers | Every settlement can be recomputed in the browser. Other programs and apps can read the index. |
| 7 | Auto-roll | Renters, owners | A lock rolls into the next series without buying again. Can be switched off any time. |
| 8 | Earnings from Nosana data | GPU owners | Host earnings read from Nosana job history on Solana, not typed in by hand |

Build order: index, claim market, Bill Lock, vault, Revenue Lock, then the rest. After each step the product really works, so nothing has to be faked.

## 5. Units and rounding

| Thing | Unit |
|---|---|
| USDC | 6 decimals. Amounts are `u64` micro-USDC. |
| Claims | 6 decimals. 1 claim = 1,000,000 units. 1 micro-USDC mints 1 unit of UP and 1 unit of DOWN. |
| Index price | `u64` micro-USD per GPU-hour ($0.34 = 340,000) |
| Fractions (claim value, pool price, band width, steps) | Parts per million, `ppm` (1,000,000 = 100%) |
| Fees | Basis points, `bps` (10,000 = 100%) |
| Time | Unix seconds from the Solana clock |

Rounding always favors the series collateral and the vault: tokens out and USDC out round down, fees and USDC in round up. Dust stays in the series collateral account.

## 6. Clamp Index

### 6.1 Sources

Each source gives one **price** (USD per hour for one GPU) and, where it exists, one **capacity** (units that can be rented right now).

| Id | Source | Price | Capacity | Weight |
|---|---|---|---|---|
| 1 | Vast.ai | Median `dph_total` of offers that are rentable, verified, on-demand, single-GPU, of the class model | Number of such offers | By tier |
| 2 | RunPod | `communityPrice` of the class GPU type | None published | Fixed 2 |
| 3 | Akash | `price.weightedAverage` of the class model | `availability.available` | By tier |
| 4 | Nosana | Median `usd_reward_per_hour` of the markets of the class | None used (prices are set per market, not bid) | Fixed 1 |

Capacity tiers: 0 units means weight 0 (the source is left out, because a price nobody can rent at is not a price). 1 to 4 units means weight 1. 5 or more units means weight 2.

The H100 class tracks the H100 SXM (80 GB) only: Vast.ai `H100 SXM` offers, RunPod `NVIDIA H100 80GB HBM3`, Akash `h100` with interface `SXM5`, plus the Nosana markets whose name contains `H100`, which appeared in November 2026 and do not name the variant (D-053). The exact requests and the rule that turns a raw response into a price and a capacity are public code in `packages/sdk/src/sources/` and are mirrored in `architecture.md`.

### 6.2 How one update is computed (on-chain)

The planned oracle network (Switchboard) shut down on 2026-09-25, so Clamp brings the prices on-chain with its own **reporters** (D-036). A reporter is a registered key that fetches the four public APIs by itself and sends what it saw. Reporters are fully automatic: a scheduled job every 15 minutes. No person types, edits or approves a number (D-042).

`submit_report(class, prices, capacities, raw_hashes)`: signed by a registered reporter. For each source it carries the price (0 when the source did not answer), the capacity, and the SHA-256 hash of the raw API response the reporter archived. A price above 0 without a hash is refused (the transaction fails), so every price on-chain has public evidence (D-055). The program stores the report, emits it as an event, and then tries an update:

1. If the last update is less than `MIN_UPDATE_INTERVAL` ago, stop. The report stays stored.
2. Fresh reports are the stored reports that are at most `REPORT_WINDOW` old and were not used in an update yet. If there are fewer than `min_reporters`, stop. If not every registered reporter has a fresh report and the oldest fresh report is younger than `REPORT_WAIT`, stop and wait for the others (D-055). So a normal update is formed from all reporters, and a reporter that is down delays the update by at most `REPORT_WAIT`.
3. Per source: take the fresh prices that are above 0 and inside the class sanity bounds `[min_price, max_price]`. If fewer than `min_reporters` reporters gave one, the source is left out. Otherwise the source price is the median of those prices and the source capacity is the median of those capacities (for an even count, the average of the two middle values, rounded down).
4. Drop sources with weight 0 (section 6.1). Require at least `min_sources` sources and a total weight of at least `min_total_weight`. Otherwise stop.
5. `candidate` = weighted median: sort the sources by price, walk up until the running weight reaches half of the total weight. If the running weight hits exactly half, take the average of that price and the next one (rounded down).
6. Step limit: `price = clamp(candidate, last_price * (1 - max_step), last_price * (1 + max_step))`. The lower bound rounds up and the upper bound rounds down, so one update never moves more than `max_step`. The first update of a class has no previous price and is not limited. A real move passes over a few updates. A single bad print has a small effect.
7. Record the price (section 6.3) and mark the fresh reports as used.

"Stop" never fails the transaction: the report is kept and nothing else changes.

How anyone can check a reporter: the raw API response of every report is archived in public. Its hash is on-chain. The rule that turns a raw response into a price is public code in the SDK. So anyone can download the file, hash it, recompute the price and compare all three with the chain.

### 6.3 Recording and the period average

Per class the program keeps `last_ts`, `last_price`, and two running sums:

```
on an accepted update at time t:
  counted    = min(t - last_ts, MAX_GAP)
  cum_price += last_price * counted
  cum_valid += counted
  last_price = price;  last_ts = t
  store an observation {t, price, cum_price, cum_valid} in a ring of OBS_CARDINALITY entries
```

Sums at any time `x` (using the last observation `a` with `ts_a <= x`):

```
counted      = min(x - ts_a, MAX_GAP)
cum_price(x) = cum_price_a + price_a * counted
cum_valid(x) = cum_valid_a + counted
```

Time-weighted average between `t0` and `t1`:

```
avg(t0, t1) = (cum_price(t1) - cum_price(t0)) / (cum_valid(t1) - cum_valid(t0))     rounded down
```

If the oracle stops, time beyond `MAX_GAP` after the last update is not counted. The average then covers only the recorded part. No number is ever invented.

### 6.4 Index parameters

| Parameter | Value | Note |
|---|---|---|
| `MIN_UPDATE_INTERVAL` | 600 s | Reporters report every 15 minutes |
| `MAX_GAP` | 7,200 s | Time counted after one observation |
| `OBS_CARDINALITY` | 2,048 | At least 14 days of history even at the minimum interval |
| `REPORT_WINDOW` | 900 s | A report older than this is ignored |
| `REPORT_WAIT` | 600 s | How long an update waits for the missing reporters (D-055) |
| Reporters | At most 5 per class | The list is set by the config admin |
| `min_reporters` | 1 while only one reporter runs, then 2 (of 3) | Per class. The index page shows how many reporters stood behind each update. |
| `max_step` | 100,000 ppm (10%) per update | Per class |
| `min_sources` / `min_total_weight` | 2 / 3 | Per class **(initial)** |
| `min_price` to `max_price` | RTX 4090: $0.05 to $5. H100: $0.50 to $20. | Per class **(initial)** |

### 6.5 Why it is hard to manipulate

- The median drops prices that are too high or too low. Empty sources do not count.
- A fake cheap offer gets rented at once, so the faker loses money.
- Settlement uses the average over the whole period, so a short spike is not enough.
- The step limit caps the effect of one update.
- With three reporters and a quorum of two, one wrong or broken reporter cannot set a source price alone.
- Every report leaves public evidence: the raw file, its hash on-chain, and the public rule.

Known limits (also in `progress.md`): on devnet the reporters are run by the team on separate machines with separate keys. That protects against one machine or one key failing. It does not protect against the team itself, and we say so. A mainnet version needs outside reporters with a bond, or proofs that the data came from the provider's server (zkTLS). The Vast.ai median is biased upward because the cheapest offers get rented first. H100 supply is thin. Posted prices (RunPod, Nosana) move rarely.

## 7. Series

### 7.1 Creating a series

`create_series(class, kind)` can be called by anyone when the class has no series of that kind yet, or the current one has expired. Series of one class and kind follow each other without overlap.

| Field | Rule |
|---|---|
| `start_ts` | The time of creation |
| `expiry_ts` | `start_ts + duration` (daily 86,400 s, weekly 604,800 s, monthly 2,592,000 s) |
| `close_ts` | `expiry_ts - duration / 24`. Pool trading stops here. Mint, merge and redeem do not. |
| `center` | `avg(start_ts - 72 h, start_ts)` of the class index. Needs at least 6 h of counted time, otherwise creation fails. |
| `lower`, `upper` | `center * (1 - half_width)` and `center * (1 + half_width)` |
| `start_index` | The index price at creation |
| Start snapshot | `cum_price(start_ts)` and `cum_valid(start_ts)`, stored in the series |
| Fees | `trade_fee_bps` and `protocol_share_bps` are copied into the series |

Creation needs a fresh index (last update within `MAX_GAP`). Nothing in a series can change after creation. No person picks the band.

Half width per class and kind (recalibrated in M2 on 2026-11-19, D-059; first values were 10%, 15% and 20%):

| Kind | Half width |
|---|---|
| Daily | 200,000 ppm (20%) |
| Weekly | 200,000 ppm (20%) |
| Monthly | 250,000 ppm (25%) |

Calibration rule: about two times the typical change of the period average seen in our own index history, rounded to 5%, and never so narrow that an index jump seen early on a provider API makes front-running pay (simulation in `programs/clamp/tests/test_frontrun.rs`). The index moves in jumps (posted prices change rarely), so the second part decides for now. Check the first part again once the index has 7 days of history.

The daily kind is a **short series** for testing and for showing a real settlement quickly. The web app labels it "Short series". It is not the hedging product.

### 7.2 Mint and merge

- `mint_pairs(amount)`: the user pays `amount` micro-USDC into the series collateral and receives `amount` units of UP and `amount` units of DOWN. Allowed until settlement.
- `merge_pairs(amount)`: the user burns `amount` units of UP and of DOWN and receives `amount` micro-USDC. Allowed until settlement.
- No fee on mint and merge.

## 8. Pool

Each series has one pool. The vault owns everything in it. Nobody else can add liquidity.

State (numbers in the series account): `pool_up`, `pool_down` (units the pool trades with) and `inv_up`, `inv_down` (vault-owned units kept out of the pool). All four are held in the two token accounts of the series.

Pool price: `price_up = pool_down / (pool_up + pool_down)`, `price_down = 1 - price_up`.

### 8.1 Fair value from the index

```
proj_avg = (cum_price(now) - start_cum_price + last_price * (expiry_ts - now))
         / (cum_valid(now) - start_cum_valid + (expiry_ts - now))
v        = clamp((proj_avg - lower) / (upper - lower), 0, 1)        in ppm
```

`v` is the best simple guess of the end value of UP: the average so far, with the current price assumed for the rest of the period.

### 8.2 Re-centering

`recenter(p)` with `p = clamp(v, P_MIN, 1 - P_MIN)`, `T_up = pool_up + inv_up`, `T_down = pool_down + inv_down`:

```
s         = min(T_up / (1 - p), T_down / p)
pool_up   = s * (1 - p);   inv_up   = T_up - pool_up
pool_down = s * p;         inv_down = T_down - pool_down
```

It only moves vault-owned units between the pool and the inventory. No value changes hands.

Re-centering runs inside every trade, but at most once per index update (when the class index has an observation newer than the last re-centering of this series). Between two index updates the pool is a plain constant-product pool, so trades move the price and large orders pay slippage.

### 8.3 Buy (the user pays USDC, gets claims of one side)

For a buy of UP with `usdc_in` (a buy of DOWN is the mirror):

```
fee      = ceil(usdc_in * trade_fee_bps / 10000)
x        = usdc_in - fee                      x pairs are minted into the pool
k        = pool_up * pool_down
new_up   = ceil(k / (pool_down + x))
out      = pool_up + x - new_up               UP units to the user
pool_up  = new_up;  pool_down += x
```

Fails if `out < min_out`, if `out == 0`, after `close_ts`, or if `v` is outside `[P_MIN, 1 - P_MIN]` (the outcome is almost certain, so the pool pauses).

Cost for an exact number of claims `a` (used by the web app and by auto-roll), before the fee:

```
x = ( -(pool_up + pool_down - a) + sqrt((pool_up + pool_down - a)^2 + 4 * a * pool_down) ) / 2      rounded up
```

### 8.4 Sell (the user gives claims of one side, gets USDC)

For a sell of `a` units of UP:

```
U = pool_up + a;  D = pool_down
y = ( (U + D) - sqrt((U + D)^2 - 4 * a * D) ) / 2      rounded down, y pairs are merged
fee = ceil(y * trade_fee_bps / 10000)
pool_up = U - y;  pool_down = D - y
the user receives y - fee
```

Fails if the result is below `min_usdc_out`, after `close_ts`, or when the pool is paused.

After every trade `pool_up * pool_down` must be at least what it was before the trade.

### 8.5 Fees

| Fee | Value | Goes to |
|---|---|---|
| `trade_fee_bps` | 100 (1%) of the USDC of every pool trade **(initial)** | Split below |
| Vault part | 80% of the fee | The vault's idle USDC (raises the share price) |
| Protocol part (`protocol_share_bps` = 2,000) | 20% of the fee | The fixed treasury token account |

A vault management fee (mentioned in the business model) is not part of this version.

### 8.6 Pool parameters

| Parameter | Value |
|---|---|
| `P_MIN` | 20,000 ppm (2%) |
| Seed | `recenter` with `T_up = T_down = allocation` (section 9) |

## 9. Vault

One vault for the collateral token. Shares are an SPL token (6 decimals).

### 9.1 Net asset value

```
value(series) = (T_up * v + T_down * (1 - v))            for a live series, v from section 8.1
              = (T_up * up_value + T_down * down_value)   for a settled series not swept yet
NAV           = idle USDC + sum of value(series) over the active series
```

The vault is valued with the index, not with the pool price. Trading cannot move the share price except by really paying the vault.

### 9.2 Instructions

| Instruction | Rule |
|---|---|
| `deposit(amount)` | Shares minted = `amount * total_shares / NAV`, rounded down. The first deposit is 1 to 1 and must be at least 10 USDC. 1,000 share units of it are locked forever (guards the share price against rounding games). |
| `withdraw(shares)` | Pays `shares * NAV / total_shares`, rounded down, from idle USDC. Fails if idle USDC is not enough. Funds free up when series are swept. The web app shows what can be withdrawn now. |
| `seed_series(series)` | Anyone, once per series. Allocation = `min(NAV * SERIES_ALLOC_BPS / 10000, idle USDC)`. The allocation moves into the series collateral and mints that many pairs for the vault. Adds the series to the active list. |
| `sweep_series(series)` | Anyone, after settlement. Redeems all vault-owned units of the series into idle USDC and removes the series from the active list. |

### 9.3 Parameters

| Parameter | Value |
|---|---|
| `SERIES_ALLOC_BPS` | 1,000 (10% of NAV per series) **(initial)** |
| Active series | At most 8 |

The vault's worst loss on one series is its allocation to that series. That is the risk cap per series.

## 10. Locks (Bill Lock and Revenue Lock)

A lock is a pool buy whose claims stay in escrow under a lock account. Bill Lock buys UP. Revenue Lock buys DOWN.

### 10.1 Size

With `W = upper - lower` in USD and `f = (expiry_ts - now) / duration` (the part of the period that is left):

```
claims = hours * W / f
```

`hours` is the GPU-hours the user expects in the rest of the period. At the start of a series (`f = 1`) this is the approved rule: claims = hours x band width. The web app proposes `hours` from the user's real bill of the last 30 days and lets the user change it. It warns when `f < 0.5`.

### 10.2 Worked example (use it as a test)

Rina rents an RTX 4090 for 400 hours a month. Band $0.40 to $0.60 (`W` = $0.20). She needs 400 x 0.20 = 80 UP claims. At a pool price of 0.50 she pays about $40 before the fee.

| Average price of the month | GPU bill | Value of 80 UP | Gain or loss on claims | Net cost |
|---|---|---|---|---|
| $0.30 (below the band) | $120 | $0 | -$40 | $160 |
| $0.40 | $160 | $0 | -$40 | $200 |
| $0.50 | $200 | $40 | $0 | $200 |
| $0.60 | $240 | $80 | +$40 | $200 |
| $0.70 (above the band) | $280 | $80 | +$40 | $240 |

Budi rents out his RTX 4090 for 400 hours and buys 80 DOWN for about $40. His net revenue stays $200 for any average between $0.40 and $0.60.

### 10.3 What the user must be told before locking

1. It is a two-way lock, not one-way insurance. If the price falls, the bill is cheaper but the claims lose value.
2. Protection only holds inside the band.
3. The largest loss is the amount paid.
4. The user's own bill can differ from the index. The app shows the user's rate next to the index before locking.

### 10.4 Lock instructions

| Instruction | Rule |
|---|---|
| `open_lock(side, usdc_in, min_claims_out, hours, ref_rate, auto_roll)` | Buys through the pool (section 8.3). Claims go to the escrow of the lock. One lock per owner, series and side. Calling it again adds to the lock. `hours` and `ref_rate` (the user's own rate from the bill) are stored for display only. |
| `close_lock(min_usdc_out)` | Owner only. Before `close_ts`: sells the claims through the pool. After settlement: redeems them. Between `close_ts` and settlement it fails. Pays the owner and closes the lock. |
| `withdraw_lock_claims()` | Owner only. Moves the claims to the owner's wallet and closes the lock. |
| `set_auto_roll(on)` | Owner only |
| `roll_lock()` | Anyone, after settlement, when `auto_roll` is on. Redeems the claims, then buys `hours * W_new` claims of the same side in the current series of the same class and kind, spending at most the redeemed amount. What is left goes to the owner's USDC account. If the amount is too small, it buys what it can. The new lock keeps `hours` and `auto_roll`. |

## 11. Settlement and redeem

`settle_series()` can be called by anyone once `now >= expiry_ts`. The result does not depend on who calls it or when.

```
avg        = (cum_price(expiry_ts) - start_cum_price) / (cum_valid(expiry_ts) - start_cum_valid)
up_value   = clamp(floor((avg - lower) * 1000000 / (upper - lower)), 0, 1000000)     micro-USDC per claim
down_value = 1000000 - up_value
```

| Case | Rule |
|---|---|
| No counted time in the period (the oracle was down the whole time) | `avg = start_index` |
| The observation ring no longer reaches back to `expiry_ts` (nobody settled for more than 14 days) | Use the oldest observation still stored |
| Coverage | `counted time / duration` is stored and shown on the proof page |

`redeem(side, amount)`: burns `amount` units and pays `floor(amount * value / 1000000)` micro-USDC. Works for any holder at any time after settlement, forever.

## 12. Test USDC

On devnet the collateral is a test USDC mint (`tUSDC`, 6 decimals) with its own small faucet program: 1,000 tUSDC per wallet per 24 hours. The main program takes the collateral mint from its config, so mainnet would use real USDC without a code change. The web app always labels the token as a test token.

## 13. Roles and trust

| Role | Can do | Cannot do |
|---|---|---|
| Anyone | Create, seed, settle, sweep, roll | |
| User | Mint, merge, trade, lock, redeem, deposit, withdraw | |
| Reporter | Send price reports for a class | Anything else. One reporter alone cannot move the index once the quorum is 2. |
| Config admin | Add a class, set the reporter list and quorum of a class, set bounds, half widths and fees for future updates and future series. The sources of a class are fixed when it is created. The admin is set once, by the program's upgrade authority. | Move collateral, pool or vault funds. Change a live or settled series. Stop mint, merge, redeem or withdraw. |
| Program upgrade authority | Upgrade the program (devnet, during the hackathon) | |

**The deployed program must be verified (D-041).** Every devnet deploy that others rely on is a verifiable build of a commit in the repo. The README gives the exact command that shows the on-chain program matches that source, so the upgrade authority cannot swap in code that nobody can read.

Honest limits: the upgrade authority, the admin's control of the reporter list, and the reporters themselves are trust points. All three are stated in the README. A mainnet version needs a timelock or a frozen program, and outside reporters.

## 14. Invariants (must hold, test them)

1. Before settlement: UP supply = DOWN supply = USDC in the series collateral account (the account may hold more through dust or donations, never less).
2. After settlement: `up_value + down_value = 1,000,000`, and the sum of all redeem payouts is at most the collateral at settlement.
3. A series never changes after creation: band, times, fees, start snapshot.
4. Settlement gives the same result for any caller at any time, while the observation ring still reaches `expiry_ts`.
5. After every pool trade `pool_up * pool_down` is at least its value before the trade. Re-centering changes no balance of any user.
6. `pool_up + inv_up` and `pool_down + inv_down` equal the balances of the two series token accounts (donations aside).
7. Vault: `deposit` then `withdraw` in the same slot never returns more than was put in. Share supply times share price never exceeds NAV.
8. The index only changes through an accepted update. Too few reporters, too few sources, too little weight or stale reports change nothing. Only a registered reporter can send a report, and a report is used in at most one update.
9. No instruction lets the admin or anyone else move collateral, pool funds or vault funds except by the rules above.
10. A lock's claims can only leave the escrow through `close_lock`, `withdraw_lock_claims` or `roll_lock`.

## 15. Out of scope and deferred

- Mainnet, audits, legal review. The product is a derivative. Its legal status is not resolved. It runs on devnet with test tokens.
- Deferred: an Android app for the Solana Mobile track, and a "pure cap" series (small premium, the user still gains when the price falls), which needs a longer index history to price.
- Not doing: access for AI agents, and position limits based on proof of a bill.
- Not in this version: a vault management fee, scaling the lock size by the ratio of the user's rate to the index, more than two GPU classes.
