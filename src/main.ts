import "@fontsource/jersey-10/400";
import "@fontsource/vt323/400";
import "./style.css";

import { attachAutocomplete } from "./autocomplete";
import { loadDay, loadPlayers, todayKey, type Day, type Player } from "./data";
import { createBackdrop } from "./pixel/backdrop";
import { playCutscene } from "./pixel/cutscene";
import { playFullTime } from "./pixel/fulltime";
import type { Mood } from "./pixel/ground";
import { createPyramid } from "./pyramid";
import {
  MAX_TOTAL,
  ROUNDS,
  ROUND_SECONDS,
  TIER_LABEL,
  depthFor,
  levelFor,
  levelIndex,
  square,
  tierFor,
  type Tier,
} from "./scoring";
import { onSoundChange, setSound, sfx, soundOn } from "./sound";
import * as store from "./storage";

const FIRST_DAY = "2026-11-17";

const screen = document.getElementById("screen")!;
const dayline = document.getElementById("dayline")!;
const pyramid = createPyramid(document.getElementById("pyramid")!);
const backdrop = createBackdrop(document.getElementById("backdrop") as HTMLCanvasElement);

let players: Player[] = [];
let day: Day;
let date = todayKey();

// ---------------------------------------------------------------------------
// Tiny DOM helper. Strings become text nodes, so player names are never parsed as HTML.

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

function show(name: string, ...children: Child[]) {
  document.body.dataset.screen = name;
  screen.replaceChildren(...children.filter((c): c is Node | string => !!c));
  scrollTo(0, 0);
}

const panel = (...children: Child[]) => h("div", { class: "panel" }, ...children);
const chip = (tier: Tier, text: string = TIER_LABEL[tier]) => h("span", { class: `chip chip--${tier}` }, text);

