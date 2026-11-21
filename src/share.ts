// Share links and their chat previews. No DOM here: vite.config.ts uses it to build the preview pages.
import { MAX_POINTS, MIN_POINTS, ROUNDS, type Level } from "./scoring";

/** "l1" for League One: the path of that level's preview page, /r/l1. */
export const levelSlug = (level: Level) => level.short.toLowerCase();

const HEADLINES: Record<string, string> = {
  sun: "Stuck in Sunday league",
  cty: "Promoted to the County league",
  npl: "Promoted to the Northern Premier League",
  nln: "Promoted to National League North",
  nl: "Promoted to the National League",
  l2: "Promoted to League Two",
  l1: "Promoted to League One",
  ch: "Promoted to the Championship",
  pl: "Made the Premier League",
};

/** What a shared link says in a chat preview, for the level the sharer reached. */
export const headline = (level: Level) => HEADLINES[levelSlug(level)] ?? `Reached ${level.name}`;

export const SITE_DESCRIPTION =
  "How deep is your ball knowledge? A daily football quiz: seven prompts, 25 seconds each. Name the most obscure player who fits and climb the football pyramid.";
export const CHALLENGE_DESCRIPTION =
  "Can you beat it? Seven prompts, 25 seconds each: name the most obscure player who fits and climb the football pyramid.";

/** Round scores in a link: two base-36 digits a round, "00" for a miss. 14 characters for 7 rounds. */
export function encodeRounds(points: (number | null)[]): string {
  return Array.from({ length: ROUNDS }, (_, i) => (points[i] ?? 0).toString(36).padStart(2, "0")).join("");
}

/** The inverse of encodeRounds, or null if the link has been mangled. */
export function decodeRounds(s: string | null): (number | null)[] | null {
  if (!s || !/^[0-9a-z]+$/.test(s) || s.length !== ROUNDS * 2) return null;
  const out: (number | null)[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const n = parseInt(s.slice(i * 2, i * 2 + 2), 36);
    if (n === 0) out.push(null);
    else if (n >= MIN_POINTS && n <= MAX_POINTS) out.push(n);
    else return null;
  }
  return out;
}
