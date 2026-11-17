export const ROUNDS = 7;
export const ROUND_SECONDS = 25;
export const MIN_DEPTH = 10;
export const MAX_DEPTH = 100;
export const MAX_TOTAL = ROUNDS * MAX_DEPTH;

export interface Level {
  name: string;
  short: string;
  at: number;
}

export const LEVELS: Level[] = [
  { name: "Premier League", short: "PL", at: 0 },
  { name: "Championship", short: "CH", at: 120 },
  { name: "League One", short: "L1", at: 200 },
  { name: "League Two", short: "L2", at: 270 },
  { name: "National League", short: "NL", at: 340 },
  { name: "National League North", short: "NLN", at: 400 },
  { name: "Northern Premier League", short: "NPL", at: 460 },
  { name: "County league", short: "CTY", at: 520 },
  { name: "Sunday league", short: "SUN", at: 590 },
];

/** Depth for the answer at `rank` (0 = most famous) among `count` valid answers. */
export function depthFor(rank: number, count: number): number {
  if (count <= 1) return MAX_DEPTH;
  return Math.round(MIN_DEPTH + ((MAX_DEPTH - MIN_DEPTH) * rank) / (count - 1));
}

export function levelFor(total: number): Level {
  let level = LEVELS[0];
  for (const l of LEVELS) if (total >= l.at) level = l;
  return level;
}

export function square(depth: number | null): string {
  if (depth === null) return "⬛";
  if (depth < 60) return "🟩";
  if (depth < 85) return "🟧";
  return "🟥";
}
