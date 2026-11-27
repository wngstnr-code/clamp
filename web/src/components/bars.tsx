import { usd4 } from "@/lib/live-index";

/**
 * Index history as bars, one per time bucket, newest on the right in the brand colour.
 * A bucket with no update is left empty, so a gap in the data shows as a gap.
 * The height runs from the lowest to the highest value in view, with a floor so a flat index still shows bars.
 */
export function Bars({ values, height, gap = 4, label }: { values: (number | null)[]; height: string; gap?: number; label: string }) {
  const seen = values.filter((v): v is number => v !== null);
  const lo = Math.min(...seen);
  const hi = Math.max(...seen);
  const last = values.findLastIndex((v) => v !== null);
  return (
    <div role="img" aria-label={label} className={`flex items-end ${height}`} style={{ gap }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={v === null ? "No update" : usd4(v)}
          className={`flex-1 rounded-[4px] ${i === last ? "bg-brand" : "bg-[#dce2f0]"}`}
          style={{ height: v === null ? 0 : `${hi > lo ? 55 + ((v - lo) / (hi - lo)) * 45 : 75}%` }}
        />
      ))}
    </div>
  );
}
