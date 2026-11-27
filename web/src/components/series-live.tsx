"use client";

import { getIndex, getSeries, type IndexView, quoteBuy, quoteSell, type SeriesView, SIDE_DOWN, SIDE_UP } from "@clamp/sdk";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { amount2, micro, p4, poolPrices, ppm } from "@/lib/market";
import { mintOrMerge, parseAmount, redeemAll, trade, userAccounts } from "@/lib/market-tx";
import { Icon } from "./icon";

type Balances = { usdc: bigint; up: bigint; down: bigint };
type State = { series: SeriesView; index: IndexView | null };

/** Fresh series, index and wallet balances, re-read every 20 s and after every transaction. */
function useSeriesLive(address: string) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [state, setState] = useState<State | null | "error">(null);
  const [balances, setBalances] = useState<Balances | null>(null);

  const refresh = useCallback(async () => {
    try {
      const series = await getSeries(connection, new PublicKey(address));
      if (!series) return setState("error");
      const index = await getIndex(connection, series.classId);
      setState({ series, index });
      if (!wallet) return setBalances(null);
      const user = userAccounts(series, wallet.publicKey);
      // A missing token account means a balance of 0.
      const read = (a: PublicKey) => connection.getTokenAccountBalance(a).then((b) => BigInt(b.value.amount), () => 0n);
      const [usdc, up, down] = await Promise.all([read(user.collateral), read(user.up), read(user.down)]);
      setBalances({ usdc, up, down });
    } catch {
      setState((s) => (s && s !== "error" ? s : "error"));
    }
  }, [connection, address, wallet]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { state, balances, wallet, connection, refresh };
}

const TABS = ["Buy", "Sell", "Mint", "Merge"] as const;
type Tab = (typeof TABS)[number];

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-ink-2">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

function Result({ sig, error }: { sig: string | null; error: string | null }) {
  if (error) return <p className="rounded-[14px] bg-[#fbe7e3] px-4 py-3 text-sm text-down">{error}</p>;
  if (!sig) return null;
  return (
    <a
      href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-[14px] bg-[#dff3ea] px-4 py-3 text-sm font-semibold text-up"
    >
      <Icon name="check" className="size-4" />
      Done. See the transaction
      <Icon name="external-link" className="ml-auto size-4" />
    </a>
  );
}

/** Turns a wallet or program error into one plain sentence. */
function plain(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(msg)) return "You cancelled the transaction in your wallet.";
  if (/slippage|MinOut|0x1771/i.test(msg)) return "The price moved before your trade landed. Nothing was spent. Try again.";
  if (/insufficient/i.test(msg)) return "Not enough balance for this, including the network fee in SOL.";
  return `The transaction failed: ${msg.slice(0, 160)}`;
}

