"use client";

import { TUSDC_MINT } from "@clamp/sdk";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { WalletButton } from "./wallet-button";

const LINKS = [
  ["Index", "/index"],
  ["Market", "/market"],
  ["Lock", "/lock/bill"],
  ["Vault", "/vault"],
  ["Positions", "/positions"],
] as const;

/** tUSDC balance of the connected wallet. Hidden until a wallet is connected and the balance is read. */
function Balance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [tusdc, setTusdc] = useState<number | null>(null);

  useEffect(() => {
    setTusdc(null);
    if (!publicKey) return;
    let live = true;
    // A missing token account means the wallet holds no tUSDC yet.
    connection
      .getTokenAccountBalance(
        getAssociatedTokenAddressSync(TUSDC_MINT, publicKey),
      )
      .then(
        (b) => b.value.uiAmount ?? 0,
        () => 0,
      )
      .then((v) => live && setTusdc(v));
    return () => {
      live = false;
    };
  }, [connection, publicKey]);

  if (tusdc === null) return null;
  return (
    <span className="hidden h-10 items-center rounded-full bg-surface-2 px-4 font-mono text-sm sm:flex">
      {tusdc.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}{" "}
      tUSDC
    </span>
  );
}

/** Navigation of the app pages: sections in the middle, network and wallet on the right. */
export function AppNav() {
  const path = usePathname();
  const links = LINKS.map(([label, href]) => {
    // Lock covers both /lock/bill and /lock/revenue.
    const base = href.startsWith("/lock") ? "/lock" : href;
    const active = path === base || path.startsWith(`${base}/`);
    return (
      <Link
        key={label}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`shrink-0 rounded-full px-4 py-2 ${active ? "bg-surface-2 text-ink" : "hover:text-ink"}`}
      >
        {label}
      </Link>
    );
  });
  return (
    <>
      <nav className="app-nav relative mx-auto flex h-[64px] w-full max-w-[1344px] items-center justify-between gap-4 rounded-full bg-surface py-3 pr-3 pl-6 shadow-[0_8px_24px_rgba(17,19,24,0.06)]">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-lg font-extrabold"
        >
          <img src="/logo.svg" alt="" className="size-[26px]" />
          Clamp
        </Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 gap-1 text-[15px] font-medium text-ink-2 lg:flex">
          {links}
        </div>
        <div className="flex items-center gap-2">
          <span
            title="Solana devnet, test tokens only"
            className="flex h-10 items-center gap-1.5 rounded-full bg-brand-soft px-3 text-sm font-semibold text-brand-deep sm:px-3.5"
          >
            <Icon name="flask-conical" className="size-4" />
            <span className="hidden sm:inline">Devnet</span>
          </span>
          <Balance />
          <WalletButton />
        </div>
      </nav>
      {/* Phones and tablets: the same links in a row under the bar. */}
      <div className="mx-auto mt-3 flex max-w-[1344px] gap-1 overflow-x-auto text-[15px] font-medium text-ink-2 lg:hidden">
        {links}
      </div>
    </>
  );
}
