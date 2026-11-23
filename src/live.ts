// Live rooms: mates play the same seven prompts at the same moment, with a live scoreboard.
//
// Everything travels over Supabase Realtime, with no server code or tables: presence says who
// is connected, and each player broadcasts their name and round scores; the host (whoever has
// been in the room longest) also broadcasts the game's state. Everyone answers a newcomer's
// hello, so latecomers catch up, and if the host leaves, the next longest-serving player
// carries on from the last state seen.
// Prompts come from the friendly generator, seeded per game, so nobody downloads anything new.

import { SUPABASE_KEY, SUPABASE_URL, backendReady } from "./config";
import type { Player, Prompt } from "./data";
import { friendlyPrompts, isFriendlyCode, newFriendlyCode } from "./friendly";
import type { Mood } from "./pixel/ground";
import { playPrompt } from "./round";
import { ROUNDS, ROUND_SECONDS, levelFor, pointsFor, pts, square, tierFor } from "./scoring";
import { sfx } from "./sound";
import { canShareSheet, chip, h, linkButton, panel, score, show } from "./ui";

/** How long the host waits past the clock for the last answers to arrive. */
const ROUND_GRACE_MS = 2500;
/** How long each round's reveal stays up before the host's page moves everyone on. */
const REVEAL_MS = 12_000;
/** Supabase: a player's changes within this long go out as one message. */
const SEND_MS = 150;
/** Supabase: how long someone presence doesn't list may stay quiet before they're dropped. */
const STALE_MS = 8000;
/** Someone opening a room link waits up to this long to hear who's there before anything else. */
const SETTLE_MS = 3000;
const MAX_NAME = 16;
const NAME_KEY = "deep-bench:name";

type Phase = "lobby" | "round" | "reveal" | "done";
const PHASES: Phase[] = ["lobby", "round", "reveal", "done"];

interface Game {
  phase: Phase;
  /** The friendly code the prompts come from; "" in the first lobby. */
  seed: string;
  round: number;
  /** When the phase began, by the host's clock. Only the host reads it. */
  at: number;
}

interface Member {
  id: string;
  name: string;
  /** When they arrived. The earliest arrival in the room is the host. */
  joined: number;
  /** The game their rounds belong to. */
  seed: string;
  /** Points for each finished round, null for no answer. Its length is how many rounds they've closed. */
  rounds: (number | null)[];
  /** Who they named each round. */
  picks: (number | null)[];
  /** Only the host's copy counts. */
  game?: Game;
}

interface Transport {
  /** Starts sharing `me`. onSync gets everyone in the room whenever anything changes. */
  join(me: Member, onSync: (members: Member[]) => void): Promise<void>;
  update(me: Member): void;
  leave(): void;
}

export interface LiveOptions {
  players: Player[];
  room: string;
  /** Dev only: run the room over BroadcastChannel between tabs of one browser, with no backend. */
  local: boolean;
  /** A room this page just made up, so nobody else can be in it yet. */
  fresh: boolean;
  /** Moves the pyramid and the ground behind the page. */
  onScore(total: number, mood: Mood): void;
}

// ---------------------------------------------------------------- incoming data

/** Names come from other people's browsers: trimmed, collapsed and capped (and only ever shown as text). */
const cleanName = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";

const cleanList = (v: unknown, ok: (n: number) => boolean) =>
  Array.isArray(v) ? v.slice(0, ROUNDS).map((x) => (typeof x === "number" && ok(x) ? x : null)) : [];

function cleanGame(v: unknown): Game | undefined {
  if (!v || typeof v !== "object") return undefined;
  const g = v as Record<string, unknown>;
  if (!PHASES.includes(g.phase as Phase) || typeof g.seed !== "string" || typeof g.round !== "number" || typeof g.at !== "number")
    return undefined;
  if (g.seed && !isFriendlyCode(g.seed)) return undefined;
  return { phase: g.phase as Phase, seed: g.seed, round: Math.max(0, Math.min(ROUNDS - 1, Math.floor(g.round))), at: g.at };
}

function cleanMember(v: unknown): Member | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.joined !== "number") return null;
  return {
    id: m.id.slice(0, 64),
    name: cleanName(m.name) || "Player",
    joined: m.joined,
    seed: typeof m.seed === "string" ? m.seed : "",
    rounds: cleanList(m.rounds, (n) => n >= 0 && n <= 100),
    picks: cleanList(m.picks, (n) => Number.isInteger(n) && n >= 0),
    game: cleanGame(m.game),
  };
}

