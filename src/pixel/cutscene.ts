import { LEVELS, type Tier } from "../scoring";
import { clamp01, ease, fit, loop, makeCanvas, rect, reducedMotion, rng, type Ctx } from "./engine";
import { Ground, type Mood } from "./ground";
import { BALL, BICYCLE, COLORS, KEEPER_SPRITES, PLAYER, PLAYER_DOWN } from "./sprites";

export interface Replay {
  tier: Tier;
  depth: number;
  name: string | null;
  fromLevel: number;
  toLevel: number;
}

const TITLES: Record<Tier, string> = {
  miss: "Time’s up",
  tap: "Tap-in",
  curler: "Curler",
  worldie: "Worldie!",
};
const SUBTITLES: Record<Tier, string> = {
  miss: "Off the bar",
  tap: "Every little helps",
  curler: "Into the top corner",
  worldie: "Nobody saw that coming",
};
const MOODS: Record<Tier, Mood> = { miss: "groan", tap: "cheer", curler: "cheer", worldie: "wild" };

/** When the ball reaches the goal (or the bar), per tier. */
const ARRIVE: Record<Tier, number> = { miss: 1.45, tap: 2.0, curler: 1.75, worldie: 1.6 };
const RUN_END = 0.9;
const DESCENT = 1.5;
const SKIP_GUARD = 0.4;

type V = { x: number; y: number };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const bezier = (p0: V, p1: V, p2: V, k: number): V => ({
  x: (1 - k) ** 2 * p0.x + 2 * (1 - k) * k * p1.x + k * k * p2.x,
  y: (1 - k) ** 2 * p0.y + 2 * (1 - k) * k * p1.y + k * k * p2.y,
});
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

function blit(ctx: Ctx, img: HTMLCanvasElement, x: number, y: number, mirror = false) {
  if (!mirror) return ctx.drawImage(img, Math.round(x), Math.round(y));
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(img, -Math.round(x) - img.width, Math.round(y));
  ctx.restore();
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  confetti?: boolean;
}

function soil(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const rand = rng(99);
  const layers = ["#3a2a1c", "#33241a", "#2b1f16", "#241a13", "#1d150f", "#16100b"];
  layers.forEach((col, i) => rect(ctx, 0, Math.floor((i * h) / layers.length), w, Math.ceil(h / layers.length) + 1, col));
  for (let i = 0; i < (w * h) / 30; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    rect(ctx, x, y, 1 + Math.floor(rand() * 2), 1, rand() > 0.5 ? "#4a3826" : "#120c08");
  }
  for (let i = 0; i < w / 12; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    rect(ctx, x, y, 3, 2, "#6a6258");
    rect(ctx, x, y, 2, 1, "#8a8278");
  }
  return c;
}

