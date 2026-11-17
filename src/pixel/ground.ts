import { COLORS, DOG } from "./sprites";
import { disc, ditherDisc, ditherRow, makeCanvas, rect, rng, type Ctx } from "./engine";

/** How the crowd behaves. */
export type Mood = "idle" | "cheer" | "wild" | "groan";

interface Style {
  sky: string[]; // bands, top to horizon
  stars: number; // per 1,000 sky pixels
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
}

const NIGHT = ["#060b18", "#09122a", "#0d1a38", "#122346", "#172c54", "#1d3660"];
const DUSK = ["#1a1636", "#2c2150", "#4a2c62", "#76405f", "#a8585a", "#d47a52"];
const EVENING = ["#20253a", "#2c3249", "#3b4159", "#4d5269", "#626679"];
const OVERCAST = ["#6f7987", "#7f8996", "#8e98a4", "#9ea7b1", "#adb5bd"];
const DRIZZLE = ["#5b636e", "#69717c", "#78808a", "#868e97", "#949ba3"];

const base: Style = {
  sky: NIGHT,
  stars: 6,
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
};

/** One ground per pyramid level, from a floodlit bowl down to a park on a wet Sunday morning. */
export const GROUNDS: Style[] = [
  { ...base, stars: 7, stand: 0.62, tiers: 2, crowd: 0.97, lights: 0.94, boards: true },
  { ...base, stars: 6, stand: 0.54, tiers: 2, crowd: 0.88, lights: 0.86, boards: true, seats: "#3a1d24" },
  { ...base, stars: 5, stand: 0.45, standW: 0.94, crowd: 0.74, lights: 0.76, boards: true, seats: "#1d3a2a" },
  { ...base, sky: DUSK, stars: 1, stand: 0.37, standW: 0.82, crowd: 0.58, lights: 0.66, boards: true, pitch: ["#2c6b44", "#285f3d"], seats: "#3a2a1a" },
  { ...base, sky: DUSK, stars: 0.5, stand: 0.3, standW: 0.64, crowd: 0.44, lights: 0.56, rail: true, pitch: ["#2c6b44", "#285f3d"], concrete: "#3a3a42" },
  { ...base, sky: EVENING, stars: 0, clouds: 0.35, cloud: ["#454b62", "#515770"], stand: 0.23, standW: 0.46, crowd: 0.32, lights: 0.46, rail: true, trees: 0.35, clubhouse: true, pitch: ["#31693f", "#2c5f39"], concrete: "#44464c", seats: "#44464c" },
  { ...base, sky: EVENING, stars: 0, clouds: 0.6, cloud: ["#454b62", "#515770"], stand: 0.16, standW: 0.28, crowd: 0.24, lights: 0.36, rail: true, trees: 0.6, clubhouse: true, pitch: ["#35683c", "#2f5d36"], concrete: "#4a4a4e", seats: "#4a4a4e", mud: 0.08 },
  { ...base, sky: OVERCAST, stars: 0, clouds: 0.75, cloud: ["#8a939e", "#b8bfc6"], crowd: 0.16, rail: true, trees: 0.85, treeColors: ["#2c4a2a", "#38592f"], clubhouse: true, litWindows: false, pitch: ["#3f7a3f", "#397039"], mud: 0.18 },
  { ...base, sky: DRIZZLE, stars: 0, clouds: 0.95, cloud: ["#737b85", "#a0a7ae"], rain: true, crowd: 0.06, trees: 1, treeColors: ["#2a4429", "#33522f"], dog: true, litWindows: false, pitch: ["#4a7a3a", "#43703a"], mud: 0.4 },
];

const SKIN = ["#f1c9a5", "#e0a878", "#c68a5c", "#9a6440", "#6e4429", "#4a2c1a"];
const HOME = ["#D7263D", "#D7263D", "#D7263D", "#F1EFE4", "#F1EFE4"];
const AWAY = ["#3a6ea5", "#5ad1e6", "#3a6ea5"];
const MISC = ["#FFD23F", "#1b1b1b", "#e07a2f", "#7b5bb0", "#2f8a4c", "#c9c6b8"];

interface Fan {
  x: number;
  y: number;
  skin: string;
  shirt: string;
  phase: number;
  standing: boolean; // railside fans are drawn full height
  brolly?: string;
}

interface Glow {
  x: number;
  y: number;
}

export class Ground {
  readonly horizon: number;
  readonly style: Style;
  private cache: HTMLCanvasElement;
  private fans: Fan[] = [];
  private stars: Glow[] = [];
  private rain: { x: number; y: number; v: number }[] = [];
  private boardsY = -1;

  constructor(
    readonly level: number,
    readonly w: number,
    readonly h: number,
    horizonShare: number,
  ) {
    this.style = GROUNDS[Math.min(level, GROUNDS.length - 1)];
    this.horizon = Math.round(h * horizonShare);
    const [cache, ctx] = makeCanvas(w, h);
    this.cache = cache;
    this.paint(ctx, rng(level * 7919 + 17));
  }

  // -------------------------------------------------------------- static layer

