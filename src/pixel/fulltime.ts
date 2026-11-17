import { LEVELS, tierFor } from "../scoring";
import { sfx } from "../sound";
import { clamp01, ease, reducedMotion } from "./engine";
import { Particles } from "./effects";
import { Ground, type Mood } from "./ground";
import { actor, shadow } from "./cutscene";
import { KEEPER_SPRITES, PLAYER, REF_SPRITES } from "./sprites";
import { openStage, type Cue } from "./stage";

export interface FullTime {
  total: number;
  level: number;
  /** Each round's depth, null for a miss. */
  depths: (number | null)[];
}

const VERDICTS = [
  "Too famous. The deep bench is waiting.",
  "A decent start. Dig deeper tomorrow.",
  "Getting your boots dirty.",
  "Proper lower-league knowledge.",
  "Non-league nous.",
  "A groundhopper in the making.",
  "You know the tea hut by name.",
  "Grassroots scholar.",
  "Sunday league legend. Absolute anorak.",
];

const SQUARE_PITCH = { miss: 196, tap: 523, curler: 659, worldie: 880 };

const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** The final whistle: your total, the division you finished in, and a send-off to match. */
export function playFullTime({ total, level, depths }: FullTime): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  // How big a send-off: polite applause near the top, a party at the bottom.
  const band = level <= 1 ? 0 : level <= 4 ? 1 : 2;
  const mood: Mood = (["idle", "cheer", "wild"] as const)[band];

  const stage = openStage("cutscene--fulltime", "Full time", "Live");
  const { ctx, w, h, hud, root, bus } = stage;
  hud.innerHTML = `
    <p class="cutscene__title">Full time</p>
    <p class="cutscene__depth">0m</p>
    <p class="cutscene__level"></p>
    <p class="cutscene__verdict"></p>
    <p class="cutscene__squares" aria-hidden="true"></p>`;
  const depthEl = hud.querySelector(".cutscene__depth") as HTMLElement;
  (hud.querySelector(".cutscene__level") as HTMLElement).textContent = LEVELS[level].name;
  (hud.querySelector(".cutscene__verdict") as HTMLElement).textContent = VERDICTS[level];
  const squares = hud.querySelector(".cutscene__squares") as HTMLElement;
  const tiers = depths.map(tierFor);
  for (const tier of tiers) {
    const sq = document.createElement("span");
    sq.className = `sq sq--${tier}`;
    squares.append(sq);
  }
  stage.say(`Full time. ${total} metres: ${LEVELS[level].name}. ${VERDICTS[level]}`);

  const share = h > w ? 0.46 : 0.52;
  const ground = new Ground(level, w, h, share, { benches: [0.12, 0.84], centre: 0.5 });
  ground.screen = { top: "FT", bottom: `${total}M` };
  const hz = ground.horizon;
  const gy = hz + Math.round((h - hz) * 0.45);
  const refX = Math.round(w * 0.5) - 4;
  const strikerX = Math.round(w * 0.26);
  const keeperX = Math.round(w * 0.72);
  const particles = new Particles();

  const REVEAL = 2.4;
  const duration = 5.2 + (band === 2 ? 0.8 : 0);
  let nextBurst = REVEAL;

  const frame = (t: number, dt: number) => {
    ground.draw(ctx, t, t < REVEAL ? "idle" : mood);
    if (band === 2 && t > REVEAL && t >= nextBurst && t < duration - 0.6) {
      nextBurst = t + 0.3;
      particles.burst(w * (0.1 + Math.random() * 0.8), hz * (0.1 + Math.random() * 0.5));
      sfx.firework(bus);
    }
    particles.draw(ctx, t, dt);

    const whistling = t > 0.1 && t < 1.7;
    shadow(ctx, refX + 4, gy, 8);
    actor(ctx, whistling ? REF_SPRITES.whistle : REF_SPRITES.stand, refX, gy);

    shadow(ctx, keeperX + 4, gy, 8);
    actor(ctx, KEEPER_SPRITES.stand, keeperX, gy);

    // The striker: hands on hips near the top of the pyramid, a party further down.
    let img = PLAYER.stand;
    let x = strikerX;
    let lift = 0;
    let mirror = false;
    if (t > REVEAL && band >= 1) {
      const hop = Math.floor(t * (band === 2 ? 6 : 4)) & 1;
      img = hop ? PLAYER.armsUp : PLAYER.stand;
      lift = hop * 2;
      if (band === 2) {
        // a lap of honour, there and back
        const k = ease.inOutCubic(span(t, REVEAL, duration - 0.4));
        x = strikerX + Math.sin(k * Math.PI) * w * 0.14;
        mirror = k > 0.5;
        if (!hop) img = PLAYER.run[Math.floor(t * 9) & 1];
      }
    }
    shadow(ctx, x + 4, gy, 8);
    actor(ctx, img, x, gy - lift, mirror);

    if (t >= 0.9) depthEl.textContent = `${Math.round(total * ease.outCubic(span(t, 0.9, 2.2)))}m`;
  };

  const cues: Cue[] = [
    { at: 0, run: () => sfx.whistle([[0.15, 0.22], [0.48, 0.22], [0.82, 0.95]], bus) },
    { at: 0.35, run: () => root.classList.add("show-title") },
    { at: 0.9, run: () => root.classList.add("show-count") },
    {
      at: REVEAL,
      run: () => {
        root.classList.add("show-level");
        const notes = [
          [392, 523],
          [523, 659, 784],
          [523, 659, 784, 1047, 784, 1047],
        ][band];
        sfx.fanfare(notes, 0.11, bus);
        if (band === 0) sfx.applause(2.4, 30, bus);
        else {
          sfx.crowd(band === 2 ? "roar" : "cheer", 2.8, bus);
          sfx.applause(2.8, band === 2 ? 90 : 60, bus);
          particles.confetti(Math.round(w * (band === 2 ? 0.9 : 0.4)), w, h);
        }
      },
    },
  ];
  // The count ticks up...
  for (let i = 0; i < 12; i++) cues.push({ at: 0.9 + i * 0.11, run: () => sfx.blip(440 + i * 40, bus) });
  // ...then the day's squares drop in one by one.
  tiers.forEach((tier, i) =>
    cues.push({
      at: REVEAL + 0.35 + i * 0.14,
      run: () => {
        squares.children[i]?.classList.add("is-on");
        sfx.blip(SQUARE_PITCH[tier], bus);
      },
    }),
  );

  return stage.run(duration, frame, cues);
}
