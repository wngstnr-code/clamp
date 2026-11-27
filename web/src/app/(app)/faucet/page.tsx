import type { Metadata } from "next";
import Link from "next/link";
import { FaucetPanel } from "@/components/faucet-panel";
import { Icon } from "@/components/icon";

export const metadata: Metadata = { title: "Test tokens · Clamp" };

export default function FaucetPage() {
  return (
    <>
      <header className="flex max-w-[760px] flex-col gap-3 px-2 pt-12 pb-8 md:pt-16">
        <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[64px]">Test tokens</h1>
        <p className="text-[17px] leading-normal text-ink-2 md:text-[19px]">
          Clamp runs on Solana devnet with test USDC. Claim 1,000 tUSDC once a day to try every page. Test tokens have no value.
        </p>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
        <FaucetPanel />
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3 rounded-[32px] bg-surface p-6 md:p-7">
            <h2 className="text-lg font-extrabold">Need devnet SOL for fees?</h2>
            <p className="text-sm text-ink-2">
              Every transaction pays a tiny fee in SOL. Get free devnet SOL from the Solana faucet, then come back.
            </p>
            <a
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noreferrer"
              className="flex h-11 w-fit items-center gap-3 rounded-full py-1 pr-1 pl-5 text-sm font-semibold ring-1 ring-line"
            >
              Open the Solana faucet
              <span className="grid size-8 place-items-center rounded-full bg-ink text-white">
                <Icon name="arrow-up-right" className="size-4" />
              </span>
            </a>
          </section>
          <section className="flex flex-col gap-3 rounded-[32px] bg-surface p-6 md:p-7">
            <h2 className="text-lg font-extrabold">Then try a lock</h2>
            <p className="text-sm text-ink-2">
              1,000 tUSDC is enough to lock a week of GPU rent, buy a side in the Market and fund the vault.
            </p>
            <Link href="/lock/bill" className="w-fit text-sm font-semibold text-brand">
              Lock my bill
            </Link>
          </section>
        </div>
      </div>
    </>
  );
}
