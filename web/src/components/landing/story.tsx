import Image from "next/image";

function Card({ title, badge, badgeClass, rows }: { title: string; badge: string; badgeClass: string; rows: [string, string][] }) {
  return (
    <div className="flex w-full flex-col gap-3.5 rounded-[26px] bg-white p-[22px] shadow-[0_12px_32px_rgba(17,19,24,0.12)] md:w-[300px] lg:w-[18.75em] lg:gap-[0.875em] lg:rounded-[1.625em] lg:p-[1.375em]">
      <div className="flex items-center justify-between">
        <span className="font-bold lg:text-[1em]">{title}</span>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold text-white lg:px-[0.83em] lg:py-[0.33em] lg:text-[0.75em] ${badgeClass}`}
        >
          {badge}
        </span>
      </div>
      <dl className="flex flex-col gap-2.5 rounded-[18px] bg-surface-2 p-4 lg:gap-[0.625em] lg:rounded-[1.125em] lg:p-[1em]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm lg:text-[0.875em]">
            <dt className="text-ink-2">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/*
 * A worked example, clearly labeled: 720 h at a locked $0.3636, index average $0.4000 (720 x 0.0364 = 26.21).
 * From lg up the scene keeps the design's 1440 x 820 frame and everything inside is sized in em,
 * with 1em = 16px at 1440px wide, so the copy and the cards always sit on the sky and sea, clear of the clam.
 */
export function Story() {
  return (
    <section className="@container bg-[#fafafa]">
      <div className="relative flex flex-col lg:block lg:aspect-[1440/820] lg:text-[length:calc(100cqw*16/1440)]">
        <div className="relative h-[340px] md:h-[480px] lg:absolute lg:inset-0 lg:h-auto">
          <Image
            src="/landing/story-beach.jpg"
            alt="The clam relaxing on a beach towel next to a graphics card and a laptop"
            fill
            unoptimized
            sizes="100vw"
            className="object-cover"
          />
        </div>
        <div className="relative flex flex-col gap-6 px-4 py-10 md:px-10 lg:absolute lg:top-[7.25em] lg:left-[44em] lg:w-[38.75em] lg:gap-0 lg:p-0">
          <div className="flex flex-col gap-3.5 lg:gap-[0.875em]">
            <h2 className="text-[40px] leading-[1.02] font-extrabold tracking-[-1.5px] lg:text-[3.375em] lg:tracking-[-0.03em]">
              Prices jumped? Your bill didn&apos;t.
            </h2>
            <p className="text-lg leading-normal text-ink/80 lg:text-[1.125em]">
              Your UP claims gain value when the index rises, which covers the extra cost of your rental.
            </p>
          </div>
          <div className="flex flex-col gap-5 md:flex-row lg:mt-[3.5em] lg:gap-[1.25em]">
            <Card
              title="Your bill lock"
              badge="Locked"
              badgeClass="bg-brand"
              rows={[
                ["Class", "RTX 4090"],
                ["Hours", "720 / month"],
                ["Locked rate", "$0.3636/hr"],
              ]}
            />
            <Card
              title="End of month"
              badge="Example"
              badgeClass="bg-up"
              rows={[
                ["Index average", "$0.4000/hr"],
                ["Extra rent", "+$26.21"],
                ["UP pays you", "+$26.21"],
              ]}
            />
          </div>
          <p className="text-[13px] text-ink/60 lg:mt-[4.8125em] lg:text-[0.8125em]">
            Example only. Real payouts follow the band and the settlement formula.
          </p>
        </div>
      </div>
    </section>
  );
}