export function playCutscene(replay: Replay): Promise<void> {
  if (reducedMotion()) return Promise.resolve();

  return new Promise((resolve) => {
    const { tier, depth, fromLevel, toLevel } = replay;
    const descends = toLevel > fromLevel;

    const root = document.createElement("div");
    root.className = `cutscene cutscene--${tier}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Replay");
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const hud = document.createElement("div");
    hud.className = "cutscene__hud";
    hud.innerHTML = `<p class="cutscene__title"></p><p class="cutscene__name"></p><p class="cutscene__depth"></p>`;
    const [titleEl, nameEl, depthEl] = [...hud.children] as HTMLElement[];
    titleEl.textContent = TITLES[tier];
    nameEl.textContent = replay.name ?? SUBTITLES.miss;
    const banner = document.createElement("p");
    banner.className = "cutscene__banner";
    banner.innerHTML = `<span>Relegated!</span> Down to <strong></strong>`;
    banner.querySelector("strong")!.textContent = LEVELS[toLevel].name;
    const skip = document.createElement("p");
    skip.className = "cutscene__skip";
    skip.textContent = "Tap or press any key to skip";
    const live = document.createElement("p");
    live.className = "visually-hidden";
    live.setAttribute("aria-live", "assertive");
    root.append(canvas, hud, banner, skip, live);
    document.body.append(root);
    live.textContent = `${TITLES[tier]}. ${replay.name ?? "No answer"}, ${depth} metres.${
      descends ? ` Down to ${LEVELS[toLevel].name}.` : ""
    }`;

    // Scene geometry, in art pixels.
    // Aim for ~180 art pixels across on desktop; phones get chunkier pixels so the players aren't tiny.
    const px = Math.max(3, Math.floor(Math.min(innerWidth / (innerWidth < 600 ? 96 : 180), innerHeight / 112)));
    const { w, h, ctx } = fit(canvas, innerWidth, innerHeight, px);
    const share = h > w ? 0.46 : 0.52;
    const ground = new Ground(fromLevel, w, h, share);
    const below = descends ? new Ground(toLevel, w, h, share) : null;
    const dirt = descends ? soil(w, Math.round(h * 0.6)) : null;
    const hz = ground.horizon;
    const gy = hz + Math.round((h - hz) * 0.45); // where feet touch the grass
    const goalX = w - Math.max(24, Math.round(w * 0.13));
    const barY = gy - 20;
    const ballStart = { x: Math.round(w * 0.47), y: gy - 5 };
    const runFrom = Math.round(w * 0.08);
    const keeperX = goalX - 11;

    const arrive = ARRIVE[tier];
    const celebrate = tier === "worldie" ? 2.2 : tier === "miss" ? 1.4 : 1.5;
    const end = arrive + celebrate;
    const total = end + (descends ? DESCENT + 0.7 : 0);

    const particles: Particle[] = [];
    const rand = Math.random;
    let lastT = 0;
    let nextBurst = arrive + 0.05;
    const shown = { title: false, banner: false };
    const trail: V[] = [];

    const ballAt = (t: number): V => {
      if (t < RUN_END) return ballStart;
      if (tier === "tap") {
        const k = ease.outCubic(span(t, RUN_END, arrive + 0.25));
        return { x: lerp(ballStart.x, goalX + 7, k), y: ballStart.y };
      }
      if (tier === "curler") {
        if (t < arrive) {
          return bezier(ballStart, { x: (ballStart.x + goalX) / 2, y: barY - 30 }, { x: goalX + 4, y: barY + 1 }, span(t, RUN_END, arrive));
        }
        const k = ease.outCubic(span(t, arrive, arrive + 0.4));
        return { x: lerp(goalX + 4, goalX + 7, k), y: lerp(barY + 1, gy - 5, k) };
      }
      if (tier === "worldie") {
        const flick = { x: ballStart.x + 3, y: gy - 24 };
        if (t < 1.25) return { x: lerp(ballStart.x, flick.x, span(t, RUN_END, 1.25)), y: lerp(ballStart.y, flick.y, ease.outCubic(span(t, RUN_END, 1.25))) };
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
        return;
      }
      rect(ctx, goalX, barY - 2, 2, gy - barY + 2, COLORS.chalk);
      rect(ctx, goalX, barY - 2, 12, 2, COLORS.chalk);
      rect(ctx, goalX + 2, gy, 10, 1, "#d8d6cc");
      if (tier === "miss" && t > arrive && t < arrive + 0.18) {
        // the clang
        rect(ctx, goalX - 6, barY - 3, 13, 1, "#ffffff");
        rect(ctx, goalX, barY - 9, 1, 13, "#ffffff");
        rect(ctx, goalX - 3, barY - 6, 1, 1, COLORS.flood);
        rect(ctx, goalX + 3, barY - 6, 1, 1, COLORS.flood);
      }
    };

    const drawKeeper = (t: number) => {
      const K = KEEPER_SPRITES;
      if (tier === "tap" && t > 1.3) return blit(ctx, K.slip, keeperX - 6, gy - K.slip.height);
      if (tier === "curler" && t > 1.4) {
        const up = Math.sin(Math.PI * span(t, 1.4, 2.1));
        const k = span(t, 1.4, 2.1);
        if (k >= 1) return blit(ctx, K.slip, keeperX - 8, gy - K.slip.height);
        return blit(ctx, K.dive, keeperX - 4 - k * 6, gy - K.dive.height - up * 16);
      }
      if (tier === "worldie" && t > arrive - 0.05) {
        const k = span(t, arrive - 0.05, arrive + 0.5);
        if (k >= 1) return blit(ctx, K.slip, keeperX - 8, gy - K.slip.height);
        return blit(ctx, K.dive, keeperX - 4, gy - K.dive.height - Math.sin(Math.PI * k) * 8);
      }
      blit(ctx, K.stand, keeperX, gy - 14 - (t > 2 && tier === "miss" ? Math.round(Math.abs(Math.sin(t * 8))) : 0));
    };

    const drawPlayer = (t: number) => {
      const P = PLAYER;
      const stop = ballStart.x - 8;
      if (t < RUN_END) {
        const x = lerp(runFrom, stop, span(t, 0, RUN_END));
        return blit(ctx, P.run[Math.floor(t * 9) & 1], x, gy - 14);
      }
      if (tier === "worldie") {
        if (t < 1.2) return blit(ctx, P.kick, stop, gy - 14);
        if (t < 1.5) {
          const k = span(t, 1.2, 1.5);
          return blit(ctx, BICYCLE, stop + 2, gy - 14 - Math.sin(Math.PI * Math.min(1, k * 1.4)) * 14);
        }
        if (t < 2.0) return blit(ctx, PLAYER_DOWN, stop - 2, gy - PLAYER_DOWN.height);
        const k = span(t, 2.0, end);
        const frame = Math.floor(t * 8) & 1 ? P.armsUp : P.run[Math.floor(t * 9) & 1];
        return blit(ctx, frame, lerp(stop + 2, runFrom, k), gy - 14 - (frame === P.armsUp ? 2 : 0), true);
      }
      if (t < RUN_END + 0.25) return blit(ctx, P.kick, stop, gy - 14);
      if (tier === "miss") return blit(ctx, t > arrive + 0.15 ? P.headInHands : P.stand, stop, gy - 14);
      if (t < arrive) return blit(ctx, P.stand, stop, gy - 14);
      if (tier === "curler") {
        // knee slide towards the corner flag
        const k = ease.outCubic(span(t, arrive, arrive + 0.9));
        const x = stop + k * 22;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w, gy - 4);
        ctx.clip();
        blit(ctx, P.armsUp, x, gy - 14 + 4);
        ctx.restore();
        rect(ctx, x + 1, gy - 1, 7, 1, "#0e1f14");
        return;
      }
      const jump = Math.floor(t * 4) & 1;
      return blit(ctx, jump ? P.armsUp : P.stand, stop, gy - 14 - jump * 2);
    };

    const drawBall = (t: number) => {
      const b = ballAt(t);
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
      blit(ctx, BALL[spinning ? Math.floor(t * 14) & 1 : 0], b.x, b.y);
    };

    const fireworks = (t: number, dt: number) => {
      if (tier === "worldie" && t > arrive && t < end && t >= nextBurst) {
        nextBurst = t + 0.22;
        const cx = w * (0.12 + rand() * 0.76);
        const cy = hz * (0.12 + rand() * 0.5);
        const color = [COLORS.flood, COLORS.red, COLORS.chalk, COLORS.cyan, COLORS.pink][Math.floor(rand() * 5)];
        for (let i = 0; i < 26; i++) {
          const a = (i / 26) * Math.PI * 2;
          const v = 18 + rand() * 18;
          particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9 + rand() * 0.3, color });
        }
      }
      if ((tier === "worldie" || tier === "curler") && t > arrive && t < arrive + 0.1 && !particles.some((p) => p.confetti)) {
        const n = tier === "worldie" ? Math.round(w * 0.8) : Math.round(w * 0.3);
        for (let i = 0; i < n; i++)
          particles.push({
            x: rand() * w,
            y: -rand() * h * 0.6,
            vx: (rand() - 0.5) * 8,
            vy: 18 + rand() * 20,
            life: 4,
            color: [COLORS.flood, COLORS.red, COLORS.chalk, COLORS.cyan][Math.floor(rand() * 4)],
            confetti: true,
          });
      }
      for (const p of particles) {
        p.life -= dt;
        if (p.confetti) {
          p.x += (p.vx + Math.sin(t * 6 + p.y) * 6) * dt;
          p.y += p.vy * dt;
          rect(ctx, p.x, p.y, (Math.floor(t * 8 + p.x) & 1) + 1, 1, p.color);
        } else {
          p.vy += 22 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.life > 0) rect(ctx, p.x, p.y, 1, 1, p.life < 0.3 ? "#9a9a9a" : p.color);
        }
      }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    };

    const world = (t: number, dt: number) => {
      const mood: Mood = t >= arrive ? MOODS[tier] : "idle";
      const shake = tier === "worldie" && t > arrive && t < arrive + 0.35 ? 2 : 0;
      ctx.save();
      if (shake) ctx.translate(Math.round((rand() - 0.5) * 2 * shake), Math.round((rand() - 0.5) * shake));
      ground.draw(ctx, t, mood);
      fireworks(t, dt);
      drawGoal(t, true);
      drawKeeper(t);
      drawBall(t);
      drawGoal(t, false);
      drawPlayer(t);
      ctx.restore();
    };

    const frame = (t: number) => {
      const dt = Math.min(0.1, t - lastT);
      lastT = t;

      if (!descends || t < end) world(t, dt);
      else {
        // Dig down through the turf to the next division.
        const d = dirt!;
        const travel = h + d.height;
        const k = ease.inOutCubic(span(t, end, end + DESCENT));
        const off = Math.round(k * travel);
        ctx.save();
        ctx.translate(0, -off);
        world(t, dt);
        ctx.restore();
        ctx.drawImage(d, 0, h - off);
        ctx.save();
        ctx.translate(0, h + d.height - off);
        below!.draw(ctx, t, k >= 1 ? "cheer" : "idle");
        ctx.restore();
        if (!shown.banner && t > end + 0.35) {
          shown.banner = true;
          root.classList.add("show-banner");
        }
      }

      if (!shown.title && t >= arrive) {
        shown.title = true;
        root.classList.add("show-title");
      }
      if (t >= arrive) {
        const k = ease.outCubic(span(t, arrive, arrive + 0.7));
        depthEl.textContent = tier === "miss" ? "0m" : `+${Math.round(depth * k)}m`;
      }
      if (t >= total) finish();
    };

    let done = false;
    const started = performance.now();
    const stop = loop(30, frame);
    const timer = window.setTimeout(() => finish(), (total + 1) * 1000); // in case rAF is throttled

    function finish() {
      if (done) return;
      done = true;
      stop();
      clearTimeout(timer);
      removeEventListener("keydown", onKey, true);
      root.classList.add("is-leaving");
      setTimeout(() => {
        root.remove();
        resolve();
      }, 180);
    }
    function onKey(e: KeyboardEvent) {
      if (performance.now() - started < SKIP_GUARD * 1000) return;
      if (e.key === "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
    addEventListener("keydown", onKey, true);
    root.addEventListener("pointerdown", () => {
      if (performance.now() - started >= SKIP_GUARD * 1000) finish();
    });
  });
}
