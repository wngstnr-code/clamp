"use client";

import { getIndex, getVault, type IndexView, listSeries, type SeriesView, sharesMintPda, type VaultView } from "@clamp/sdk";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { when } from "@/lib/index-data";
import { amount2, micro, p4, poolPrices, ppm, seriesName } from "@/lib/market";
import { redeemAll } from "@/lib/market-tx";
import { Button } from "./button";
import { Icon } from "./icon";

type Holding = { s: SeriesView; side: 0 | 1; amount: bigint; each: number | null };
type Data = { holdings: Holding[]; vault: VaultView | null; shares: bigint; indexTs: number };

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-2">
        <h2 className="text-[24px] font-extrabold">{title}</h2>
        <span className="text-sm text-ink-2">{note}</span>
      </div>
      {children}
    </section>
  );
}

/** Everything the connected wallet holds: claims per series, vault shares. Locks arrive with the lock program. */
export function PositionsView() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const [data, setData] = useState<Data | null | "error">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ sig?: string; error?: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) return setData(null);
    try {
      const now = Math.floor(Date.now() / 1000);
      const [series, accounts, vault] = await Promise.all([
        listSeries(connection),
        connection.getParsedTokenAccountsByOwner(wallet.publicKey, { programId: TOKEN_PROGRAM_ID }),
        getVault(connection, now),
      ]);
      const balance = new Map<string, bigint>();
      for (const a of accounts.value) {
        const info = a.account.data.parsed.info as { mint: string; tokenAmount: { amount: string } };
        balance.set(info.mint, (balance.get(info.mint) ?? 0n) + BigInt(info.tokenAmount.amount));
      }
      const indexes = new Map<number, IndexView | null>();
      for (const id of new Set(series.map((s) => s.classId))) indexes.set(id, await getIndex(connection, id));
      const holdings: Holding[] = [];
      for (const s of series) {
        const index = indexes.get(s.classId) ?? null;
        // Settled: what redeem pays. Open: the pool price a sale would start from.
        const prices = s.settled
          ? { up: ppm(s.upValue), down: 1 - ppm(s.upValue) }
          : index && s.seeded
            ? poolPrices(s, index, now)
            : null;
        for (const side of [0, 1] as const) {
          const amount = balance.get((side === 0 ? s.upMint : s.downMint).toBase58()) ?? 0n;
          if (amount > 0n) holdings.push({ s, side, amount, each: prices ? (side === 0 ? prices.up : prices.down) : null });
        }
      }
      holdings.sort((a, b) => Number(a.s.settled) - Number(b.s.settled) || a.s.closeTs - b.s.closeTs);
      const indexTs = Math.max(0, ...[...indexes.values()].map((i) => i?.lastTs ?? 0));
      setData({ holdings, vault, shares: balance.get(sharesMintPda().toBase58()) ?? 0n, indexTs });
    } catch {
      setData("error");
    }
  }, [connection, wallet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!wallet)
    return (
      <section className="mt-10 flex flex-col items-center gap-4 rounded-[36px] bg-surface px-6 py-16 text-center">
        <Image src="/landing/clam-renter.jpg" alt="" width={96} height={96} className="size-24 rounded-full object-cover" />
        <h2 className="text-[28px] font-extrabold">Connect a wallet to see your positions</h2>
        <p className="max-w-[440px] text-ink-2">Claims, locks and vault shares of the connected wallet show up here.</p>
        <button onClick={() => setVisible(true)} className="h-12 rounded-full bg-ink px-6 font-semibold text-white">
          Connect wallet
        </button>
      </section>
    );
  if (data === null) return <div className="mt-10 h-[420px] animate-pulse rounded-[36px] bg-surface" />;
  if (data === "error")
    return <p className="mt-10 rounded-[32px] bg-surface p-8 text-ink-2">Your positions cannot be read from Solana right now.</p>;

  const now = Math.floor(Date.now() / 1000);
  const claimsWorth = data.holdings.reduce((a, h) => a + (h.each === null ? 0 : micro(h.amount) * h.each), 0);
  const shareValue = data.vault?.sharePrice != null ? micro(data.shares) * micro(data.vault.sharePrice) : null;
  const worth = claimsWorth + (shareValue ?? 0);
  const empty = data.holdings.length === 0 && data.shares === 0n;

  const redeem = async (h: Holding) => {
    const key = `${h.s.address.toBase58()}-${h.side}`;
    setBusy(key);
    setMsg(null);
    try {
      const sig = await redeemAll(connection, wallet, h.s, h.side === 0 ? h.amount : 0n, h.side === 1 ? h.amount : 0n);
      setMsg({ sig });
      await refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg({ error: /reject|denied|cancel/i.test(m) ? "You cancelled the transaction in your wallet." : `Redeem failed: ${m.slice(0, 160)}` });
    } finally {
      setBusy(null);
    }
  };

  if (empty)
    return (
      <section className="mt-10 flex flex-col items-center gap-4 rounded-[36px] bg-surface px-6 py-16 text-center">
        <Image src="/landing/clam-renter.jpg" alt="" width={96} height={96} className="size-24 rounded-full object-cover" />
        <h2 className="text-[32px] font-extrabold">No positions yet</h2>
        <p className="max-w-[440px] text-ink-2">
          Lock your GPU bill or revenue, buy a side in the Market, or fund the vault. Everything you hold shows up here.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button href="/lock/bill">Lock my bill</Button>
          <Button href="/market" variant="secondary">
            Browse the Market
          </Button>
        </div>
      </section>
    );

  return (
    <>
      <div className="flex flex-col gap-1 rounded-[32px] bg-surface p-6 md:p-8">
        <span className="text-[13px] text-ink-2">Worth now</span>
        <span className="font-mono text-[32px] md:text-[40px]">{amount2(worth)} tUSDC</span>
        {data.indexTs > 0 && <span className="text-[13px] text-muted">Valued at the {when(data.indexTs, now)} index</span>}
      </div>

      <Section title="Locks" note="Claims held for you inside a lock">
        <p className="rounded-[32px] bg-surface p-6 text-sm text-ink-2 md:p-8">
          Bill and revenue locks are not live on devnet yet. Claims you bought or minted are listed below.
        </p>
      </Section>

      {msg && (
        <div className="mt-6">
          {msg.error ? (
            <p className="rounded-[14px] bg-[#fbe7e3] px-4 py-3 text-sm text-down">{msg.error}</p>
          ) : (
            <a
              href={`https://explorer.solana.com/tx/${msg.sig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-[14px] bg-[#dff3ea] px-4 py-3 text-sm font-semibold text-up"
            >
              <Icon name="check" className="size-4" />
              Redeemed. See the transaction
            </a>
          )}
        </div>
      )}

      <Section title="Claims in your wallet" note="Bought or minted, not inside a lock">
        {data.holdings.length === 0 ? (
          <p className="rounded-[32px] bg-surface p-6 text-sm text-ink-2 md:p-8">No claims in this wallet.</p>
        ) : (
          <div className="overflow-x-auto rounded-[32px] bg-surface px-6 py-3 md:px-8">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-line text-sm text-ink-2">
                  <th className="px-1 py-4 font-semibold">Series</th>
                  <th className="px-1 py-4 font-semibold">Side</th>
                  <th className="px-1 py-4 font-semibold">Amount</th>
                  <th className="px-1 py-4 font-semibold">Value each</th>
                  <th className="px-1 py-4 font-semibold">Worth</th>
                  <th className="w-44 px-1 py-4" />
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => {
                  const key = `${h.s.address.toBase58()}-${h.side}`;
                  const worthRow = h.each === null ? null : micro(h.amount) * h.each;
                  return (
                    <tr key={key} className="border-b border-line last:border-0">
                      <td className="px-1 py-4">
                        <span className="flex flex-col gap-0.5">
                          <span className="font-bold">{seriesName(h.s)}</span>
                          <span className="text-[13px] text-ink-2">
                            {h.s.settled
                              ? `Settled, average $${micro(h.s.avg).toFixed(4)}`
                              : now >= h.s.closeTs
                                ? `Closed, settles ${when(h.s.expiryTs, now)}`
                                : `Open, closes ${when(h.s.closeTs, now)}`}
                          </span>
                        </span>
                      </td>
                      <td className={`px-1 py-4 font-bold ${h.side === 0 ? "text-up" : "text-down"}`}>{h.side === 0 ? "UP" : "DOWN"}</td>
                      <td className="px-1 py-4 font-mono">{amount2(micro(h.amount))}</td>
                      <td className="px-1 py-4 font-mono">{h.each === null ? "n/a" : p4(h.each)}</td>
                      <td className="px-1 py-4 font-mono">{worthRow === null ? "n/a" : `${amount2(worthRow)} tUSDC`}</td>
                      <td className="px-1 py-3 text-right">
                        {h.s.settled ? (
                          <button
                            onClick={() => redeem(h)}
                            disabled={busy !== null}
                            className="h-11 rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            {busy === key ? "Waiting..." : `Redeem ${worthRow === null ? "" : amount2(worthRow)}`}
                          </button>
                        ) : (
                          <Button href={`/market/${h.s.address.toBase58()}`} variant="secondary">
                            Trade
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Vault" note="Your share of the vault">
        <div className="flex flex-wrap items-center gap-6 rounded-[32px] bg-surface p-6 md:p-8">
          {(
            [
              ["Shares", amount2(micro(data.shares))],
              ["Share price", data.vault?.sharePrice != null ? micro(data.vault.sharePrice).toFixed(6) : "n/a"],
              ["Worth now", shareValue === null ? "n/a" : `${amount2(shareValue)} tUSDC`],
              [
                "Free to withdraw",
                shareValue === null || !data.vault ? "n/a" : `${amount2(Math.min(shareValue, micro(data.vault.idle)))} tUSDC`,
              ],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex min-w-[150px] flex-1 flex-col gap-1">
              <span className="text-[13px] text-ink-2">{k}</span>
              <span className="font-mono text-lg">{v}</span>
            </div>
          ))}
          <Button href="/vault" variant="secondary">
            Open the vault
          </Button>
        </div>
      </Section>
    </>
  );
}
