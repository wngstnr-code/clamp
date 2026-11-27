import { getSeries } from "@clamp/sdk";
import { Connection } from "@solana/web3.js";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { ProofCheck } from "@/components/proof-check";
import { RPC_URL } from "@/lib/config";
import { CLASSES, explorerTx, when } from "@/lib/index-data";
import { usd4 } from "@/lib/live-index";
import { KIND_NAMES, micro, seriesName } from "@/lib/market";
import { parseAddress } from "@/lib/market-data";

type Props = { params: Promise<{ series: string }> };

export const metadata: Metadata = { title: "Proof · Clamp" };
export const revalidate = 60;

/** The settle transaction from the public Supabase mirror, or null. */
async function settleSignature(address: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/series?select=settle_signature&address=eq.${address}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 300 },
    });
    const [row] = res.ok ? ((await res.json()) as { settle_signature: string | null }[]) : [];
    return row?.settle_signature ?? null;
  } catch {
    return null;
  }
}

export default async function ProofPage({ params }: Props) {
  const address = (await params).series;
  const key = parseAddress(address);
  if (!key) notFound();
  const s = await getSeries(new Connection(RPC_URL, "confirmed"), key).catch(() => undefined);
  if (s === null) notFound();
  const now = Math.floor(Date.now() / 1000);
  const sig = s?.settled ? await settleSignature(address) : null;
  const cls = s ? CLASSES.find((c) => c.id === s.classId) : undefined;

  return (
    <>
      <header className="flex max-w-[860px] flex-col gap-3 px-2 pt-10 pb-8">
        <Link
          href={`/market/${address}`}
          className="flex w-fit items-center gap-2 text-[15px] font-semibold text-ink-2 hover:text-ink"
        >
          <Icon name="arrow-left" className="size-4" />
          {s ? seriesName(s) : "Series"}
        </Link>
        <h1 className="text-[40px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[60px]">Check this settlement yourself</h1>
        <p className="text-[17px] leading-normal text-ink-2">
          Your browser reads every index update of the period from Solana and does the math again. Nobody has to be trusted.
        </p>
      </header>

      {s === undefined ? (
        <p className="rounded-[36px] bg-surface p-8 text-ink-2">This series cannot be read from Solana right now.</p>
      ) : !s.settled ? (
        <section className="flex max-w-[640px] flex-col gap-4 rounded-[36px] bg-surface p-6 md:p-9">
          <span className="grid size-14 place-items-center rounded-full bg-ink-2 text-white">
            <Icon name="hourglass" className="size-6" />
          </span>
          <h2 className="text-2xl font-extrabold">
            {seriesName(s)} settles after {when(s.expiryTs, now)}
          </h2>
          <p className="text-ink-2">
            There is nothing to check yet. Anyone can trigger settlement once the period ends, then the proof appears here.
          </p>
          <div>
            <Button href={`/market/${address}`} variant="secondary">
              See the average so far
            </Button>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
          <div className="flex flex-col">
            <ProofCheck address={address} />
          </div>
          <section className="flex flex-col gap-3 rounded-[36px] bg-surface p-6 md:p-7">
            <h2 className="text-[22px] font-extrabold">The series</h2>
            {(
              [
                ["Class", cls?.name ?? `Class ${s.classId}`],
                ["Period", KIND_NAMES[s.kind] ?? ""],
                ["Band", `${usd4(micro(s.lower))} to ${usd4(micro(s.upper))}`],
                ["Started", when(s.startTs, now)],
                ["Expired", when(s.expiryTs, now)],
                ["Address", `${address.slice(0, 6)}...${address.slice(-4)}`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 text-sm">
                <span className="text-ink-2">{k}</span>
                <span className="font-mono">{v}</span>
              </div>
            ))}
            <div className="mt-2 flex flex-wrap gap-2.5">
              {sig && (
                <a
                  href={explorerTx(sig)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold hover:bg-line"
                >
                  <Icon name="external-link" className="size-3.5" />
                  Settle transaction
                </a>
              )}
              {cls && (
                <Link
                  href={`/index/${cls.slug}?range=7d`}
                  className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] font-semibold hover:bg-line"
                >
                  <Icon name="file-text" className="size-3.5" />
                  Every update
                </Link>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
