import "@fontsource/jersey-10/400";
import "@fontsource/vt323/400";
import "./style.css";

import { inject, track } from "@vercel/analytics";

import { attachAutocomplete } from "./autocomplete";
import { addDays, loadDay, loadPlayers, todayKey, type Day, type Player } from "./data";
import { friendlyPrompts, isFriendlyCode, newFriendlyCode } from "./friendly";
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
  levelFor,
  levelIndex,
  pointsFor,
  pts,
  square,
  tierFor,
  type Tier,
} from "./scoring";
import { decodeRounds, encodeRounds, levelSlug } from "./share";
import { onSoundChange, setSound, sfx, soundOn } from "./sound";
import * as store from "./storage";

const FIRST_DAY = "2026-11-17";

// Vercel Web Analytics: cookieless page views. In local dev it only logs to the console.
inject();

const screen = document.getElementById("screen")!;
const dayline = document.getElementById("dayline")!;
const pyramid = createPyramid(document.getElementById("pyramid")!);
const backdrop = createBackdrop(document.getElementById("backdrop") as HTMLCanvasElement);

/** Today's team sheet, a past one from the archive, or a friendly made up on the spot. */
type Mode = "daily" | "archive" | "friendly";

let players: Player[] = [];
let day: Day;
let mode: Mode = "daily";
/** The team sheet's date. Friendlies use today's. */
let date = todayKey();
/** Where progress is saved: the date, or "f:<code>" for a friendly. */
let key = date;
let friendlyCode = "";
/** A friend's round scores, when the page was opened from their shared result. */
let rival: (number | null)[] | null = null;

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

const state = () => store.getDay(key);
/** A big score: the number in display type, "pts" smaller beside it. */
const score = (cls: string, n: number) =>
  h("p", { class: `score ${cls}` }, h("span", { class: "score__num" }, String(n)), h("span", { class: "score__unit" }, "pts"));
