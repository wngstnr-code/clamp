# Dev3pack Global Hackathon: what matters for Clamp

Official sources: https://hack.dev3pack.xyz/ and https://hack.dev3pack.xyz/faq (read the live version before submitting, rules can change). Facts below were collected on 2026-11-16, 2026-11-17 and (dashboard) 2026-11-19.

## 1. Dates

| Event | Date | Note |
|---|---|---|
| Registration | Before the event, as early as possible | Apply at https://app.dev3pack.xyz/hackathon/register. Applications are reviewed: once accepted, the applicant's email is whitelisted and can sign up at hack.dev3pack.xyz/auth/sign-up. **Both AG and Wangsit must apply and be accepted**, then one creates a team in the dashboard (hack.dev3pack.xyz/dashboard/teams) and the other joins with the 6-character code. Submission happens in the same dashboard, so no acceptance means no submission. |
| Hackathon window | 2026-11-27 to 2026-11-29 | Hybrid, with build stations (Jakarta and Semarang among them) |
| **Submission** | **Sunday 2026-11-29, 12:00 to 14:00 WIB (05:00 to 07:00 UTC)** | Dashboard schedule ("Project Submission"). Checked again on 2026-11-27 23:53 WIB: the dashboard countdown ends at **14:00 WIB on 2026-11-29**, the hard cutoff. We still aim for 12:00 WIB: everything (repo public, README, video, live link, verified deploy) must be ready by the morning of 2026-11-29. |
| Kick off | Friday 2026-11-27, 22:00 to 23:00 WIB | Dashboard schedule |
| Project feedback session | Saturday 2026-11-28, 20:00 to 22:00 WIB | Dashboard schedule. A chance to show a working draft. |
| Closing and winners | Sunday 2026-11-29, 22:00 to 23:00 WIB | Dashboard: "Closing Ceremony & Winners Announcement", one global event (checked 2026-11-27) |
| Global Demo Day | Tuesday 2026-12-01, 20:00 to 22:00 WIB | Dashboard schedule, after the winners announcement |
| Bootcamp (optional) | 2026-11-24 to 2026-11-27, 20:00 WIB | Solana Rust Bootcamp, separate registration |
| Accelerator application | by 2026-12-03 | Bridge Accelerator, 8 weeks, 0% equity |

## 2. Prizes

| Prize | Amount | Note |
|---|---|---|
| Best app overall | $5,000 (1st 2,500 USDC, 2nd 1,500, 3rd 1,000) | Dashboard "Tracks & Prizes" on 2026-11-19. One load of the same page showed $10,000 with 3,000, 2,500 and 1,500 plus Ledgers for the top 10, Claude Pro for the top 30 and a $500 bonus for x402; a reload showed $5,000. Treat the amounts as unconfirmed. |
| Local prizes | $500+ in 19 countries | Indonesia was not on the list on 2026-11-17; the dashboard now lists Superteam Indonesia local prizes as a side track (submitted externally). Our target is the global top 3. |
| Solana Mobile track | Seeker phones | We do not have a Seeker. Deferred (D-014). |
| Gaming track | With Byte Arena | Not for us |
| Top 30 | Claude Pro | |

Prize tracks on the dashboard (checked 2026-11-27): Best App Overall on Solana ($5,000), Best DeFi App on Solana ($250), Best Agentic App on Solana, Best Seeker Mobile App (Seeker phones), Firecrawl ($1,197 per team member), ElevenLabs ($897 per team member), Pollar ($500), Byte game ($500), **Supabase ($100 per team member)**, plus perks and an accelerator. FAQ: every project is in the main Solana track; a team may also opt into partner tracks "that your project actually uses", and judges check the requirements.