/** The trade panel of a series in every state of the design: no wallet, not enough tUSDC, closed, settled. */
export function TradePanel({ address }: { address: string }) {
  const { state, balances, wallet, connection, refresh } = useSeriesLive(address);
  const { setVisible } = useWalletModal();
  const [tab, setTab] = useState<Tab>("Buy");
  const [side, setSide] = useState(SIDE_UP);
  const [text, setText] = useState("100");
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state === null) return <div className="h-[520px] animate-pulse rounded-[32px] bg-surface" />;
  if (state === "error")
    return <p className="rounded-[32px] bg-surface p-7 text-sm text-ink-2">This series cannot be read from Solana right now.</p>;

  const { series: s, index } = state;
  const now = Math.floor(Date.now() / 1000);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setSig(null);
    setError(null);
    try {
      setSig(await fn());
      await refresh();
    } catch (e) {
      setError(plain(e));
    } finally {
      setBusy(false);
    }
  };

  // Settled: redeem what the wallet holds.
  if (s.settled) {
    const up = ppm(s.upValue);
    const get = balances ? micro(balances.up) * up + micro(balances.down) * (1 - up) : 0;
    const holds = balances && (balances.up > 0n || balances.down > 0n);
    return (
      <section className="flex flex-col gap-4 rounded-[32px] bg-surface p-6 shadow-[0_12px_32px_rgba(17,19,24,0.06)] md:p-7">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">Final result</h2>
          <span className="flex items-center gap-1.5 rounded-full bg-[#dff3ea] px-3 py-1.5 text-[13px] font-semibold text-up">
            <Icon name="check" className="size-3.5" />
            Settled
          </span>
        </div>
        <Row k="Average" v={`$${(micro(s.avg)).toFixed(4)}`} />
        <Row k="UP pays" v={`$${p4(up)} each`} />
        <Row k="DOWN pays" v={`$${p4(1 - up)} each`} />
        {balances && <Row k="You hold" v={`${amount2(micro(balances.up))} UP, ${amount2(micro(balances.down))} DOWN`} />}
        <div className="flex flex-col gap-1 rounded-[18px] bg-surface-2 p-4">
          <span className="text-[13px] text-ink-2">You receive</span>
          <span className="font-mono text-[28px]">{amount2(get)} tUSDC</span>
        </div>
        {!wallet ? (
          <button onClick={() => setVisible(true)} className="h-12 rounded-full bg-ink font-semibold text-white">
            Connect wallet
          </button>
        ) : (
          <button
            disabled={!holds || busy}
            onClick={() => run(() => redeemAll(connection, wallet, s, balances!.up, balances!.down))}
            className="h-12 rounded-full bg-brand font-semibold text-white disabled:bg-line disabled:text-muted"
          >
            {busy ? "Waiting for your wallet..." : holds ? "Redeem all" : "Nothing to redeem"}
          </button>
        )}
        <Result sig={sig} error={error} />
        <Link href={`/proof/${address}`} className="flex items-center gap-1.5 text-sm font-semibold text-brand">
          Check this settlement on the proof page
          <Icon name="arrow-up-right" className="size-4" />
        </Link>
      </section>
    );
  }

  const closed = now >= s.closeTs;
  const prices = index && s.seeded ? poolPrices(s, index, now) : null;
  const amount = parseAmount(text);
  const isTrade = tab === "Buy" || tab === "Sell";
  const sideLabel = side === SIDE_UP ? "UP" : "DOWN";
  const fee = Number(s.tradeFeeBps) / 100;

  // What the action needs from the wallet, and what it gives back.
  const quote =
    amount && index && isTrade
      ? tab === "Buy"
        ? quoteBuy(s, index, side, amount, now)
        : quoteSell(s, index, side, amount, now)
      : null;
  const need = !balances || !amount ? 0n : tab === "Sell" ? (side === SIDE_UP ? balances.up : balances.down) : tab === "Merge" ? (balances.up < balances.down ? balances.up : balances.down) : balances.usdc;
  const short = balances && amount ? amount > need : false;
  const balanceLabel = !balances
    ? null
    : tab === "Sell"
      ? `${amount2(micro(need))} ${sideLabel}`
      : tab === "Merge"
        ? `${amount2(micro(need))} pairs`
        : `${amount2(micro(balances.usdc))} tUSDC`;
  const blockedText =
    quote?.blocked === "paused"
      ? "The pool is paused: the outcome is almost certain."
      : quote?.blocked === "not_seeded"
        ? "The pool has no liquidity yet."
        : null;
  const tradeOff = isTrade && (closed || !!blockedText);

  const submit = () => {
    if (!wallet || !amount) return;
    if (tab === "Mint" || tab === "Merge") return run(() => mintOrMerge(connection, wallet, s, tab === "Merge", amount));
    if (!quote || quote.blocked) return;
    // Accept at most 1% less than the quote.
    return run(() => trade(connection, wallet, s, tab === "Buy", side, amount, (quote.out * 99n) / 100n));
  };

  return (
    <div className="flex flex-col gap-3">
      {closed && (
        <div className="flex gap-3 rounded-[18px] bg-[#fdf3d6] px-5 py-4">
          <Icon name="triangle-alert" className="mt-0.5 size-[18px] shrink-0 text-[#9a6b00]" />
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-bold">Trading closed</p>
            <p className="text-sm text-ink-2">
              The pool is paused. Settlement opens at {new Date(s.expiryTs * 1000).toISOString().slice(11, 16)} UTC, then
              anyone can trigger it. Mint and merge still work until then.
            </p>
          </div>
        </div>
      )}
      <section className="flex flex-col gap-4 rounded-[32px] bg-surface p-5 shadow-[0_12px_32px_rgba(17,19,24,0.06)] md:p-6">
        <div role="tablist" className="grid grid-cols-4 gap-1 rounded-full bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              onClick={() => {
                setTab(t);
                setSig(null);
                setError(null);
              }}
              className={`rounded-full py-2 text-sm font-semibold ${t === tab ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {isTrade && (
          <div className="grid grid-cols-2 gap-3">
            {[SIDE_UP, SIDE_DOWN].map((sd) => {
              const on = sd === side;
              const up = sd === SIDE_UP;
              return (
                <button
                  key={sd}
                  onClick={() => setSide(sd)}
                  aria-pressed={on}
                  className={`flex flex-col gap-1 rounded-[18px] p-4 text-left ring-1 ${
                    on ? (up ? "bg-[#dff3ea] ring-up" : "bg-[#fbe7e3] ring-down") : "ring-line"
                  }`}
                >
                  <span className={`text-sm font-bold ${up ? "text-up" : "text-down"}`}>{up ? "UP" : "DOWN"}</span>
                  <span className="text-[13px] text-ink-2">{up ? "Pays if prices rise" : "Pays if prices fall"}</span>
                  <span className="mt-1 font-mono text-xl">{prices ? p4(up ? prices.up : prices.down) : "n/a"}</span>
                </button>
              );
            })}
          </div>
        )}

        <label className={`flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4 ring-1 ${short ? "ring-down" : "ring-transparent"}`}>
          <span className="flex justify-between text-[13px] text-ink-2">
            <span>{tab === "Buy" ? "You pay" : tab === "Sell" ? "You sell" : tab === "Mint" ? "You put in" : "Pairs to merge"}</span>
            {balanceLabel && <span>Balance {balanceLabel}</span>}
          </span>
          <span className="flex items-center gap-3">
            <input
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Amount"
              className="w-full min-w-0 bg-transparent font-mono text-[28px] outline-none"
            />
            <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-[13px] font-semibold">
              {tab === "Buy" || tab === "Mint" ? "tUSDC" : tab === "Sell" ? sideLabel : "pairs"}
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-2">
          {!amount ? (
            <p className="text-sm text-ink-2">Enter an amount, up to 6 decimals.</p>
          ) : isTrade ? (
            quote && !quote.blocked ? (
              <>
                <Row
                  k="You receive"
                  v={tab === "Buy" ? `about ${amount2(micro(quote.out))} ${sideLabel}` : `about ${amount2(micro(quote.out))} tUSDC`}
                />
                {quote.out > 0n && (
                  // The pool is a curve: a big order pays more per claim than the price shown above.
                  <Row
                    k="Average price"
                    v={p4(tab === "Buy" ? Number(amount) / Number(quote.out) : Number(quote.out) / Number(amount))}
                  />
                )}
                <Row k={`Fee, ${fee}%`} v={`${amount2(micro(quote.fee))} tUSDC`} />
                {tab === "Buy" && <Row k="Most you can lose" v={`${amount2(micro(amount))} tUSDC`} />}
              </>
            ) : (
              <p className="text-sm text-ink-2">{blockedText ?? (closed ? "Trading is closed for this series." : "No quote right now.")}</p>
            )
          ) : tab === "Mint" ? (
            <Row k="You receive" v={`${amount2(micro(amount))} UP and ${amount2(micro(amount))} DOWN`} />
          ) : (
            <Row k="You receive" v={`${amount2(micro(amount))} tUSDC`} />
          )}
        </div>

        {!wallet ? (
          <button onClick={() => setVisible(true)} className="h-12 rounded-full bg-ink font-semibold text-white">
            Connect wallet
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={busy || !amount || short || tradeOff || (isTrade && !quote?.out)}
            className="h-12 rounded-full bg-brand font-semibold text-white disabled:bg-line disabled:text-muted"
          >
            {busy
              ? "Waiting for your wallet..."
              : tradeOff
                ? "Trading closed"
                : short
                  ? tab === "Buy" || tab === "Mint"
                    ? "Not enough tUSDC"
                    : `Not enough ${tab === "Sell" ? sideLabel : "pairs"}`
                  : tab === "Buy"
                    ? `Buy ${sideLabel}`
                    : tab === "Sell"
                      ? `Sell ${sideLabel}`
                      : tab === "Mint"
                        ? "Mint pairs"
                        : "Merge pairs"}
          </button>
        )}
        {short && (tab === "Buy" || tab === "Mint") && (
          <Link href="/faucet" className="flex items-center gap-1.5 text-sm font-semibold text-brand">
            <Icon name="flask-conical" className="size-4" />
            Get 1,000 test tUSDC
          </Link>
        )}
        <Result sig={sig} error={error} />
      </section>
      <p className="px-2 text-center text-[13px] text-muted">Prices follow the index. The pool re-centers after every update.</p>
    </div>
  );
}

/** What the connected wallet holds in this series and what it is worth at the pool price. */
export function YourClaims({ address }: { address: string }) {
  const { state, balances, wallet } = useSeriesLive(address);
  const series = state && state !== "error" ? state.series : null;
  const index = state && state !== "error" ? state.index : null;
  const holds = balances && (balances.up > 0n || balances.down > 0n);
  const now = Math.floor(Date.now() / 1000);
  const prices = series && index && !series.settled && series.seeded ? poolPrices(series, index, now) : null;

  return (
    <section className="flex items-center gap-5 rounded-[32px] bg-surface p-6 md:p-7">
      <Image src="/landing/clam-renter.jpg" alt="" width={64} height={64} className="size-16 shrink-0 rounded-full object-cover" />
      {!wallet ? (
        <div className="flex flex-col gap-1">
          <p className="font-extrabold">Your claims</p>
          <p className="text-sm text-ink-2">Connect a wallet to see what you hold in this series.</p>
        </div>
      ) : !holds ? (
        <div className="flex flex-col gap-1">
          <p className="font-extrabold">No claims in this series yet</p>
          <p className="text-sm text-ink-2">Buy a side or mint a pair to start.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-extrabold">Your claims</p>
            <p className="font-mono text-sm">
              <span className="text-up">{amount2(micro(balances.up))} UP</span>,{" "}
              <span className="text-down">{amount2(micro(balances.down))} DOWN</span>
            </p>
          </div>
          {prices && (
            <p className="text-sm text-ink-2">
              Worth about{" "}
              <span className="font-mono text-ink">
                {amount2(micro(balances.up) * prices.up + micro(balances.down) * prices.down)} tUSDC
              </span>{" "}
              at the pool price
            </p>
          )}
        </div>
      )}
    </section>
  );
}
