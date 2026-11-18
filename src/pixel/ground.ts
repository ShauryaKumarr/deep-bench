import { drawText, textWidth } from "./font";
import { COLORS, DOG } from "./sprites";
import { disc, ditherDisc, ditherRow, makeCanvas, rect, rng, type Ctx } from "./engine";

/** How the crowd behaves. */
export type Mood = "idle" | "cheer" | "wild" | "groan";

/** Horizontal shift per row of pitch, so lines that run away from the camera lean in perspective. */
export const SKEW = 0.22;

interface Style {
  sky: string[]; // bands, top to horizon
  stars: number; // per 1,000 sky pixels
  moon: boolean;
  clouds: number; // 0..1
  cloud: [string, string];
  rain: boolean;
  stand: number; // height as a share of the sky
  standW: number; // share of the width
  tiers: 1 | 2;
  roof: boolean;
  crowd: number; // 0..1 seat occupancy, or railside density without a stand
  lights: number; // tower height as a share of the sky, 0 for none
  boards: boolean;
  rail: boolean;
  trees: number;
  treeColors: [string, string];
  clubhouse: boolean;
  litWindows: boolean;
  dog: boolean;
  pitch: [string, string];
  mud: number;
  concrete: string;
  seats: string;
  /** "screen" on the stand roof, a hand-turned "board", or nothing. */
  scoreboard: "screen" | "board" | null;
  /** Covered dugouts, a wooden bench, or a kit bag on the grass. */
  bench: "dugout" | "bench" | "bag";
}

const NIGHT = ["#060b18", "#09122a", "#0d1a38", "#122346", "#172c54", "#1d3660"];
const DUSK = ["#1a1636", "#2c2150", "#4a2c62", "#76405f", "#a8585a", "#d47a52"];
const EVENING = ["#20253a", "#2c3249", "#3b4159", "#4d5269", "#626679"];
const OVERCAST = ["#6f7987", "#7f8996", "#8e98a4", "#9ea7b1", "#adb5bd"];
const DRIZZLE = ["#5b636e", "#69717c", "#78808a", "#868e97", "#949ba3"];

const base: Style = {
  sky: NIGHT,
  stars: 6,
  moon: false,
  clouds: 0,
  cloud: ["#2a3346", "#353f55"],
  rain: false,
  stand: 0,
  standW: 1,
  tiers: 1,
  roof: true,
  crowd: 0,
  lights: 0,
  boards: false,
  rail: false,
  trees: 0,
  treeColors: ["#16301f", "#1e3d28"],
  clubhouse: false,
  litWindows: true,
  dog: false,
  pitch: ["#2f7d4c", "#2a7045"],
  mud: 0,
  concrete: "#2b313d",
  seats: "#1b2948",
  scoreboard: null,
  bench: "dugout",
};

