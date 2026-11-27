import type { Metadata } from "next";
import { Bars } from "@/components/bars";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { BigPrice, changeText, Notice, ProviderMark } from "@/components/index-parts";
import {
  bucket,
  change,
  CLASSES,
  type ClassInfo,
  hhmm,
  LATE_AFTER_S,
  notAnswering,
  type OpenSeries,
  readOpenSeries,
  readUpdates,
  SERIES_KIND,
  SOURCE_IDS,
  sourceName,
  type Update,
  when,
} from "@/lib/index-data";
import { type LiveIndex, readIndex, usd4 } from "@/lib/live-index";

export const metadata: Metadata = { title: "Clamp Index" };
export const revalidate = 60;

const DAY = 24 * 3600;

function seriesLine(series: OpenSeries[] | null, now: number) {
  if (series === null) return "Series not available right now.";
  if (series.length === 0) return "No series open right now.";
  return series.map((s) => `${SERIES_KIND[s.kind] ?? "A"} series open, closes ${when(s.closeTs, now)}.`).join(" ");
}

function ClassCard({
  info,
  index,
  updates,
  series,
  now,
}: {
  info: ClassInfo;
  index: LiveIndex;
  updates: Update[] | null;
  series: OpenSeries[] | null;
  now: number;
}) {
  const latest = updates?.[0];
  const ch = changeText(updates ? change(updates, index?.price) : null, "24h");
  const answering = latest?.sources.filter((s) => s.weight > 0).length;
  const late = index !== null && now - index.ts > LATE_AFTER_S;
  return (
    <section className="flex flex-col gap-6 rounded-[36px] bg-surface p-6 md:p-9">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[28px] leading-none font-extrabold">{info.name}</h2>
        {late ? (
          <span className="flex items-center gap-1.5 rounded-full bg-[#fdf3d6] px-3 py-1.5 text-[13px] font-semibold text-[#7a5500]">
            <Icon name="clock" className="size-3.5" />
            Last update {when(index.ts, now)}
          </span>
        ) : (
          <span className={`font-mono text-base ${ch.tone}`}>{ch.text}</span>
        )}
      </div>
      <p className="flex items-baseline gap-1">
        <BigPrice value={index?.price} className={`text-[56px] leading-none md:text-[88px] ${late ? "text-ink-2" : ""}`} />
        {index && <span className="font-mono text-xl text-muted">/hr</span>}
      </p>
      {updates && updates.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Bars
            values={bucket(updates, now - DAY, now, 24)}
            height="h-24"
            label={`${info.name} index, one bar per hour over the last 24 hours`}
          />
          <div className="flex justify-between text-[13px] text-muted">
            <span>24h ago</span>
            <span>now</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-2">History is not available right now.</p>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-5">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-bold">
            {latest
              ? `${answering} of ${SOURCE_IDS.length} providers, ${latest.reporters} reporters, ${updates!.length} updates in 24h`
              : "No update in the last 24 hours"}
          </span>
          <span className="text-ink-2">{seriesLine(series, now)}</span>
        </div>
        <Button href={`/index/${info.slug}`} variant="secondary">
          Open {info.name}
        </Button>
      </div>
    </section>
  );
}

export default async function IndexPage() {
  const now = Math.floor(Date.now() / 1000);
  const data = await Promise.all(
    CLASSES.map(async (c) => {
      const [index, updates, series] = await Promise.all([
        readIndex(c.id),
        readUpdates(c.id, now - DAY),
        readOpenSeries(c.id, now),
      ]);
      return { info: c, index, updates, series };
    }),
  );
  const lastTs = Math.max(0, ...data.map((d) => d.index?.ts ?? 0));
  const late = data.filter((d) => d.index && now - d.index.ts > LATE_AFTER_S);
  const missing = data.flatMap((d) =>
    notAnswering(d.updates ?? []).map((m) => ({ ...m, cls: d.info.name, used: d.updates![0]!.sources.filter((s) => s.weight > 0) })),
  );

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6 px-2 pt-12 pb-10 md:pt-16">
        <div className="flex max-w-[820px] flex-col gap-3">
          <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[64px]">Clamp Index</h1>
          <p className="text-[17px] leading-normal text-ink-2 md:text-[19px]">
            The hourly rental price per GPU class. Four providers are read, three reporters write the median on Solana,
            and every update can be checked.
          </p>
        </div>
        {lastTs > 0 && (
          <span className="flex items-center gap-2.5 rounded-full bg-surface px-[18px] py-3 text-[15px] font-semibold text-ink-2">
            <Icon name="refresh-cw" className="size-4" />
            Updated {when(lastTs, now)}
          </span>
        )}
      </header>

      <div className="mb-6 flex flex-col gap-3 empty:hidden">
        {late.map((d) => (
          <Notice key={d.info.id} title={`No ${d.info.name} update for ${Math.floor((now - d.index!.ts) / 60)} minutes`}>
            The last {d.info.name} value is from {when(d.index!.ts, now)}. Reporters write many times a day, so this usually
            clears soon. Settlement only counts updates that landed.
          </Notice>
        ))}
        {missing.map((m) => (
          <Notice
            key={`${m.cls}-${m.id}`}
            title={`${sourceName(m.id)} has not answered for ${m.cls}${m.since ? ` since ${hhmm(m.since)} UTC` : " in the last 24 hours"}`}
          >
            The index keeps going with the others: it used {m.used.map((s) => sourceName(s.id)).join(", ")}.
          </Notice>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {data.map((d) => (
          <ClassCard key={d.info.id} {...d} now={now} />
        ))}
      </div>

      <section className="mt-10 flex flex-col gap-5 rounded-[36px] bg-surface p-6 md:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[28px] leading-tight font-extrabold">What each provider charges right now</h2>
          {lastTs > 0 && <span className="text-[15px] text-ink-2">Last update, {when(lastTs, now)}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-line text-sm text-ink-2">
                <th className="px-1 py-4 font-semibold">Provider</th>
                {data.map((d) => (
                  <th key={d.info.id} className="w-[18%] px-1 py-4 text-right font-semibold">
                    {d.info.name}
                  </th>
                ))}
                <th className="w-[22%] px-1 py-4 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {SOURCE_IDS.map((id) => {
                const cells = data.map((d) => d.updates?.[0]?.sources.find((s) => s.id === id));
                const used = cells.filter((s) => s && s.weight > 0).length;
                const known = cells.filter(Boolean).length;
                const status =
                  known === 0 ? "Not available" : used === known ? "Answering" : used === 0 ? "Left out" : `Used for ${used} of ${known}`;
                return (
                  <tr key={id} className={`border-b border-line last:border-0 ${used === 0 ? "text-muted" : ""}`}>
                    <td className="px-1 py-4">
                      <span className="flex items-center gap-3.5 text-[17px] font-bold">
                        <ProviderMark name={sourceName(id)} faded={used === 0} />
                        {sourceName(id)}
                      </span>
                    </td>
                    {cells.map((s, i) => (
                      <td key={i} className={`px-1 py-4 text-right font-mono text-[17px] ${s && s.weight === 0 ? "text-muted" : ""}`}>
                        {!s || s.price === 0 ? "no price" : usd4(s.price)}
                      </td>
                    ))}
                    <td className="px-1 py-4 text-right text-[17px] text-ink-2">{status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          The index is a weighted median, so one provider far from the others does not move it. A faded price was read but
          left out of that update by the source rules.
        </p>
      </section>
    </>
  );
}
