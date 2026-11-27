"use client";

import { getIndex, type IndexView, listSeries, quoteCostFor, type SeriesView, SIDE_DOWN, SIDE_UP, TUSDC_MINT } from "@clamp/sdk";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usd4 } from "@/lib/live-index";
import { amount2, CLASS_NAMES, KIND_NAMES, micro, timeLeft } from "@/lib/market";
import { trade } from "@/lib/market-tx";
import { Button } from "./button";
import { Icon } from "./icon";

type Side = "bill" | "revenue";
type Step = "connect" | "review" | "locked";
type Bill = { classId: number; hours: number; spent: number };
type Done = { sig: string; claims: number; paid: number; s: SeriesView; hours: number; rate: number };

const DAY = 86400;

function Steps({ step }: { step: Step }) {
  const all: [Step, string][] = [
    ["connect", "Connect"],
    ["review", "Review"],
    ["locked", "Lock"],
  ];
  const at = all.findIndex(([k]) => k === step);
  return (
    <ol className="flex items-center gap-2 text-sm font-semibold" aria-label="Steps">
      {all.map(([k, label], i) => (
        <li key={k} className="flex items-center gap-2">
          {i > 0 && <span className="h-px w-6 bg-line md:w-10" aria-hidden />}
          <span
            aria-current={i === at ? "step" : undefined}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 ${i === at ? "bg-ink text-white" : i < at ? "bg-surface text-ink-2" : "bg-surface text-muted"}`}
          >
            {label}
            {i < at && <Icon name="check" className="size-3.5 text-up" />}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Bill Lock (buys UP) and Revenue Lock (buys DOWN), spec 10. The user types the numbers of the last
 * 30 days; Clamp proposes hours and claims with `claims = hours * W / f` and buys them through the pool.
 */
export function LockFlow({ side }: { side: Side }) {
  const bill = side === "bill";
  const sideId = bill ? SIDE_UP : SIDE_DOWN;
  const sideName = bill ? "UP" : "DOWN";
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { setVisible } = useWalletModal();

  const [step, setStep] = useState<Step>("connect");
  const [form, setForm] = useState({ classId: 1, hours: "", spent: "" });
  const [entered, setEntered] = useState<Bill | null>(null);
  const [market, setMarket] = useState<{ series: SeriesView[]; index: Map<number, IndexView | null> } | null | "error">(null);
  const [pick, setPick] = useState<string | null>(null);
  const [hoursText, setHoursText] = useState("");
  const [ticks, setTicks] = useState([false, false, false, false]);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const load = useCallback(async () => {
    try {
      const series = await listSeries(connection);
      const index = new Map<number, IndexView | null>();
      for (const id of [1, 2]) index.set(id, await getIndex(connection, id));
      setMarket({ series, index });
    } catch {
      setMarket("error");
    }
  }, [connection]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!wallet) return setUsdc(null);
    connection
      .getTokenAccountBalance(getAssociatedTokenAddressSync(TUSDC_MINT, wallet.publicKey))
      .then((b) => setUsdc(BigInt(b.value.amount)), () => setUsdc(0n));
  }, [connection, wallet, done]);

  const now = Math.floor(Date.now() / 1000);
  const open = useMemo(
    () =>
      market && market !== "error" && entered
        ? market.series.filter((s) => s.classId === entered.classId && !s.settled && s.seeded && now < s.closeTs).sort((a, b) => b.kind - a.kind)
        : [],
    [market, entered, now],
  );
  const s = open.find((x) => x.address.toBase58() === pick) ?? open[0];
  const index = market && market !== "error" && entered ? (market.index.get(entered.classId) ?? null) : null;

  // Hours the user expects until the series ends, proposed from the last 30 days.
  const proposed = entered && s ? (entered.hours / 30) * ((s.expiryTs - now) / DAY) : 0;
  useEffect(() => {
    if (s) setHoursText(proposed.toFixed(1));
    // Re-propose only when the series or the bill changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.address.toBase58(), entered]);

  const submitBill = (e: React.FormEvent) => {
    e.preventDefault();
    const hours = Number(form.hours);
    const spent = Number(form.spent);
    if (!(hours > 0) || !(spent > 0)) return;
    setEntered({ classId: form.classId, hours, spent });
    setStep("review");
  };

  if (step === "locked" && done) {
    const W = micro(done.s.upper - done.s.lower);
    return (
      <section className="mt-8 grid grid-cols-[minmax(0,1fr)] items-center gap-8 rounded-[36px] bg-surface p-6 md:p-12 lg:grid-cols-[1fr_520px]">
        <div className="flex flex-col gap-5">
          <Image src={bill ? "/landing/clam-renter.jpg" : "/landing/clam-owner.jpg"} alt="" width={112} height={112} className="size-28 rounded-full object-cover" />
          <h2 className="text-[40px] leading-tight font-extrabold tracking-[-1px] md:text-[52px]">
            Your {bill ? "bill" : "revenue"} is locked.
          </h2>
          <p className="max-w-[460px] text-ink-2">
            {amount2(done.claims)} {sideName} now sit in your wallet. If the {CLASS_NAMES[done.s.classId]} average{" "}
            {bill ? "rises" : "falls"} inside the band, they pay back the {bill ? "extra rent" : "lost revenue"}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button href="/positions">See it in Positions</Button>
            <a
              href={`https://explorer.solana.com/tx/${done.sig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center gap-3 rounded-full bg-surface py-1.5 pr-1.5 pl-[22px] text-[15px] font-medium ring-1 ring-line"
            >
              View transaction
              <span className="grid size-9 place-items-center rounded-full bg-ink text-white">
                <Icon name="arrow-up-right" className="size-[17px]" />
              </span>
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-[28px] bg-surface-2 p-6">
          <h3 className="text-lg font-extrabold">Your {bill ? "bill" : "revenue"} lock</h3>
          {(
            [
              ["Class", CLASS_NAMES[done.s.classId]],
              ["Hours", `${done.hours.toFixed(1)} until ${new Date(done.s.expiryTs * 1000).toUTCString().slice(5, 11)}`],
              [bill ? "Your rate" : "Your earnings", `${usd4(done.rate)} /hr`],
              ["Band", `${usd4(micro(done.s.lower))} to ${usd4(micro(done.s.upper))}`],
              ["Claims held", `${amount2(done.claims)} ${sideName}`],
              ["Paid", `${amount2(done.paid)} tUSDC`],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 text-sm">
              <span className="text-ink-2">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
          <p className="mt-1 text-[13px] text-ink-2">
            Worth at most {amount2(done.claims)} tUSDC (band width ${W.toFixed(4)} x hours), at least 0.
          </p>
        </div>
      </section>
    );
  }

  if (step === "connect" || !entered) {
    return (
      <>
        <div className="flex justify-end">
          <Steps step="connect" />
        </div>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <form onSubmit={submitBill} className="flex flex-col gap-5 rounded-[36px] bg-surface p-6 ring-2 ring-ink md:p-9">
            <h2 className="text-[22px] font-extrabold">Your last 30 days</h2>
            <p className="text-sm text-ink-2">
              Type the numbers from your {bill ? "GPU rental bill" : "GPU host earnings"}. They stay in your browser and only size the
              lock.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((id) => (
                <button
                  type="button"
                  key={id}
                  onClick={() => setForm((f) => ({ ...f, classId: id }))}
                  aria-pressed={form.classId === id}
                  className={`flex h-14 items-center gap-3 rounded-[18px] px-4 font-bold ${form.classId === id ? "bg-surface ring-2 ring-ink" : "bg-surface-2"}`}
                >
                  {CLASS_NAMES[id]}
                  {form.classId === id && <Icon name="check" className="ml-auto size-4" />}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1.5 rounded-[18px] bg-surface-2 p-4">
              <span className="text-[13px] text-ink-2">{CLASS_NAMES[form.classId]} hours {bill ? "rented" : "rented out"}</span>
              <input
                inputMode="decimal"
                required
                value={form.hours}
                onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                placeholder="for example 720"
                className="bg-transparent font-mono text-2xl outline-none placeholder:text-muted"
              />
            </label>
            <label className="flex flex-col gap-1.5 rounded-[18px] bg-surface-2 p-4">
              <span className="text-[13px] text-ink-2">{bill ? "You spent, in USD" : "You earned, in USD"}</span>
              <input
                inputMode="decimal"
                required
                value={form.spent}
                onChange={(e) => setForm((f) => ({ ...f, spent: e.target.value }))}
                placeholder="for example 261.79"
                className="bg-transparent font-mono text-2xl outline-none placeholder:text-muted"
              />
            </label>
            <button className="flex h-12 w-fit items-center gap-3 rounded-full bg-ink py-1.5 pr-1.5 pl-[22px] font-medium text-white">
              Review the lock
              <span className="grid size-9 place-items-center rounded-full bg-white text-ink">
                <Icon name="arrow-up-right" className="size-[17px]" />
              </span>
            </button>
          </form>
          <section className="flex flex-col gap-3 rounded-[36px] bg-surface p-6 md:p-8">
            <h2 className="text-lg font-extrabold">Reading your bill for you</h2>
            <p className="text-sm text-ink-2">
              Connecting a read-only Vast.ai or RunPod key, or dropping an invoice file, is not live yet. Until then, type the hours and
              the amount from your last bill. Nothing is stored.
            </p>
          </section>
        </div>
      </>
    );
  }

  // Review
  const rate = entered.spent / entered.hours;
  const indexPrice = index ? micro(index.lastPrice) : null;
  const diff = indexPrice ? ((rate - indexPrice) / indexPrice) * 100 : null;
  const hours = Number(hoursText);
  const f = s ? (s.expiryTs - now) / (s.expiryTs - s.startTs) : 0;
  const W = s ? micro(s.upper - s.lower) : 0;
  const claims = s && hours > 0 && f > 0 ? (hours * W) / f : 0;
  const claimsMicro = BigInt(Math.floor(claims * 1e6));
  const quote = s && index && claimsMicro > 0n ? quoteCostFor(s, index, sideId, claimsMicro, now) : null;
  const cost = quote && !quote.blocked ? quote.usdcIn : null;
  const fee = s ? Number(s.tradeFeeBps) / 100 : 1;
  const short = usdc !== null && cost !== null && cost > usdc;
  const allTicked = ticks.every(Boolean);
  const warnings = [
    bill
      ? "It works both ways. If prices fall, your bill is cheaper but your claims lose value."
      : "It works both ways. If prices rise, your revenue is higher but your claims lose value.",
    s ? `It only protects inside the band, ${usd4(micro(s.lower))} to ${usd4(micro(s.upper))}.` : "It only protects inside the band.",
    `The most you can lose is what you pay${cost ? `: ${amount2(micro(cost))} tUSDC` : ""}.`,
    `Your own rate can differ from the index.${diff !== null ? ` Yours is ${Math.abs(diff).toFixed(1)}% ${diff >= 0 ? "above" : "below"} it today.` : ""}`,
  ];

  const lock = async () => {
    if (!wallet || !s || !cost || !index) return;
    setBusy(true);
    setError(null);
    try {
      // Pay at most the quote; accept 1% fewer claims if the price moved (spec 8.3 min out).
      const sig = await trade(connection, wallet, s, true, sideId, cost, (claimsMicro * 99n) / 100n);
      setDone({ sig, claims, paid: micro(cost), s, hours, rate });
      setStep("locked");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(m) ? "You cancelled the transaction in your wallet." : `The lock failed: ${m.slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex justify-end">
        <Steps step="review" />
      </div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-extrabold">Your {bill ? "bill" : "earnings"}, last 30 days</h2>
              <button onClick={() => setStep("connect")} className="text-sm font-semibold text-ink-2 hover:text-ink">
                Change
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  [`${CLASS_NAMES[entered.classId]} hours`, `${entered.hours.toLocaleString("en-US")} h`],
                  [bill ? "Spent" : "Earned", `$${amount2(entered.spent)}`],
                  [bill ? "Your rate" : "You earn", `${usd4(rate)} /hr`],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1 rounded-[18px] bg-surface-2 p-4">
                  <span className="text-[13px] text-ink-2">{k}</span>
                  <span className="font-mono text-xl">{v}</span>
                </div>
              ))}
            </div>
            {indexPrice !== null && diff !== null && (
              <p className="flex gap-3 rounded-[18px] bg-brand-soft px-5 py-4 text-sm">
                <Icon name="arrow-left-right" className="mt-0.5 size-4 shrink-0 text-brand-deep" />
                You {bill ? "pay" : "earn"} {usd4(rate)} an hour. The {CLASS_NAMES[entered.classId]} index is {usd4(indexPrice)}, so your
                rate is {Math.abs(diff).toFixed(1)}% {diff >= 0 ? "above" : "below"} it. The lock follows the index, not your exact rate.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-8">
            <h2 className="text-lg font-extrabold">Which period to lock</h2>
            {market === null ? (
              <div className="h-20 animate-pulse rounded-[18px] bg-surface-2" />
            ) : market === "error" ? (
              <p className="text-sm text-ink-2">The market cannot be read from Solana right now.</p>
            ) : open.length === 0 ? (
              <p className="text-sm text-ink-2">No {CLASS_NAMES[entered.classId]} series is open right now. A new one opens every day.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {open.map((x) => {
                  const on = x === s;
                  return (
                    <button
                      key={x.address.toBase58()}
                      onClick={() => setPick(x.address.toBase58())}
                      aria-pressed={on}
                      className={`flex flex-col gap-1 rounded-[18px] p-4 text-left ${on ? "ring-2 ring-ink" : "bg-surface-2"}`}
                    >
                      <span className="font-bold">
                        {CLASS_NAMES[x.classId]} {KIND_NAMES[x.kind]}
                      </span>
                      <span className="text-[13px] text-ink-2">Ends in {timeLeft(x.expiryTs - now)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {s && f < 0.5 && (
              <div className="flex gap-3 rounded-[18px] bg-[#fdf3d6] px-5 py-4">
                <Icon name="triangle-alert" className="mt-0.5 size-[18px] shrink-0 text-[#9a6b00]" />
                <div className="flex flex-col gap-1">
                  <p className="text-[15px] font-bold">Less than half of this period is left</p>
                  <p className="text-sm text-ink-2">
                    {((s.expiryTs - now) / 3600).toFixed(1)} of {((s.expiryTs - s.startTs) / 3600).toFixed(0)} hours remain, so Clamp needs
                    more claims per hour to cover the average.
                  </p>
                </div>
              </div>
            )}
          </section>

          {s && (
            <section className="flex flex-col gap-3 rounded-[36px] bg-surface p-6 md:p-8">
              <h2 className="text-lg font-extrabold">GPU hours until the series ends</h2>
              <label className="flex items-center gap-4 rounded-[18px] bg-surface-2 p-4">
                <input
                  inputMode="decimal"
                  value={hoursText}
                  onChange={(e) => setHoursText(e.target.value)}
                  aria-label="GPU hours until the series ends"
                  className="w-full min-w-0 bg-transparent font-mono text-2xl outline-none"
                />
                <span className="shrink-0 text-sm text-ink-2">hours, from your last 30 days</span>
              </label>
              <p className="text-[13px] text-ink-2">
                About {(entered.hours / 30).toFixed(1)} hours a day. Change it if the next days will be different.
              </p>
            </section>
          )}
        </div>

        <section className="flex flex-col gap-4 rounded-[32px] bg-surface p-6 shadow-[0_12px_32px_rgba(17,19,24,0.06)] md:p-7">
          <h2 className="text-lg font-extrabold">Your lock</h2>
          {s ? (
            <>
              {(
                [
                  ["Band", `${usd4(micro(s.lower))} to ${usd4(micro(s.upper))}`],
                  ["Claims", `${amount2(claims)} ${sideName}`],
                  ["Price per claim", cost && claims > 0 ? `about ${(micro(cost) / claims).toFixed(2)}` : "n/a"],
                  [`Fee, ${fee}%`, cost ? `${amount2((micro(cost) * fee) / 100)} tUSDC` : "n/a"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 text-sm">
                  <span className="text-ink-2">{k}</span>
                  <span className="font-mono">{v}</span>
                </div>
              ))}
              <div className="flex flex-col gap-1 rounded-[18px] bg-surface-2 p-4">
                <span className="text-[13px] text-ink-2">You pay, at most</span>
                <span className="font-mono text-[28px]">{cost ? `${amount2(micro(cost))} tUSDC` : "n/a"}</span>
              </div>
              <div className="flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4 text-sm">
                {(
                  [
                    [`Average ends at ${usd4(micro(bill ? s.upper : s.lower))} or ${bill ? "above" : "below"}`, claims],
                    ["Average ends mid band", claims / 2],
                    [`Average ends at ${usd4(micro(bill ? s.lower : s.upper))} or ${bill ? "below" : "above"}`, 0],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-ink-2">{k}</span>
                    <span className="font-mono">{amount2(v)} tUSDC</span>
                  </div>
                ))}
              </div>
              {quote?.blocked && <p className="text-sm text-down">The pool cannot take this trade right now ({quote.blocked}).</p>}
              <fieldset className="flex flex-col gap-2.5">
                <legend className="mb-2 text-sm font-bold">Before you lock</legend>
                {warnings.map((w, i) => (
                  <label key={i} className="flex gap-2.5 text-[13px] leading-snug">
                    <input
                      type="checkbox"
                      checked={ticks[i]}
                      onChange={(e) => setTicks((t) => t.map((x, j) => (j === i ? e.target.checked : x)))}
                      className="mt-0.5 size-4 shrink-0 accent-ink"
                    />
                    {w}
                  </label>
                ))}
              </fieldset>
              <p className="rounded-[14px] bg-[#fdf3d6] px-4 py-3 text-[13px] text-ink-2">
                The lock account (claims held for you, close early, roll into the next series) is not live on devnet yet. This buys
                the same {sideName} claims into your wallet. You redeem them yourself after settlement.
              </p>
              {!wallet ? (
                <button onClick={() => setVisible(true)} className="h-12 rounded-full bg-ink font-semibold text-white">
                  Connect wallet
                </button>
              ) : (
                <button
                  onClick={lock}
                  disabled={busy || !cost || !allTicked || short}
                  className="h-12 rounded-full bg-ink font-semibold text-white disabled:bg-line disabled:text-muted"
                >
                  {busy
                    ? "Waiting for your wallet..."
                    : short
                      ? "Not enough tUSDC"
                      : !allTicked
                        ? "Tick the four points first"
                        : `Lock my ${bill ? "bill" : "revenue"} for ${cost ? amount2(micro(cost)) : ""} tUSDC`}
                </button>
              )}
              {short && (
                <Link href="/faucet" className="flex items-center gap-1.5 text-sm font-semibold text-brand">
                  <Icon name="flask-conical" className="size-4" />
                  Get 1,000 test tUSDC
                </Link>
              )}
              {error && <p className="rounded-[14px] bg-[#fbe7e3] px-4 py-3 text-sm text-down">{error}</p>}
            </>
          ) : (
            <p className="text-sm text-ink-2">Pick a period to see the lock.</p>
          )}
        </section>
      </div>
    </>
  );
}