/** One ground per pyramid level, from a park on a wet Sunday morning up to a floodlit bowl. */
export const GROUNDS: Style[] = [
  { ...base, sky: DRIZZLE, stars: 0, clouds: 0.95, cloud: ["#737b85", "#a0a7ae"], rain: true, crowd: 0.06, trees: 1, treeColors: ["#2a4429", "#33522f"], dog: true, litWindows: false, pitch: ["#4a7a3a", "#43703a"], mud: 0.4, bench: "bag" },
  { ...base, sky: OVERCAST, stars: 0, clouds: 0.75, cloud: ["#8a939e", "#b8bfc6"], crowd: 0.16, rail: true, trees: 0.85, treeColors: ["#2c4a2a", "#38592f"], clubhouse: true, litWindows: false, pitch: ["#3f7a3f", "#397039"], mud: 0.18, scoreboard: "board", bench: "bench" },
  { ...base, sky: EVENING, stars: 0, clouds: 0.6, cloud: ["#454b62", "#515770"], stand: 0.16, standW: 0.28, crowd: 0.24, lights: 0.36, rail: true, trees: 0.6, clubhouse: true, pitch: ["#35683c", "#2f5d36"], concrete: "#4a4a4e", seats: "#4a4a4e", mud: 0.08, scoreboard: "board", bench: "bench" },
  { ...base, sky: EVENING, stars: 0, clouds: 0.35, cloud: ["#454b62", "#515770"], stand: 0.23, standW: 0.46, crowd: 0.32, lights: 0.46, rail: true, trees: 0.35, clubhouse: true, pitch: ["#31693f", "#2c5f39"], concrete: "#44464c", seats: "#44464c", scoreboard: "board", bench: "bench" },
  { ...base, sky: DUSK, stars: 0.5, stand: 0.3, standW: 0.64, crowd: 0.44, lights: 0.56, rail: true, pitch: ["#2c6b44", "#285f3d"], concrete: "#3a3a42", scoreboard: "board" },
  { ...base, sky: DUSK, stars: 1, stand: 0.37, standW: 0.82, crowd: 0.58, lights: 0.66, boards: true, pitch: ["#2c6b44", "#285f3d"], seats: "#3a2a1a", scoreboard: "screen" },
  { ...base, stars: 5, moon: true, stand: 0.45, standW: 0.94, crowd: 0.74, lights: 0.76, boards: true, seats: "#1d3a2a", scoreboard: "screen" },
  { ...base, stars: 6, moon: true, stand: 0.54, tiers: 2, crowd: 0.88, lights: 0.86, boards: true, seats: "#3a1d24", scoreboard: "screen" },
  { ...base, stars: 7, moon: true, stand: 0.62, tiers: 2, crowd: 0.97, lights: 0.94, boards: true, scoreboard: "screen" },
];

const SKIN = ["#f1c9a5", "#e0a878", "#c68a5c", "#9a6440", "#6e4429", "#4a2c1a"];
const HOME = ["#D7263D", "#D7263D", "#D7263D", "#F1EFE4", "#F1EFE4"];
const AWAY = ["#3a6ea5", "#5ad1e6", "#3a6ea5"];
const MISC = ["#FFD23F", "#1b1b1b", "#e07a2f", "#7b5bb0", "#2f8a4c", "#c9c6b8"];
const LINE = "#dcd9ca";

// Made-up sponsors for the advertising boards.
const ADS: [string, string, string][] = [
  ["Deep Bench", COLORS.flood, "#0c1a12"],
  ["Matchday Pies", "#0c1a12", COLORS.flood],
  ["Terrace Tea", COLORS.red, COLORS.chalk],
  ["Floodlight FM", COLORS.chalk, "#0c1a12"],
  ["Obscure XI", "#1b2948", COLORS.chalk],
  ["Boot Room", "#2f7a4a", COLORS.chalk],
  ["Half-time oranges", COLORS.orange, "#0c1a12"],
];
const BOARD_H = 7;

interface Fan {
  x: number;
  y: number;
  skin: string;
  shirt: string;
  phase: number;
  standing: boolean; // railside fans are drawn full height
  brolly?: string;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
}

interface Sub {
  x: number;
  y: number;
  skin: string;
  kit: string;
  phase: number;
}

export interface GroundOptions {
  /** Where the benches sit, as shares of the width. */
  benches?: number[];
  /** Extra pitch markings painted under everything that moves. Defaults to a halfway line and centre circle. */
  markings?: (ctx: Ctx, ground: Ground) => void;
  /** Where the halfway line crosses the pitch, as a share of the width. */
  centre?: number;
}

export interface Scoreboard {
  top: string;
  bottom: string;
  blink?: boolean;
}

export class Ground {
  readonly horizon: number;
  readonly style: Style;
  /** What the scoreboard says. Set by whoever owns the ground. */
  screen: Scoreboard | null = null;

  private sky: HTMLCanvasElement;
  private scene: HTMLCanvasElement;
  private boardStrip: HTMLCanvasElement | null = null;
  private fans: Fan[] = [];
  private stars: { x: number; y: number }[] = [];
  private clouds: Cloud[] = [];
  private rain: { x: number; y: number; v: number }[] = [];
  private subs: Sub[] = [];
  private benchXs: number[] = [];
  private screenBox: { x: number; y: number; w: number; h: number; lines: 1 | 2 } | null = null;
  private boardsY = -1;

