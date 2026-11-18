import { fit, loop, reducedMotion } from "./engine";
import { Ground, type Mood } from "./ground";

export const backdropPixel = () => (innerWidth >= 1100 ? 5 : innerWidth >= 760 ? 4 : 3);

/** The ground behind the page. It gets bigger as you climb the pyramid. */
export function createBackdrop(canvas: HTMLCanvasElement) {
  let level = 0;
  let total = 0;
  let mood: Mood = "idle";
  let ground: Ground | null = null;
  let ctx: CanvasRenderingContext2D;
  let stop: (() => void) | null = null;

  const build = () => {
    const box = canvas.parentElement!.getBoundingClientRect();
    const size = fit(canvas, box.width, box.height, backdropPixel());
    ctx = size.ctx;
    ground = new Ground(level, size.w, size.h, 0.56);
    label();
  };

  const label = () => {
    if (ground) ground.screen = { top: "POINTS", bottom: String(total) };
  };

  const frame = (t: number) => ground?.draw(ctx, t, mood);

  const run = () => {
    stop?.();
    stop = null;
    if (reducedMotion() || document.hidden) frame(0);
    else stop = loop(10, frame);
  };

  new ResizeObserver(() => {
    build();
    run();
  }).observe(canvas.parentElement!);
  document.addEventListener("visibilitychange", run);

  return {
    set(nextLevel: number, nextTotal: number, nextMood: Mood = mood) {
      mood = nextMood;
      total = nextTotal;
      if (nextLevel !== level || !ground) {
        level = nextLevel;
        build();
      } else label();
      run();
    },
  };
}
