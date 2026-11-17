import { openBus, type Bus } from "../sound";
import { fit, loop, type Ctx } from "./engine";

const SKIP_GUARD_MS = 400;

/** Cutscenes play at 1 / PACE speed. Raise it to slow every scene down, lower it to speed them up. */
export const PACE = 1.35;

export interface Cue {
  at: number;
  run: () => void;
}

export interface Stage {
  root: HTMLElement;
  hud: HTMLElement;
  ctx: Ctx;
  w: number;
  h: number;
  bus: Bus | null;
  /** Announces the scene to screen readers. */
  say(text: string): void;
  /** Plays `frame` until `duration` seconds, firing cues on the way. Resolves when done or skipped. */
  run(duration: number, frame: (t: number, dt: number) => void, cues?: Cue[]): Promise<void>;
}

/** A full-screen pixel canvas over the page, with a HUD layer and skip handling. */
export function openStage(className: string, label: string, badge: string): Stage {
  const root = document.createElement("div");
  root.className = `cutscene ${className}`;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", label);
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const hud = document.createElement("div");
  hud.className = "cutscene__hud";
  const tag = document.createElement("p");
  tag.className = "cutscene__badge";
  tag.setAttribute("aria-hidden", "true");
  tag.textContent = badge;
  const skip = document.createElement("p");
  skip.className = "cutscene__skip";
  skip.textContent = matchMedia("(pointer: coarse)").matches ? "Tap to skip" : "Click or press any key to skip";
  const live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "assertive");
  root.append(canvas, hud, tag, skip, live);
  document.body.append(root);

  // ~180 art pixels across on desktop; phones get chunkier pixels so the players aren't tiny.
  const px = Math.max(3, Math.floor(Math.min(innerWidth / (innerWidth < 600 ? 96 : 180), innerHeight / 112)));
  const { w, h, ctx } = fit(canvas, innerWidth, innerHeight, px);
  const bus = openBus();

  return {
    root,
    hud,
    ctx,
    w,
    h,
    bus,
    say: (text) => (live.textContent = text),
    run(duration, frame, cues = []) {
      return new Promise((resolve) => {
        const pending = [...cues].sort((a, b) => a.at - b.at);
        const started = performance.now();
        let last = 0;
        let done = false;

        const stop = loop(30, (real) => {
          const t = real / PACE; // scene time: everything is scripted in these units
          const dt = Math.min(0.1, t - last);
          last = t;
          while (pending.length && pending[0].at <= t) pending.shift()!.run();
          frame(t, dt);
          if (t >= duration) finish();
        });
        const timer = window.setTimeout(finish, (duration * PACE + 1) * 1000); // if rAF is throttled

        function finish() {
          if (done) return;
          done = true;
          stop();
          clearTimeout(timer);
          removeEventListener("keydown", onKey, true);
          bus?.close();
          root.classList.add("is-leaving");
          setTimeout(() => {
            root.remove();
            resolve();
          }, 240);
        }
        function onKey(e: KeyboardEvent) {
          if (performance.now() - started < SKIP_GUARD_MS || e.key === "Tab") return;
          if ((e.target as Element | null)?.closest?.(".sound-toggle")) return;
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
        addEventListener("keydown", onKey, true);
        root.addEventListener("pointerdown", () => {
          if (performance.now() - started >= SKIP_GUARD_MS) finish();
        });
      });
    },
  };
}
