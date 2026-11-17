import { sprite, transform, type Palette } from "./engine";

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

const player: Palette = {
  h: "#2a1a10", // hair
  s: "#c68a5c", // skin
  y: COLORS.flood, // shirt
  d: COLORS.ink, // shorts
  w: COLORS.chalk, // socks
  b: "#111111", // boots
};

const keeper: Palette = { ...player, h: "#5a3a1a", s: "#e0b088", y: COLORS.red, d: "#1b1b1b", w: "#1b1b1b", g: COLORS.chalk };

// Facing right, 9 × 14.
const STAND = [
  "...hhh...",
  "..hsssh..",
  "...sss...",
  "....s....",
  "..yyyyy..",
  ".yyyyyyy.",
  ".s.yyy.s.",
  ".s.yyy.s.",
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
  "...yyyy..",
  "..yyyyyy.",
  "..s.yyy.s",
  ".s..yyy..",
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
  "...yyyy..",
  "..yyyyyy.",
  "..s.yyys.",
  "...syyy..",
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
  ".syyyy...",
  "s.yyyyy..",
  "..yyyy.s.",
  "..yyy...s",
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
  "...ysy...",
  "..yyyyy..",
  "..yyyyy..",
  "...yyy...",
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
  ".y.sss.y.",
  ".y..s..y.",
  "..yyyyy..",
  "..yyyyy..",
  "..yyyyy..",
  "...yyy...",
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
  "s.yyyyy.s",
  ".yyyyyyy.",
  "...yyy...",
  "...yyy...",
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
  "..ysssy..",
  "...ysy...",
  "..yyyyy..",
  "..yyyyy..",
  "...yyy...",
  "...ddd...",
  "...d.d...",
  "...s.s...",
  "...w.w...",
  "...w.w...",
  "..bb.bb..",
];

export const PLAYER = {
  stand: sprite(STAND, player),
  run: [sprite(RUN_A, player), sprite(RUN_B, player)],
  kick: sprite(KICK, player),
  armsUp: sprite(ARMS_UP, player),
  headInHands: sprite(HEAD_IN_HANDS, player),
};
/** Upside down, for the overhead kick. */
export const BICYCLE = transform(PLAYER.kick, 1, -1);
/** Flat on the grass after landing it. */
export const PLAYER_DOWN = transform(PLAYER.stand, 1, 1, -1);

const keeperStand = transform(sprite(KEEPER, keeper), -1); // faces left, towards the shooter
const keeperReach = transform(sprite(KEEPER_REACH, keeper), -1);
export const KEEPER_SPRITES = {
  stand: keeperStand,
  /** Full stretch, arms towards the top corner. */
  dive: transform(keeperReach, 1, 1, -1),
  /** Flat on the floor. */
  slip: transform(keeperStand, 1, 1, 1),
};

const ballPal: Palette = { w: COLORS.chalk, b: "#1b1b1b" };
export const BALL = [
  sprite([".www.", "wwbww", "wbbbw", "wwbww", ".www."], ballPal),
  sprite([".wbw.", "wwwww", "bwwwb", "wwwww", ".wbw."], ballPal),
];

const dogPal: Palette = { t: "#8a5a2b", T: "#6a4220", b: "#111111" };
export const DOG = [
  sprite(["......tb", "t....ttt", ".ttttt..", ".TtttT..", ".t...t.."], dogPal),
  sprite(["......tb", "t....ttt", ".ttttt..", ".TtttT..", "..t.t..."], dogPal),
];
