import { normalise, type Player } from "./data";

const MAX_OPTIONS = 8;

export function search(players: Player[], query: string): number[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const terms = q.split(" ");
  const starts: number[] = [];
  const contains: number[] = [];
  // Players are ordered by fame, so the first hits are the best-known ones.
  for (let i = 0; i < players.length && starts.length < MAX_OPTIONS; i++) {
    const p = players[i];
    if (p.key.startsWith(q)) starts.push(i);
    else if (contains.length < MAX_OPTIONS && terms.every((t) => p.words.some((w) => w.startsWith(t)))) {
      contains.push(i);
    }
  }
  return [...starts, ...contains].slice(0, MAX_OPTIONS);
}

function meta(p: Player): string {
  const years = p.first === p.last ? `${p.first}` : `${p.first}–${p.last}`;
  return [p.nation, p.pos, years].filter(Boolean).join(" · ");
}

/** Wires an input up as an ARIA combobox over all players. */
export function attachAutocomplete(
  input: HTMLInputElement,
  listbox: HTMLUListElement,
  players: Player[],
  onPick: (index: number) => void,
) {
  let results: number[] = [];
  let active = -1;

  const close = () => {
    results = [];
    active = -1;
    listbox.hidden = true;
    listbox.replaceChildren();
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const highlight = (i: number) => {
    active = i;
    [...listbox.children].forEach((el, j) => el.setAttribute("aria-selected", String(j === i)));
    if (i >= 0) {
      input.setAttribute("aria-activedescendant", `opt-${i}`);
      listbox.children[i]?.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };

  const pick = (i: number) => {
    const index = results[i];
    if (index === undefined) return;
    input.value = "";
    close();
    onPick(index);
  };

  const render = () => {
    results = search(players, input.value);
    listbox.replaceChildren(
      ...results.map((index, i) => {
        const p = players[index];
        const li = document.createElement("li");
        li.id = `opt-${i}`;
        li.role = "option";
        li.className = "option";
        li.innerHTML = `<span class="option__name"></span><span class="option__meta"></span>`;
        li.children[0].textContent = p.name;
        li.children[1].textContent = meta(p);
        // mousedown keeps focus in the input
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(i);
        });
        return li;
      }),
    );
    listbox.hidden = results.length === 0;
    input.setAttribute("aria-expanded", String(results.length > 0));
    highlight(results.length ? 0 : -1);
  };

  input.addEventListener("input", render);
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      highlight((active + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length) {
      e.preventDefault();
      highlight((active - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) pick(active);
    } else if (e.key === "Escape") {
      close();
    }
  });

  return { close };
}
