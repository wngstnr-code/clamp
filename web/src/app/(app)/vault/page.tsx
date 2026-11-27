import { getIndex, getVault, type IndexView, seriesFairValue, seriesValue } from "@clamp/sdk";
import { Connection } from "@solana/web3.js";
import type { Metadata } from "next";
import { Icon } from "@/components/icon";
import { VaultPanel } from "@/components/vault-panel";
import { RPC_URL } from "@/lib/config";
import { when } from "@/lib/index-data";
import { amount2, micro, seriesName } from "@/lib/market";

export const metadata: Metadata = { title: "Vault · Clamp" };
export const revalidate = 30;

const COLORS = ["bg-ink", "bg-brand", "bg-[#8b9cff]", "bg-[#bcc6ff]", "bg-[#dce2f0]"];

async function load() {
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const now = Math.floor(Date.now() / 1000);
    const vault = await getVault(connection, now);
    if (!vault) return null;
    const indexes = new Map<number, IndexView | null>();
    for (const s of vault.activeSeries) if (!indexes.has(s.classId)) indexes.set(s.classId, await getIndex(connection, s.classId));
    // Each series valued the way the vault values it (spec 9.1): both sides it holds, at the index, not the pool price.
    const parts = vault.activeSeries.map((s) => {
      const index = indexes.get(s.classId);
      const v = s.settled ? s.upValue : index && now < s.expiryTs ? seriesFairValue(s, index, now) : null;
      return { s, value: v === null ? null : seriesValue(s.poolUp + s.invUp, s.poolDown + s.invDown, v, false) };
    });
    const lastIndex = Math.max(0, ...[...indexes.values()].map((i) => i?.lastTs ?? 0));
    return { vault, parts, now, lastIndex };
  } catch (e) {
    console.error("vault read failed:", e);
    return "error" as const;
  }
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

export default async function VaultPage() {
  const data = await load();
  const header = (
    <header className="flex flex-wrap items-end justify-between gap-6 px-2 pt-12 pb-8 md:pt-16">
      <div className="flex max-w-[760px] flex-col gap-3">
        <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[64px]">Vault</h1>
        <p className="text-[17px] leading-normal text-ink-2 md:text-[19px]">
          Your tUSDC funds both sides of every series and earns the trade fees. The vault never puts more than 10% of its value
          into one series.
        </p>
      </div>
      {data && data !== "error" && data.lastIndex > 0 && (
        <span className="flex items-center gap-2.5 rounded-full bg-surface px-[18px] py-3 text-[15px] font-semibold text-ink-2">
          <Icon name="refresh-cw" className="size-4" />
          Valued at the {when(data.lastIndex, data.now)} index
        </span>
      )}
    </header>
  );
  if (data === null || data === "error")
    return (
      <>
        {header}
        <p className="rounded-[32px] bg-surface p-8 text-ink-2">
          {data === null ? "The vault is not set up on devnet yet." : "The vault cannot be read from Solana right now."}
        </p>
      </>
    );

  const { vault, parts, now } = data;
  const inSeries = parts.reduce((a, p) => a + (p.value ?? 0n), 0n);
  const total = vault.nav ?? vault.idle + inSeries;
  const rows = [{ name: "Idle", note: "Free for withdrawals and new series", value: vault.idle as bigint | null }].concat(
    parts.map((p) => ({
      name: seriesName(p.s),
      note: p.s.settled
        ? "Settled, waiting to be swept back"
        : p.value === null
          ? `Expired ${when(p.s.expiryTs, now)}, waiting for settlement`
          : "Both sides held in the pool, valued at the index",
      value: p.value,
    })),
  );

  return (
    <>
      {header}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Total value" v={`${amount2(micro(total))} tUSDC`} note="Idle tUSDC plus every series at the index" />
        <Stat
          k="Share price"
          v={vault.sharePrice === null ? "n/a" : micro(vault.sharePrice).toFixed(6)}
          note="Started at 1.000000, moves with fees and settlements"
        />
        <Stat k="Free to withdraw now" v={`${amount2(micro(vault.idle))} tUSDC`} note="Idle, not inside a series" />
        <Stat k="In series" v={`${amount2(micro(inSeries))} tUSDC`} note={`${parts.length} active series`} />
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="flex flex-col gap-5 rounded-[32px] bg-surface p-6 md:p-9">
          <h2 className="text-[22px] font-extrabold">Where the money sits</h2>
          {total > 0n && (
            <div className="flex h-3 shrink-0 gap-1 overflow-hidden rounded-full" aria-hidden>
              {rows.map((r, i) =>
                r.value && r.value > 0n ? (
                  <span key={r.name + i} className={`${COLORS[Math.min(i, COLORS.length - 1)]}`} style={{ flexGrow: Number(r.value) }} />
                ) : null,
              )}
            </div>
          )}
          <div className="flex flex-col">
            {rows.map((r, i) => (
              <div key={r.name + i} className="flex items-center gap-4 border-b border-line py-4 last:border-0">
                <span className={`size-3 shrink-0 rounded-[3px] ${COLORS[Math.min(i, COLORS.length - 1)]}`} />
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="font-bold">{r.name}</span>
                  <span className="text-[13px] text-ink-2">{r.note}</span>
                </div>
                <span className="w-16 text-right font-mono text-sm text-ink-2">
                  {r.value === null || total === 0n ? "" : `${((Number(r.value) / Number(total)) * 100).toFixed(1)}%`}
                </span>
                <span className="w-28 text-right font-mono">{r.value === null ? "pending" : amount2(micro(r.value))}</span>
              </div>
            ))}
          </div>
          <p className="flex gap-3 rounded-[18px] bg-brand-soft px-5 py-4 text-sm">
            <Icon name="check" className="mt-0.5 size-4 shrink-0 text-brand-deep" />
            The worst the vault can lose on one series is what it put into that series, at most 10% of its value when the series
            opened. Trading cannot move the share price: only fees and settlement do.
          </p>
        </section>
        <VaultPanel />
      </div>
    </>
  );
}