// ---------------------------------------------------------------- transports

/**
 * Supabase Realtime. Presence lets a client make only 5 calls per 30 seconds (more and the
 * server closes the channel), so it only says who is connected: each browser tracks itself
 * once per connection. Everything that changes (names, answers, the game's state) goes out as
 * Broadcast messages instead: a browser sends its state when it changes, at most every
 * SEND_MS, and everyone answers a newcomer's "hello" with theirs. Nothing repeats on a timer,
 * so a quiet room costs nothing against the project's monthly message quota.
 */
async function supabaseTransport(room: string): Promise<Transport> {
  // Loaded only when someone opens a live room, so the daily game stays small.
  const { RealtimeClient } = await import("@supabase/realtime-js");
  const client = new RealtimeClient(`${SUPABASE_URL.replace(/^http/, "ws")}/realtime/v1`, {
    params: { apikey: SUPABASE_KEY },
  });
  let channel: ReturnType<typeof client.channel> | null = null;
  let me: Member;
  let onSync: (members: Member[]) => void = () => {};
  /** The latest state each other player broadcast. */
  const others = new Map<string, { m: Member; seen: number }>();
  /** Who presence says is connected, with what they tracked on arrival. */
  let present = new Map<string, Member>();
  /** Players who said goodbye; presence can take a moment to agree. */
  const gone = new Set<string>();
  let timer = 0;
  let sweep = 0;

  const emit = () => {
    const list = [me];
    for (const [id, o] of others) if (id !== me.id) list.push(o.m);
    // Connected but not heard from yet: shown from what they tracked on arrival.
    for (const [id, m] of present) if (id !== me.id && !others.has(id) && !gone.has(id)) list.push(m);
    onSync(list);
  };
  /** Over the open socket only: realtime-js would otherwise quietly fall back to an HTTP request. */
  const push = (event: string, payload: object) => {
    if (channel && client.isConnected() && channel.state === "joined") void channel.send({ type: "broadcast", event, payload });
  };
  const send = () => {
    timer = 0;
    push("state", me);
  };
  const sendSoon = () => {
    if (!timer) timer = window.setTimeout(send, SEND_MS);
  };
  /** Drops players who left without a word: presence doesn't list them and they've gone quiet. */
  const prune = () => {
    const now = Date.now();
    let changed = false;
    for (const [id, o] of others)
      if (!present.has(id) && now - o.seen > STALE_MS) {
        others.delete(id);
        changed = true;
      }
    if (changed) emit();
  };

  return {
    join(m, cb) {
      me = m;
      onSync = cb;
      const ch = client.channel(`deep-bench-room:${room}`, {
        config: { presence: { key: me.id }, broadcast: { self: false } },
      });
      channel = ch;
      ch.on("presence", { event: "sync" }, () => {
        present = new Map();
        for (const [key, metas] of Object.entries(ch.presenceState())) {
          const p = cleanMember({ ...(metas[metas.length - 1] as object), id: key });
          if (p) present.set(p.id, p);
        }
        prune();
        emit();
      });
      ch.on("broadcast", { event: "hello" }, () => sendSoon());
      ch.on("broadcast", { event: "state" }, ({ payload }) => {
        const p = cleanMember(payload);
        if (!p || p.id === me.id) return;
        gone.delete(p.id);
        others.set(p.id, { m: p, seen: Date.now() });
        emit();
      });
      ch.on("broadcast", { event: "leave" }, ({ payload }) => {
        const id = typeof payload?.id === "string" ? payload.id : "";
        if (!id || id === me.id) return;
        gone.add(id);
        others.delete(id);
        emit();
      });
      sweep = window.setInterval(prune, 1000);
      return new Promise((resolve, reject) => {
        let joined = false;
        // Runs again after every reconnect: tracking and saying hello again catches up both ways.
        ch.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void ch.track({ name: me.name, joined: me.joined });
            push("hello", {});
            send();
            if (!joined) {
              joined = true;
              resolve();
            }
          } else if (!joined && (status === "CHANNEL_ERROR" || status === "TIMED_OUT")) reject(new Error(status));
        });
      });
    },
    update(m) {
      me = m;
      sendSoon();
    },
    leave() {
      clearInterval(sweep);
      clearTimeout(timer);
      push("leave", { id: me.id });
      if (channel) void client.removeChannel(channel);
      client.disconnect();
    },
  };
}

