/** Low-resolution canvas helpers. One art pixel is drawn as a block of `px` CSS pixels. */

export type Ctx = CanvasRenderingContext2D;

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Sizes `canvas` to cover cssW × cssH with whole art pixels. Returns the art resolution. */
export function fit(canvas: HTMLCanvasElement, cssW: number, cssH: number, px: number) {
  const w = Math.max(1, Math.ceil(cssW / px));
  const h = Math.max(1, Math.ceil(cssH / px));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${w * px}px`;
  canvas.style.height = `${h * px}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { w, h, ctx };
}

/** Deterministic PRNG (mulberry32), so a ground looks the same every time it is drawn. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Palette = Record<string, string>;

/** Renders a sprite drawn as strings; "." (or any unmapped char) is transparent. */
export function sprite(rows: string[], pal: Palette): HTMLCanvasElement {
  const w = Math.max(...rows.map((r) => r.length));
  const [c, ctx] = makeCanvas(w, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const col = pal[ch];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }),
  );
  return c;
}

/** Mirror (sx = -1) and/or flip (sy = -1) a sprite, or turn it a quarter (quarter = ±1). */
export function transform(src: HTMLCanvasElement, sx = 1, sy = 1, quarter = 0): HTMLCanvasElement {
  const turned = quarter !== 0;
  const [c, ctx] = makeCanvas(turned ? src.height : src.width, turned ? src.width : src.height);
  ctx.translate(c.width / 2, c.height / 2);
  if (turned) ctx.rotate((quarter * Math.PI) / 2);
  ctx.scale(sx, sy);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A filled pixel circle. */
export function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(Math.round(cx - dx), Math.round(cy + dy), dx * 2 + 1, 1);
  }
}

/** A checkerboard-filled circle: pixel-art glow without smooth gradients. */
export function ditherDisc(ctx: Ctx, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    for (let x = -dx + ((dy + dx) & 1); x <= dx; x += 2) ctx.fillRect(Math.round(cx + x), Math.round(cy + dy), 1, 1);
  }
}

/** Checkerboard row, used to dither between two bands of colour. */
export function ditherRow(ctx: Ctx, y: number, w: number, color: string, offset = 0) {
  ctx.fillStyle = color;
  for (let x = (y + offset) & 1; x < w; x += 2) ctx.fillRect(x, y, 1, 1);
}

/** Calls `frame(t)` at a fixed, slightly choppy rate. Returns a stop function. */
export function loop(fps: number, frame: (t: number) => void): () => void {
  let id = 0;
  let last = -Infinity;
  const start = performance.now();
  const step = (now: number) => {
    id = requestAnimationFrame(step);
    if (now - last < 1000 / fps - 2) return;
    last = now;
    frame((now - start) / 1000);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}

export const ease = {
  outCubic: (x: number) => 1 - (1 - x) ** 3,
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
