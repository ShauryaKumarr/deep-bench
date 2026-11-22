// Answer stats: what share of players named each answer in today's team sheet.
// Plain fetches to two Postgres functions (supabase/schema.sql); no client library needed.
import { SUPABASE_URL, backendReady, supabaseHeaders } from "./config";

const DEVICE_KEY = "deep-bench:device";

/** A random id for this browser, so it counts once per round. Not linked to anything personal. */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) localStorage.setItem(DEVICE_KEY, (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: still counts, just not de-duplicated
  }
}

const rpc = (name: string, body: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: supabaseHeaders(), body: JSON.stringify(body) });

const pending = new Map<string, Promise<unknown>>();

/** Records a daily round: the player picked, or null for no answer. Never throws. */
export function recordPick(day: string, round: number, player: number | null) {
  if (!backendReady()) return;
  const sent = rpc("record_pick", { p_day: day, p_round: round, p_player: player ?? -1, p_device: deviceId() }).catch(
    () => undefined,
  );
  pending.set(`${day}:${round}`, sent);
}

/** For one round: how many named each player (-1 = no answer), and how many played it. */
export interface RoundStats {
  counts: Map<number, number>;
  total: number;
}

/** Every round of a day, or null if stats aren't available. Waits for this browser's own picks first. */
export async function dayStats(day: string): Promise<RoundStats[] | null> {
  if (!backendReady()) return null;
  try {
    await Promise.all([...pending].filter(([k]) => k.startsWith(`${day}:`)).map(([, p]) => p));
    const res = await rpc("day_stats", { p_day: day });
    if (!res.ok) return null;
    const rows: { round: number; player: number; n: number }[] = await res.json();
    const out: RoundStats[] = Array.from({ length: 7 }, () => ({ counts: new Map(), total: 0 }));
    for (const { round, player, n } of rows) {
      const r = out[round];
      if (!r) continue;
      r.counts.set(player, Number(n));
      r.total += Number(n);
    }
    return out;
  } catch {
    return null;
  }
}

/** "2%", "<1%", rounded so tiny shares don't read as zero. */
export function share(n: number, total: number): string {
  if (!total) return "0%";
  const p = (n / total) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
}
