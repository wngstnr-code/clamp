"use client";

import { getObservations, getSeries, type SeriesView, twapFromObservations } from "@clamp/sdk";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { Icon } from "./icon";

type Result =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "done"; s: SeriesView; avg: bigint; up: bigint; coveragePpm: number };

const PPM = 1_000_000n;
const usd6 = (v: bigint) => `$${(Number(v) / 1e6).toFixed(6)}`;
const v6 = (v: bigint) => (Number(v) / 1e6).toFixed(6);
const pct = (ppm: number) => `${(ppm / 1e4).toFixed(ppm % 10_000 === 0 ? 0 : 2)}%`;
const day = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * Recomputes the settlement of a series in the browser from the index observations on Solana
 * (spec 11) and compares it with what the program stored. Nothing is sent anywhere.
 */
export function ProofCheck({ address }: { address: string }) {
  const { connection } = useConnection();
  const [r, setR] = useState<Result>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await getSeries(connection, new PublicKey(address));
      if (!s || !s.settled) throw new Error("This series is not settled.");
      const data = await getObservations(connection, s.classId);
      if (!data) throw new Error("The index of this class cannot be read.");
      const twap = twapFromObservations(data.observations, s.startTs, s.expiryTs);
      // No counted time at all: the program falls back to the index at the start (spec 11).
      const avg = twap.average ?? s.startIndex;
      const raw = avg <= s.lower ? 0n : avg >= s.upper ? PPM : ((avg - s.lower) * PPM) / (s.upper - s.lower);
      const coveragePpm = Number((twap.countedSecs * PPM) / BigInt(s.expiryTs - s.startTs));
      if (live) setR({ kind: "done", s, avg, up: raw, coveragePpm });
    })().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      if (live)
        setR({
          kind: "error",
          text: /before the stored history/.test(msg)
            ? "The index history stored on Solana no longer reaches back to the start of this series, so the browser cannot recompute it."
            : msg,
        });
    });
    return () => {
      live = false;
    };
  }, [connection, address]);

  if (r.kind === "loading")
    return (
      <section className="flex flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-9">
        <div className="flex items-center gap-4">
          <span className="grid size-14 animate-spin place-items-center rounded-full bg-ink-2 text-white [animation-duration:2s]">
            <Icon name="refresh-cw" className="size-6" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-xl font-extrabold">Reading the period from Solana</p>
            <p className="text-sm text-ink-2">Your browser is loading every update of the period and adding them up. Nothing is sent anywhere.</p>
          </div>
        </div>
      </section>
    );
  if (r.kind === "error")
    return <p className="rounded-[36px] bg-surface p-6 text-ink-2 md:p-9">{r.text}</p>;

  const { s, avg, up, coveragePpm } = r;
  const rows = [
    ["Average index of the period", usd6(avg), usd6(s.avg), avg === s.avg],
    ["UP value per claim", v6(up), v6(s.upValue), up === s.upValue],
    ["Coverage", pct(coveragePpm), pct(s.coveragePpm), coveragePpm === s.coveragePpm],
  ] as const;
  const ok = rows.every((x) => x[3]);

  return (
    <>
      <section className="flex items-center gap-5 rounded-[36px] bg-surface p-6 md:p-9">
        <span className={`grid size-16 shrink-0 place-items-center rounded-full text-white ${ok ? "bg-up" : "bg-down"}`}>
          <Icon name={ok ? "check" : "triangle-alert"} className="size-8" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-[26px] font-extrabold md:text-[32px]">{ok ? "Same answer as the chain" : "The numbers do not match"}</h2>
          <p className="text-sm text-ink-2">
            {ok
              ? "All three numbers match the settled series to the last micro-USDC."
              : "Your browser and the chain disagree on this series. That should never happen. Please tell the Clamp team with the numbers below."}
          </p>
        </div>
      </section>

      <section className="mt-6 overflow-x-auto rounded-[36px] bg-surface px-6 py-3 md:px-9">
        <table className="w-full min-w-[620px] text-left">
          <thead>
            <tr className="border-b border-line text-sm text-ink-2">
              <th className="px-1 py-4 font-semibold" />
              <th className="px-1 py-4 font-semibold">Your browser</th>
              <th className="px-1 py-4 font-semibold">On-chain</th>
              <th className="px-1 py-4" />
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, mine, chain, same]) => (
              <tr key={k} className="border-b border-line last:border-0">
                <td className="px-1 py-4 font-semibold">{k}</td>
                <td className="px-1 py-4 font-mono">{mine}</td>
                <td className="px-1 py-4 font-mono">{chain}</td>
                <td className={`px-1 py-4 text-right text-sm font-semibold ${same ? "text-up" : "text-down"}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name={same ? "check" : "triangle-alert"} className="size-4" />
                    {same ? "Match" : "Differs"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 flex flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-9">
        <h2 className="text-[22px] font-extrabold">The math, with this series&apos; numbers</h2>
        <pre className="overflow-x-auto rounded-[20px] bg-night p-6 font-mono text-[13px] leading-relaxed text-white/85">
          {`average = time-weighted mean of every accepted update
          from ${day(s.startTs)} to ${day(s.expiryTs)} UTC
        = ${usd6(avg)}

UP      = floor((${v6(avg)} - ${v6(s.lower)}) x 1,000,000
                / (${v6(s.upper)} - ${v6(s.lower)}))
        = ${up.toString()} micro-USDC = ${v6(up)}
DOWN    = 1 - UP = ${v6(PPM - up)}`}
        </pre>
        <p className="text-sm text-ink-2">
          Gaps longer than two hours without an update are not counted, so a dead oracle cannot fill the period with an old
          price.
        </p>
      </section>
    </>
  );
}
