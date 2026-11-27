import type { Metadata } from "next";
import Link from "next/link";
import { LockFlow } from "@/components/lock-flow";

export const metadata: Metadata = { title: "Bill Lock · Clamp" };

export default function Page() {
  return (
    <>
      <header className="flex flex-col gap-4 px-2 pt-10 pb-4">
        <nav aria-label="Lock type" className="flex w-fit gap-1 rounded-full bg-surface p-1 text-sm font-semibold">
          <Link href="/lock/bill" aria-current={"page"} className="rounded-full px-4 py-2 bg-ink text-white">
            Bill Lock
          </Link>
          <Link href="/lock/revenue" aria-current={undefined} className="rounded-full px-4 py-2 text-ink-2 hover:text-ink">
            Revenue Lock
          </Link>
        </nav>
        <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[64px]">Lock your GPU bill</h1>
        <p className="max-w-[640px] text-[17px] leading-normal text-ink-2">Show Clamp what you rented last month. It takes your GPU hours and your rate, then suggests a lock. Nothing is signed yet.</p>
      </header>
      <LockFlow side="bill" />
    </>
  );
}
