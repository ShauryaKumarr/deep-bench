export const ROUNDS = 7;
export const ROUND_SECONDS = 25;
export const MIN_POINTS = 10;
export const MAX_POINTS = 100;
export const MAX_TOTAL = ROUNDS * MAX_POINTS;

export interface Level {
  name: string;
  short: string;
  /** Points needed to reach this level. */
  at: number;
}

/** The English football pyramid, bottom to top. You climb it with points. */
export const LEVELS: Level[] = [
  { name: "Sunday league", short: "SUN", at: 0 },
  { name: "County league", short: "CTY", at: 110 },
  { name: "Northern Premier League", short: "NPL", at: 180 },
  { name: "National League North", short: "NLN", at: 240 },
  { name: "National League", short: "NL", at: 300 },
  { name: "League Two", short: "L2", at: 360 },
  { name: "League One", short: "L1", at: 430 },
  { name: "Championship", short: "CH", at: 500 },
  { name: "Premier League", short: "PL", at: 580 },
];

/** Points for the answer at `rank` (0 = most famous) among `count` valid answers. */
export function pointsFor(rank: number, count: number): number {
  if (count <= 1) return MAX_POINTS;
  return Math.round(MIN_POINTS + ((MAX_POINTS - MIN_POINTS) * rank) / (count - 1));
}

export function levelFor(total: number): Level {
  let level = LEVELS[0];
  for (const l of LEVELS) if (total >= l.at) level = l;
  return level;
}

/** 0 for Sunday league up to 8 for the Premier League. */
export function levelIndex(total: number): number {
  return LEVELS.indexOf(levelFor(total));
}

export const pts = (n: number) => `${n} pts`;

/** How good a round was. Also picks the replay. */
export type Tier = "miss" | "tap" | "curler" | "worldie";

export function tierFor(points: number | null): Tier {
  if (points === null) return "miss";
  if (points < 60) return "tap";
  if (points < 85) return "curler";
  return "worldie";
}

export const TIER_LABEL: Record<Tier, string> = {
  miss: "Miss",
  tap: "Tap-in",
  curler: "Curler",
  worldie: "Worldie",
};

const SQUARES: Record<Tier, string> = { miss: "⬛", tap: "🟩", curler: "🟧", worldie: "🟥" };

export function square(points: number | null): string {
  return SQUARES[tierFor(points)];
}
