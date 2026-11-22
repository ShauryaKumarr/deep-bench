import { attachAutocomplete } from "./autocomplete";
import type { Player, Prompt } from "./data";
import { ROUND_SECONDS } from "./scoring";
import { sfx } from "./sound";
import { h, panel, show } from "./ui";

export interface RoundOptions {
  prompt: Prompt;
  players: Player[];
  /** "Round 3 of 7". */
  eyebrow: string;
  /** The squares so far. */
  pips: string;
  /** Ends the round early with no answer, e.g. when a live room moves on without you. */
  signal?: AbortSignal;
}

/**
 * The round on the clock: prompt, countdown and answer box. Resolves with the valid player
 * named (the first correct answer locks in), or null when the clock runs out.
 */
export function playPrompt({ prompt, players, eyebrow, pips, signal }: RoundOptions): Promise<number | null> {
  return new Promise((resolve) => {
    const answers = new Set(prompt.answers);
    // Same-named players (there are eight Júlio Césars) all count for the valid one.
    const byName = new Map<string, number>();
    for (const a of prompt.answers) if (!byName.has(players[a].key)) byName.set(players[a].key, a);

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
          h("div", {}, h("p", { class: "eyebrow" }, eyebrow), h("p", { class: "pips", "aria-hidden": "true" }, pips)),
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

    const finish = (pick: number | null) => {
      if (finished) return;
      finished = true;
      clearInterval(tick);
      signal?.removeEventListener("abort", onAbort);
      ac.close();
      input.disabled = true;
      input.blur(); // drop the on-screen keyboard before whatever comes next
      resolve(pick);
    };
    const onAbort = () => finish(null);
    signal?.addEventListener("abort", onAbort);

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
      if (hit !== undefined) return finish(hit);
      if (guessed.has(index)) return;
      guessed.add(index);
      wrong.prepend(h("li", {}, players[index].name));
      status.textContent = `${players[index].name} doesn’t fit. Keep going.`;
      sfx.bonk();
      input.classList.remove("is-wrong");
      void input.offsetWidth; // restart the shake
      input.classList.add("is-wrong");
    });

    if (signal?.aborted) finish(null);
  });
}