  constructor(
    readonly level: number,
    readonly w: number,
    readonly h: number,
    horizonShare: number,
    private options: GroundOptions = {},
  ) {
    this.style = GROUNDS[Math.min(level, GROUNDS.length - 1)];
    this.horizon = Math.round(h * horizonShare);
    const rand = rng(level * 7919 + 17);
    const [sky, skyCtx] = makeCanvas(w, h);
    const [scene, sceneCtx] = makeCanvas(w, h);
    this.sky = sky;
    this.scene = scene;
    this.paintSky(skyCtx, rand);
    this.paintScene(sceneCtx, rand);
  }

  /** x on a line through (x0, y0) that runs away from the camera, at row y. */
  lean(x0: number, y0: number, y: number) {
    return x0 + (y - y0) * SKEW;
  }

  // ------------------------------------------------------------ static layers

  private paintSky(ctx: Ctx, rand: () => number) {
    const { w, horizon: hz, style: s } = this;
    const band = hz / s.sky.length;
    s.sky.forEach((c, i) => rect(ctx, 0, Math.floor(i * band), w, Math.ceil(band) + 1, c));
    for (let i = 1; i < s.sky.length; i++) {
      const y = Math.floor(i * band);
      ditherRow(ctx, y - 1, w, s.sky[i], 1);
      ditherRow(ctx, y, w, s.sky[i - 1]);
    }

    const starCount = Math.round((w * hz * s.stars) / 1000);
    for (let i = 0; i < starCount; i++) {
      const star = { x: Math.floor(rand() * w), y: Math.floor(rand() * hz * 0.7) };
      rect(ctx, star.x, star.y, 1, 1, rand() > 0.7 ? "#ffffff" : "#8a9cc4");
      if (rand() > 0.6) this.stars.push(star);
    }

    if (s.moon) {
      const mx = Math.round(w * 0.6);
      const my = Math.max(7, Math.round(hz * 0.2));
      ctx.globalAlpha = 0.18;
      ditherDisc(ctx, mx, my, 10, "#e8e4d0");
      ctx.globalAlpha = 1;
      disc(ctx, mx, my, 5, "#efeadb");
      rect(ctx, mx - 2, my - 2, 2, 2, "#d6d0b8");
      rect(ctx, mx + 2, my + 1, 2, 1, "#d6d0b8");
      rect(ctx, mx - 1, my + 3, 1, 1, "#d6d0b8");
    }

    const clouds = Math.round((w / 40) * s.clouds * 3);
    for (let i = 0; i < clouds; i++) {
      this.clouds.push({
        x: rand() * w,
        y: Math.floor(rand() * hz * 0.75) + 3,
        w: 14 + Math.floor(rand() * 30),
        speed: 0.6 + rand() * 1.6,
      });
    }
  }

