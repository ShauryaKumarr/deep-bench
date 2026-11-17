import type { Ctx } from "./engine";

/** A small bitmap font for ad boards and scoreboards: 5 rows, mostly 3 wide. Rows are space-separated. */
const GLYPHS: Record<string, string> = {
  A: ".#. #.# ### #.# #.#",
  B: "##. #.# ##. #.# ##.",
  C: ".## #.. #.. #.. .##",
  D: "##. #.# #.# #.# ##.",
  E: "### #.. ##. #.. ###",
  F: "### #.. ##. #.. #..",
  G: ".## #.. #.# #.# .##",
  H: "#.# #.# ### #.# #.#",
  I: "### .#. .#. .#. ###",
  J: "..# ..# ..# #.# .#.",
  K: "#.# #.# ##. #.# #.#",
  L: "#.. #.. #.. #.. ###",
  M: "#...# ##.## #.#.# #...# #...#",
  N: "##. #.# #.# #.# #.#",
  O: ".#. #.# #.# #.# .#.",
  P: "##. #.# ##. #.. #..",
  Q: ".#. #.# #.# ##. .##",
  R: "##. #.# ##. #.# #.#",
  S: ".## #.. .#. ..# ##.",
  T: "### .#. .#. .#. .#.",
  U: "#.# #.# #.# #.# ###",
  V: "#.# #.# #.# #.# .#.",
  W: "#...# #...# #.#.# ##.## #...#",
  X: "#.# #.# .#. #.# #.#",
  Y: "#.# #.# .#. .#. .#.",
  Z: "### ..# .#. #.. ###",
  "0": "### #.# #.# #.# ###",
  "1": ".#. ##. .#. .#. ###",
  "2": "##. ..# .#. #.. ###",
  "3": "##. ..# .#. ..# ##.",
  "4": "#.# #.# ### ..# ..#",
  "5": "### #.. ##. ..# ##.",
  "6": ".## #.. ### #.# ###",
  "7": "### ..# .#. .#. .#.",
  "8": "### #.# ### #.# ###",
  "9": "### #.# ### ..# ##.",
  " ": "... ... ... ... ...",
  "-": "... ... ### ... ...",
  "+": "... .#. ### .#. ...",
  "!": ".#. .#. .#. ... .#.",
  ".": "... ... ... ... .#.",
  ":": "... .#. ... .#. ...",
  "'": ".#. .#. ... ... ...",
  "&": ".#. #.# .#. #.# .##",
  "/": "..# ..# .#. #.. #..",
};

const BITS: Record<string, { w: number; bits: string }> = Object.fromEntries(
  Object.entries(GLYPHS).map(([ch, g]) => [ch, { w: g.indexOf(" "), bits: g.replace(/ /g, "") }]),
);

const glyphW = (ch: string) => BITS[ch]?.w ?? 3;

export const textWidth = (text: string) =>
  Math.max(0, [...text.toUpperCase()].reduce((sum, ch) => sum + glyphW(ch) + 1, 0) - 1);

/** Draws upper-case text with its top-left corner at (x, y). Unknown characters render as spaces. */
export function drawText(ctx: Ctx, text: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  let cx = Math.round(x);
  const top = Math.round(y);
  for (const ch of text.toUpperCase()) {
    const g = BITS[ch];
    if (g) for (let i = 0; i < g.bits.length; i++) if (g.bits[i] === "#") ctx.fillRect(cx + (i % g.w), top + Math.floor(i / g.w), 1, 1);
    cx += glyphW(ch) + 1;
  }
}