Tracks that fit Clamp without any change: **Supabase** (we really use it: Postgres tables, `pg_cron` for the 15 minute tick, the `raw` storage bucket for the reporters' archive) and **Best DeFi App** (fully collateralized claims, a pool and a vault). Opt into both at submission; the README must show the Supabase use plainly. Do not opt into tracks we do not use.

FAQ on earlier work (checked 2026-11-27): building before the hackathon is allowed if the project is Solana-related and at least one feature is added during the hackathon (M3 to M6 were).

Partners named so far: ElevenLabs, Firecrawl, Supabase, Noah AI, Pollar (Latin America only). Partner tracks were not announced yet on 2026-11-17. When they are, check once whether one fits without changing the product.

Qualification (dashboard, 2026-11-19): project name and short description; a unique Solana program in Rust deployed at least to devnet; the program addresses in the README; a public GitHub repo with README and setup steps; a demo video under 3 minutes and a live demo link. Bonus: consistent and considerable use of Solana libraries and SDKs. Side tracks listed there (submitted externally): Colosseum Accelerator, Superteam Indonesia local prizes. Other track names seen once: LI.FI, Virtuals, Solana Mobile, ElevenLabs (not checked in detail).

## 3. Judging

Two stages, each with a Product rubric and a Technical rubric. No weights and no judge names are published.

| Stage | What happens |
|---|---|
| 1 | All entries are screened down to the top 100 |
| 2 | Code inspection, founder-market fit, and a check that the live demo really works |

| Signal | Clamp's answer |
|---|---|
| Rule compliance | Built on Solana, open source, verified program on devnet |
| Product clarity | "Lock your GPU rental price" |
| Real-world impact | A measurable budget problem for small GPU renters |
| Demo quality | A real bill, a real index, a series that really settled |
| Deployment | The index and a weekly series run on devnet before demo day |
| Repo quality | Open code, tests, honest notes on limits |
| Depth of Solana and SDK use | Index combined on-chain from a reporter quorum, on-chain period average, claims, pool, vault, locks |
| Founder-market fit | Our weakest signal. See section 8. |

## 4. Rules that affect us

- Must be built on Solana. Open source is mandatory.
- Team of 1 to 4. We are 2. Every member applies on their own and is added to the team in the dashboard (the submission form has a "confirm team members" step).
- Build stations (Jakarta, Semarang and others) are optional. Everything, including submission, can be done online.
- A devnet or mainnet program address is required.
- Code written before the hackathon is allowed if it is Solana-related and the README says clearly what was built before and what during.
- AI tools are allowed.
- Forking another hackathon project means disqualification.
- The demo video must be under 3 minutes (longer is rejected) and must show the real product.

## 5. What won the last edition (May 2026, 382 projects)

Top places went to crypto inheritance, privacy, commitment tools, parametric insurance for AI agents and an Indonesian judging tool. Places 11 to 30 were mostly AI agents and agent payments. Crowded themes to stay away from: inheritance, agent payments, prediction markets, neobanks, trading card games. Facts on the top 10, checked on 2026-11-18 from the official winners thread on X (11 May 2026) and the winners' public repos:

| Question | Answer |
|---|---|
| Devnet or mainnet at submission | Devnet: 10 of 10. None was on mainnet. The FAQ says both are accepted. |
| Fresh or earlier work | 7 of 10 were built fresh during the event week. 3 of 10 (all in the top 5) had 1 to 4 months of earlier commits. |
| After the hackathon | 5 of the top 10 reached the Bridge accelerator demo day. None was confirmed live on mainnet by November. |
| Closest to our topic | Place 7 was a GPU rental marketplace (a different product: matching renters and hosts, not a price lock). Judges have seen the GPU theme once, so our pitch must make the price lock and the index the clear difference. |

So devnet is normal for winners, and earlier work is normal as long as it is disclosed.

The official top 10 (dev3pack thread on X, 11 May 2026, checked again on 2026-11-28; 382 projects, 682 hackers, 84 countries):

| # | Project | Country | What it does |
|---|---|---|---|
| 1 | Afterlife | Costa Rica | Decentralized crypto inheritance. Joined the Bridge Accelerator |
| 2 | Protocol 01 | France, Ireland | Privacy. Solo build, about three months of earlier work (the builder's own post) |
| 3 | Commit | Ghana | Commitment tool |
| 4 | Covantic | Ukraine | Parametric insurance for AI agents, claims paid in USDC after an on-chain loss check |
| 5 | Heirloom | Kenya | Crypto inheritance |
| 6 | Judge Chain | Indonesia | Judging tool |
| 7 | APIS | France | GPU rental marketplace |
| 8 | Mazrat'al Albaan | South Africa | Not checked |
| 9 | LiiLend | Kenya | Not checked |
| 10 | Dead Man's Switch | Malaysia | Crypto inheritance |

Top 3 prizes were $3,000, $2,500 and $1,500 (Solana Costa Rica, 14 May 2026). A first place per country got fast-track access to the Bridge Accelerator (a Mexico winner's post, 13 May 2026).

## 6. Submission checklist

- [ ] Both members applied, accepted, signed up, and in one team in the dashboard
- [ ] Project name and one-liner
- [ ] Program address (devnet), deployed from a verifiable build, with the verify command in the README (D-041)
- [ ] Description
- [ ] Images (screenshots)
- [ ] Demo video under 3 minutes
- [ ] Public repo with a README that has exact "do X, see Y" steps and the "before" and "during" sections
- [ ] Live link
- [ ] License file
- [ ] Hosted demo checked from a clean browser and a phone
- [ ] `node scripts/check-dashes.mjs` passes, all tests pass

## 7. Demo script (under 3 minutes)

The first 30 seconds are the wow moment. Everything shown is real.

| Time | Show | Say |
|---|---|---|
| 0:00 to 0:10 | A real GPU bill, read from the rental account | "This is a real GPU bill. Next month it can be 20% higher, and the budget cannot." |
| 0:10 to 0:20 | The Clamp Index chart with its four sources | "This is the rental price from four real providers, recorded on Solana every 15 minutes." |
| 0:20 to 0:30 | Click "Lock", the transaction confirms | "One click. The bill is locked for this period." |
| 0:30 to 1:10 | The outcome table of the lock, then the same flow for a GPU owner | How UP and DOWN work, why the two sides need each other, no margin and no liquidation |
| 1:10 to 1:50 | A series that already settled, then the proof page recomputing it | "Anyone can check the payout from the on-chain data." |
| 1:50 to 2:20 | The vault page and the index read by a small code example | Who provides liquidity, and the index as a public good |
| 2:20 to 2:50 | Pilot users and interview numbers, honest limits, what is next | Founder-market fit and the road after the hackathon |

The settled series must be real, so the first series has to start well before demo day (see the hard dates in `development-plan.md`). The bill belongs to a pilot user (with their permission) or is our own small bill from testing.

## 8. Founder-market fit plan

We are Solana builders, not GPU renters. Our fit comes from access to users, and we say so.

| Proof | Target |
|---|---|
| Named pilot users | At least one renter and one GPU owner who try it on devnet |
| Index history | Published from 2026-11-20, more than a week of real data by demo day |
| Interviews | 10 or more renters, with their bill numbers in the pitch |
| Our own small bill | From renting an RTX 4090 for a small real job while testing |

Never claim to be heavy GPU users.

## 9. Hard questions from judges

| Question | Honest answer |
|---|---|
| Who is on the other side? | GPU owners, who need the opposite direction. The vault fills the gap. Early liquidity is small. |
| My bill is not the index. | True. The app shows the user's rate next to the index before locking. The rest is the user's risk. |
| Can the index be manipulated? | Median over sources, empty sources left out, a step limit and a period average make it expensive. H100 is thin, which is why RTX 4090 is the primary class. |
| GPU prices tend to fall. Who wants a lock? | GPU owners fear exactly that. The band is re-centered every period, and 2026 showed the risk goes both ways. |
| Why a blockchain? | Collateral locked in a program, automatic settlement anyone can check, any size, and GPU owners already have Solana wallets. |
| It is a derivative. Is it legal? | Not resolved. It runs on devnet with test tokens. |
| What is your experience here? | We build on Solana. The proof is in pilot users, index history and interviews. |
| Who runs the oracle? | We do, on devnet: three reporters on separate platforms, a quorum of two, a median per source. The oracle network we first planned to use shut down in September 2026, and no live network carries GPU rental prices. Every report has its raw API response in public and the hash on-chain, so anyone can check any number. For mainnet: outside reporters with a bond, or zkTLS proofs. |
| Regulated exchanges now list compute futures. Why this? | Those contracts are large and need a broker. A student with a $200 bill cannot use them. Check the latest contract sizes before the pitch (`research.md` section 2). |
| Who controls it? | On devnet the program is upgradeable and an admin sets the reporter list. Neither can touch funds or a live series. Both are stated in the README. The program is a verified build: anyone can check that the code on-chain is the code in the repo. |

## 10. Links

- Site: https://hack.dev3pack.xyz/
- FAQ: https://hack.dev3pack.xyz/faq
- Announcements: https://x.com/dev3pack
