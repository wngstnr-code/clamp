import Image from "next/image";
import { type LiveIndex, usd4 } from "@/lib/live-index";
import { ago, type LatestUpdate } from "@/lib/live-sources";

function Price({ value }: { value: LiveIndex }) {
  if (!value) return <span className="font-mono text-2xl text-ink-2 lg:text-[1.75em]">not available</span>;
  const s = usd4(value.price);
  return (
    <span className="font-mono text-2xl lg:text-[2.5em]">
      {s.slice(0, -2)}
      <span className="text-ink/25">{s.slice(-2)}</span>
    </span>
  );
}

/*
 * From lg up the scene keeps the design's 1312 x 780 frame and everything inside is sized in em,
 * with 1em = 16px at 1312px wide. So the photo crop and the copy keep the exact positions of the
 * design file at every width: the copy sits on the desk, right of the laptop, the panel next to the mouse.
 */
export function FourProviders({ rtx, h100, update }: { rtx: LiveIndex; h100: LiveIndex; update: LatestUpdate }) {
  return (
    <section className="@container bg-[#fafafa] px-4 py-16 md:px-16 md:py-28">
      <div className="relative mx-auto flex max-w-[1312px] flex-col overflow-hidden rounded-[40px] bg-night lg:block lg:aspect-[1312/780] lg:text-[length:min(16px,calc(100cqw*16/1312))]">
        <div className="relative h-[280px] md:h-[440px] lg:absolute lg:inset-0 lg:h-auto">
          <Image
            src="/landing/providers-desk.jpg"
            alt="The clam on a wooden desk with a laptop and a graphics card"
            fill
            unoptimized
            sizes="(min-width: 1024px) 1312px, 100vw"
            className="object-cover"
          />
          {/* Darkens the right side of the photo so the white text stays readable. */}
          <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(10,13,24,0)_35%,rgba(10,13,24,0.85)_75%,rgba(10,13,24,0.9))] lg:block" />
        </div>

        <div className="relative flex flex-col gap-6 p-5 lg:absolute lg:top-[5em] lg:left-[41.25em] lg:w-[38.75em] lg:gap-0 lg:p-0">
          <div className="flex flex-col gap-3.5 text-white lg:gap-[0.875em]">
            <h2 className="text-[36px] leading-[1.02] font-extrabold tracking-[-1.5px] lg:text-[3.375em] lg:tracking-[-0.03em]">
              Four providers. One number you can check.
            </h2>
            <p className="text-lg leading-normal text-white/90 lg:text-[1.125em]">
              Three reporters read real rental prices many times a day and write the median on Solana. Every update
              links to its raw file.
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-[26px] bg-white/18 p-5 ring-1 ring-white/30 backdrop-blur-xl lg:mt-[4.5em] lg:gap-[0.75em] lg:rounded-[1.625em] lg:p-[1.25em]">
            <div className="grid grid-cols-2 gap-3 lg:gap-[0.75em]">
              {(
                [
                  ["RTX 4090", rtx],
                  ["H100", h100],
                ] as const
              ).map(([name, value]) => (
                <div
                  key={name}
                  className="flex flex-col gap-1.5 rounded-[18px] bg-white/90 p-[18px] lg:gap-[0.375em] lg:rounded-[1.125em] lg:p-[1.125em]"
                >
                  <span className="text-sm font-bold text-ink-2 lg:text-[0.875em]">{name}, per GPU hour</span>
                  <Price value={value} />
                </div>
              ))}
            </div>

            <div className="flex flex-col rounded-[18px] bg-white/90 px-[18px] py-1.5 lg:rounded-[1.125em] lg:px-[1.125em] lg:py-[0.375em]">
              {update ? (
                update.sources.map((s, i) => (
                  <div
                    key={s.name}
                    className={`flex items-center gap-4 py-3 lg:gap-[1em] lg:py-[0.75em] ${i < 3 ? "border-b border-ink/10" : ""} ${s.price === null ? "opacity-45" : ""}`}
                  >
                    {/* ponytail: wordmark until the official provider logos are in. */}
                    <span className="w-24 shrink-0 text-[17px] leading-[1.35] font-extrabold md:w-[150px] lg:w-[8.8em] lg:text-[1.0625em]">
                      {s.name}
                    </span>
                    <span className="flex-1 font-mono text-[15px] lg:text-[0.9375em]">
                      {s.price === null ? "no price" : `${usd4(s.price)} /hr`}
                    </span>
                    <span className="hidden shrink-0 text-right text-[13px] text-ink-2 sm:block lg:text-[0.8125em]">
                      {s.price === null ? "left out of this update" : `updated ${ago(update.ts)}`}
                    </span>
                  </div>
                ))
              ) : (
                <p className="py-4 text-sm text-ink-2 lg:text-[0.875em]">Provider prices are not available right now.</p>
              )}
            </div>
          </div>

          <p className="text-[13px] text-white/70 lg:mt-[1.25em] lg:text-[0.8125em]">
            H100 prices from the last update. The index for each period is the average of every update.
          </p>
        </div>
      </div>
    </section>
  );
}
