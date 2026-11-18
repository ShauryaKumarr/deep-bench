import { LEVELS, type Tier } from "../scoring";
import { sfx } from "../sound";
import { clamp01, disc, ease, makeCanvas, rect, reducedMotion, rng, type Ctx } from "./engine";
import { Particles } from "./effects";
import { Ground, type Mood } from "./ground";
import { BALL, BICYCLE, COLORS, KEEPER_SPRITES, PLAYER, PLAYER_DOWN, REF_SPRITES } from "./sprites";
import { openStage, type Cue } from "./stage";

export interface Replay {
  tier: Tier;
  points: number;
  name: string | null;
  /** Total points before this round. */
  before: number;
  fromLevel: number;
  toLevel: number;
}

const TITLES: Record<Tier, string> = {
  miss: "Time’s up",
  tap: "Tap-in",
  curler: "Curler",
  worldie: "Worldie!",
};
const MOODS: Record<Tier, Mood> = { miss: "groan", tap: "cheer", curler: "cheer", worldie: "wild" };

/** When the ball reaches the goal (or the bar), per tier. */
const ARRIVE: Record<Tier, number> = { miss: 1.45, tap: 2.0, curler: 1.75, worldie: 1.6 };
const RUN_END = 0.9;
const CLIMB = 1.5;
const LINE = "#dcd9ca";

type V = { x: number; y: number };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const bezier = (p0: V, p1: V, p2: V, k: number): V => ({
  x: (1 - k) ** 2 * p0.x + 2 * (1 - k) * k * p1.x + k * k * p2.x,
  y: (1 - k) ** 2 * p0.y + 2 * (1 - k) * k * p1.y + k * k * p2.y,
});
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Draws an outlined sprite with its feet on row `feet` and its left edge at `x`. */
export function actor(ctx: Ctx, img: HTMLCanvasElement, x: number, feet: number, mirror = false) {
  const dx = Math.round(x) - 1;
  const dy = Math.round(feet) - img.height + 1;
  if (!mirror) return ctx.drawImage(img, dx, dy);
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(img, -dx - img.width, dy);
  ctx.restore();
}

/** A soft two-row shadow on the grass. */
export function shadow(ctx: Ctx, cx: number, y: number, width: number, strength = 0.32) {
  ctx.globalAlpha = strength;
  rect(ctx, cx - width / 2, y, width, 1, "#000000");
  rect(ctx, cx - width / 2 + 1, y - 1, width - 2, 1, "#000000");
  ctx.globalAlpha = 1;
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(a: string, b: string, k: number) {
  const [x, y] = [hex(a), hex(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
}

/**
 * The sky between one division and the next, for the promotion climb. Its bottom matches the
 * current ground's sky; at the top, the bigger ground floats on a ragged island of earth and cloud.
 */
function ascent(w: number, h: number, from: string): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const rand = rng(7);
  const top = "#8fb8e4";
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const y0 = Math.floor((i * h) / steps);
    rect(ctx, 0, y0, w, Math.ceil(h / steps) + 1, mix(top, from, i / (steps - 1)));
    if (i) for (let x = y0 & 1; x < w; x += 2) rect(ctx, x, y0, 1, 1, mix(top, from, (i - 1) / (steps - 1)));
  }
  // Wisps and a few birds on the way up.
  for (let i = 0; i < w / 16; i++) {
    const x = rand() * w;
    const y = h * (0.35 + rand() * 0.55);
    const cw = 10 + rand() * 22;
    ctx.globalAlpha = 0.5;
    rect(ctx, x, y, cw, 2, "#e8eef6");
    rect(ctx, x + cw / 4, y - 1, cw / 2, 1, "#e8eef6");
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rand() * (w - 6));
    const y = Math.floor(h * (0.35 + rand() * 0.4));
    rect(ctx, x, y, 1, 1, "#1b2230");
    rect(ctx, x + 1, y + 1, 1, 1, "#1b2230");
    rect(ctx, x + 2, y, 1, 1, "#1b2230");
  }
  // Puffs of cloud hugging the underside of the island...
  for (let x = -4; x < w + 6; x += 6 + Math.floor(rand() * 6)) {
    const r = 3 + Math.floor(rand() * 5);
    const y = 7 + Math.floor(rand() * 6);
    disc(ctx, x, y + 1, r, "#c9d3e0");
    disc(ctx, x - 1, y, r - 1, "#f1f4f9");
  }
  // ...and the island itself: turf edge, then earth hanging in a ragged fringe with the odd root.
  rect(ctx, 0, 0, w, 1, "#2a5a32");
  rect(ctx, 0, 1, w, 3, "#5a4229");
  for (let x = 0; x < w; x++) {
    const hang = Math.floor(rand() * 4) + (Math.sin(x * 0.35) > 0.6 ? 2 : 0);
    rect(ctx, x, 4, 1, hang, "#4a3420");
    if (rand() > 0.94) rect(ctx, x, 4 + hang, 1, 2 + Math.floor(rand() * 3), "#6a5032");
  }
  for (let i = 0; i < w / 10; i++) rect(ctx, Math.floor(rand() * w), 1 + Math.floor(rand() * 3), 2, 1, "#6a6258");
  return c;
}

