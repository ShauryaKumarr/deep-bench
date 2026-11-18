/**
 * Synthesised sound effects (Web Audio, no files). Muted until the player turns sound on;
 * the choice is remembered. Nothing is created until sound is on and the page has had a
 * click or key press, so browsers never block or warn about autoplay.
 */

const KEY = "deep-bench:sound";

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
})();

let ac: AudioContext | null = null;
let master: GainNode;
let noiseBuf: AudioBuffer;
const listeners = new Set<(on: boolean) => void>();

function context(): AudioContext | null {
  if (!enabled) return null;
  if (!ac) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.5;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    master.connect(comp).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") void ac.resume();
  return ac;
}

// Browsers only let audio start from a user gesture.
for (const type of ["pointerdown", "keydown"] as const) {
  addEventListener(type, () => enabled && context(), { capture: true, passive: true });
}

export function soundOn() {
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* not remembered, still works for this visit */
  }
  if (on) context();
  else void ac?.suspend();
  listeners.forEach((fn) => fn(on));
}

export function onSoundChange(fn: (on: boolean) => void) {
  listeners.add(fn);
}

/** A sub-mix for one cutscene, so skipping it can fade everything it started. */
export interface Bus {
  node: AudioNode;
  close(): void;
}

export function openBus(): Bus | null {
  const a = context();
  if (!a) return null;
  const g = a.createGain();
  g.connect(master);
  return {
    node: g,
    close() {
      const t = a.currentTime;
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + 0.25);
      setTimeout(() => g.disconnect(), 500);
    },
  };
}

// ---------------------------------------------------------------- primitives

type Point = [time: number, value: number];

/** Linear envelope through points (seconds after `at`). */
function shape(param: AudioParam, at: number, points: Point[]) {
  param.setValueAtTime(points[0][1], at + points[0][0]);
  for (const [t, v] of points.slice(1)) param.linearRampToValueAtTime(v, at + t);
}

interface NoiseOpts {
  dur: number;
  type: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  env: Point[];
  delay?: number;
}

function noise(a: AudioContext, out: AudioNode, o: NoiseOpts) {
  const at = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = o.type;
  f.frequency.setValueAtTime(o.freq, at);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, at + o.dur);
  f.Q.value = o.q ?? 1;
  const g = a.createGain();
  shape(g.gain, at, o.env);
  src.connect(f).connect(g).connect(out);
  src.start(at, Math.random() * 1.5);
  src.stop(at + o.dur + 0.05);
}

