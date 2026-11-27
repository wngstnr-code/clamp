import Link from "next/link";

const LINKS = [
  ["How it works", "#how-it-works"],
  ["Index", "/index"],
  ["Locks", "/lock/bill"],
  ["Vault", "/vault"],
] as const;

// A long, thin pill: logo left, links centred on the page, one call to action right.
export function LandingNav() {
  return (
    <nav className="relative mx-auto flex h-[52px] w-full max-w-[1200px] items-center justify-between gap-6 rounded-full bg-surface py-[5px] pr-[5px] pl-5 shadow-[0_8px_24px_rgba(17,19,24,0.08)]">
      <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-extrabold">
        <img src="/logo.svg" alt="" className="size-[26px]" />
        Clamp
      </Link>
      <div className="absolute left-1/2 hidden -translate-x-1/2 text-[15px] whitespace-nowrap text-ink-2 lg:flex">
        {LINKS.map(([label, href]) => (
          <Link key={label} href={href} className="flex h-10 items-center rounded-full px-3.5 hover:text-ink">
            {label}
          </Link>
        ))}
      </div>
      <Link
        href="/index"
        className="flex h-[42px] shrink-0 items-center rounded-full bg-ink px-5 text-[15px] font-medium whitespace-nowrap text-white hover:opacity-90"
      >
        Open app
      </Link>
    </nav>
  );
}