const dayNumber = (d = date) =>
  Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${FIRST_DAY}T12:00:00Z`)) / 86_400_000) + 1;
const dateLabel = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const sum = (points: (number | null)[]) => points.reduce<number>((a, p) => a + (p ?? 0), 0);
const roundPoints = () => Array.from({ length: ROUNDS }, (_, i) => state().rounds[i]?.points ?? null);

/** Custom analytics events. Never lets analytics break the game. */
function event(name: string, props: Record<string, string | number> = {}) {
  try {
    track(name, { mode, ...props });
  } catch {
    /* ignore */
  }
}

/** A link styled as a button, for moving between modes (each mode is its own page load). */
const linkButton = (href: string, text: string, quiet = false) =>
  // A no-break space keeps the ▶ with its last word when a long label wraps on a phone.
  h("a", { class: quiet ? "btn btn--quiet" : "btn", href }, text.replace(/ ▶$/, " ▶"));

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
    return r ? square(r.points) : "▫️";
  }).join("");
}

/** "You've been challenged": shown before kick-off when the page came from a friend's result. */
function challengeNotice() {
  if (!rival) return null;
  const them = sum(rival);
  return h(
    "div",
    { class: "notice notice--challenge" },
    h("p", { class: "eyebrow" }, "You’ve been challenged"),
    h(
      "p",
      {},
      `A friend scored ${pts(them)} (${levelFor(them).name}) on ${mode === "friendly" ? "this friendly" : "this team sheet"}. Can you beat them?`,
    ),
    h("p", { class: "grid grid--small", "aria-label": "Their rounds" }, rival.map(square).join("")),
  );
}

// ---------------------------------------------------------------------------
// Screens

function intro(forfeited: number | null) {
  const done = state().rounds.filter(Boolean).length;
  const button = h("button", { class: "btn btn--big", type: "button" }, done ? `Continue: round ${done + 1} ▶` : "Kick off ▶");
  button.addEventListener("click", () => {
    if (!done) event("kickoff");
    playRound(done);
  });
  const title = { daily: "Today’s team sheet", archive: `Team sheet #${dayNumber()}`, friendly: "Friendly" }[mode];
  const note = {
    daily: "Leaving the page mid-round counts that round as a miss.",
    archive: "From the archive: it won’t count towards your streak or stats. Leaving mid-round still counts as a miss.",
    friendly:
      "A friendly: seven random international prompts that never count towards your streak. Send the link and your mates get the same seven.",
  }[mode];

  show(
    "intro",
    forfeited !== null &&
      h("p", { class: "notice" }, `Round ${forfeited + 1} counted as a miss: the page was left while the clock was running.`),
    challengeNotice(),
    panel(
      h("h2", { class: "title" }, done ? "Back on the pitch" : title),
      done
        ? h("p", { class: "grid", "aria-label": `${done} of ${ROUNDS} rounds played` }, grid())
        : h(
            "ol",
            { class: "rules" },
            h("li", {}, `${ROUNDS} prompts, ${ROUND_SECONDS} seconds each.`),
            h("li", {}, "Name any player who fits. Wrong guesses cost nothing, so keep going until the clock runs out."),
            h("li", {}, "The more obscure your answer, the more points: 10 for the best known, 100 for the least."),
            h("li", {}, `Points win promotion. Score ${MAX_TOTAL} to climb from Sunday league to the Premier League.`),
          ),
      h(
        "p",
        { class: "chips", "aria-label": "Scoring" },
        chip("tap", "Tap-in · under 60 pts"),
        chip("curler", "Curler · 60–84"),
        chip("worldie", "Worldie · 85+"),
        chip("miss", "Miss · 0"),
      ),
      h("p", { class: "small" }, note),
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

  store.startRound(key, i, mode === "archive");
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
    const points = pick === null ? null : pointsFor(prompt.answers.indexOf(pick), prompt.answers.length);
    store.finishRound(key, i, { pick, points });
    const after = store.total(state());

    const tier = tierFor(points);
    await playCutscene({
      tier,
      points: points ?? 0,
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
    h("span", { class: "answers__points" }, pts(pointsFor(rank, count))),
  );
}

function reveal(i: number) {
  const prompt = day.prompts[i];
  const { pick, points } = state().rounds[i];
  const tier = tierFor(points);
  const n = prompt.answers.length;
  const famous = prompt.answers[0];
  const obscure = prompt.answers[n - 1];
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
        score("verdict__points", points ?? 0),
      ),
      h(
        "dl",
        { class: "extremes" },
        h("div", {}, h("dt", {}, "Best known"), h("dd", {}, players[famous].name, h("span", {}, ` ${pts(pointsFor(0, n))}`))),
        h("div", {}, h("dt", {}, "Most obscure"), h("dd", {}, players[obscure].name, h("span", {}, ` ${pts(pointsFor(n - 1, n))}`))),
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
  return playFullTime({ total, level: levelIndex(total), rounds: state().rounds.map((r) => r?.points ?? null) });
}

/**
 * Every shared result is a challenge: the link goes to the preview page for the level reached
 * (so the chat preview shows it) and carries the round scores, so whoever opens it plays the
 * same seven prompts and gets a head to head at full time.
 */
function shareUrl(total: number): string {
  const params = new URLSearchParams(mode === "friendly" ? { f: friendlyCode } : { d: date });
  params.set("c", encodeRounds(roundPoints()));
  return `${location.origin}${import.meta.env.BASE_URL}r/${levelSlug(levelFor(total))}?${params}`;
}

function shareText(total: number): string {
  return [
    mode === "friendly" ? `Deep Bench friendly ${friendlyCode.toUpperCase()}` : `Deep Bench #${dayNumber()}`,
    `${pts(total)} · ${levelFor(total).name}`,
    grid(),
    `Beat me: ${shareUrl(total)}`,
  ].join("\n");
}

/** You against the friend whose link this came from. */
function headToHead(total: number) {
  if (!rival) return null;
  const them = sum(rival);
  const diff = total - them;
  const side = (who: string, points: number, rounds: (number | null)[]) =>
    h(
      "div",
      { class: "h2h__side" },
      h("dt", {}, who),
      h("dd", {}, h("span", { class: "h2h__total" }, pts(points)), h("span", { class: "h2h__level" }, levelFor(points).name)),
      h("dd", { class: "h2h__grid", "aria-hidden": "true" }, rounds.map(square).join("")),
    );
  return panel(
    h("p", { class: "eyebrow" }, "Head to head"),
    h("h2", { class: "title" }, diff > 0 ? `You win by ${diff}` : diff < 0 ? `They win by ${-diff}` : "Honours even"),
    h("dl", { class: "h2h" }, side("You", total, roundPoints()), side("Them", them, rival)),
  );
}

/** What to play next, so nobody finishes and leaves with nothing to do. */
function nextUp() {
  const items = {
    daily: [linkButton("/?friendly", "Play a friendly ▶"), linkButton("/?archive", "Past team sheets", true)],
    archive: [linkButton("/", "Today’s team sheet ▶"), linkButton("/?archive", "More from the archive", true)],
    friendly: [linkButton("/?friendly", "Another friendly ▶"), linkButton("/", "Today’s team sheet", true)],
  }[mode];
  return panel(
    h("p", { class: "eyebrow" }, "Keep playing"),
    h(
      "p",
      { class: "small" },
      mode === "friendly"
        ? "Friendlies are unlimited and never touch your streak."
        : "Friendlies are unlimited random matches. The archive has every past team sheet.",
    ),
    ...items,
  );
}

function results() {
  const s = state();
  const total = store.total(s);
  const level = levelFor(total);
  const st = store.stats(todayKey());
  settle("cheer");

  const share = h("button", { class: "btn", type: "button" }, rival ? "Share your reply" : "Share & challenge");
  const shared = h("p", { class: "small", "aria-live": "polite" });
  share.addEventListener("click", async () => {
    const text = shareText(total);
    event("share", { level: level.short });
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        shared.textContent = "Copied. Paste it in the group chat: whoever opens the link plays the same seven.";
      }
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // closed the share sheet
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
  const timer = mode === "daily" ? window.setInterval(updateCountdown, 1000) : 0;
  if (mode === "daily") updateCountdown();

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
      score("total", total),
      h("h2", { class: "title" }, level.name),
      h("pre", { class: "share-preview", "aria-label": "Your result" }, shareText(total)),
      share,
      shared,
    ),
    headToHead(total),
    panel(
      h(
        "ol",
        { class: "summary" },
        ...day.prompts.map((p, i) => {
          const r = s.rounds[i];
          return h(
            "li",
            {},
            h("span", { class: "summary__sq", "aria-hidden": "true" }, square(r?.points ?? null)),
            h("span", { class: "summary__text" }, p.text, h("br"), h("strong", {}, r?.pick != null ? players[r.pick].name : "Missed")),
            h(
              "span",
              { class: "summary__points" },
              String(r?.points ?? 0),
              rival && h("small", { class: "summary__rival", title: "Their points" }, `vs ${rival[i] ?? 0}`),
            ),
          );
        }),
      ),
      mode === "daily" &&
        h(
          "dl",
          { class: "stats" },
          stat("Played", String(st.played)),
          stat("Streak", String(st.streak)),
          stat("Best streak", String(st.bestStreak)),
          stat("Best", pts(st.best)),
          stat("Average", pts(st.average)),
        ),
      mode === "daily" && h("p", { class: "small" }, "Next team sheet in ", countdown),
      rewatch,
    ),
    nextUp(),
  );
  share.focus({ preventScroll: true });
}

/** Every past team sheet, newest first. */
function archiveList() {
  const today = todayKey();
  const rows: HTMLElement[] = [];
  for (let d = addDays(today, -1); d >= FIRST_DAY; d = addDays(d, -1)) {
    const s = store.savedDay(d);
    const played = s?.rounds.filter(Boolean).length ?? 0;
    const status = !s || !played ? "Not played" : store.isComplete(s) ? pts(store.total(s)) : `${played} of ${ROUNDS} played`;
    rows.push(
      h(
        "li",
        {},
        h(
          "a",
          { class: "archive__row", href: `/?d=${d}` },
          h("span", { class: "archive__num" }, `#${dayNumber(d)}`),
          h("span", { class: "archive__date" }, dateLabel(d)),
          h("span", { class: s && store.isComplete(s) ? "archive__status is-done" : "archive__status" }, status),
        ),
      ),
    );
  }
  show(
    "archive",
    panel(
      h("h2", { class: "title" }, "The archive"),
      h("p", { class: "small" }, "Every past team sheet. Archive games don’t count towards your streak or stats."),
      rows.length
        ? h("ol", { class: "archive" }, ...rows)
        : h("p", {}, "Nothing here yet: today’s is the very first team sheet. Come back tomorrow, or play a friendly."),
    ),
    h("div", {}, linkButton("/", "Today’s team sheet ▶"), linkButton("/?friendly", "Play a friendly", true)),
  );
}

function failure(message: string) {
  show("failure", panel(h("h2", { class: "title" }, "Match postponed"), h("p", {}, message)));
}

// ---------------------------------------------------------------------------

/** Marks the current mode in the header menu. */
function markMode(current: Mode) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".modes a")) {
    if (a.dataset.mode === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/**
 * Routes, all on the one page:
 *   /                     today's team sheet
 *   /?d=YYYY-MM-DD        a past team sheet (today's if it is today)
 *   /?archive             the list of past team sheets
 *   /?friendly            a new friendly, which becomes /?f=<code>
 *   /?f=<code>            that friendly
 *   …&c=<rounds>          opened from a friend's result: a head to head
 */
async function boot() {
  show("loading", h("p", { class: "small loading" }, "Warming up…"));
  const params = new URLSearchParams(location.search);
  const today = todayKey();
  let notice: string | null = null;

  if (params.has("archive")) {
    markMode("archive");
    dayline.textContent = "The archive";
    settle();
    return archiveList();
  }

  if (params.has("f") || params.has("friendly")) {
    mode = "friendly";
    friendlyCode = (params.get("f") ?? "").toLowerCase();
    if (!isFriendlyCode(friendlyCode)) {
      friendlyCode = newFriendlyCode();
      params.delete("c"); // a challenge only makes sense on the friendly it came from
      history.replaceState(null, "", `?f=${friendlyCode}`);
    }
    key = `f:${friendlyCode}`;
  } else if (params.has("d")) {
    const d = params.get("d")!;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < FIRST_DAY) params.delete("c");
    else if (d > today) {
      // Shared from a time zone that has already reached tomorrow.
      notice = "That team sheet hasn’t opened here yet: it’s tomorrow where your friend is. Here’s today’s.";
      params.delete("c");
    } else if (d < today) {
      mode = "archive";
      date = key = d;
    }
  }
  rival = decodeRounds(params.get("c"));
  if (rival) event("challenge_open");
  markMode(mode);

  try {
    if (mode === "friendly") {
      players = await loadPlayers();
      day = { date, prompts: friendlyPrompts(players, friendlyCode) };
    } else {
      const [p, d] = await Promise.all([loadPlayers(), loadDay(date)]);
      players = p;
      if (!d) return failure(`There’s no team sheet for ${date}. Check back tomorrow.`);
      day = d;
    }
  } catch {
    return failure("The data didn’t load. Check your connection and reload.");
  }
  dayline.textContent =
    mode === "friendly"
      ? `Friendly · ${friendlyCode.toUpperCase()}`
      : `${mode === "archive" ? "Archive · " : ""}Day ${dayNumber()} · ${dateLabel(date)}`;

  // Local dev only: /?reset wipes this team sheet's progress so it can be replayed.
  if (import.meta.env.DEV && params.has("reset") && mode !== "friendly") {
    store.resetDay(date);
    params.delete("reset");
    const rest = params.toString();
    history.replaceState(null, "", rest ? `?${rest}` : location.pathname);
  }

  const forfeited = store.forfeitAbandoned(key);
  settle();
  if (store.isComplete(state())) results();
  else intro(forfeited);
  if (notice) screen.prepend(h("p", { class: "notice" }, notice));
}

boot();
