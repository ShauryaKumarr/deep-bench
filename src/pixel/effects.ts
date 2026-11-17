import { rect, type Ctx } from "./engine";
import { COLORS } from "./sprites";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  confetti: boolean;
}

const BURST = [COLORS.flood, COLORS.red, COLORS.chalk, COLORS.cyan, COLORS.pink];
const PAPER = [COLORS.flood, COLORS.red, COLORS.chalk, COLORS.cyan];

/** Fireworks and confetti. */
export class Particles {
  private list: Particle[] = [];

  burst(x: number, y: number) {
    const color = BURST[Math.floor(Math.random() * BURST.length)];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const v = 18 + Math.random() * 18;
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9 + Math.random() * 0.3, color, confetti: false });
    }
  }

  confetti(n: number, w: number, h: number) {
    for (let i = 0; i < n; i++)
      this.list.push({
        x: Math.random() * w,
        y: -Math.random() * h * 0.6,
        vx: (Math.random() - 0.5) * 8,
        vy: 18 + Math.random() * 20,
        life: 5,
        color: PAPER[Math.floor(Math.random() * PAPER.length)],
        confetti: true,
      });
  }

  draw(ctx: Ctx, t: number, dt: number) {
    for (const p of this.list) {
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
    this.list = this.list.filter((p) => p.life > 0);
  }
}