/** Presence over BroadcastChannel, for testing rooms in one browser without a backend. */
function localTransport(room: string): Transport {
  const bc = new BroadcastChannel(`deep-bench-room:${room}`);
  const others = new Map<string, { m: Member; seen: number }>();
  let me: Member;
  let onSync: (members: Member[]) => void = () => {};
  let beat = 0;
  const emit = () => onSync([me, ...[...others.values()].map((o) => o.m)]);
  const send = () => bc.postMessage({ type: "state", m: me });
  bc.onmessage = (e: MessageEvent) => {
    const { type, m, id } = e.data ?? {};
    if (type === "hello") return send();
    if (type === "leave") others.delete(id);
    if (type === "state") {
      const member = cleanMember(m);
      if (member) others.set(member.id, { m: member, seen: Date.now() });
    }
    emit();
  };
  return {
    async join(m, cb) {
      me = m;
      onSync = cb;
      bc.postMessage({ type: "hello" });
      send();
      beat = window.setInterval(() => {
        send();
        for (const [id, o] of others) if (Date.now() - o.seen > 4000) others.delete(id);
        emit();
      }, 1000);
      emit();
    },
    update(m) {
      me = m;
      send();
      emit();
    },
    leave() {
      clearInterval(beat);
      bc.postMessage({ type: "leave", id: me?.id });
      bc.close();
    },
  };
}

// ---------------------------------------------------------------- the room

const MOOD: Record<ReturnType<typeof tierFor>, Mood> = { miss: "groan", tap: "cheer", curler: "cheer", worldie: "wild" };
const totalOf = (m: Member) => m.rounds.reduce<number>((a, p) => a + (p ?? 0), 0);
const gridOf = (rounds: (number | null)[]) =>
  Array.from({ length: ROUNDS }, (_, i) => (i < rounds.length ? square(rounds[i]) : "▫️")).join("");

function savedName(): string {
  try {
    const n = cleanName(localStorage.getItem(NAME_KEY));
    if (n) return n;
  } catch {
    /* storage blocked */
  }
  return `Player ${Math.floor(100 + Math.random() * 900)}`;
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage blocked */
  }
}

function unavailable() {
  show(
    "live-off",
    panel(
      h("h2", { class: "title" }, "Live rooms are warming up"),
      h("p", {}, "Live play isn’t switched on yet. Play a friendly in the meantime: send the link and your mates get the same seven prompts."),
    ),
    linkButton("/?friendly", "Play a friendly ▶"),
  );
}

