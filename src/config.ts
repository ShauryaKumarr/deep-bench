// The Supabase project behind answer stats and live rooms. Both values are public by design:
// the key only allows what supabase/schema.sql grants (two functions) and Realtime rooms.
// Set them here, or as VITE_SUPABASE_URL / VITE_SUPABASE_KEY at build time. While they are
// empty, answer stats stay hidden and live rooms say they aren't available.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? "";
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY ?? "";

export const backendReady = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Request headers for Supabase. New "sb_publishable_" keys aren't JWTs, so they go in apikey only. */
export function supabaseHeaders(): Record<string, string> {
  const h: Record<string, string> = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (!SUPABASE_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}
