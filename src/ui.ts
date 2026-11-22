import { TIER_LABEL, type Tier } from "./scoring";

// Tiny DOM helpers. Strings become text nodes, so player (and live-room) names are never parsed as HTML.

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

export const screen = document.getElementById("screen")!;

export function show(name: string, ...children: Child[]) {
  document.body.dataset.screen = name;
  screen.replaceChildren(...children.filter((c): c is Node | string => !!c));
  scrollTo(0, 0);
}

export const panel = (...children: Child[]) => h("div", { class: "panel" }, ...children);
export const chip = (tier: Tier, text: string = TIER_LABEL[tier]) => h("span", { class: `chip chip--${tier}` }, text);

/** A big score: the number in display type, "pts" smaller beside it. */
export const score = (cls: string, n: number) =>
  h("p", { class: `score ${cls}` }, h("span", { class: "score__num" }, String(n)), h("span", { class: "score__unit" }, "pts"));

/** A link styled as a button, for moving between modes (each mode is its own page load). */
export const linkButton = (href: string, text: string, quiet = false) =>
  // A no-break space keeps the ▶ with its last word when a long label wraps on a phone.
  h("a", { class: quiet ? "btn btn--quiet" : "btn", href }, text.replace(/ ▶$/, " ▶"));
