import Image from "next/image";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";

const FLOW = [
  ["Connect your bill", "A read-only key or an invoice file."],
  ["Check the lock", "Your rate, the index and the band side by side."],
  ["Lock it", "Clamp buys the claims. Close or roll it later."],
] as const;

export function Demo() {
  return (
    <section id="demo" className="relative h-[880px] overflow-hidden md:h-[920px]">
      <Image
        src="/landing/demo-sunset.jpg"
        alt="The clam next to an open laptop on a beach towel at sunset"
        fill
        unoptimized
        sizes="100vw"
        className="object-cover object-[70%_center]"
      />
      {/* The sunset fades into the white footer below, like a soft blur. */}
      <div className="absolute inset-x-0 bottom-0 h-[520px] md:h-[360px] bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.55)_45%,rgba(255,255,255,0.95)_80%,#fff_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[70px] bg-white/20 backdrop-blur-lg" />

      <div className="relative flex flex-col gap-8 px-4 pt-16 md:px-24 md:pt-24">
        <h2 className="max-w-[560px] text-[44px] leading-none font-extrabold tracking-[-2px] text-white md:text-6xl">
          See a lock in two minutes.
        </h2>
        <div>
          <Button href="#demo" variant="secondary" icon="play">
            Watch the demo
          </Button>
        </div>
      </div>

      <ol className="absolute inset-x-4 bottom-10 flex flex-col gap-5 md:inset-x-24 md:bottom-[60px] md:flex-row md:items-center">
        {FLOW.map(([title, text], i) => (
          <li key={title} className="flex flex-1 items-center gap-5">
            {i > 0 && <Icon name="arrow-right" className="hidden size-5 shrink-0 text-ink-2 md:block" />}
            <div className="flex flex-col gap-1">
              <span className="text-lg font-extrabold">{title}</span>
              <span className="text-sm text-ink-2">{text}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
