"use client";

import { faucetMintAuthority, faucetRecord, TEST_USDC_PROGRAM_ID, TUSDC_MINT } from "@clamp/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { amount2 } from "@/lib/market";
import { Icon } from "./icon";

const COOLDOWN = 24 * 3600;
// sha256("global:claim")[0..8], the Anchor discriminator of the faucet's `claim` (as in backend/src/faucet-claim.ts).
const CLAIM = Uint8Array.from([62, 198, 214, 193, 213, 159, 108, 210]);
const SOL_FAUCET = "https://faucet.solana.com/";

type Info = { usdc: number; sol: number; lastClaim: number | null };

const short = (s: string) => `${s.slice(0, 4)}...${s.slice(-4)}`;
const utc = (ts: number) => new Date(ts * 1000).toISOString().slice(11, 16);
function wait(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The faucet card in every state of the design: no wallet, ready, claimed, already claimed today, no SOL. */
export function FaucetPanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return setInfo(null);
    const ata = getAssociatedTokenAddressSync(TUSDC_MINT, publicKey);
    const [usdc, lamports, record] = await Promise.all([
      connection.getTokenAccountBalance(ata).then((b) => b.value.uiAmount ?? 0, () => 0),
      connection.getBalance(publicKey),
      connection.getAccountInfo(faucetRecord(publicKey)),
    ]);
    // FaucetRecord: 8 byte discriminator, wallet (32), last_claim_ts (i64).
    const lastClaim =
      record && record.data.length >= 48
        ? Number(new DataView(record.data.buffer, record.data.byteOffset).getBigInt64(40, true))
        : null;
    setInfo({ usdc, sol: lamports / 1e9, lastClaim });
  }, [connection, publicKey]);

  useEffect(() => {
    setSig(null);
    setError(null);
    refresh().catch(() => setError("Could not reach the devnet RPC."));
  }, [refresh]);

  const claim = async () => {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const ix = new TransactionInstruction({
        programId: TEST_USDC_PROGRAM_ID,
        data: Buffer.from(CLAIM),
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: faucetRecord(publicKey), isSigner: false, isWritable: true },
          { pubkey: TUSDC_MINT, isSigner: false, isWritable: true },
          { pubkey: faucetMintAuthority(), isSigner: false, isWritable: false },
          { pubkey: getAssociatedTokenAddressSync(TUSDC_MINT, publicKey), isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
      });
      const s = await sendTransaction(new Transaction().add(ix), connection);
      await connection.confirmTransaction(s, "confirmed");
      setSig(s);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        /reject|denied|cancel/i.test(msg)
          ? "You cancelled the claim in your wallet."
          : /0x1770|Cooldown/i.test(msg)
            ? "This wallet already claimed in the last 24 hours."
            : `The claim failed: ${msg.slice(0, 160)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const next = info?.lastClaim ? info.lastClaim + COOLDOWN : null;
  const cooling = next !== null && next > now;
  const noSol = info !== null && info.sol < 0.001;

  return (
    <section className="flex flex-col gap-6 rounded-[36px] bg-surface p-6 md:p-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[13px] font-semibold text-brand-deep">
          <Icon name="flask-conical" className="size-3.5" />
          Test tokens, devnet only
        </span>
        {publicKey && (
          <span className="rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[13px]">{short(publicKey.toBase58())}</span>
        )}
      </div>
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-[64px] leading-none md:text-[96px]">1,000</span>
        <span className="font-mono text-xl text-ink-2">tUSDC</span>
      </p>
      <dl className="flex flex-col">
        {(
          [
            ["Your balance", info ? `${amount2(info.usdc)} tUSDC` : publicKey ? "reading..." : "connect a wallet"],
            ["Limit", "1,000 tUSDC per wallet every 24 hours"],
            ["Network", "Solana devnet"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-t border-line py-4 text-sm">
            <dt className="text-ink-2">{k}</dt>
            <dd className="text-right font-mono">{v}</dd>
          </div>
        ))}
      </dl>

      {sig && (
        <a
          href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-3 rounded-[20px] bg-ink px-5 py-4 text-white"
        >
          <span className="grid size-9 place-items-center rounded-full bg-brand">
            <Icon name="check" className="size-4" />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">1,000 tUSDC claimed</span>
            <span className="text-[13px] text-white/70">
              Balance {info ? amount2(info.usdc) : "..."} tUSDC. View transaction
            </span>
          </span>
          <Icon name="arrow-up-right" className="size-4" />
        </a>
      )}
      {error && <p className="rounded-[14px] bg-[#fbe7e3] px-4 py-3 text-sm text-down">{error}</p>}

      {!publicKey ? (
        <div className="flex flex-col gap-2">
          <button onClick={() => setVisible(true)} className="h-12 w-fit rounded-full bg-ink px-6 font-semibold text-white">
            Connect wallet
          </button>
          <p className="text-sm text-ink-2">Tokens go to the connected wallet. Phantom, Solflare and Backpack work.</p>
        </div>
      ) : noSol ? (
        <div className="flex flex-col gap-3 rounded-[18px] bg-[#fdf3d6] p-5">
          <p className="flex items-center gap-2 font-bold">
            <Icon name="triangle-alert" className="size-4 text-[#9a6b00]" />
            This wallet has no devnet SOL
          </p>
          <p className="text-sm text-ink-2">The claim needs a tiny SOL fee. Get devnet SOL from the Solana faucet and try again.</p>
          <a href={SOL_FAUCET} target="_blank" rel="noreferrer" className="w-fit text-sm font-semibold text-brand">
            Open the Solana faucet
          </a>
        </div>
      ) : cooling ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-bold">
            <Icon name="hourglass" className="size-4" />
            You can claim again in {wait(next! - now)}
          </p>
          <p className="text-sm text-ink-2">One claim per wallet every 24 hours keeps the faucet fair for everyone.</p>
          <button disabled className="h-12 w-fit rounded-full bg-line px-6 font-semibold text-muted">
            Claim again at {utc(next!)} UTC
          </button>
        </div>
      ) : (
        <button
          onClick={claim}
          disabled={busy || !info}
          className="flex h-12 w-fit items-center gap-3 rounded-full bg-ink py-1.5 pr-1.5 pl-[22px] font-medium text-white disabled:opacity-60"
        >
          {busy ? "Waiting for your wallet..." : "Claim 1,000 tUSDC"}
          <span className="grid size-9 place-items-center rounded-full bg-white text-ink">
            <Icon name="arrow-down-to-line" className="size-[17px]" />
          </span>
        </button>
      )}
    </section>
  );
}
