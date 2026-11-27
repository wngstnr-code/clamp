import { Icon } from "./icon";

/** Daily series carry this label everywhere (architecture.md section 7). */
export function ShortLabel({ extra }: { extra?: string }) {
  return (
    <span className="flex w-fit items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-[13px] font-semibold text-ink-2">
      <Icon name="hourglass" className="size-3.5" />
      Short series{extra ? `, ${extra}` : ""}
    </span>
  );
}