  private paint(ctx: Ctx, rand: () => number) {
    const { w, h, horizon: hz, style: s } = this;

    // Sky in bands, dithered where they meet.
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

    // Blocky clouds.
    const clouds = Math.round((w / 40) * s.clouds * 3);
    for (let i = 0; i < clouds; i++) {
      const cx = Math.floor(rand() * w);
      const cy = Math.floor(rand() * hz * 0.75);
      const cw = 14 + Math.floor(rand() * 30);
      rect(ctx, cx - cw / 2, cy, cw, 3, s.cloud[0]);
      rect(ctx, cx - cw / 3, cy - 2, (cw * 2) / 3, 2, s.cloud[0]);
      rect(ctx, cx - cw / 4, cy - 3, cw / 2, 2, s.cloud[1]);
      rect(ctx, cx - cw / 2 + 2, cy, cw - 6, 1, s.cloud[1]);
    }

    const standH = Math.round(hz * s.stand);
    const standW = Math.round(w * s.standW);
    const sx = Math.round((w - standW) / 2);
    const standTop = hz - standH;

    // Trees along the horizon.
    const trees = Math.round((w / 9) * s.trees);
    for (let i = 0; i < trees; i++) {
      const x = Math.floor(rand() * w);
      const r = 3 + Math.floor(rand() * 6);
      rect(ctx, x, hz - r, 1, r, "#3a2a1c");
      disc(ctx, x, hz - r - 2, r, s.treeColors[0]);
      disc(ctx, x - 1, hz - r - 3, Math.max(1, r - 2), s.treeColors[1]);
    }

    // Floodlight towers stand behind the stand.
    if (s.lights > 0) {
      const top = Math.round(hz - hz * s.lights);
      const head = s.lights > 0.6 ? 4 : s.lights > 0.4 ? 3 : 2;
      const spots = w > 220 ? [0.05, 0.27, 0.73, 0.95] : [0.07, 0.93];
      for (const f of spots) {
        const x = Math.round(w * f);
        rect(ctx, x, top, 1, hz - top, "#3a3f48");
        rect(ctx, x + 1, top + 4, 1, hz - top - 4, "#252931");
        const hw = head * 2 + 3;
        ctx.globalAlpha = 0.3;
        ditherDisc(ctx, x, top, hw + 7, "#ffe9a0");
        ctx.globalAlpha = 0.55;
        ditherDisc(ctx, x, top, hw + 2, "#fff3b0");
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
      const roofH = s.roof ? Math.max(2, Math.round(standH * 0.07)) : 0;
      if (s.roof) {
        rect(ctx, sx - 2, standTop - roofH, standW + 4, roofH, "#141820");
        rect(ctx, sx - 2, standTop, standW + 4, 1, "#0c0f14");
        for (let x = sx + 10; x < sx + standW - 4; x += 28) rect(ctx, x, standTop, 1, standH - 2, "#1a1e26");
      }
      const boxes = s.tiers === 2 ? Math.round(standTop + standH * 0.45) : -1;
      if (boxes > 0) {
        rect(ctx, sx, boxes, standW, 3, "#11151c");
        for (let x = sx + 2; x < sx + standW - 2; x += 3) rect(ctx, x, boxes + 1, 1, 1, rand() > 0.3 ? "#ffd98a" : "#2a2f38");
      }
      const rows0 = standTop + 2;
      const rowsEnd = hz - (s.boards ? 4 : 1);
      for (let y = rows0; y + 2 < rowsEnd; y += 3) {
        if (boxes > 0 && y + 3 >= boxes && y <= boxes + 3) continue;
        rect(ctx, sx + 1, y + 2, standW - 2, 1, s.seats);
        const away = (x: number) => x > sx + standW * 0.82;
        for (let x = sx + 1 + ((y / 3) & 1); x < sx + standW - 1; x += 2) {
          if (rand() > s.crowd) continue;
          const pal = away(x) ? AWAY : rand() > 0.82 ? MISC : HOME;
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
      if (s.boards) this.boardsY = hz - 3;
    }

    // Clubhouse.
    if (s.clubhouse) {
      const cw = 30;
      const cx = Math.round(w * 0.74);
      const ch = 11;
      rect(ctx, cx, hz - ch, cw, ch, "#7a5a40");
      rect(ctx, cx - 2, hz - ch - 2, cw + 4, 2, "#3a2a2a");
      rect(ctx, cx + 2, hz - ch - 4, cw - 4, 2, "#3a2a2a");
      for (let x = cx + 3; x < cx + cw - 4; x += 6) rect(ctx, x, hz - ch + 3, 3, 3, s.litWindows ? "#ffd98a" : "#9fb3c0");
      rect(ctx, cx + cw - 7, hz - 6, 4, 6, "#3a2a1c");
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

    // Pitch: mowing stripes, touchline, the odd bit of mud.
    const sw = 10;
    for (let x = 0; x < w; x += sw) rect(ctx, x, hz, sw, h - hz, (x / sw) & 1 ? s.pitch[1] : s.pitch[0]);
    rect(ctx, 0, hz, w, 1, "#0e1f14");
    rect(ctx, 0, hz + 3, w, 1, "#e9e6d8");
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
  }

  // ------------------------------------------------------------- dynamic layer

  draw(ctx: Ctx, t: number, mood: Mood = "idle") {
    const { w, h, horizon: hz, style: s } = this;
    ctx.drawImage(this.cache, 0, 0);

    for (const star of this.stars) {
      if (Math.sin(t * 2.3 + star.x * 0.7 + star.y) > 0.75) {
        rect(ctx, star.x - 1, star.y, 3, 1, "#cfd8f0");
        rect(ctx, star.x, star.y - 1, 1, 3, "#cfd8f0");
      }
    }

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

    if (this.boardsY >= 0) {
      const seg = 22;
      const off = Math.floor(t * 10) % seg;
      const cols = [COLORS.flood, "#0c1a12", COLORS.red, COLORS.chalk];
      for (let x = -off, i = 0; x < w; x += seg, i++) {
        const c = cols[i % cols.length];
        rect(ctx, x, this.boardsY, seg, 3, c);
        const ink = c === "#0c1a12" ? COLORS.flood : "#0c1a12";
        for (let k = 3; k < seg - 3; k += 2) if ((k * 7 + i) % 5 !== 0) rect(ctx, x + k, this.boardsY + 1, 1, 1, ink);
      }
    }

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
}