function tone(a: AudioContext, out: AudioNode, type: OscillatorType, freq: number, delay: number, dur: number, gain: number, freqEnd?: number) {
  const at = a.currentTime + delay;
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
  const g = a.createGain();
  shape(g.gain, at, [
    [0, 0],
    [0.005, gain],
    [dur * 0.7, gain * 0.7],
    [dur, 0],
  ]);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

function play(fn: (a: AudioContext, out: AudioNode) => void, bus?: Bus | null) {
  const a = context();
  if (a) fn(a, bus?.node ?? master);
}

// ------------------------------------------------------------------- effects

export const sfx = {
  /** A referee's pea whistle. Each blast is [start, length] in seconds. */
  whistle(blasts: [number, number][], bus?: Bus | null) {
    play((a, out) => {
      for (const [start, len] of blasts) {
        const at = a.currentTime + start;
        const g = a.createGain();
        shape(g.gain, at, [
          [0, 0],
          [0.02, 0.2],
          [len - 0.04, 0.17],
          [len, 0],
        ]);
        // The pea rattles: fast wobble in pitch and level.
        const trill = a.createOscillator();
        trill.frequency.value = 34 + Math.random() * 6;
        const depth = a.createGain();
        depth.gain.value = 140;
        trill.connect(depth);
        for (const [mult, level] of [
          [1, 1],
          [2, 0.18],
        ]) {
          const o = a.createOscillator();
          o.frequency.value = 2950 * mult;
          depth.connect(o.frequency);
          const og = a.createGain();
          og.gain.value = level;
          o.connect(og).connect(g);
          o.start(at);
          o.stop(at + len + 0.05);
        }
        const tremolo = a.createGain();
        tremolo.gain.value = 0.06;
        trill.connect(tremolo).connect(g.gain);
        trill.start(at);
        trill.stop(at + len + 0.05);
        g.connect(out);
        noise(a, out, { dur: len, type: "bandpass", freq: 3000, q: 3, env: [[0, 0], [0.02, 0.03], [len, 0]], delay: start });
      }
    }, bus);
  },

  kick(power = 1, bus?: Bus | null) {
    play((a, out) => {
      tone(a, out, "sine", 150, 0, 0.18, 0.75 * power, 45);
      noise(a, out, { dur: 0.04, type: "highpass", freq: 2200, env: [[0, 0.3 * power], [0.04, 0]] });
    }, bus);
  },

  /** The ball hitting the back of the net. */
  net(bus?: Bus | null) {
    play((a, out) => {
      noise(a, out, { dur: 0.45, type: "bandpass", freq: 900, freqEnd: 3400, q: 0.9, env: [[0, 0], [0.02, 0.4], [0.45, 0]] });
      noise(a, out, { dur: 0.3, type: "highpass", freq: 4500, env: [[0, 0], [0.03, 0.08], [0.3, 0]], delay: 0.05 });
    }, bus);
  },

  /** Off the bar. */
  clang(bus?: Bus | null) {
    play((a, out) => {
      [
        [620, 0.35, 1.1],
        [1580, 0.2, 0.7],
        [2470, 0.14, 0.5],
        [3760, 0.08, 0.35],
      ].forEach(([f, g, d]) => tone(a, out, "sine", f, 0, d, g));
      noise(a, out, { dur: 0.05, type: "highpass", freq: 3000, env: [[0, 0.25], [0.05, 0]] });
    }, bus);
  },

  /** Crowd noise: a murmur, a cheer or a roar. */
  crowd(level: "murmur" | "cheer" | "roar", dur: number, bus?: Bus | null) {
    play((a, out) => {
      const peak = level === "roar" ? 0.34 : level === "cheer" ? 0.22 : 0.05;
      const attack = level === "murmur" ? 0.6 : level === "roar" ? 0.12 : 0.25;
      const env: Point[] = [
        [0, 0],
        [attack, peak],
        [Math.max(attack + 0.05, dur - 0.9), peak * 0.8],
        [dur, 0],
      ];
      noise(a, out, { dur, type: "lowpass", freq: 750, q: 0.7, env });
      noise(a, out, { dur, type: "bandpass", freq: 1500, q: 0.6, env: env.map(([t, v]) => [t, v * 0.5]) });
      if (level !== "murmur") {
        // individual shouts poking out of the roar
        for (let i = 0; i < (level === "roar" ? 10 : 5); i++) {
          const f = 300 + Math.random() * 500;
          tone(a, out, "sawtooth", f, 0.1 + Math.random() * dur * 0.6, 0.3 + Math.random() * 0.3, 0.012, f * (1.1 + Math.random() * 0.3));
        }
      }
    }, bus);
  },

  /** Clapping: lots of tiny noise bursts. */
  applause(dur: number, perSecond: number, bus?: Bus | null) {
    play((a, out) => {
      const n = Math.round(dur * perSecond);
      for (let i = 0; i < n; i++) {
        const delay = dur * Math.random() ** 1.4;
        const len = 0.025 + Math.random() * 0.03;
        noise(a, out, {
          dur: len,
          type: "bandpass",
          freq: 1100 + Math.random() * 1600,
          q: 1.4,
          env: [[0, 0.06 + Math.random() * 0.06], [len, 0]],
          delay,
        });
      }
    }, bus);
  },

  /** "Ooooh." */
  groan(bus?: Bus | null) {
    play((a, out) => {
      const lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 650;
      const g = a.createGain();
      const at = a.currentTime;
      shape(g.gain, at, [
        [0, 0],
        [0.35, 0.05],
        [0.9, 0.045],
        [1.7, 0],
      ]);
      lp.connect(g).connect(out);
      for (let i = 0; i < 8; i++) {
        const o = a.createOscillator();
        o.type = "sawtooth";
        const f = 140 + i * 16 + Math.random() * 12;
        o.frequency.setValueAtTime(f * 1.04, at);
        o.frequency.linearRampToValueAtTime(f * 1.08, at + 0.35);
        o.frequency.exponentialRampToValueAtTime(f * 0.78, at + 1.6);
        o.connect(lp);
        o.start(at);
        o.stop(at + 1.75);
      }
      noise(a, out, { dur: 1.6, type: "lowpass", freq: 500, env: [[0, 0], [0.35, 0.12], [1.6, 0]] });
    }, bus);
  },

  firework(bus?: Bus | null) {
    play((a, out) => {
      noise(a, out, { dur: 0.14, type: "lowpass", freq: 900, env: [[0, 0.5], [0.14, 0]] });
      for (let i = 0; i < 7; i++) {
        noise(a, out, { dur: 0.02, type: "highpass", freq: 3000, env: [[0, 0.1], [0.02, 0]], delay: 0.15 + Math.random() * 0.6 });
      }
    }, bus);
  },

  /** Promotion: a rising whoosh and a climbing arpeggio. */
  rise(bus?: Bus | null) {
    play((a, out) => {
      noise(a, out, { dur: 1.9, type: "bandpass", freq: 260, freqEnd: 2600, q: 1.2, env: [[0, 0], [0.4, 0.3], [1.5, 0.25], [1.9, 0]] });
      [262, 330, 392, 440, 523, 587, 659].forEach((f, i) => tone(a, out, "square", f, i * 0.12, 0.1, 0.045));
    }, bus);
  },

  /** A short 8-bit fanfare. `notes` are frequencies. */
  fanfare(notes: number[], step = 0.1, bus?: Bus | null) {
    play((a, out) => {
      notes.forEach((f, i) => {
        tone(a, out, "square", f, i * step, step * (i === notes.length - 1 ? 3 : 0.9), 0.05);
        tone(a, out, "triangle", f / 2, i * step, step * (i === notes.length - 1 ? 3 : 0.9), 0.08);
      });
    }, bus);
  },

  blip(freq = 880, bus?: Bus | null) {
    play((a, out) => tone(a, out, "square", freq, 0, 0.06, 0.05), bus);
  },

  /** A wrong guess. */
  bonk() {
    play((a, out) => {
      tone(a, out, "square", 196, 0, 0.08, 0.05);
      tone(a, out, "square", 147, 0.08, 0.12, 0.05);
    });
  },

  /** The clock in its last seconds. */
  tick(urgent: boolean) {
    play((a, out) => tone(a, out, "sine", urgent ? 1500 : 1100, 0, 0.04, 0.07));
  },
};
