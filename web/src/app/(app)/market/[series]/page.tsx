import { getIndex, getSeries } from "@clamp/sdk";
import { Connection } from "@solana/web3.js";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { ShortLabel } from "@/components/market-parts";
import { TradePanel, YourClaims } from "@/components/series-live";
import { RPC_URL } from "@/lib/config";
import { countUpdates, hhmm, when } from "@/lib/index-data";
import { usd4 } from "@/lib/live-index";
import { averageSoFar, isShort, micro, p4, ppm, seriesName, timeLeft, upValueAt } from "@/lib/market";
import { parseAddress } from "@/lib/market-data";

type Props = { params: Promise<{ series: string }> };

export const revalidate = 30;

async function load(address: string) {
  const key = parseAddress(address);
  if (!key) return null;
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const series = await getSeries(connection, key);
    if (!series) return null;
    return { series, index: await getIndex(connection, series.classId) };
  } catch (e) {
    console.error("series read failed:", e);
    return "error" as const;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).series);
  return { title: data && data !== "error" ? `${seriesName(data.series)} · Clamp` : "Series · Clamp" };
}

/** One plain sentence on where the average sits in the band. */
function where(f: number) {
  if (f <= 0) return "The average so far is below the band, so DOWN would pay the full dollar and UP nothing.";
  if (f >= 1) return "The average so far is above the band, so UP would pay the full dollar and DOWN nothing.";
  if (f < 0.4) return "The average so far sits in the lower part of the band, so UP would pay less than half a dollar.";
  if (f > 0.6) return "The average so far sits in the upper part of the band, so UP would pay more than half a dollar.";
  return "The average so far sits near the middle of the band, so both sides would pay close to half a dollar.";
}

function Stat({ k, v, note }: { k: string; v: string; note: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[24px] bg-surface p-5 md:p-6">
      <span className="text-sm text-ink-2">{k}</span>
      <span className="font-mono text-xl md:text-[24px]">{v}</span>
      <span className="text-[13px] text-muted">{note}</span>
    </div>
  );
}

export default async function SeriesPage({ params }: Props) {
  const address = (await params).series;
  const data = await load(address);
  if (data === null) notFound();
  if (data === "error")
    return <p className="mt-12 rounded-[32px] bg-surface p-8 text-ink-2">This series cannot be read from Solana right now.</p>;

  const { series: s, index } = data;
  const now = Math.floor(Date.now() / 1000);
  const updates = await countUpdates(s.classId, s.startTs);
  const avg = index ? averageSoFar(s, index, now) : null;
  const f = avg === null ? null : upValueAt(s, avg);
  // Where the average sits on the band bar, kept inside the bar when it is outside the band.
  const pos = avg === null ? null : Math.min(1, Math.max(0, Number(avg - s.lower) / Number(s.upper - s.lower)));
  const upPays = s.settled ? ppm(s.upValue) : f;
  const closed = now >= s.closeTs;

  return (
    <>
      <header className="flex flex-col gap-2.5 px-2 pt-10 pb-8">
        <Link href="/market" className="flex w-fit items-center gap-2 text-[15px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="arrow-left" className="size-4" />
          All series
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-[44px] leading-none font-extrabold tracking-[-1.5px] md:text-[64px]">{seriesName(s)}</h1>
          {isShort(s) && <ShortLabel extra={s.settled ? "settled" : `closes ${hhmm(s.closeTs)} UTC`} />}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Band" v={`${usd4(micro(s.lower))} to ${usd4(micro(s.upper))}`} note="Set when the series opened" />
        <Stat
          k="Index now"
          v={index ? usd4(micro(index.lastPrice)) : "not available"}
          note={index ? `Updated ${when(index.lastTs, now)}` : "The index cannot be read right now"}
        />
        <Stat
          k={s.settled ? "Final average" : "Average so far"}
          v={avg === null ? "nothing counted yet" : usd4(micro(avg))}
          note={`${updates === null ? "Updates" : `${updates} updates`} since ${when(s.startTs, now)}`}
        />
        <Stat
          k={s.settled ? "Settled" : closed ? "Trading closed" : "Closes in"}
          v={s.settled ? when(s.expiryTs, now) : closed ? `settles in ${timeLeft(s.expiryTs - now)}` : timeLeft(s.closeTs - now)}
          note={s.settled ? `${(s.coveragePpm / 1e4).toFixed(0)}% of the period counted` : `Settles from ${when(s.expiryTs, now)}`}
        />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-5 rounded-[32px] bg-surface p-6 md:p-9">
            <h2 className="text-[22px] font-extrabold">{s.settled ? "How it ended" : "If the period ended now"}</h2>
            <p className="text-[15px] text-ink-2">
              {s.settled ? "The result is final. Each side pays what the average decided." : f === null ? "Nothing is counted yet." : where(f)}
            </p>
            <div className="relative h-14 rounded-full bg-brand-soft">
              {pos !== null && (
                <span
                  aria-hidden
                  className="absolute top-2 bottom-2 w-[3px] -translate-x-1/2 rounded-full bg-ink"
                  style={{ left: `${3 + pos * 94}%` }}
                />
              )}
            </div>
            <div className="flex justify-between gap-4 font-mono text-[13px] text-ink-2">
              <span>Lower {usd4(micro(s.lower))}</span>
              {avg !== null && <span>Average {usd4(micro(avg))}</span>}
              <span>Upper {usd4(micro(s.upper))}</span>
            </div>
            {upPays !== null && (
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["UP", upPays, "bg-[#dff3ea]", "text-up"],
                    ["DOWN", 1 - upPays, "bg-[#fbe7e3]", "text-down"],
                  ] as const
                ).map(([name, v, bg, tone]) => (
                  <div key={name} className={`flex flex-col gap-1.5 rounded-[22px] p-5 ${bg}`}>
                    <span className={`text-sm font-bold ${tone}`}>{s.settled ? `${name} paid` : `${name} would pay`}</span>
                    <span className="font-mono text-[32px]">${p4(v)}</span>
                    <span className="text-[13px] text-ink-2">{s.settled ? "per claim, final" : "per claim, if the average stays here"}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex items-center gap-5 rounded-[32px] bg-surface p-6 md:p-7">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-deep">
              <Icon name="arrow-left-right" className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-extrabold">A pair is always worth 1 tUSDC</p>
              <p className="text-sm text-ink-2">
                Mint 1 UP and 1 DOWN for 1 tUSDC, or merge a pair back into 1 tUSDC at any time, even before settlement.
              </p>
            </div>
          </section>

          <YourClaims address={address} />
        </div>

        <TradePanel address={address} />
      </div>
    </>
  );
}