const state = () => store.getDay(date);
const metres = (n: number) => `${n}m`;
const dayNumber = () =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${FIRST_DAY}T12:00:00Z`)) / 86_400_000) + 1;

const MOOD_AFTER: Record<Tier, Mood> = { miss: "groan", tap: "cheer", curler: "cheer", worldie: "wild" };

function settle(mood: Mood = "idle") {
  const total = store.total(state());
  pyramid.set(total);
  backdrop.set(levelIndex(total), total, mood);
}

// Sound toggle: off until the player asks for it.
const soundButton = document.getElementById("sound") as HTMLButtonElement;
const soundLabel = soundButton.querySelector(".sound-toggle__label")!;
const showSound = (on: boolean) => {
  soundButton.setAttribute("aria-pressed", String(on));
  soundButton.classList.toggle("is-on", on);
  soundLabel.textContent = on ? "Sound on" : "Sound off";
};
showSound(soundOn());
onSoundChange(showSound);
soundButton.addEventListener("click", () => {
  setSound(!soundOn());
  if (soundOn()) sfx.fanfare([523, 784], 0.08);
});
// A little blip on every button press.
screen.addEventListener("click", (e) => {
  if ((e.target as Element).closest(".btn")) sfx.blip(988);
});

function grid(): string {
  return Array.from({ length: ROUNDS }, (_, i) => {
    const r = state().rounds[i];
    return r ? square(r.depth) : "▫️";
  }).join("");
}

// ---------------------------------------------------------------------------
// Screens

function intro(forfeited: number | null) {
  const done = state().rounds.filter(Boolean).length;
  const button = h("button", { class: "btn btn--big", type: "button" }, done ? `Continue: round ${done + 1} ▶` : "Kick off ▶");
  button.addEventListener("click", () => playRound(done));

  show(
    "intro",
    forfeited !== null &&
      h("p", { class: "notice" }, `Round ${forfeited + 1} counted as a miss: the page was left while the clock was running.`),
    panel(
      h("h2", { class: "title" }, done ? "Back on the pitch" : "Today’s team sheet"),
      done
        ? h("p", { class: "grid", "aria-label": `${done} of ${ROUNDS} rounds played` }, grid())
        : h(
            "ol",
            { class: "rules" },
            h("li", {}, `${ROUNDS} prompts, ${ROUND_SECONDS} seconds each.`),
            h("li", {}, "Name any player who fits. Wrong guesses cost nothing, so keep going until the clock runs out."),
            h("li", {}, "The more obscure your answer, the deeper you sink: 10m for the best known, 100m for the least."),
            h("li", {}, `Dig as deep as ${MAX_TOTAL}m, from the Premier League to Sunday league.`),
          ),
      h(
        "p",
        { class: "chips", "aria-label": "Scoring" },
        chip("tap", "Tap-in · under 60m"),
        chip("curler", "Curler · 60–84m"),
        chip("worldie", "Worldie · 85m+"),
        chip("miss", "Miss · 0m"),
      ),
      h("p", { class: "small" }, "Leaving the page mid-round counts that round as a miss."),
    ),
    button,
  );
  button.focus({ preventScroll: true });
}

function playRound(i: number) {
  const prompt = day.prompts[i];
  const answers = new Set(prompt.answers);
  // Same-named players (there are eight Júlio Césars) all count for the valid one.
  const byName = new Map<string, number>();
  for (const a of prompt.answers) if (!byName.has(players[a].key)) byName.set(players[a].key, a);

  store.startRound(date, i);
  settle();

  const digits = h("span", { class: "board__digits" }, String(ROUND_SECONDS));
  const board = h(
    "div",
    { class: "board", role: "timer", "aria-label": `${ROUND_SECONDS} seconds left` },
    h("span", { class: "board__plus", "aria-hidden": "true" }, "+"),
    digits,
  );
  const input = h("input", {
    class: "guess__input",
    id: "guess",
    type: "text",
    role: "combobox",
    autocomplete: "off",
    autocapitalize: "words",
    spellcheck: "false",
    "aria-autocomplete": "list",
    "aria-controls": "options",
    "aria-expanded": "false",
    "aria-describedby": "prompt",
    placeholder: "Start typing a player…",
  });
  const listbox = h("ul", { class: "options", id: "options", role: "listbox", "aria-label": "Players" });
  listbox.hidden = true;
  const wrong = h("ul", { class: "wrong", "aria-label": "Wrong guesses" });
  const status = h("p", { class: "visually-hidden", "aria-live": "assertive" });

  show(
    "round",
    panel(
      h(
        "div",
        { class: "round__head" },
        h(
          "div",
          {},
          h("p", { class: "eyebrow" }, `Round ${i + 1} of ${ROUNDS}`),
          h("p", { class: "pips", "aria-hidden": "true" }, grid()),
        ),
        h("div", { class: "board-wrap" }, board, h("span", { class: "board__handle", "aria-hidden": "true" })),
      ),
      h("h2", { class: "prompt", id: "prompt" }, prompt.text),
      h("div", { class: "guess" }, h("label", { class: "visually-hidden", for: "guess" }, "Your answer"), input, listbox),
      wrong,
    ),
    status,
  );
  input.focus({ preventScroll: true });
  input.addEventListener("input", () => input.classList.remove("is-wrong"));

  const guessed = new Set<number>();
  const deadline = performance.now() + ROUND_SECONDS * 1000;
  let finished = false;
  let lastShown = ROUND_SECONDS;

  const finish = async (pick: number | null) => {
    if (finished) return;
    finished = true;
    clearInterval(tick);
    ac.close();
    input.disabled = true;
    input.blur(); // drop the on-screen keyboard before the replay

    const before = store.total(state());
    const depth = pick === null ? null : depthFor(prompt.answers.indexOf(pick), prompt.answers.length);
    store.finishRound(date, i, { pick, depth });
    const after = store.total(state());

    const tier = tierFor(depth);
    await playCutscene({
      tier,
      depth: depth ?? 0,
      name: pick === null ? null : players[pick].name,
      before,
      fromLevel: levelIndex(before),
      toLevel: levelIndex(after),
    });
    settle(MOOD_AFTER[tier]);
    reveal(i);
  };

  const tick = window.setInterval(() => {
    const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    if (left !== lastShown) {
      lastShown = left;
      digits.textContent = String(left);
      board.setAttribute("aria-label", `${left} seconds left`);
      board.classList.toggle("is-low", left <= 5);
      if (left === 10 || left === 5) status.textContent = `${left} seconds left`;
      if (left > 0 && left <= 5) sfx.tick(left <= 3);
    }
    if (left === 0) finish(null);
  }, 100);

  const ac = attachAutocomplete(input, listbox, players, (index) => {
    if (finished) return;
    const hit = answers.has(index) ? index : byName.get(players[index].key);
    if (hit !== undefined) return void finish(hit);
    if (guessed.has(index)) return;
    guessed.add(index);
    wrong.prepend(h("li", {}, players[index].name));
    status.textContent = `${players[index].name} doesn’t fit. Keep going.`;
    sfx.bonk();
    input.classList.remove("is-wrong");
    void input.offsetWidth; // restart the shake
    input.classList.add("is-wrong");
  });
}

function answerRow(index: number, rank: number, count: number, pick: number | null) {
  const p = players[index];
  return h(
    "li",
    { class: index === pick ? "answers__row is-pick" : "answers__row" },
    h("span", { class: "answers__name" }, p.name),
    h("span", { class: "answers__depth" }, metres(depthFor(rank, count))),
  );
}

function reveal(i: number) {
  const prompt = day.prompts[i];
  const { pick, depth } = state().rounds[i];
  const tier = tierFor(depth);
  const n = prompt.answers.length;
  const shallow = prompt.answers[0];
  const deep = prompt.answers[n - 1];
  const last = i === ROUNDS - 1;

  const next = h("button", { class: "btn", type: "button" }, last ? "Full time: results ▶" : `Next: round ${i + 2} ▶`);
  next.addEventListener("click", async () => {
    if (!last) return playRound(i + 1);
    next.disabled = true;
    await fullTime();
    results();
  });

  show(
    "reveal",
    panel(
      h("p", { class: "eyebrow" }, `Round ${i + 1} of ${ROUNDS}`),
      h("h2", { class: "prompt prompt--small" }, prompt.text),
      h(
        "div",
        { class: `verdict verdict--${tier}` },
        h("div", {}, chip(tier), h("p", { class: "verdict__label" }, pick === null ? "No answer" : players[pick].name)),
        h("p", { class: "verdict__depth" }, metres(depth ?? 0)),
      ),
      h(
        "dl",
        { class: "extremes" },
        h("div", {}, h("dt", {}, "Shallowest"), h("dd", {}, players[shallow].name, h("span", {}, ` ${metres(depthFor(0, n))}`))),
        h("div", {}, h("dt", {}, "Deepest"), h("dd", {}, players[deep].name, h("span", {}, ` ${metres(depthFor(n - 1, n))}`))),
      ),
      h(
        "details",
        { class: "answers" },
        h("summary", {}, `All ${n} valid answers`),
        h("ol", {}, ...prompt.answers.map((a, rank) => answerRow(a, rank, n, pick))),
      ),
    ),
    next,
  );
  next.focus({ preventScroll: true });
}

function fullTime() {
  const total = store.total(state());
  return playFullTime({ total, level: levelIndex(total), depths: state().rounds.map((r) => r?.depth ?? null) });
}

function shareText(totalDepth: number): string {
  return [
    `Deep Bench #${dayNumber()}`,
    `${metres(totalDepth)} · ${levelFor(totalDepth).name}`,
    grid(),
    location.origin + import.meta.env.BASE_URL,
  ].join("\n");
}

