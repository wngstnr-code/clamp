import Image from "next/image";
import { Button } from "@/components/button";
import { type LiveIndex, usd4 } from "@/lib/live-index";
import { LandingNav } from "./nav";

function IndexValue({ name, index }: { name: string; index: LiveIndex }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-[13px] font-bold">{name}</span>
      <span className="font-mono text-[13px]">{index ? `${usd4(index.price)}/hr` : "not available"}</span>
    </span>
  );
}

export function Hero({ rtx, h100 }: { rtx: LiveIndex; h100: LiveIndex }) {
  return (
    // On phones the photo sits under the copy so the text never lands on the clam.
    <section className="relative flex flex-col overflow-hidden bg-[#bfe6f3] md:block md:h-svh md:min-h-[680px]">
      <div className="relative order-last h-[420px] md:absolute md:inset-0 md:order-none md:h-auto">
        <Image
          src="/landing/hero-sea.jpg"
          alt="A clam riding a wave in a turquoise sea, holding a graphics card"
          fill
          unoptimized
          priority
          sizes="100vw"
          className="object-cover object-[72%_center]"
        />
      </div>
      <div className="relative px-4 pt-6 pb-10 md:flex md:h-full md:flex-col md:px-10 xl:px-[120px] md:pb-0">
        <LandingNav />
        <div className="mt-24 flex max-w-[560px] flex-col gap-6 md:my-auto md:pt-10 md:pb-16">
          <h1 className="text-[44px] leading-[1.02] font-extrabold tracking-[-2px] md:text-[68px]">
            Ride the GPU price waves. Or lock them.
          </h1>
          <p className="max-w-[470px] text-lg leading-normal text-ink/80">
            GPU rental prices rise and fall like the tide. Clamp locks next month&apos;s bill for renters and next
            month&apos;s revenue for owners. Fully backed by USDC on Solana.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button href="/lock/bill">Lock my bill</Button>
            <Button href="#demo" variant="secondary" icon="play">
              Watch the demo
            </Button>
          </div>
          <div className="flex w-fit flex-wrap items-center gap-x-[18px] gap-y-2 rounded-[18px] bg-surface px-[18px] py-3">
            <span className="text-xs font-bold text-ink-2">Clamp Index</span>
            <IndexValue name="RTX 4090" index={rtx} />
            <IndexValue name="H100" index={h100} />
          </div>
        </div>
      </div>
    </section>
  );
}
