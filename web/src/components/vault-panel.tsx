"use client";

import { getVault, sharesMintPda, TUSDC_MINT, type VaultView } from "@clamp/sdk";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { amount2, micro } from "@/lib/market";
import { parseAmount, vaultMove } from "@/lib/market-tx";
import { Icon } from "./icon";

const six = (v: number) => v.toFixed(6);

/** Deposit and withdraw, in every state of the design: no wallet, more than is free, waiting for settlement. */
export function VaultPanel() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const [vault, setVault] = useState<VaultView | null | "error">(null);
  const [bal, setBal] = useState<{ usdc: bigint; shares: bigint } | null>(null);
  const [tab, setTab] = useState<"Deposit" | "Withdraw">("Deposit");
  const [text, setText] = useState("100");
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVault(await getVault(connection));
      if (!wallet) return setBal(null);
      const read = (a: PublicKey) => connection.getTokenAccountBalance(a).then((b) => BigInt(b.value.amount), () => 0n);
      const [usdc, shares] = await Promise.all([
        read(getAssociatedTokenAddressSync(TUSDC_MINT, wallet.publicKey)),
        read(getAssociatedTokenAddressSync(sharesMintPda(), wallet.publicKey)),
      ]);
      setBal({ usdc, shares });
    } catch {
      setVault((v) => (v && v !== "error" ? v : "error"));
    }
  }, [connection, wallet]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (vault === null) return <div className="h-[460px] animate-pulse rounded-[32px] bg-surface" />;
  if (vault === "error" || !vault)
    return <p className="rounded-[32px] bg-surface p-7 text-sm text-ink-2">The vault cannot be read from Solana right now.</p>;

  const amount = parseAmount(text);
  const waiting = vault.nav === null; // an active series expired and waits for settlement
  const price = vault.sharePrice === null ? null : micro(vault.sharePrice);
  const deposit = tab === "Deposit";
  const outValue = amount && price ? (deposit ? micro(amount) / price : micro(amount) * price) : null;
  const short = !!(bal && amount && amount > (deposit ? bal.usdc : bal.shares));
  const overFree = !deposit && outValue !== null && outValue > micro(vault.idle);

  const submit = async () => {
    if (!wallet || !amount) return;
    setBusy(true);
    setSig(null);
    setError(null);
    try {
      setSig(await vaultMove(connection, wallet, deposit, amount));
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|cancel/i.test(msg) ? "You cancelled the transaction in your wallet." : `The transaction failed: ${msg.slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {waiting && (
        <div className="flex gap-3 rounded-[18px] bg-[#fdf3d6] px-5 py-4">
          <Icon name="triangle-alert" className="mt-0.5 size-[18px] shrink-0 text-[#9a6b00]" />
          <div className="flex flex-col gap-1">
            <p className="text-[15px] font-bold">Deposits and withdrawals wait a moment</p>
            <p className="text-sm text-ink-2">
              A series of the vault has expired. Anyone can settle it; the vault is valued again as soon as it is.
            </p>
          </div>
        </div>
      )}
      {wallet && bal && bal.shares === 0n && !sig && (
        <section className="flex items-center gap-4 rounded-[28px] bg-surface p-5">
          <Image src="/landing/clam-vault.jpg" alt="" width={56} height={56} className="size-14 shrink-0 rounded-full object-cover" />
          <div className="flex flex-col gap-0.5">
            <p className="font-extrabold">You have no shares yet</p>
            <p className="text-sm text-ink-2">Deposit tUSDC to fund both sides of every series and earn the trade fees.</p>
          </div>
        </section>
      )}
      <section className="flex flex-col gap-4 rounded-[32px] bg-surface p-5 shadow-[0_12px_32px_rgba(17,19,24,0.06)] md:p-6">
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {(["Deposit", "Withdraw"] as const).map((t) => (
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
        <label className={`flex flex-col gap-2 rounded-[18px] bg-surface-2 p-4 ring-1 ${short ? "ring-down" : "ring-transparent"}`}>
          <span className="flex justify-between text-[13px] text-ink-2">
            <span>{deposit ? "You deposit" : "You withdraw"}</span>
            {bal && <span>{deposit ? `Balance ${amount2(micro(bal.usdc))}` : `Holding ${amount2(micro(bal.shares))}`}</span>}
          </span>
          <span className="flex items-center gap-3">
            <input
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Amount"
              className="w-full min-w-0 bg-transparent font-mono text-[28px] outline-none"
            />
            <span className="shrink-0 rounded-full bg-surface px-3 py-1 text-[13px] font-semibold">{deposit ? "tUSDC" : "shares"}</span>
          </span>
        </label>
        <div className="flex flex-col gap-2 text-sm">
          {[
            [deposit ? "You get" : "You receive", waiting ? "waiting for settlement" : outValue === null ? "n/a" : deposit ? `about ${amount2(outValue)} shares` : `about ${amount2(outValue)} tUSDC`],
            ["Share price", price === null ? "n/a" : six(price)],
            deposit ? ["Fee", "none"] : ["Free in the vault now", `${amount2(micro(vault.idle))} tUSDC`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-ink-2">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
        {!wallet ? (
          <button onClick={() => setVisible(true)} className="h-12 rounded-full bg-ink font-semibold text-white">
            Connect wallet
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={busy || !amount || short || overFree || waiting}
            className="h-12 rounded-full bg-ink font-semibold text-white disabled:bg-line disabled:text-muted"
          >
            {busy
              ? "Waiting for your wallet..."
              : waiting
                ? "Waiting for settlement"
                : short
                  ? deposit
                    ? "Not enough tUSDC"
                    : "Not enough shares"
                  : overFree
                    ? "Not enough free right now"
                    : deposit
                      ? `Deposit ${amount ? amount2(micro(amount)) : ""} tUSDC`
                      : `Withdraw ${outValue === null ? "" : amount2(outValue)} tUSDC`}
          </button>
        )}
        {overFree && (
          <p className="rounded-[14px] bg-[#fdf3d6] px-4 py-3 text-sm">
            {amount2(micro(vault.idle))} tUSDC is free now. The rest frees up as series settle and are swept back into the vault.
          </p>
        )}
        {error && <p className="rounded-[14px] bg-[#fbe7e3] px-4 py-3 text-sm text-down">{error}</p>}
        {sig && (
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
        )}
      </section>
      <p className="px-2 text-center text-[13px] text-muted">
        Shares are rounded down. You can withdraw whenever enough tUSDC is idle.
      </p>
    </div>
  );
}