export function playCutscene(replay: Replay): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const { tier, points, fromLevel, toLevel } = replay;
  const promoted = toLevel > fromLevel;

  const stage = openStage(`cutscene--${tier}`, "Replay", "Replay");
  const { ctx, w, h, hud, root, bus } = stage;
  hud.innerHTML = `<p class="cutscene__title"></p><p class="cutscene__name"></p><p class="cutscene__points"></p>`;
  const [titleEl, nameEl, pointsEl] = [...hud.children] as HTMLElement[];
  titleEl.textContent = TITLES[tier];
  nameEl.textContent = replay.name ?? "Off the bar";
  const banner = document.createElement("p");
  banner.className = "cutscene__banner";
  banner.innerHTML = `<span>Promoted!</span> Up to <strong></strong>`;
  banner.querySelector("strong")!.textContent = LEVELS[toLevel].name;
  root.append(banner);
  stage.say(`${TITLES[tier]}. ${replay.name ?? "No answer"}, ${points} points.${promoted ? ` Promoted to ${LEVELS[toLevel].name}.` : ""}`);

  // Scene geometry, in art pixels.
  const share = h > w ? 0.46 : 0.52;
  const hz = Math.round(h * share);
  const gy = hz + Math.round((h - hz) * 0.45); // where feet touch the grass
  const goalX = w - Math.max(24, Math.round(w * 0.13));
  const barY = gy - 20;
  const ballStart = { x: Math.round(w * 0.47), y: gy - 5 };
  const runFrom = Math.round(w * 0.08);
  const keeperX = goalX - 11;
  const refX = Math.round(w * 0.3);
  const refFeet = gy - 8;

  // Penalty area, leaning with the pitch.
  const markings = (c: Ctx, g: Ground) => {
    const yard = (goalX - ballStart.x) / 16;
    const rowsPerYard = (h - hz - 3) / 68;
    const goalLine = goalX + 1;
    const vertical = (xAtGy: number, y0: number, y1: number) => {
      for (let y = Math.max(hz + 4, Math.round(y0)); y <= Math.min(h - 1, Math.round(y1)); y++) rect(c, g.lean(xAtGy, gy, y), y, 1, 1, LINE);
    };
    const across = (xFrom: number, xTo: number, y: number) => {
      const yy = Math.round(y);
      if (yy <= hz + 3 || yy >= h) return;
      const a = g.lean(xFrom, gy, yy);
      rect(c, a, yy, g.lean(xTo, gy, yy) - a, 1, LINE);
    };
    vertical(goalLine, hz + 4, h);
    for (const [deep, wide] of [
      [18, 22],
      [6, 10],
    ]) {
      const x = goalLine - deep * yard;
      vertical(x, gy - wide * rowsPerYard, gy + wide * rowsPerYard);
      across(x, goalLine, gy - wide * rowsPerYard);
      across(x, goalLine, gy + wide * rowsPerYard);
    }
    const spotX = goalLine - 12 * yard;
    rect(c, g.lean(spotX, gy, gy) - 1, gy, 2, 1, LINE);
    // the D
    const r = 10 * yard;
    const edge = goalLine - 18 * yard;
    for (let i = 0; i < r * 8; i++) {
      const a = (i / (r * 8)) * Math.PI * 2;
      const x = spotX + Math.cos(a) * r;
      if (x >= edge - 0.5) continue;
      const y = Math.round(gy + Math.sin(a) * 10 * rowsPerYard);
      rect(c, g.lean(x, gy, y), y, 1, 1, LINE);
    }
  };

  const ground = new Ground(fromLevel, w, h, share, { benches: [0.14, 0.3], markings });
  ground.screen = { top: "POINTS", bottom: String(replay.before) };
  const above = promoted ? new Ground(toLevel, w, h, share) : null;
  if (above) above.screen = { top: "POINTS", bottom: String(replay.before + points) };
  const sky = promoted ? ascent(w, Math.round(h * 0.7), ground.style.sky[0]) : null;

  const arrive = ARRIVE[tier];
  const end = arrive + (tier === "worldie" ? 2.2 : tier === "miss" ? 1.4 : 1.5);
  const total = end + (promoted ? CLIMB + 0.7 : 0);

  const particles = new Particles();
  const trail: V[] = [];
  let nextBurst = arrive + 0.05;
  let bursts = 0;

  const ballAt = (t: number): V => {
    if (t < RUN_END) return ballStart;
    if (tier === "tap") {
      const k = ease.outCubic(span(t, RUN_END, arrive + 0.25));
      return { x: lerp(ballStart.x, goalX + 7, k), y: ballStart.y };
    }
    if (tier === "curler") {
      if (t < arrive) return bezier(ballStart, { x: (ballStart.x + goalX) / 2, y: barY - 30 }, { x: goalX + 4, y: barY + 1 }, span(t, RUN_END, arrive));
      const k = ease.outCubic(span(t, arrive, arrive + 0.4));
      return { x: lerp(goalX + 4, goalX + 7, k), y: lerp(barY + 1, gy - 5, k) };
    }
    if (tier === "worldie") {
      const flick = { x: ballStart.x + 3, y: gy - 24 };
      if (t < 1.25) {
        const k = span(t, RUN_END, 1.25);
        return { x: lerp(ballStart.x, flick.x, k), y: lerp(ballStart.y, flick.y, ease.outCubic(k)) };
      }
      if (t < arrive) {
        const k = span(t, 1.3, arrive);
        return { x: lerp(flick.x, goalX + 3, k), y: lerp(flick.y, barY + 1, k) };
      }
      const k = ease.outCubic(span(t, arrive, arrive + 0.45));
      return { x: lerp(goalX + 3, goalX + 7, k), y: lerp(barY + 1, gy - 5, k) };
    }
    // miss: rattles the bar and flies back over everyone's head
    const corner = { x: goalX - 3, y: barY - 3 };
    if (t < arrive) return bezier(ballStart, { x: (ballStart.x + goalX) / 2, y: barY - 26 }, corner, span(t, RUN_END, arrive));
    const k = span(t, arrive, arrive + 0.9);
    return { x: lerp(corner.x, corner.x - w * 0.45, k), y: corner.y - Math.sin(k * Math.PI * 0.8) * 30 + k * k * 10 };
  };

  const drawGoal = (t: number, behind: boolean) => {
    if (behind) {
      // Side netting, bulging where the ball went in.
      const hit = tier !== "miss" && t >= arrive ? 1 - span(t, arrive, arrive + 0.55) : 0;
      const power = tier === "worldie" ? 4 : 2;
      const impactY = tier === "tap" ? gy - 3 : barY + 3;
      ctx.globalAlpha = 0.75;
      for (let y = barY + 1; y < gy; y += 2) {
        const push = Math.round(hit * power * Math.max(0, 1 - Math.abs(y - impactY) / 9));
        for (let x = goalX + 1 + ((y >> 1) & 1); x < goalX + 11; x += 2) rect(ctx, x + push, y, 1, 1, "#d8d6cc");
        rect(ctx, goalX + 11 + push, y, 1, 2, "#d8d6cc");
      }
      ctx.globalAlpha = 1;
      rect(ctx, goalX + 2, barY - 1, 10, 1, "#bdbab0");
      shadow(ctx, goalX + 7, gy + 1, 14, 0.25);
      return;
    }
    rect(ctx, goalX, barY - 2, 2, gy - barY + 2, COLORS.chalk);
    rect(ctx, goalX, barY - 2, 12, 2, COLORS.chalk);
    rect(ctx, goalX + 1, barY - 2, 1, gy - barY + 2, "#c9c6b8"); // post shading
    rect(ctx, goalX + 2, gy, 10, 1, "#d8d6cc");
    if (tier === "miss" && t > arrive && t < arrive + 0.18) {
      rect(ctx, goalX - 6, barY - 3, 13, 1, "#ffffff");
      rect(ctx, goalX, barY - 9, 1, 13, "#ffffff");
      rect(ctx, goalX - 3, barY - 6, 1, 1, COLORS.flood);
      rect(ctx, goalX + 3, barY - 6, 1, 1, COLORS.flood);
    }
  };

  const drawRef = (t: number) => {
    const pose = tier !== "miss" && t > arrive + 0.5 ? REF_SPRITES.point : REF_SPRITES.stand;
    shadow(ctx, refX + 4, refFeet, 8);
    actor(ctx, pose, refX, refFeet);
  };

  const drawKeeper = (t: number) => {
    const K = KEEPER_SPRITES;
    let img = K.stand;
    let x = keeperX;
    let lift = 0;
    if (tier === "tap" && t > 1.3) {
      img = K.slip;
      x = keeperX - 6;
    } else if (tier === "curler" && t > 1.4) {
      const k = span(t, 1.4, 2.1);
      if (k >= 1) [img, x] = [K.slip, keeperX - 8];
      else [img, x, lift] = [K.dive, keeperX - 4 - k * 6, Math.sin(Math.PI * k) * 16];
    } else if (tier === "worldie" && t > arrive - 0.05) {
      const k = span(t, arrive - 0.05, arrive + 0.5);
      if (k >= 1) [img, x] = [K.slip, keeperX - 8];
      else [img, x, lift] = [K.dive, keeperX - 4, Math.sin(Math.PI * k) * 8];
    } else if (tier === "miss" && t > 2) {
      lift = Math.round(Math.abs(Math.sin(t * 8))); // relieved little hop
    }
    shadow(ctx, x + img.width / 2 - 1, gy, Math.max(6, img.width - 4 - lift / 2));
    actor(ctx, img, x, gy - lift);
  };

  const drawPlayer = (t: number) => {
    const P = PLAYER;
    const stop = ballStart.x - 8;
    const at = (img: HTMLCanvasElement, x: number, lift = 0, mirror = false) => {
      shadow(ctx, x + img.width / 2 - 1, gy, Math.max(6, img.width - 4 - lift / 3));
      actor(ctx, img, x, gy - lift, mirror);
    };
    if (t < RUN_END) return at(P.run[Math.floor(t * 9) & 1], lerp(runFrom, stop, span(t, 0, RUN_END)));
    if (tier === "worldie") {
      if (t < 1.2) return at(P.kick, stop);
      if (t < 1.5) return at(BICYCLE, stop + 2, Math.sin(Math.PI * Math.min(1, span(t, 1.2, 1.5) * 1.4)) * 14);
      if (t < 2.0) return at(PLAYER_DOWN, stop - 2);
      const k = span(t, 2.0, end);
      const up = Math.floor(t * 8) & 1;
      return at(up ? P.armsUp : P.run[Math.floor(t * 9) & 1], lerp(stop + 2, runFrom, k), up ? 2 : 0, true);
    }
    if (t < RUN_END + 0.25) return at(P.kick, stop);
    if (tier === "miss") return at(t > arrive + 0.15 ? P.headInHands : P.stand, stop);
    if (t < arrive) return at(P.stand, stop);
    if (tier === "curler") {
      // knee slide towards the corner flag
      const x = stop + ease.outCubic(span(t, arrive, arrive + 0.9)) * 22;
      shadow(ctx, x + 4, gy, 12);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, gy - 3);
      ctx.clip();
      actor(ctx, P.armsUp, x, gy + 4);
      ctx.restore();
      rect(ctx, x + 1, gy - 2, 7, 1, "#0e1f14");
      return;
    }
    const jump = Math.floor(t * 4) & 1;
    return at(jump ? P.armsUp : P.stand, stop, jump * 2);
  };

  const drawBall = (t: number) => {
    const b = ballAt(t);
    const height = gy - 5 - b.y;
    if (b.x > -6 && b.x < w && height > -2) shadow(ctx, b.x + 2.5, gy, Math.max(2, 5 - Math.floor(height / 6)), Math.max(0.12, 0.35 - height / 120));
    if (tier === "worldie" && t > 1.3 && t < arrive + 0.05) {
      trail.push(b);
      if (trail.length > 7) trail.shift();
      trail.forEach((p, i) => rect(ctx, p.x + 1, p.y + 1, 3, 3, i > 4 ? "#ffffff" : COLORS.flood));
    } else if (tier === "curler" && t > RUN_END && t < arrive) {
      trail.push(b);
      if (trail.length > 5) trail.shift();
      ctx.globalAlpha = 0.5;
      trail.forEach((p) => rect(ctx, p.x + 2, p.y + 2, 1, 1, COLORS.chalk));
      ctx.globalAlpha = 1;
    }
    const spinning = t > RUN_END && (t < arrive + 0.3 || tier === "miss");
    ctx.drawImage(BALL[spinning ? Math.floor(t * 14) & 1 : 0], Math.round(b.x) - 1, Math.round(b.y) - 1);
  };

  const effects = (t: number, dt: number) => {
    if (tier === "worldie" && t > arrive && t < end && t >= nextBurst) {
      nextBurst = t + 0.22;
      particles.burst(w * (0.12 + Math.random() * 0.76), hz * (0.12 + Math.random() * 0.5));
      if (bursts++ % 2 === 0) sfx.firework(bus);
    }
    particles.draw(ctx, t, dt);
  };

  const world = (t: number, dt: number) => {
    const mood: Mood = t >= arrive ? MOODS[tier] : "idle";
    const shake = tier === "worldie" && t > arrive && t < arrive + 0.35 ? 2 : 0;
    ctx.save();
    if (shake) ctx.translate(Math.round((Math.random() - 0.5) * 2 * shake), Math.round((Math.random() - 0.5) * shake));
    ground.draw(ctx, t, mood);
    effects(t, dt);
    drawRef(t);
    drawGoal(t, true);
    drawKeeper(t);
    drawBall(t);
    drawGoal(t, false);
    drawPlayer(t);
    ctx.restore();
  };

  const frame = (t: number, dt: number) => {
    if (!sky || !above || t < end) world(t, dt);
    else {
      // Climb up through the sky to the next division.
      const travel = h + sky.height;
      const off = Math.round(ease.inOutCubic(span(t, end, end + CLIMB)) * travel);
      ctx.save();
      ctx.translate(0, off);
      world(t, dt);
      ctx.restore();
      ctx.drawImage(sky, 0, off - sky.height);
      ctx.save();
      ctx.translate(0, off - travel);
      above.draw(ctx, t, off >= travel ? "cheer" : "idle");
      ctx.restore();
    }
    if (t >= arrive) {
      const k = ease.outCubic(span(t, arrive, arrive + 0.7));
      pointsEl.textContent = tier === "miss" ? "0 pts" : `+${Math.round(points * k)} pts`;
    }
  };

  const goalCrowd: Record<Tier, () => void> = {
    miss: () => sfx.groan(bus),
    tap: () => {
      sfx.crowd("cheer", 2.2, bus);
      sfx.applause(2.4, 45, bus);
    },
    curler: () => {
      sfx.crowd("cheer", 2.6, bus);
      sfx.applause(2.8, 70, bus);
    },
    worldie: () => {
      sfx.crowd("roar", 3.2, bus);
      sfx.applause(3, 90, bus);
    },
  };

  const cues: Cue[] = [
    { at: 0, run: () => sfx.crowd("murmur", arrive + 0.3, bus) },
    { at: RUN_END, run: () => sfx.kick(tier === "worldie" ? 0.4 : tier === "tap" ? 0.6 : 0.9, bus) },
    {
      at: arrive,
      run: () => {
        root.classList.add("show-title");
        if (tier === "miss") {
          sfx.clang(bus);
          ground.screen = { top: "MISS", bottom: "0" };
        } else {
          sfx.net(bus);
          ground.screen = { top: "GOAL!", bottom: `+${points}`, blink: true };
        }
        goalCrowd[tier]();
        if (tier === "curler" || tier === "worldie") particles.confetti(Math.round(w * (tier === "worldie" ? 0.8 : 0.3)), w, h);
      },
    },
  ];
  if (tier === "worldie") cues.push({ at: 1.3, run: () => sfx.kick(1.1, bus) });
  if (promoted) {
    cues.push({ at: end, run: () => sfx.rise(bus) });
    cues.push({
      at: end + 0.35,
      run: () => {
        root.classList.add("show-banner");
        sfx.fanfare([523, 659, 784, 1047], 0.09, bus);
      },
    });
  }

  return stage.run(total, frame, cues);
}
