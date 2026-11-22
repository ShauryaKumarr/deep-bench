// The Supabase project behind answer stats and live rooms. Both values are public by design:
// the key only allows what supabase/schema.sql grants (two functions) and Realtime rooms.
// VITE_SUPABASE_URL / VITE_SUPABASE_KEY at build time override them (set both to "" to run
// without a backend: answer stats then stay hidden and live rooms say they aren't available).
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? "https://ztlpjwulcckhudbpgmvi.supabase.co";
export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_KEY ?? "sb_publishable_diIyouzrMJNhsIVGTkrl6g_QpkxXGYN";

export const backendReady = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Request headers for Supabase. New "sb_publishable_" keys aren't JWTs, so they go in apikey only. */
export function supabaseHeaders(): Record<string, string> {
  const h: Record<string, string> = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (!SUPABASE_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}
