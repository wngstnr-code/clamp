import type { SeriesView } from "@clamp/sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { ShortLabel } from "@/components/market-parts";
import { when } from "@/lib/index-data";
import { usd4 } from "@/lib/live-index";
import { isShort, micro, p4, poolPrices, ppm, seriesName, timeLeft } from "@/lib/market";
import { readMarket } from "@/lib/market-data";

export const metadata: Metadata = { title: "Market · Clamp" };
export const revalidate = 30;

type Props = { searchParams: Promise<{ view?: string; class?: string }> };

const CLASS_FILTERS = [
  ["All classes", undefined],
  ["RTX 4090", "1"],
  ["H100", "2"],
] as const;

function Pills({ items, current, href }: { items: readonly (readonly [string, string | undefined])[]; current?: string; href: (v?: string) => string }) {
  return (
    <div className="flex gap-1 rounded-full bg-surface p-1">
      {items.map(([label, v]) => (
        <Link
          key={label}
          href={href(v)}
          scroll={false}
          aria-current={v === current ? "page" : undefined}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${v === current ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

function SettledCard({ s, now }: { s: SeriesView; now: number }) {
  const up = ppm(s.upValue);
  return (
    <section className="flex flex-col gap-5 rounded-[32px] bg-surface p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-extrabold">{seriesName(s)}</h3>
          <p className="text-sm text-ink-2">
            Settled {when(s.expiryTs, now)}, {(s.coveragePpm / 1e4).toFixed(0)}% of the period counted
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-[#dff3ea] px-3 py-1.5 text-[13px] font-semibold text-up">
          <Icon name="check" className="size-3.5" />
          Settled
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        {(
          [
            ["Average", usd4(micro(s.avg)), "text-ink"],
            ["UP paid", `$${p4(up)}`, "text-up"],
            ["DOWN paid", `$${p4(1 - up)}`, "text-down"],
          ] as const
        ).map(([k, v, tone]) => (
          <div key={k} className="flex flex-col gap-1 rounded-[18px] bg-surface-2 p-4">
            <dt className="text-[13px] text-ink-2">{k}</dt>
            <dd className={`font-mono text-lg md:text-[22px] ${tone}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-3">
        <Button href={`/market/${s.address.toBase58()}`}>Redeem</Button>
        <Button href={`/proof/${s.address.toBase58()}`} variant="secondary">
          Check the proof
        </Button>
      </div>
    </section>
  );
}

export default async function MarketPage({ searchParams }: Props) {
  const sp = await searchParams;
  const view = sp.view === "settled" ? "settled" : "open";
  const cls = sp.class === "1" || sp.class === "2" ? sp.class : undefined;
  const now = Math.floor(Date.now() / 1000);
  const market = await readMarket();
  const href = (v: { view?: string; class?: string }) => {
    const q = new URLSearchParams();
    if (v.view && v.view !== "open") q.set("view", v.view);
    if (v.class) q.set("class", v.class);
    return `/market${q.size ? `?${q}` : ""}`;
  };
  const inClass = (s: SeriesView) => !cls || s.classId === Number(cls);
  const open = market?.series.filter((s) => !s.settled && inClass(s)).sort((a, b) => a.closeTs - b.closeTs) ?? [];
  const settled = market?.series.filter((s) => s.settled && inClass(s)).sort((a, b) => b.expiryTs - a.expiryTs) ?? [];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6 px-2 pt-12 pb-8 md:pt-16">
        <div className="flex max-w-[700px] flex-col gap-3">
          <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[64px]">Market</h1>
          <p className="text-[17px] leading-normal text-ink-2 md:text-[19px]">
            Buy the side you need, or mint a pair for 1 tUSDC. Every series is fully backed and settles on-chain.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Pills
            items={[
              ["Open", "open"],
              ["Settled", "settled"],
            ]}
            current={view}
            href={(v) => href({ view: v, class: cls })}
          />
          <Pills items={CLASS_FILTERS} current={cls} href={(v) => href({ view, class: v })} />
        </div>
      </header>

      {!market ? (
        <p className="rounded-[32px] bg-surface p-8 text-ink-2">The market cannot be read from Solana right now. Try again in a minute.</p>
      ) : view === "open" ? (
        <>
          <section className="overflow-x-auto rounded-[32px] bg-surface px-6 py-3 md:px-8">
            {open.length === 0 ? (
              <p className="py-8 text-ink-2">No open series right now.</p>
            ) : (
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="border-b border-line text-sm text-ink-2">
                    <th className="px-1 py-4 font-semibold">Series</th>
                    <th className="px-1 py-4 font-semibold">Band</th>
                    <th className="px-1 py-4 font-semibold">Index now</th>
                    <th className="px-1 py-4 font-semibold">Closes in</th>
                    <th className="px-1 py-4 text-right font-semibold">UP</th>
                    <th className="px-1 py-4 text-right font-semibold">DOWN</th>
                    <th className="w-32 px-1 py-4" />
                  </tr>
                </thead>
                <tbody>
                  {open.map((s) => {
                    const index = market.indexes.get(s.classId) ?? null;
                    const prices = index && s.seeded ? poolPrices(s, index, now) : null;
                    const closed = now >= s.closeTs;
                    return (
                      <tr key={s.address.toBase58()} className="border-b border-line last:border-0">
                        <td className="px-1 py-4">
                          <span className="flex flex-wrap items-center gap-3 text-[17px] font-extrabold">
                            {seriesName(s)}
                            {isShort(s) && <ShortLabel />}
                          </span>
                        </td>
                        <td className="px-1 py-4 font-mono text-[15px] text-ink-2">
                          {usd4(micro(s.lower))} to {usd4(micro(s.upper))}
                        </td>
                        <td className="px-1 py-4 font-mono text-[15px]">{index ? usd4(micro(index.lastPrice)) : "not available"}</td>
                        <td className="px-1 py-4 text-[15px]">
                          <span className="flex items-center gap-1.5">
                            <Icon name="clock" className="size-4 text-ink-2" />
                            {closed ? `Closed, settles ${when(s.expiryTs, now)}` : timeLeft(s.closeTs - now)}
                          </span>
                        </td>
                        <td className="px-1 py-4 text-right font-mono text-[15px] text-up">{prices ? p4(prices.up) : "n/a"}</td>
                        <td className="px-1 py-4 text-right font-mono text-[15px] text-down">{prices ? p4(prices.down) : "n/a"}</td>
                        <td className="px-1 py-3 text-right">
                          <Button href={`/market/${s.address.toBase58()}`} variant="secondary">
                            Trade
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
          {settled.length > 0 && (
            <>
              <h2 className="mt-12 mb-5 px-2 text-[28px] font-extrabold">Recently settled</h2>
              <div className="grid gap-6 lg:grid-cols-2">
                {settled.slice(0, 2).map((s) => (
                  <SettledCard key={s.address.toBase58()} s={s} now={now} />
                ))}
              </div>
            </>
          )}
        </>
      ) : settled.length === 0 ? (
        <p className="rounded-[32px] bg-surface p-8 text-ink-2">No settled series yet.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {settled.map((s) => (
            <SettledCard key={s.address.toBase58()} s={s} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
