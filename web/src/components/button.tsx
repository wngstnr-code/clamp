import Link from "next/link";
import { Icon, type IconName } from "./icon";

// Buttons from the design system (1 · Foundations): a pill with the label and an icon in a circle.
const VARIANTS = {
  primary: { pill: "bg-ink text-white", circle: "bg-white text-ink" },
  brand: { pill: "bg-brand text-white", circle: "bg-ink text-white" },
  secondary: { pill: "bg-surface text-ink ring-1 ring-line", circle: "bg-ink text-white" },
} as const;

type Props = {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
  icon?: IconName;
};

export function Button({ href, children, variant = "primary", icon = "arrow-up-right" }: Props) {
  const v = VARIANTS[variant];
  return (
    <Link
      href={href}
      className={`inline-flex h-12 items-center gap-3 rounded-full py-1.5 pr-1.5 pl-[22px] text-[15px] font-medium transition-[opacity,transform] duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${v.pill}`}
    >
      {children}
      <span className={`grid size-9 place-items-center rounded-full ${v.circle}`}>
        <Icon name={icon} className="size-[17px]" />
      </span>
    </Link>
  );
}
