import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";

const SIDES = [
  {
    title: "Bill Lock",
    who: "For researchers, students and small AI teams on a fixed GPU budget.",
    outcome:
      "You hold UP. If the index ends at the top of the band, each UP pays $1.00 and covers your extra rent.",
    cta: "Lock my bill",
    href: "/lock/bill",
    image: "/landing/clam-renter.jpg",
    alt: "The clam holding a long paper receipt",
  },
  {
    title: "Revenue Lock",
    who: "For hosts who rent out their GPUs and need steady income.",
    outcome:
      "You hold DOWN. If the index ends at the bottom of the band, each DOWN pays $1.00 and covers your lost rent.",
    cta: "Lock my revenue",
    href: "/lock/revenue",
    image: "/landing/clam-owner.jpg",
    alt: "The clam sitting on a graphics card, holding a coin",
  },
] as const;

export function PickYourSide() {
  return (
    <section id="how-it-works" className="bg-[#fcfcfc] px-4 py-20 md:px-24 md:pt-24 md:pb-28">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <h2 className="max-w-[620px] text-[40px] leading-none font-extrabold tracking-[-2px] md:text-6xl">
          Pick your side of the price.
        </h2>
        <p className="max-w-[420px] text-lg leading-normal text-ink-2">
          GPU rental prices move like the tide. Renters fear the rise, owners fear the fall. Clamp lets each side
          lock the part that hurts.
        </p>
      </div>

      <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-0">
        {SIDES.map((s, i) => (
          <div key={s.title} className={`flex flex-col gap-6 ${i === 0 ? "md:border-r md:border-line md:pr-12" : "md:pl-12"}`}>
            <div className="flex items-center gap-6">
              <Image
                src={s.image}
                alt={s.alt}
                width={180}
                height={180}
                className="size-28 shrink-0 rounded-full object-cover md:size-[180px]"
              />
              <div className="flex flex-col gap-2.5">
                <h3 className="text-[32px] font-extrabold tracking-[-1px] md:text-[40px]">{s.title}</h3>
                <p className="text-[17px] leading-normal text-ink-2">{s.who}</p>
              </div>
            </div>
            <p className="text-[17px] leading-[1.55]">{s.outcome}</p>
            <div>
              <Button href={s.href}>{s.cta}</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-14 flex flex-col gap-6 rounded-3xl bg-brand-soft p-5 md:flex-row md:items-center">
        <Image
          src="/landing/clam-vault.jpg"
          alt="The clam hugging a stack of coins inside a small safe"
          width={96}
          height={96}
          className="size-24 shrink-0 rounded-full object-cover"
        />
        <p className="flex-1 text-[17px] leading-normal">
          Have idle USDC? Put it in the vault. It funds both sides of the pool and earns the trade fees, with a risk
          cap on every series.
        </p>
        <Link href="/vault" className="flex items-center gap-2 px-3 font-bold hover:opacity-80">
          Open the vault
          <Icon name="arrow-right" />
        </Link>
      </div>
    </section>
  );
}
