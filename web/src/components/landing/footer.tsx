import Link from "next/link";

const PROGRAM = "wXKbfiz8yqTgGksXC5ZpN77CzXgW77ttcqHxnpqMrhC";

const PRODUCT = [
  ["Bill Lock", "/lock/bill"],
  ["Revenue Lock", "/lock/revenue"],
  ["Index", "/index"],
  ["Vault", "/vault"],
] as const;

// X and GitHub join "Follow" once the handle exists and the repo is public (D-046).
const FOLLOW = [["Solana Explorer", `https://explorer.solana.com/address/${PROGRAM}?cluster=devnet`]] as const;

function Column({ title, links }: { title: string; links: readonly (readonly [string, string])[] }) {
  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-sm font-semibold text-ink/60">{title}</p>
      {links.map(([label, href]) => (
        <Link key={label} href={href} className="text-[15px] hover:text-brand">
          {label}
        </Link>
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="bg-white px-4 pt-[72px] pb-10 md:px-24">
      <div className="flex flex-col justify-between gap-10 md:flex-row">
        <div className="flex max-w-[360px] flex-col gap-4">
          <span className="flex items-center gap-2.5 text-[26px] font-extrabold">
            <img src="/logo.svg" alt="" className="size-8" />
            Clamp
          </span>
          <p className="leading-relaxed text-ink/60">
            Clamp locks the GPU rental price for renters and owners, fully backed by USDC.
          </p>
        </div>
        <div className="flex gap-20">
          <Column title="Product" links={PRODUCT} />
          <Column title="Follow" links={FOLLOW} />
        </div>
      </div>
      <div className="mt-14 flex flex-col justify-between gap-2 border-t border-ink/10 pt-6 text-sm text-ink/60 md:flex-row">
        <span>© 2026 Clamp</span>
        <span>Live on Solana devnet. Test tokens only.</span>
      </div>
    </footer>
  );
}
