import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bars } from "@/components/bars";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { BigPrice, changeText, Notice, ProviderMark } from "@/components/index-parts";
import {
  bucket,
  change,
  classBySlug,
  CLASSES,
  dayMonth,
  explorerTx,
  hhmm,
  LATE_AFTER_S,
  notAnswering,
  readLatestUpdates,
  readReporters,
  readTicks,
  readUpdates,
  sourceName,
  type Tick,
  type Update,
  when,
} from "@/lib/index-data";
import { readIndex, usd4 } from "@/lib/live-index";

type Props = { params: Promise<{ class: string }>; searchParams: Promise<{ range?: string; rows?: string }> };

const HOUR = 3600;
// One bar per half hour over a day, one per four hours over a week.
const RANGES = {
  "24h": { label: "24h", title: "Last 24 hours", span: 24 * HOUR, bars: 48, per: "half hour" },
  "7d": { label: "7 days", title: "Last 7 days", span: 7 * 24 * HOUR, bars: 42, per: "four hours" },
} as const;
type RangeKey = keyof typeof RANGES;

const WORDS = ["None", "One", "Two", "Three", "Four", "Five"];
const word = (n: number) => WORDS[n] ?? String(n);

export function generateStaticParams() {
  return CLASSES.map((c) => ({ class: c.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const info = classBySlug((await params).class);
  return { title: info ? `${info.name} index · Clamp` : "Clamp Index" };
}

/** The raw provider files the reporters hashed for an update: their reads in the 15 minutes before it, newest per source. */
function rawFiles(u: Update, ticks: Tick[]) {
  const seen = new Set<number>();
  return ticks
    .filter((t) => t.ts <= u.ts && t.ts > u.ts - 15 * 60 && t.rawUrl)
    .filter((t) => !seen.has(t.sourceId) && seen.add(t.sourceId))
    .sort((a, b) => a.sourceId - b.sourceId);
}

export default async function ClassIndexPage({ params, searchParams }: Props) {
  const info = classBySlug((await params).class);
  if (!info) notFound();
  const sp = await searchParams;
  const rangeKey: RangeKey = sp.range === "7d" ? "7d" : "24h";
  const range = RANGES[rangeKey];
  const rows = sp.rows === "50" ? 50 : 10;
  const now = Math.floor(Date.now() / 1000);

  const [index, history, day, recent, reporters] = await Promise.all([
    readIndex(info.id),
    readUpdates(info.id, now - range.span, 2000),
    rangeKey === "24h" ? null : readUpdates(info.id, now - 24 * HOUR),
    readLatestUpdates(info.id, rows),
    readReporters(info.id),
  ]);
  const last24 = rangeKey === "24h" ? history : day;
  const ticks = recent?.length ? await readTicks(info.id, recent.at(-1)!.ts - 15 * 60, recent[0]!.ts) : null;
  const latest = recent?.[0];
  const ch = changeText(last24 ? change(last24, index?.price) : null, "24h");
  const late = index !== null && now - index.ts > LATE_AFTER_S;
  const quiet = notAnswering(last24 ?? recent ?? []);
  const prices = history?.map((u) => u.price) ?? [];
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => now - range.span + f * range.span);
  const values = history ? bucket(history, now - range.span, now, range.bars) : [];
  const seen = values.filter((v): v is number => v !== null);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6 px-2 pt-10 pb-8">
        <div className="flex flex-col gap-2.5">
          <Link href="/index" className="flex w-fit items-center gap-2 text-[15px] font-semibold text-ink-2 hover:text-ink">
            <Icon name="arrow-left" className="size-4" />
            All classes
          </Link>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <h1 className="text-[44px] leading-none font-extrabold tracking-[-1.5px] md:text-[64px]">{info.name}</h1>
            <p className="flex items-baseline gap-1">
              <BigPrice value={index?.price} className={`text-[40px] leading-none md:text-[60px] ${late ? "text-ink-2" : ""}`} />
              {index && <span className="font-mono text-lg text-muted">/hr</span>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`flex items-center gap-2 rounded-full px-[18px] py-3 text-[15px] font-semibold ${
              ch.tone === "text-up" ? "bg-[#dff3ea]" : ch.tone === "text-down" ? "bg-[#fbe7e3]" : "bg-surface"
            } ${ch.tone}`}
          >
            {ch.icon && <Icon name={ch.icon} className="size-4" />}
            {ch.text[0]!.toUpperCase() + ch.text.slice(1)}
          </span>
          <Button href="/market">Trade {info.name}</Button>
        </div>
      </header>

      <div className="mb-6 flex flex-col gap-3 empty:hidden">
        {late && (
          <Notice title={`No update for ${Math.floor((now - index.ts) / 60)} minutes`}>
            The last {info.name} value is from {when(index.ts, now)}. Reporters write many times a day, so this usually clears
            soon. Settlement only counts updates that landed.
          </Notice>
        )}
        {quiet.map((m) => (
          <Notice
            key={m.id}
            title={`${sourceName(m.id)} has not answered${m.since ? ` since ${hhmm(m.since)} UTC` : " in the last 24 hours"}`}
          >
            The index keeps going with the other providers. The quiet provider stays in the list, faded.
          </Notice>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="flex flex-col gap-5 rounded-[36px] bg-surface p-6 md:p-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[22px] font-extrabold">{range.title}</h2>
            <nav aria-label="Time range" className="flex gap-1 rounded-full bg-surface-2 p-1">
              {(Object.keys(RANGES) as RangeKey[]).map((k) => (
                <Link
                  key={k}
                  href={k === "24h" ? `/index/${info.slug}` : `/index/${info.slug}?range=${k}`}
                  scroll={false}
                  aria-current={k === rangeKey ? "page" : undefined}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${k === rangeKey ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`}
                >
                  {RANGES[k].label}
                </Link>
              ))}
            </nav>
          </div>
          {seen.length ? (
            <>
              <div className="flex gap-4">
                <div className="flex h-[300px] w-14 shrink-0 flex-col justify-between font-mono text-xs text-muted">
                  {/* A flat index gets one label, not the same number three times. */}
                  <span>{Math.max(...seen) > Math.min(...seen) ? usd4(Math.max(...seen)) : ""}</span>
                  <span>{usd4((Math.max(...seen) + Math.min(...seen)) / 2)}</span>
                  <span>{Math.max(...seen) > Math.min(...seen) ? usd4(Math.min(...seen)) : ""}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <Bars
                    values={values}
                    height="h-[300px]"
                    gap={3}
                    label={`${info.name} index, one bar per ${range.per}, ${range.title.toLowerCase()}`}
                  />
                </div>
              </div>
              <div className="flex justify-between pl-[72px] text-[13px] text-muted">
                {xTicks.map((t, i) => (
                  <span key={t}>
                    {i === 4 ? "now" : rangeKey === "24h" ? `${hhmm(t)}` : dayMonth(t)}
                  </span>
                ))}
              </div>
              <p className="text-sm text-ink-2">
                One bar per {range.per}, times in UTC. Low {usd4(Math.min(...prices))}, high {usd4(Math.max(...prices))} over{" "}
                {range.title.toLowerCase()}. An empty slot means no update landed then.
              </p>
            </>
          ) : (
            <p className="py-24 text-center text-sm text-ink-2">History is not available right now.</p>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-7">
          <h2 className="text-[22px] font-extrabold">At the last update</h2>
          {latest ? (
            <>
              <p className="text-sm leading-normal text-ink-2">
                {when(latest.ts, now)}.{" "}
                {reporters
                  ? `${word(latest.reporters)} of ${word(reporters.registered).toLowerCase()} reporters agreed (at least ${reporters.min} needed).`
                  : `${word(latest.reporters)} reporters agreed.`}{" "}
                The weighted median is {usd4(latest.price)}.
              </p>
              {latest.sources.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3.5 rounded-[18px] bg-surface-2 px-4 py-3.5 ${s.weight === 0 ? "text-muted" : ""}`}
                >
                  <ProviderMark name={sourceName(s.id)} faded={s.weight === 0} />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="font-bold">{sourceName(s.id)}</span>
                    <span className="text-[13px] text-ink-2">
                      {s.price === 0 ? "Did not answer" : s.weight === 0 ? "Left out by the source rules" : `Weight ${s.weight}, capacity ${s.capacity}`}
                    </span>
                  </div>
                  <span className="font-mono">{s.price === 0 ? "no price" : usd4(s.price)}</span>
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-ink-2">The last update is not available right now.</p>
          )}
        </section>
      </div>

      <section className="mt-6 flex flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-9">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[22px] font-extrabold">Every update, with its proof</h2>
          <span className="text-sm text-ink-2">
            Newest first. Each one links to the Solana transaction and the raw provider files.
          </span>
        </div>
        {recent?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-sm text-ink-2">
                  <th className="px-1 py-3.5 font-semibold">Time, UTC</th>
                  <th className="px-1 py-3.5 font-semibold">Index</th>
                  <th className="px-1 py-3.5 font-semibold">Sources used</th>
                  <th className="px-1 py-3.5 font-semibold">Reporters</th>
                  <th className="px-1 py-3.5 text-right font-semibold">Proof</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((u) => {
                  const files = ticks ? rawFiles(u, ticks) : [];
                  return (
                    <tr key={u.signature} className="border-b border-line align-top last:border-0">
                      <td className="px-1 py-4 font-mono">{when(u.ts, now).replace(" UTC", "")}</td>
                      <td className="px-1 py-4 font-mono">{usd4(u.price)}</td>
                      <td className="px-1 py-4">
                        {u.sources
                          .filter((s) => s.weight > 0)
                          .map((s) => sourceName(s.id))
                          .join(", ")}
                      </td>
                      <td className="px-1 py-4 font-mono">
                        {u.reporters}
                        {reporters ? ` of ${reporters.registered}` : ""}
                      </td>
                      <td className="px-1 py-3">
                        <div className="flex flex-wrap justify-end gap-2.5">
                          <a
                            href={explorerTx(u.signature)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold hover:bg-line"
                          >
                            <Icon name="external-link" className="size-3.5" />
                            Transaction
                          </a>
                          {files.length > 0 && (
                            <details className="relative">
                              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold hover:bg-line">
                                <Icon name="file-text" className="size-3.5" />
                                Raw files
                              </summary>
                              <div className="absolute right-0 z-10 mt-2 flex w-44 flex-col rounded-[14px] bg-surface p-2 shadow-[0_12px_32px_rgba(17,19,24,0.14)] ring-1 ring-line">
                                {files.map((f) => (
                                  <a
                                    key={f.sourceId}
                                    href={f.rawUrl!}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-[10px] px-3 py-2 text-sm hover:bg-surface-2"
                                  >
                                    {sourceName(f.sourceId)}, {hhmm(f.ts)}
                                  </a>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-sm text-ink-2">Updates are not available right now.</p>
        )}
        {rows === 10 && (recent?.length ?? 0) === 10 && (
          <div>
            <Button
              href={`/index/${info.slug}?${rangeKey === "7d" ? "range=7d&" : ""}rows=50`}
              variant="secondary"
              icon="arrow-down-to-line"
            >
              Show older updates
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
