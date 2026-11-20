"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TUSDC_MINT } from "@clamp/sdk";

type Balances = { sol: number; tusdc: number } | "error" | null;

/** Live devnet balances of the connected wallet: SOL and test USDC. */
export function WalletStatus() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [balances, setBalances] = useState<Balances>(null);

  useEffect(() => {
    if (!publicKey) return;
    let live = true;
    setBalances(null);
    const ata = getAssociatedTokenAddressSync(TUSDC_MINT, publicKey);
    Promise.all([
      connection.getBalance(publicKey),
      // A missing token account means the wallet holds no tUSDC yet.
      connection.getTokenAccountBalance(ata).then((b) => b.value.uiAmount ?? 0, () => 0),
    ]).then(
      ([lamports, tusdc]) => live && setBalances({ sol: lamports / LAMPORTS_PER_SOL, tusdc }),
      () => live && setBalances("error"),
    );
    return () => {
      live = false;
    };
  }, [connection, publicKey]);

  if (!publicKey) return <p className="text-muted">Connect a wallet to see your devnet balances.</p>;
  if (balances === "error") return <p className="text-down">Could not reach the devnet RPC.</p>;
  if (!balances) return <p className="text-muted">Loading balances...</p>;

  return (
    <dl className="grid grid-cols-2 gap-4 sm:max-w-sm">
      <div className="rounded-lg border border-line p-4">
        <dt className="text-xs text-muted">SOL (devnet)</dt>
        <dd className="mt-1 font-mono text-lg">{balances.sol.toFixed(4)}</dd>
      </div>
      <div className="rounded-lg border border-line p-4">
        <dt className="text-xs text-muted">tUSDC (test token)</dt>
        <dd className="mt-1 font-mono text-lg">{balances.tusdc.toFixed(2)}</dd>
      </div>
    </dl>
  );
}
