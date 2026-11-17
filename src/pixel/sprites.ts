import { outline, sprite, transform, type Palette } from "./engine";

export const COLORS = {
  chalk: "#F1EFE4",
  flood: "#FFD23F",
  red: "#D7263D",
  ink: "#10241a",
  cyan: "#5ad1e6",
  pink: "#ff7ab8",
  orange: "#f08a24",
  green: "#5ac05a",
};

const EDGE = "#08130d";

const player: Palette = {
  h: "#2a1a10", // hair
  s: "#c68a5c", // skin
  y: COLORS.flood, // shirt
  Y: "#d9a514", // shirt, shaded side
  d: COLORS.ink, // shorts
  w: COLORS.chalk, // socks
  b: "#111111", // boots
};

const keeper: Palette = { ...player, h: "#5a3a1a", s: "#e0b088", y: COLORS.red, Y: "#a51c2f", d: "#1b1b1b", w: "#1b1b1b", g: COLORS.chalk };
const referee: Palette = { ...player, h: "#1a1a1a", s: "#d9a07a", y: "#1c1c1c", Y: "#0f0f0f", d: "#141414", w: "#1c1c1c", c: COLORS.chalk };

// Facing right, 9 × 14. Every actor sprite is outlined, so drawn sprites are 11 × 16.
const STAND = [
  "...hhh...",
  "..hsssh..",
  "...sss...",
  "....s....",
  "..yyyyY..",
  ".yyyyyYY.",
  ".s.yyY.s.",
  ".s.yyY.s.",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
const RUN_A = [
  "....hhh..",
  "...hsss..",
  "....sss..",
  ".....s...",
  "...yyyY..",
  "..yyyyYY.",
  "..s.yyY.s",
  ".s..yyY..",
  "....ddd..",
  "...dd.dd.",
  "..ss...s.",
  ".ww....w.",
  "bw.....w.",
  "b......bb",
];
const RUN_B = [
  "....hhh..",
  "...hsss..",
  "....sss..",
  ".....s...",
  "...yyyY..",
  "..yyyyYY.",
  "..s.yyYs.",
  "...syyY..",
  "....ddd..",
  "....dd...",
  "....ss...",
  "....ws...",
  "....ww...",
  "...bbb...",
];
const KICK = [
  "...hhh...",
  "..hsss...",
  "...sss...",
  "....s....",
  ".syyyY...",
  "s.yyyyY..",
  "..yyyY.s.",
  "..yyY...s",
  "..ddd....",
  "..dd.ddd.",
  "..s....sw",
  "..w.....b",
  ".ww......",
  "bb.......",
];
const ARMS_UP = [
  "s.......s",
  ".s.hhh.s.",
  "..yhssy..",
  "...sss...",
  "...ysY...",
  "..yyyyY..",
  "..yyyyY..",
  "...yyY...",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
const HEAD_IN_HANDS = [
  ".........",
  "..shhhs..",
  ".y.sss.Y.",
  ".y..s..Y.",
  "..yyyyY..",
  "..yyyyY..",
  "..yyyyY..",
  "...yyY...",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
const KEEPER = [
  "...hhh...",
  "..hsssh..",
  "...sss...",
  "g...s...g",
  "s.yyyyY.s",
  ".yyyyyYY.",
  "...yyY...",
  "...yyY...",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
const KEEPER_REACH = [
  "g.......g",
  "s.hhh...s",
  ".shssh.s.",
  "..ysssY..",
  "...ysY...",
  "..yyyyY..",
  "..yyyyY..",
  "...yyY...",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
const REF = [
  "...hhh...",
  "..hsssh..",
  "...sss...",
  "...csc...",
  "..yyyyY..",
  ".yyyyyYY.",
  ".s.yyY.s.",
  ".s.yyY.s.",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
// Arm out, pointing back to the centre circle.
const REF_POINT = [
  "...hhh...",
  "..hsssh..",
  "...sss...",
  "...csc...",
  "..yyyyY..",
  "ssyyyyYY.",
  "...yyY.s.",
  "...yyY.s.",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];
// Arm up, whistle in.
const REF_WHISTLE = [
  ".......s.",
  "...hhh.s.",
  "..hsssys.",
  "...sssy..",
  "..yyyyY..",
  ".yyyyyY..",
  ".s.yyY...",
  ".s.yyY...",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];

const make = (rows: string[], pal: Palette) => outline(sprite(rows, pal), EDGE);

export const PLAYER = {
  stand: make(STAND, player),
  run: [make(RUN_A, player), make(RUN_B, player)],
  kick: make(KICK, player),
  armsUp: make(ARMS_UP, player),
  headInHands: make(HEAD_IN_HANDS, player),
};
/** Upside down, for the overhead kick. */
export const BICYCLE = transform(PLAYER.kick, 1, -1);
/** Flat on the grass after landing it. */
export const PLAYER_DOWN = transform(PLAYER.stand, 1, 1, -1);

const keeperStand = transform(make(KEEPER, keeper), -1); // faces left, towards the shooter
const keeperReach = transform(make(KEEPER_REACH, keeper), -1);
export const KEEPER_SPRITES = {
  stand: keeperStand,
  /** Full stretch, arms towards the ball. */
  dive: transform(keeperReach, 1, 1, -1),
  /** Flat on the floor. */
  slip: transform(keeperStand, 1, 1, 1),
};

export const REF_SPRITES = {
  stand: make(REF, referee),
  point: make(REF_POINT, referee),
  whistle: make(REF_WHISTLE, referee),
};

const ballPal: Palette = { w: COLORS.chalk, b: "#1b1b1b" };
export const BALL = [
  outline(sprite([".www.", "wwbww", "wbbbw", "wwbww", ".www."], ballPal), EDGE),
  outline(sprite([".wbw.", "wwwww", "bwwwb", "wwwww", ".wbw."], ballPal), EDGE),
];

const dogPal: Palette = { t: "#8a5a2b", T: "#6a4220", b: "#111111" };
export const DOG = [
  sprite(["......tb", "t....ttt", ".ttttt..", ".TtttT..", ".t...t.."], dogPal),
  sprite(["......tb", "t....ttt", ".ttttt..", ".TtttT..", "..t.t..."], dogPal),
];
