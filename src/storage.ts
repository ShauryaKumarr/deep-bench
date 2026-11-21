import { addDays } from "./data";
import { ROUNDS } from "./scoring";

export interface RoundResult {
  /** Player index, or null for a miss. */
  pick: number | null;
  points: number | null;
}

export interface DayState {
  rounds: RoundResult[];
  /** Round currently on the clock. Still set on load means the page was left mid-round. */
  active: number | null;
  /** Started after its own day (from the archive), so it doesn't count towards streaks or stats. */
  late?: boolean;
}

/** Friendlies are keyed "f:<code>" and only live in memory: they never touch stats or streaks. */
export const isFriendly = (key: string) => key.startsWith("f:");
const memory: Record<string, DayState> = {};

interface Store {
  v: 1;
  days: Record<string, DayState>;
}

const KEY = "deep-bench:v1";

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1 && s.days) {
        // Rounds saved before scores were called points stored them as `depth`.
        for (const day of Object.values(s.days) as { rounds: (RoundResult & { depth?: number | null })[] }[])
          for (const r of day.rounds) if (r && r.points === undefined) r.points = r.depth ?? null;
        return s;
      }
    }
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return { v: 1, days: {} };
}

let store = read();

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* private mode etc: the game still works, it just won't remember */
  }
}

export function getDay(key: string): DayState {
  if (isFriendly(key)) return (memory[key] ??= { rounds: [], active: null });
  return (store.days[key] ??= { rounds: [], active: null });
}

/** Forgets one day's progress, so it can be played again. */
export function resetDay(date: string) {
  delete store.days[date];
  write();
}

/** `fromArchive`: a past day started from the archive, which then stays out of streaks and stats. */
export function startRound(key: string, round: number, fromArchive = false) {
  const day = getDay(key);
  if (fromArchive && !day.rounds.some(Boolean)) day.late = true;
  day.active = round;
  write();
}

export function finishRound(date: string, round: number, result: RoundResult) {
  const day = getDay(date);
  day.rounds[round] = result;
  day.active = null;
  write();
}

/** Applies the reload rule. Returns the round that was forfeited, if any. */
export function forfeitAbandoned(date: string): number | null {
  const day = getDay(date);
  const r = day.active;
  if (r === null || day.rounds[r]) {
    day.active = null;
    return null;
  }
  finishRound(date, r, { pick: null, points: null });
  return r;
}

export function isComplete(day: DayState): boolean {
  return day.rounds.filter(Boolean).length >= ROUNDS;
}

export function total(day: DayState): number {
  return day.rounds.reduce((sum, r) => sum + (r?.points ?? 0), 0);
}

export interface Stats {
  played: number;
  streak: number;
  bestStreak: number;
  best: number;
  average: number;
}

/** Every saved day, for the archive list. */
export const savedDay = (date: string): DayState | undefined => store.days[date];

/** Stats only count days played on the day itself, so the archive can't pad a streak. */
export function stats(today: string): Stats {
  const done = Object.entries(store.days)
    .filter(([, d]) => isComplete(d) && !d.late)
    .map(([date, d]) => ({ date, total: total(d) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let bestStreak = 0;
  let run = 0;
  let prev = "";
  for (const { date } of done) {
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = date;
  }
  // The current streak survives until the end of the day after the last game.
  const last = done.at(-1)?.date;
  const streak = last === today || last === addDays(today, -1) ? run : 0;

  const totals = done.map((d) => d.total);
  return {
    played: done.length,
    streak,
    bestStreak,
    best: totals.length ? Math.max(...totals) : 0,
    average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0,
  };
}
