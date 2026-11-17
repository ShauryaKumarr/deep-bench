export interface Player {
  name: string;
  nation: string;
  pos: string;
  first: number;
  last: number;
  /** Normalised name, for matching. */
  key: string;
  words: string[];
}

export interface Prompt {
  text: string;
  /** Player indices, most famous first. */
  answers: number[];
}

export interface Day {
  date: string;
  prompts: Prompt[];
}

const POS_SHORT: Record<string, string> = {
  Goalkeeper: "GK",
  Defender: "DF",
  Midfielder: "MF",
  Forward: "FW",
};

const base = import.meta.env.BASE_URL;

export function normalise(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/ß/g, "ss")
    .replace(/ı/g, "i")
    .replace(/[đð]/g, "d")
    .replace(/ł/g, "l")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/['’.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadPlayers(): Promise<Player[]> {
  const res = await fetch(`${base}data/players.json`);
  if (!res.ok) throw new Error(`players.json: ${res.status}`);
  const raw: {
    nations: string[];
    positions: string[];
    players: [string, number, number, number, number][];
  } = await res.json();
  return raw.players.map(([name, nat, pos, first, last]) => {
    const key = normalise(name);
    return {
      name,
      nation: raw.nations[nat] ?? "",
      pos: POS_SHORT[raw.positions[pos]] ?? "",
      first,
      last,
      key,
      words: key.split(" "),
    };
  });
}

export async function loadDay(date: string): Promise<Day | null> {
  const res = await fetch(`${base}data/days/${date}.json`);
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null; // dev servers answer unknown paths with index.html
  }
}

export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
