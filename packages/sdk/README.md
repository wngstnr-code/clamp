# @clamp/sdk

TypeScript SDK for Clamp, a two-way GPU rental price lock on Solana (devnet). It carries the program IDL and types, the PDA helpers, readers for the index, the market, the vault and locks, the pool math (equal to the program's), the bill and earnings parsers, and a settlement proof anyone can run.

Program `wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC` on devnet. Amounts are integers with 6 decimals: prices in micro-USD per GPU-hour (`363600` = $0.3636), claims and tUSDC in micro units.

## Build

```
pnpm build:sdk     # from the repo root
pnpm test:sdk
```

## Example: from a bill to a checked settlement

```ts
import { Connection } from "@solana/web3.js";
import {
  CLASS_RTX4090, KIND_DAILY, SIDE_UP,
  currentSeries, getIndex, getTwap, lockSizeFromBill, quoteCostFor, seriesPda, verifySettlement,
} from "@clamp/sdk";

const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const now = Math.floor(Date.now() / 1000);

// 1. The index and its average over the last 24 hours
const index = await getIndex(conn, CLASS_RTX4090);
const twap = await getTwap(conn, CLASS_RTX4090, now - 86_400, now);
console.log("index", index?.lastPrice, "24 h average", twap.average);

// 2. The live daily series and the size of a Bill Lock for 120 GPU-hours a month
const series = await currentSeries(conn, CLASS_RTX4090, KIND_DAILY);
if (series && index) {
  // spec 10.1 at the bill's pace: hours * band width / part of the period left
  const size = lockSizeFromBill(120, series, now);
  if (size && size.claims > 0n) {
    const q = quoteCostFor(series, index, SIDE_UP, size.claims, now);
    console.log("claims", size.claims, "hours", size.hours, "late in period", size.lateInPeriod, "cost", q.blocked ?? q.usdcIn);
  }
}

// 3. Recompute a settled series from the on-chain index history
if (series && series.seq > 0) {
  const previous = seriesPda(CLASS_RTX4090, KIND_DAILY, series.seq - 1);
  const check = await verifySettlement(conn, previous);
  console.log("settlement", check.status, check.differences);
}
```

## What is in it

| Area | Functions |
|---|---|
| Program | `CLAMP_IDL`, `clampProgram(connection, wallet?)`, `KeypairWallet`, the generated `Clamp` type |
| PDAs | `configPda`, `classPda`, `indexPda`, `seriesPda`, `seriesAccounts`, `vaultPda`, `sharesMintPda`, `idlePda`, `lockPda`, `escrowPda`, faucet PDAs |
| Index | `getIndex`, `getObservations`, `getTwap`, `twapFromObservations`, `verifyReport` (a report against its public raw files) |
| Market | `getSeries`, `listSeries`, `currentSeries`, `seriesFairValue`, `quoteBuy`, `quoteSell`, `quoteCostFor`, `getVault` |
| Locks | `getLocks(owner?)`, `getLock`, `lockSizeFromBill` (from a bill, the one to use), `hoursForRest`, `lockSize`, `lockValueNow` (what `close_lock` pays now), `lockOutcomes` (the outcome table) |
| Bills | `parseVastBill`, `parseRunpodBill`, `parseBillFile` (in the browser), `assignLine` |
| Earnings | `parseVastEarnings`, `parseEarningsFile`, `assignMachine`, `getNosanaEarnings` (public job history, no key) |
| Proof | `verifySettlement`, `checkSettlement`, `computeSettlement` (mirror of `settle_series`) |
| Math | `math/pool`, `math/twap`, `math/vault`, `math/median`: mirrors of the program's integer math, tested against shared vectors |

The bill and earnings parsers never guess a GPU: a line with an unknown GPU stays in `unassigned` until the user names it. Hours that are estimated (Runpod bills, Vast.ai earnings from the listed price) are marked as such.

Bills and Vast.ai earnings come through the stateless proxy of the backend (`POST /bill/vast`, `POST /bill/runpod`, `POST /earnings/vast`, key in the `X-Provider-Key` header, never stored). The routes and types are in `docs/architecture.md` section 5.

## Limits

Devnet and test USDC only. The index is reported by the team's own reporters (see the repo README). Nothing here is audited.