  private paintScene(ctx: Ctx, rand: () => number) {
    const { w, h, horizon: hz, style: s } = this;
    const standH = Math.round(hz * s.stand);
    const standW = Math.round(w * s.standW);
    const sx = Math.round((w - standW) / 2);
    const standTop = hz - standH;
    const roofH = s.roof && standH > 4 ? Math.max(2, Math.round(standH * 0.07)) : 0;

    // Trees along the horizon.
    const trees = Math.round((w / 9) * s.trees);
    for (let i = 0; i < trees; i++) {
      const x = Math.floor(rand() * w);
      const r = 3 + Math.floor(rand() * 6);
      rect(ctx, x, hz - r, 1, r, "#3a2a1c");
      disc(ctx, x, hz - r - 2, r, s.treeColors[0]);
      disc(ctx, x - 1, hz - r - 3, Math.max(1, r - 2), s.treeColors[1]);
    }

    // Floodlights: beams through the night air, then the towers.
    if (s.lights > 0) {
      const top = Math.round(hz - hz * s.lights);
      const head = s.lights > 0.6 ? 4 : s.lights > 0.4 ? 3 : 2;
      const spots = w > 220 ? [0.05, 0.27, 0.73, 0.95] : [0.07, 0.93];
      const night = s.sky === NIGHT;
      for (const f of spots) {
        const x = Math.round(w * f);
        if (night) {
          ctx.globalAlpha = 0.07;
          ctx.fillStyle = "#fff3b0";
          for (let y = top + head; y < hz; y++) {
            const p = (y - top) / (hz - top);
            const c = x + (w / 2 - x) * p * 0.55;
            const half = 2 + (y - top) * 0.3;
            for (let bx = Math.ceil(c - half) + (y & 1); bx < c + half; bx += 2) ctx.fillRect(bx, y, 1, 1);
          }
          ctx.globalAlpha = 1;
        }
        rect(ctx, x, top, 1, hz - top, "#3a3f48");
        rect(ctx, x + 1, top + 4, 1, hz - top - 4, "#252931");
        for (let y = top + 6; y < hz - 2; y += 5) rect(ctx, x - 1, y, 3, 1, "#2a2e36"); // rungs
        const hw = head * 2 + 3;
        ctx.globalAlpha = 0.16;
        ditherDisc(ctx, x, top, hw + 5, "#ffe9a0");
        ctx.globalAlpha = 0.4;
        ditherDisc(ctx, x, top, hw + 1, "#fff3b0");
        ctx.globalAlpha = 1;
        rect(ctx, x - Math.floor(hw / 2) - 1, top - head - 1, hw + 2, head + 2, "#2a2d33");
        for (let ly = 0; ly < head; ly++)
          for (let lx = 0; lx < hw; lx += 2)
            rect(ctx, x - Math.floor(hw / 2) + lx + (ly & 1), top - head + ly, 1, 1, ly === 0 ? "#ffffff" : "#fff3b0");
      }
    }

    // The stand, with fans placed in its rows.
    if (standH > 4) {
      rect(ctx, sx, standTop, standW, standH, s.concrete);
      rect(ctx, sx, standTop, 1, standH, "#1a1e26");
      rect(ctx, sx + standW - 1, standTop, 1, standH, "#1a1e26");
      if (roofH) {
        rect(ctx, sx - 2, standTop - roofH, standW + 4, roofH, "#141820");
        rect(ctx, sx - 2, standTop - roofH, standW + 4, 1, "#262c38"); // lit fascia edge
        rect(ctx, sx - 2, standTop, standW + 4, 1, "#0c0f14");
        for (let x = sx + 10; x < sx + standW - 4; x += 28) rect(ctx, x, standTop, 1, standH - 2, "#1a1e26");
      }
      const boxes = s.tiers === 2 ? Math.round(standTop + standH * 0.45) : -1;
      if (boxes > 0) {
        rect(ctx, sx, boxes, standW, 3, "#11151c");
        for (let x = sx + 2; x < sx + standW - 2; x += 3) rect(ctx, x, boxes + 1, 1, 1, rand() > 0.3 ? "#ffd98a" : "#2a2f38");
      }
      const rowsEnd = hz - (s.boards ? BOARD_H + 1 : 1);
      for (let y = standTop + 2; y + 2 < rowsEnd; y += 3) {
        if (boxes > 0 && y + 3 >= boxes && y <= boxes + 3) continue;
        rect(ctx, sx + 1, y + 2, standW - 2, 1, s.seats);
        for (let x = sx + 1 + ((y / 3) & 1); x < sx + standW - 1; x += 2) {
          if (rand() > s.crowd) continue;
          const pal = x > sx + standW * 0.82 ? AWAY : rand() > 0.82 ? MISC : HOME;
          this.fans.push({
            x,
            y,
            skin: SKIN[Math.floor(rand() * SKIN.length)],
            shirt: pal[Math.floor(rand() * pal.length)],
            phase: rand() * Math.PI * 2,
            standing: false,
          });
        }
      }
      if (s.boards) this.boardsY = hz - BOARD_H;

      // A big screen on the roof.
      if (s.scoreboard === "screen" && roofH) {
        const bw = 29;
        const bh = 15;
        // between the floodlight towers, clear of the moon
        const bx = Math.min(sx + standW - bw - 2, Math.round(sx + standW * 0.84 - bw / 2));
        const by = standTop - roofH - bh - 2;
        if (by > 1 && bx + bw < w - 1) {
          rect(ctx, bx + 4, by + bh, 1, 2, "#2a2d33");
          rect(ctx, bx + bw - 5, by + bh, 1, 2, "#2a2d33");
          rect(ctx, bx - 1, by - 1, bw + 2, bh + 2, "#2a2d33");
          this.screenBox = { x: bx, y: by, w: bw, h: bh, lines: 2 };
        }
      }
    }

    // Clubhouse.
    if (s.clubhouse) {
      const cw = 30;
      const cx = Math.round(w * 0.74);
      const ch = 11;
      rect(ctx, cx, hz - ch, cw, ch, "#7a5a40");
      for (let y = hz - ch + 1; y < hz; y += 2) rect(ctx, cx, y, cw, 1, "#70523a"); // brick courses
      rect(ctx, cx - 2, hz - ch - 2, cw + 4, 2, "#3a2a2a");
      rect(ctx, cx + 2, hz - ch - 4, cw - 4, 2, "#3a2a2a");
      for (let x = cx + 3; x < cx + cw - 4; x += 6) rect(ctx, x, hz - ch + 3, 3, 3, s.litWindows ? "#ffd98a" : "#9fb3c0");
      rect(ctx, cx + cw - 7, hz - 6, 4, 6, "#3a2a1c");
    }

    // A hand-turned scoreboard on legs.
    if (s.scoreboard === "board") {
      const bw = 21;
      const bh = 9;
      const bx = s.clubhouse ? Math.round(w * 0.74) - bw - 6 : Math.round(w * 0.86 - bw / 2);
      const by = hz - bh - 6;
      if (bx > 1 && bx + bw < w - 1) {
        rect(ctx, bx + 2, by + bh, 1, 6, "#3a2a1c");
        rect(ctx, bx + bw - 3, by + bh, 1, 6, "#3a2a1c");
        rect(ctx, bx - 1, by - 1, bw + 2, bh + 2, "#d9d4c0");
        this.screenBox = { x: bx, y: by, w: bw, h: bh, lines: 1 };
      }
    }

    // Railside fans where there is no stand to sit in.
    if (standH <= 4 && s.crowd > 0) {
      const n = Math.round(w * s.crowd * 0.35) + 2;
      for (let i = 0; i < n; i++) {
        const x = Math.floor(rand() * (w - 6)) + 3;
        this.fans.push({
          x,
          y: hz - 6,
          skin: SKIN[Math.floor(rand() * SKIN.length)],
          shirt: ["#2a3a5a", "#5a3a2a", "#3a4a3a", "#7a2a2a", "#c9c6b8"][Math.floor(rand() * 5)],
          phase: rand() * Math.PI * 2,
          standing: true,
          brolly: s.rain && rand() > 0.4 ? ["#D7263D", "#FFD23F", "#3a6ea5", "#1b1b1b"][Math.floor(rand() * 4)] : undefined,
        });
      }
    }

    // Pitch: mowing stripes that lean with the perspective, darker at the far edge.
    const sw = 10;
    for (let y = hz + 1; y < h; y++) {
      const off = Math.round((y - hz) * SKEW);
      for (let k = Math.floor(-off / sw) - 1; k * sw + off < w; k++) rect(ctx, k * sw + off, y, sw, 1, k & 1 ? s.pitch[1] : s.pitch[0]);
    }
    rect(ctx, 0, hz, w, 1, "#0e1f14");
    ctx.globalAlpha = 0.22;
    rect(ctx, 0, hz + 1, w, 2, "#0e1f14");
    ctx.globalAlpha = 0.1;
    rect(ctx, 0, h - Math.round((h - hz) * 0.18), w, h, "#000000");
    ctx.globalAlpha = 1;
    rect(ctx, 0, hz + 3, w, 1, LINE);

    if (this.options.markings) this.options.markings(ctx, this);
    else this.centreCircle(ctx);

    const mud = Math.round(((w * (h - hz)) / 400) * s.mud);
    for (let i = 0; i < mud; i++) {
      const x = Math.floor(rand() * w);
      const y = hz + 6 + Math.floor(rand() * (h - hz - 8));
      rect(ctx, x, y, 3 + Math.floor(rand() * 8), 1 + Math.floor(rand() * 2), rand() > 0.5 ? "#6a5032" : "#5a4229");
      if (s.rain && rand() > 0.7) rect(ctx, x + 1, y, 3, 1, "#8fa2b0");
    }

    if (s.rail) {
      rect(ctx, 0, hz - 3, w, 1, "#c9c6b8");
      for (let x = 2; x < w; x += 7) rect(ctx, x, hz - 3, 1, 3, "#9a978a");
    }

    if (s.rain) {
      const n = Math.round((w * h) / 140);
      for (let i = 0; i < n; i++) this.rain.push({ x: rand() * w, y: rand() * h, v: 0.8 + rand() * 0.6 });
    }

    if (s.boards) this.boardStrip = adStrip();

    // Benches, and the substitutes on them.
    this.benchXs = (this.options.benches ?? [0.76, 0.9]).map((f) => Math.round(w * f)).filter((x) => x > 1 && x + 24 < w);
    const seats = s.bench === "dugout" ? 6 : s.bench === "bench" ? 3 : 1;
    for (const bx of this.benchXs) {
      for (let i = 0; i < seats; i++) {
        this.subs.push({
          x: bx + 2 + i * 3,
          y: hz - (s.bench === "dugout" ? 4 : 5),
          skin: SKIN[Math.floor(rand() * SKIN.length)],
          kit: i % 3 === 1 ? "#c8f03c" : s.bench === "dugout" ? "#1b2948" : "#2a2a35",
          phase: rand() * Math.PI * 2,
        });
      }
    }
  }