function results() {
  const s = state();
  const totalDepth = store.total(s);
  const level = levelFor(totalDepth);
  const st = store.stats(date);
  settle("cheer");

  const share = h("button", { class: "btn", type: "button" }, "Share result");
  const shared = h("p", { class: "small", "aria-live": "polite" });
  share.addEventListener("click", async () => {
    const text = shareText(totalDepth);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        shared.textContent = "Copied to clipboard.";
      }
    } catch {
      shared.textContent = "Couldn’t share. Copy it from above instead.";
    }
  });

  const countdown = h("span", {});
  const updateCountdown = () => {
    const now = new Date();
    if (todayKey(now) !== date) {
      clearInterval(timer);
      countdown.textContent = "now. Reload to play.";
      return;
    }
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const secs = Math.floor((midnight.getTime() - now.getTime()) / 1000);
    countdown.textContent = [secs / 3600, (secs / 60) % 60, secs % 60]
      .map((v) => String(Math.floor(v)).padStart(2, "0"))
      .join(":");
  };
  const timer = window.setInterval(updateCountdown, 1000);
  updateCountdown();

  const stat = (label: string, value: string) => h("div", { class: "stat" }, h("dt", {}, label), h("dd", {}, value));
  const rewatch = h("button", { class: "btn btn--quiet", type: "button" }, "Watch full time ▶");
  rewatch.addEventListener("click", async () => {
    await fullTime();
    rewatch.focus({ preventScroll: true });
  });

  show(
    "results",
    panel(
      h("p", { class: "eyebrow" }, "Full time"),
      h("p", { class: "total" }, metres(totalDepth)),
      h("h2", { class: "title" }, level.name),
      h("pre", { class: "share-preview", "aria-label": "Your result" }, shareText(totalDepth)),
      share,
      shared,
    ),
    panel(
      h(
        "ol",
        { class: "summary" },
        ...day.prompts.map((p, i) => {
          const r = s.rounds[i];
          return h(
            "li",
            {},
            h("span", { class: "summary__sq", "aria-hidden": "true" }, square(r?.depth ?? null)),
            h("span", { class: "summary__text" }, p.text, h("br"), h("strong", {}, r?.pick != null ? players[r.pick].name : "Missed")),
            h("span", { class: "summary__depth" }, metres(r?.depth ?? 0)),
          );
        }),
      ),
      h(
        "dl",
        { class: "stats" },
        stat("Played", String(st.played)),
        stat("Streak", String(st.streak)),
        stat("Best streak", String(st.bestStreak)),
        stat("Deepest", metres(st.best)),
        stat("Average", metres(st.average)),
      ),
      h("p", { class: "small" }, "Next team sheet in ", countdown),
      rewatch,
    ),
  );
  share.focus({ preventScroll: true });
}

function failure(message: string) {
  show("failure", panel(h("h2", { class: "title" }, "Match postponed"), h("p", {}, message)));
}

// ---------------------------------------------------------------------------

async function boot() {
  show("loading", h("p", { class: "small loading" }, "Warming up…"));
  try {
    const [p, d] = await Promise.all([loadPlayers(), loadDay(date)]);
    players = p;
    if (!d) return failure(`There’s no team sheet for ${date}. Check back tomorrow.`);
    day = d;
  } catch {
    return failure("The data didn’t load. Check your connection and reload.");
  }
  dayline.textContent = `Day ${dayNumber()} · ${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })}`;

  const forfeited = store.forfeitAbandoned(date);
  settle();
  if (store.isComplete(state())) results();
  else intro(forfeited);
}

boot();