export async function startLive(o: LiveOptions) {
  if (!o.local && !backendReady()) return unavailable();

  // A reload rejoins as the same player, keeping their place (and host seniority) in the room.
  const sessionKey = `deep-bench:live:${o.room}`;
  let restored: Member | null = null;
  try {
    restored = cleanMember(JSON.parse(sessionStorage.getItem(sessionKey) ?? "null"));
  } catch {
    /* nothing saved */
  }
  const me: Member = restored ?? {
    id: crypto.randomUUID(),
    name: savedName(),
    joined: Date.now(),
    seed: "",
    rounds: [],
    picks: [],
  };
  delete me.game; // whoever is host now will say what's going on

  let members: Member[] = [me];
  let game: Game = { phase: "lobby", seed: "", round: 0, at: Date.now() };
  let view = "";
  /** Updates the live parts of whatever is on screen. */
  let refresh: (() => void) | null = null;
  let roundAbort: AbortController | null = null;
  const promptCache = new Map<string, Prompt[]>();
  const promptsFor = (seed: string) => {
    let p = promptCache.get(seed);
    if (!p) promptCache.set(seed, (p = friendlyPrompts(o.players, seed)));
    return p;
  };

  // Opening someone's room link: hold on until we've heard who's there, so this page doesn't
  // briefly think it's alone (and so in charge) and put up a lobby of its own.
  const settleBy = o.fresh ? 0 : Date.now() + SETTLE_MS;
  let heardAt = 0;
  let settled = o.fresh;

  show("loading", h("p", { class: "small loading" }, "Joining the room…"));
  let transport: Transport;
  try {
    transport = o.local ? localTransport(o.room) : await supabaseTransport(o.room);
    await transport.join(me, (list) => {
      const others = list.filter((m) => m.id !== me.id);
      members = [me, ...others].sort((a, b) => a.joined - b.joined || a.id.localeCompare(b.id));
      if (others.length && !heardAt) heardAt = Date.now();
      step();
    });
  } catch {
    show(
      "live-off",
      panel(h("h2", { class: "title" }, "Couldn’t reach the room"), h("p", {}, "Check your connection and reload to try again.")),
    );
    return;
  }
  addEventListener("pagehide", () => transport.leave());
  window.setInterval(step, 500);
  step();

  // -------------------------------------------------------------- state

  function publish() {
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({ ...me, game: undefined }));
    } catch {
      /* storage blocked */
    }
    transport.update(me);
  }

  // Function declarations (hoisted): a transport may report the room before join() returns.
  function host() {
    return members[0];
  }
  function amHost() {
    return host().id === me.id;
  }
  /** Everyone in the room, best total first (for this game). */
  function standings() {
    return [...members].sort(
      (a, b) => (b.seed === game.seed ? totalOf(b) : -1) - (a.seed === game.seed ? totalOf(a) : -1),
    );
  }

  function setGame(g: Game) {
    me.game = game = g;
    publish();
  }

  function kickOff() {
    setGame({ phase: "round", seed: newFriendlyCode(), round: 0, at: Date.now() });
    step();
  }

  function advance() {
    const g = me.game!;
    if (g.round + 1 >= ROUNDS) setGame({ ...g, phase: "done", at: Date.now() });
    else setGame({ ...g, phase: "round", round: g.round + 1, at: Date.now() });
    step();
  }

  /** The host's page runs the clock: it closes rounds and moves the room on. */
  function hostDrive() {
    const g = me.game!;
    const now = Date.now();
    if (g.phase === "round") {
      const allIn = members.every((m) => m.seed === g.seed && m.rounds.length > g.round);
      if (allIn || now > g.at + ROUND_SECONDS * 1000 + ROUND_GRACE_MS) setGame({ ...g, phase: "reveal", at: now });
    } else if (g.phase === "reveal" && now > g.at + REVEAL_MS) advance();
  }

  function step() {
    if (!settled) {
      // Replies to our hello arrive together, so a moment after the first we've heard everyone.
      const now = Date.now();
      if (now < settleBy && !(heardAt && now - heardAt >= 400)) return;
      settled = true;
    }
    if (amHost()) {
      if (!me.game) setGame(game); // taking over: carry on from the last state seen
      hostDrive();
    } else {
      if (me.game) {
        delete me.game;
        publish();
      }
      const g = host().game;
      if (g) game = g;
    }
    follow();
    refresh?.();
  }

  /** Catches this player up with the room: a new game, rounds that closed without an answer, the screen. */
  function follow() {
    const g = game;
    if (g.phase !== "lobby" && g.seed && me.seed !== g.seed) {
      me.seed = g.seed;
      me.rounds = [];
      me.picks = [];
      publish();
    }
    const closed = g.phase === "lobby" ? 0 : g.phase === "round" ? g.round : g.phase === "reveal" ? g.round + 1 : ROUNDS;
    if (g.seed === me.seed && me.rounds.length < closed) {
      roundAbort?.abort(); // the room moved on without our answer
      while (me.rounds.length < closed) {
        me.rounds.push(null);
        me.picks.push(null);
      }
      publish();
      o.onScore(totalOf(me), "groan");
    }
    const key = `${g.phase}:${g.seed}:${g.round}`;
    if (key !== view) {
      view = key;
      render();
    }
  }

  // -------------------------------------------------------------- screens

  function render() {
    refresh = null;
    if (game.phase === "lobby") return lobby();
    if (game.phase === "round") return me.rounds.length > game.round ? waiting() : play(game.round);
    if (game.phase === "reveal") return reveal(game.round);
    return fullTime();
  }

  /** Copies (or, on phones, shares) the room link. */
  function inviteButton() {
    const button = h("button", { class: "btn btn--quiet", type: "button" }, "Invite mates");
    const said = h("p", { class: "small", "aria-live": "polite" });
    button.addEventListener("click", async () => {
      const url = `${location.origin}/?room=${o.room}`;
      const text = `Play Deep Bench live with me: ${url}`;
      try {
        if (canShareSheet()) await navigator.share({ text });
        else {
          // Just the link on a computer, so it also works pasted into an address bar.
          await navigator.clipboard.writeText(url);
          said.textContent = "Link copied. Anyone who opens it joins this room.";
        }
      } catch (e) {
        if ((e as DOMException)?.name !== "AbortError") said.textContent = `Couldn’t copy. The link is ${url}`;
      }
    });
    return [button, said];
  }

  /** Who's in the room, with the host marked. `status` adds a note per player. */
  function roster(list: HTMLElement, status?: (m: Member) => string) {
    list.replaceChildren(
      ...members.map((m) =>
        h(
          "li",
          { class: m.id === me.id ? "live-list__row is-me" : "live-list__row" },
          h("span", { class: "live-list__name" }, m.name, m.id === me.id ? " (you)" : "", m === host() ? " · host" : ""),
          status && h("span", { class: "live-list__status" }, status(m)),
        ),
      ),
    );
  }

  /** The host's control, or a note saying who has it. Rebuilt only when the host changes, so clicks and focus survive. */
  function hostControl(box: HTMLElement, label: string, action: () => void, waitingFor: (hostName: string) => string) {
    let wasHost: boolean | null = null;
    const note = h("p", { class: "small" });
    const button = h("button", { class: "btn btn--big", type: "button" }, label);
    button.addEventListener("click", () => {
      button.disabled = true;
      action();
    });
    return () => {
      if (amHost() !== wasHost) {
        wasHost = amHost();
        box.replaceChildren(wasHost ? button : note);
      }
      note.textContent = waitingFor(host().name);
    };
  }

  function lobby() {
    o.onScore(0, "idle");
    const input = h("input", {
      class: "live-name",
      id: "live-name",
      type: "text",
      maxlength: String(MAX_NAME),
      autocomplete: "nickname",
      spellcheck: "false",
    });
    input.value = me.name;
    input.addEventListener("change", () => {
      const name = cleanName(input.value);
      if (!name) return void (input.value = me.name);
      me.name = name;
      saveName(name);
      publish();
      refresh?.();
    });
    const list = h("ul", { class: "live-list" });
    const controls = h("div", {});
    const control = hostControl(controls, "Kick off ▶", kickOff, (name) => `Waiting for ${name} to kick off…`);
    refresh = () => {
      roster(list);
      control();
    };
    show(
      "live-lobby",
      panel(
        h("p", { class: "eyebrow" }, "Live room"),
        h("h2", { class: "title" }, o.room.toUpperCase()),
        h(
          "p",
          { class: "small" },
          `Everyone in the room plays the same ${ROUNDS} prompts at the same time: ${ROUND_SECONDS} seconds each, first correct answer locks in, and the more obscure it is, the more points.`,
        ),
        h("label", { class: "eyebrow", for: "live-name" }, "Your name"),
        input,
        h("p", { class: "eyebrow live-gap" }, `In the room`),
        list,
        ...inviteButton(),
      ),
      controls,
    );
    refresh();
  }

  async function play(i: number) {
    const seed = game.seed;
    const prompt = promptsFor(seed)[i];
    roundAbort = new AbortController();
    const pick = await playPrompt({
      prompt,
      players: o.players,
      eyebrow: `Live · round ${i + 1} of ${ROUNDS}`,
      pips: gridOf(me.rounds),
      signal: roundAbort.signal,
    });
    roundAbort = null;
    if (me.seed !== seed || me.rounds.length !== i) return; // the room moved on without us
    const points = pick === null ? null : pointsFor(prompt.answers.indexOf(pick), prompt.answers.length);
    me.rounds.push(points);
    me.picks.push(pick);
    publish();
    o.onScore(totalOf(me), MOOD[tierFor(points)]);
    if (pick !== null) sfx.fanfare(points! >= 85 ? [523, 659, 784, 1047] : [523, 784], 0.08);
    if (view === `round:${seed}:${i}`) waiting();
    step();
  }

  function waiting() {
    const i = game.round;
    const points = me.rounds[i] ?? null;
    const pick = me.picks[i];
    const list = h("ul", { class: "live-list" });
    refresh = () =>
      roster(list, (m) => (m.seed === game.seed && m.rounds.length > i ? "locked in" : "thinking…"));
    show(
      "live-wait",
      panel(
        h("p", { class: "eyebrow" }, `Round ${i + 1} of ${ROUNDS}`),
        h(
          "div",
          { class: `verdict verdict--${tierFor(points)}` },
          h("div", {}, chip(tierFor(points)), h("p", { class: "verdict__label" }, pick == null ? "No answer" : o.players[pick].name)),
          score("verdict__points", points ?? 0),
        ),
        h("p", { class: "small" }, "Waiting for the rest of the room…"),
        list,
      ),
    );
    refresh();
  }

  function reveal(i: number) {
    const prompt = promptsFor(game.seed)[i];
    const n = prompt.answers.length;
    const board = h("ol", { class: "live-board" });
    const table = h("ol", { class: "live-board" });
    const controls = h("div", {});
    const shownAt = Date.now();
    const last = i === ROUNDS - 1;
    const control = hostControl(controls, last ? "Full time ▶" : "Next round ▶", advance, () => {
      const s = Math.max(0, Math.ceil((REVEAL_MS - (Date.now() - shownAt)) / 1000));
      return last ? `Full time in ${s}s…` : `Next round in ${s}s…`;
    });
    refresh = () => {
      const inGame = members.filter((m) => m.seed === game.seed);
      board.replaceChildren(
        ...[...inGame]
          .sort((a, b) => (b.rounds[i] ?? 0) - (a.rounds[i] ?? 0))
          .map((m) => {
            const p = m.picks[i];
            return h(
              "li",
              { class: m.id === me.id ? "live-board__row is-me" : "live-board__row" },
              h("span", { class: "live-board__sq", "aria-hidden": "true" }, square(m.rounds[i] ?? null)),
              h("span", { class: "live-board__who" }, m.name, h("br"), h("strong", {}, p == null ? "No answer" : (o.players[p]?.name ?? "?"))),
              h("span", { class: "live-board__pts" }, String(m.rounds[i] ?? 0)),
            );
          }),
      );
      standingsInto(table);
      control();
    };
    show(
      "live-reveal",
      panel(
        h("p", { class: "eyebrow" }, `Round ${i + 1} of ${ROUNDS}`),
        h("h2", { class: "prompt prompt--small" }, prompt.text),
        h(
          "p",
          { class: "small" },
          `Best known: ${o.players[prompt.answers[0]].name} · most obscure: ${o.players[prompt.answers[n - 1]].name} (${n} valid answers)`,
        ),
        board,
      ),
      panel(h("p", { class: "eyebrow" }, "Standings"), table),
      controls,
    );
    refresh();
  }

  function standingsInto(list: HTMLElement) {
    list.replaceChildren(
      ...standings()
        .filter((m) => m.seed === game.seed)
        .map((m, rank) =>
          h(
            "li",
            { class: m.id === me.id ? "live-board__row is-me" : "live-board__row" },
            h("span", { class: "live-board__rank" }, String(rank + 1)),
            h(
              "span",
              { class: "live-board__who" },
              m.name,
              h("br"),
              h("small", { class: "live-board__grid", "aria-hidden": "true" }, gridOf(m.rounds)),
            ),
            h("span", { class: "live-board__pts" }, String(totalOf(m))),
          ),
        ),
    );
  }

  function fullTime() {
    const table = h("ol", { class: "live-board" });
    const title = h("h2", { class: "title" });
    const controls = h("div", {});
    const control = hostControl(controls, "Rematch ▶", kickOff, (name) => `${name} can start a rematch.`);
    o.onScore(totalOf(me), "cheer");
    sfx.fanfare([523, 659, 784, 1047], 0.12);
    refresh = () => {
      const top = standings().filter((m) => m.seed === game.seed);
      const best = top.length ? totalOf(top[0]) : 0;
      const winners = top.filter((m) => totalOf(m) === best);
      title.textContent =
        winners.length > 1 ? "Honours even" : winners[0]?.id === me.id ? "You win!" : `${winners[0]?.name ?? "Nobody"} wins`;
      standingsInto(table);
      control();
    };
    show(
      "live-done",
      panel(
        h("p", { class: "eyebrow" }, "Full time"),
        title,
        h("p", { class: "small" }, `You: ${pts(totalOf(me))} · ${levelFor(totalOf(me)).name}`),
        table,
      ),
      controls,
      ...inviteButton(),
      linkButton("/", "Today’s team sheet", true),
    );
    refresh();
  }
}
