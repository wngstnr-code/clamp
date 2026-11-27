import { Icon } from "@/components/icon";
import { usd4 } from "@/lib/live-index";

/** "$0.3636" with the last two digits faded, like the design. */
export function BigPrice({ value, className }: { value: number | undefined; className: string }) {
  if (value === undefined) return <span className={`font-mono text-ink-2 ${className}`}>not available</span>;
  const s = usd4(value);
  return (
    <span className={`font-mono ${className}`}>
      {s.slice(0, -2)}
      <span className="text-ink/25">{s.slice(-2)}</span>
    </span>
  );
}

/** Up, down or flat over the window, in words and colour. */
export function changeText(pct: number | null, window: string) {
  if (pct === null) return { text: `no data in ${window}`, tone: "text-ink-2", icon: null };
  const abs = Math.abs(pct).toFixed(2);
  if (Number(abs) === 0) return { text: `0.00% in ${window}`, tone: "text-ink-2", icon: null };
  return pct > 0
    ? { text: `up ${abs}% in ${window}`, tone: "text-up", icon: "trending-up" as const }
    : { text: `down ${abs}% in ${window}`, tone: "text-down", icon: "trending-down" as const };
}

/** A yellow notice for when the index or a provider is not as it should be. */
export function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="flex gap-3 rounded-[18px] bg-[#fdf3d6] px-5 py-4 text-ink">
      <Icon name="triangle-alert" className="mt-0.5 size-[18px] shrink-0 text-[#9a6b00]" />
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-bold">{title}</p>
        <p className="text-sm text-ink-2">{children}</p>
      </div>
    </div>
  );
}

/** Initial in a small square until the official provider logos are in. */
export function ProviderMark({ name, faded = false }: { name: string; faded?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-sm font-extrabold ${faded ? "text-muted" : ""}`}
    >
      {name[0]}
    </span>
  );
}
