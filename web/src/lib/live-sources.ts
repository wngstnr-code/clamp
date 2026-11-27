/** Source ids on chain (architecture.md section 3.1). */
const SOURCE_NAMES: Record<number, string> = { 1: "Vast.ai", 2: "RunPod", 3: "Akash", 4: "Nosana" };

export type SourcePrice = { name: string; price: number | null; weight: number };
export type LatestUpdate = { ts: number; sources: SourcePrice[] } | null;

type Row = { ts: string; sources: { id: number; price: string; weight: number }[] };

/**
 * Per provider prices of the latest index update of a class, from the public Supabase mirror
 * (read with the anon key). Returns null when the mirror cannot be read, so nothing is made up.
 */
export async function readLatestUpdate(classId: number): Promise<LatestUpdate> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/index_updates?select=ts,sources&class_id=eq.${classId}&order=ts.desc&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, next: { revalidate: 60 } },
    );
    if (!res.ok) {
      console.error(`index_updates read failed: HTTP ${res.status}`);
      return null;
    }
    const [row] = (await res.json()) as Row[];
    if (!row) return null;
    const sources = [1, 2, 3, 4].map((id) => {
      const s = row.sources.find((x) => x.id === id);
      // Weight 0 means the source was left out of this update (no price, or out of range).
      return { name: SOURCE_NAMES[id]!, price: s && s.weight > 0 ? Number(s.price) / 1e6 : null, weight: s?.weight ?? 0 };
    });
    return { ts: Math.floor(Date.parse(row.ts) / 1000), sources };
  } catch (e) {
    console.error("index_updates read failed:", e);
    return null;
  }
}

/** "3 min ago" from a unix timestamp. */
export function ago(ts: number, now = Date.now() / 1000) {
  const min = Math.max(0, Math.round((now - ts) / 60));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} h ago`;
}
