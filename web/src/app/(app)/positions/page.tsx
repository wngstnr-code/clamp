import type { Metadata } from "next";
import { PositionsView } from "@/components/positions-view";

export const metadata: Metadata = { title: "Positions · Clamp" };

export default function PositionsPage() {
  return (
    <>
      <header className="flex flex-col gap-3 px-2 pt-12 pb-8 md:pt-16">
        <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-1.5px] md:text-[64px]">Positions</h1>
        <p className="text-[17px] leading-normal text-ink-2">Everything this wallet holds, valued at the latest index.</p>
      </header>
      <PositionsView />
    </>
  );
}