  /** Halfway line and centre circle; by default off to the right, where the page doesn't cover them. */
  private centreCircle(ctx: Ctx) {
    const { w, h, horizon: hz } = this;
    const cx = Math.round(w * (this.options.centre ?? 0.8));
    const cy = Math.round(hz + (h - hz) * 0.45);
    for (let y = hz + 4; y < h; y++) rect(ctx, this.lean(cx, cy, y), y, 1, 1, LINE);
    const rx = Math.max(10, Math.round((h - hz) * 0.32));
    const ry = Math.max(3, Math.round(rx * 0.36));
    const steps = rx * 8;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const y = Math.round(cy + Math.sin(a) * ry);
      rect(ctx, Math.round(this.lean(cx + Math.cos(a) * rx, cy, y)), y, 1, 1, LINE);
    }
    rect(ctx, cx - 1, cy, 3, 1, LINE);
  }

  // ------------------------------------------------------------- dynamic layer

  draw(ctx: Ctx, t: number, mood: Mood = "idle") {
    const { w, h, horizon: hz, style: s } = this;
    ctx.drawImage(this.sky, 0, 0);

    for (const star of this.stars) {
      if (Math.sin(t * 2.3 + star.x * 0.7 + star.y) > 0.8) {
        rect(ctx, star.x - 1, star.y, 3, 1, "#cfd8f0");
        rect(ctx, star.x, star.y - 1, 1, 3, "#cfd8f0");
      }
    }

    for (const c of this.clouds) {
      const span = w + c.w * 2;
      const x = Math.round(((c.x + t * c.speed) % span) - c.w);
      rect(ctx, x, c.y, c.w, 3, s.cloud[0]);
      rect(ctx, x + c.w / 6, c.y - 2, (c.w * 2) / 3, 2, s.cloud[0]);
      rect(ctx, x + c.w / 4, c.y - 3, c.w / 2, 2, s.cloud[1]);
      rect(ctx, x + 2, c.y, c.w - 6, 1, s.cloud[1]);
    }

    ctx.drawImage(this.scene, 0, 0);

    const speed = mood === "wild" ? 13 : mood === "cheer" ? 8 : 2;
    for (const f of this.fans) {
      let lift = 0;
      const wave = Math.sin(t * speed + f.phase);
      if (mood === "wild") lift = wave > 0.5 ? 2 : wave > -0.3 ? 1 : 0;
      else if (mood === "cheer") lift = wave > 0.1 ? 1 : 0;
      else if (mood === "idle") lift = wave > 0.97 ? 1 : 0;
      const y = f.y - lift;
      if (f.standing) {
        if (f.brolly) {
          rect(ctx, f.x - 2, y - 3, 5, 1, f.brolly);
          rect(ctx, f.x - 1, y - 4, 3, 1, f.brolly);
          rect(ctx, f.x, y - 2, 1, 2, "#333");
        }
        rect(ctx, f.x, y, 1, 1, f.skin);
        rect(ctx, f.x, y + 1, 1, 2, f.shirt);
        rect(ctx, f.x, y + 3, 1, 3 + lift, "#2a2a35");
      } else {
        rect(ctx, f.x, y, 1, 1, f.skin);
        rect(ctx, f.x, y + 1, 1, 2, f.shirt);
      }
      if (lift > 0 && mood === "wild") {
        rect(ctx, f.x - 1, y - 1, 1, 1, f.skin);
        rect(ctx, f.x + 1, y - 1, 1, 1, f.skin);
      }
    }

    // Camera flashes in the crowd.
    if ((mood === "cheer" || mood === "wild") && this.fans.length) {
      const n = mood === "wild" ? 6 : 2;
      for (let i = 0; i < n; i++) {
        const f = this.fans[Math.floor(Math.random() * this.fans.length)];
        rect(ctx, f.x, f.y - 1, 1, 3, "#ffffff");
        rect(ctx, f.x - 1, f.y, 3, 1, "#ffffff");
      }
    }

    if (this.boardStrip && this.boardsY >= 0) {
      const sw = this.boardStrip.width;
      const off = Math.floor(t * 8) % sw;
      for (let x = -off; x < w; x += sw) ctx.drawImage(this.boardStrip, x, this.boardsY);
    }

    this.drawScoreboard(ctx, t);
    this.drawBenches(ctx, t, mood);

    if (s.dog) {
      const span = Math.max(20, w * 0.5);
      const p = (t * 9) % (span * 2);
      const forward = p < span;
      const x = Math.round(w * 0.2 + (forward ? p : span * 2 - p));
      const frame = DOG[Math.floor(t * 6) & 1];
      const y = hz + 5;
      if (forward) ctx.drawImage(frame, x, y);
      else {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(frame, -x - frame.width, y);
        ctx.restore();
      }
    }

    if (s.rain) {
      ctx.fillStyle = "rgba(200, 212, 224, 0.55)";
      for (const d of this.rain) {
        const y = (d.y + t * 90 * d.v) % h;
        const x = (d.x - (y - d.y) * 0.25 + w * 4) % w;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
      }
    }
  }

  private drawScoreboard(ctx: Ctx, t: number) {
    const box = this.screenBox;
    if (!box) return;
    const led = box.lines === 2;
    rect(ctx, box.x, box.y, box.w, box.h, led ? "#05070a" : "#1d4a30");
    const sb = this.screen;
    if (!sb) return;
    const centre = (text: string) => box.x + Math.round((box.w - textWidth(text)) / 2);
    const showTop = !sb.blink || Math.floor(t * 3) % 2 === 0;
    if (led) {
      if (showTop) drawText(ctx, sb.top, centre(sb.top), box.y + 2, COLORS.chalk);
      drawText(ctx, sb.bottom, centre(sb.bottom), box.y + 8, COLORS.flood);
    } else if (showTop) {
      drawText(ctx, sb.bottom, centre(sb.bottom), box.y + 2, COLORS.chalk);
    }
  }

  private drawBenches(ctx: Ctx, t: number, mood: Mood) {
    const { horizon: hz, style: s } = this;
    for (const bx of this.benchXs) {
      if (s.bench === "dugout") {
        rect(ctx, bx, hz - 7, 21, 7, "#141a24");
        rect(ctx, bx - 1, hz - 8, 23, 1, "#9fc0d4");
        ctx.globalAlpha = 0.45;
        rect(ctx, bx - 1, hz - 7, 23, 2, "#9fc0d4");
        ctx.globalAlpha = 1;
        rect(ctx, bx - 1, hz - 7, 1, 7, "#6d8ea2");
        rect(ctx, bx + 21, hz - 7, 1, 7, "#6d8ea2");
        rect(ctx, bx, hz - 2, 21, 1, "#2a303c");
      } else if (s.bench === "bench") {
        rect(ctx, bx, hz - 3, 11, 1, "#8a6a44");
        rect(ctx, bx + 1, hz - 2, 1, 2, "#5a4429");
        rect(ctx, bx + 9, hz - 2, 1, 2, "#5a4429");
        // the manager, in a long coat
        rect(ctx, bx + 13, hz - 8, 1, 1, "#e0a878");
        rect(ctx, bx + 13, hz - 7, 2, 5, "#2a2a35");
        rect(ctx, bx + 13, hz - 2, 1, 2, "#1b1b1b");
      } else {
        rect(ctx, bx, hz + 1, 5, 3, "#1b2948"); // kit bag
        rect(ctx, bx + 1, hz, 3, 1, "#0f1730");
      }
    }
    for (const sub of this.subs) {
      const fidget = mood === "wild" ? (Math.sin(t * 12 + sub.phase) > 0 ? 1 : 0) : Math.sin(t * 1.5 + sub.phase) > 0.95 ? 1 : 0;
      if (s.bench === "bag") {
        // one lad stood by his bag, hands in pockets
        rect(ctx, sub.x + 5, hz - 4 - fidget, 1, 1, sub.skin);
        rect(ctx, sub.x + 5, hz - 3 - fidget, 1, 3, "#3a3a46");
        rect(ctx, sub.x + 5, hz, 1, 2, "#1b1b1b");
        continue;
      }
      rect(ctx, sub.x, sub.y - fidget, 1, 1, sub.skin);
      rect(ctx, sub.x, sub.y + 1 - fidget, 1, 2, sub.kit);
    }
    // One substitute warming up along the touchline, in a bib.
    if (s.bench !== "bag" && this.benchXs.length) {
      const bx = this.benchXs[0];
      const span = 26;
      const p = (t * 6) % (span * 2);
      const x = Math.round(bx - 4 + (p < span ? p : span * 2 - p));
      const y = hz + 1;
      const stride = Math.floor(t * 8) & 1;
      rect(ctx, x, y - 6, 1, 1, "#c68a5c");
      rect(ctx, x, y - 5, 1, 2, "#ff7a1a");
      rect(ctx, x, y - 3, 1, 1, "#1b1b1b");
      rect(ctx, x - stride, y - 2, 1, 2, "#c68a5c");
      rect(ctx, x + 1 - stride, y - 2, 1, 2, "#c68a5c");
    }
  }
}

/** One long strip of advertising boards, drawn once and scrolled. */
function adStrip(): HTMLCanvasElement {
  const widths = ADS.map(([text]) => textWidth(text) + 10);
  const total = widths.reduce((a, b) => a + b + 1, 0);
  const [c, ctx] = makeCanvas(total, BOARD_H);
  let x = 0;
  ADS.forEach(([text, bg, fg], i) => {
    rect(ctx, x, 0, widths[i], BOARD_H, bg);
    drawText(ctx, text, x + 5, 1, fg);
    x += widths[i];
    rect(ctx, x, 0, 1, BOARD_H, "#05080a");
    x += 1;
  });
  rect(ctx, 0, BOARD_H - 1, total, 1, "rgba(0,0,0,0.35)");
  return c;
}
