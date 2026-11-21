import type { Player, Prompt } from "./data";
import { rng } from "./pixel/engine";
import { ROUNDS } from "./scoring";

// Friendlies: unlimited practice matches built in the browser from players.json.
// They only use nationality and position, so they never give away a daily prompt,
// and the same code always gives the same seven prompts, so friends can play the same one.

/** Same rules as the daily prompts: 6 to 250 answers, at least two among the 1,500 best known. */
const MIN_ANSWERS = 6;
const MAX_ANSWERS = 250;
const WELL_KNOWN = 1500;
const MIN_KNOWN = 2;

/** Mirrors NATIONS_WITH_THE in scripts/build_data.py. */
const WITH_THE = new Set([
  "Netherlands",
  "United States",
  "Czech Republic",
  "Dominican Republic",
  "Central African Republic",
  "DR Congo",
  "Philippines",
  "Gambia",
  "Comoros",
  "Faroe Islands",
  "Netherlands Antilles",
  "United Arab Emirates",
  "Cayman Islands",
  "Bahamas",
  "Maldives",
  "Republic of the Congo",
]);
const nationPhrase = (n: string) => (WITH_THE.has(n) ? `the ${n}` : n);

const POSITIONS: [string, string][] = [
  ["GK", "A goalkeeper"],
  ["DF", "A defender"],
  ["MF", "A midfielder"],
  ["FW", "A forward"],
];

interface Candidate extends Prompt {
  nation: string;
  known: number;
}

let pool: Candidate[] | null = null;

function buildPool(players: Player[]): Candidate[] {
  const byNation = new Map<string, number[]>();
  players.forEach((p, i) => {
    if (!p.nation) return;
    let list = byNation.get(p.nation);
    if (!list) byNation.set(p.nation, (list = []));
    list.push(i); // players.json is ordered by fame, so these stay most famous first
  });

  const out: Candidate[] = [];
  const add = (nation: string, text: string, answers: number[]) => {
    const known = answers.filter((a) => a < WELL_KNOWN).length;
    if (answers.length >= MIN_ANSWERS && answers.length <= MAX_ANSWERS && known >= MIN_KNOWN)
      out.push({ nation, text, answers, known });
  };
  // Sorted so the pool, and so every code, comes out the same on every device.
  for (const nation of [...byNation.keys()].sort()) {
    const all = byNation.get(nation)!;
    add(nation, `A player from ${nationPhrase(nation)}`, all);
    for (const [pos, phrase] of POSITIONS)
      add(nation, `${phrase} from ${nationPhrase(nation)}`, all.filter((i) => players[i].pos === pos));
  }
  return out;
}

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o or 1/l/i to misread

export function newFriendlyCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export const isFriendlyCode = (code: string) => new RegExp(`^[${CODE_CHARS}]{6}$`).test(code);

function seedFor(code: string): number {
  let h = 2166136261;
  for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Seven prompts from seven different nations, easiest first like the daily. */
export function friendlyPrompts(players: Player[], code: string): Prompt[] {
  pool ??= buildPool(players);
  const rand = rng(seedFor(code));
  const picked: Candidate[] = [];
  const nations = new Set<string>();
  let left = [...pool];
  while (picked.length < ROUNDS && left.length) {
    // Prompts with more well-known answers come up more often, as in the daily schedule.
    const weights = left.map((c) => Math.sqrt(c.known));
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < left.length - 1 && (r -= weights[i]) > 0) i++;
    const pick = left[i];
    picked.push(pick);
    nations.add(pick.nation);
    left = left.filter((c) => !nations.has(c.nation));
  }
  return picked
    .sort((a, b) => b.known / b.answers.length - a.known / a.answers.length)
    .map(({ text, answers }) => ({ text, answers }));
}
