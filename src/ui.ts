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

/** Phones get the system share sheet; desktops copy to the clipboard instead. */
export const canShareSheet = () => Boolean(navigator.share) && matchMedia("(pointer: coarse)").matches;

const URL_RE = /https?:\/\/\S+/g;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Text with its URLs as links, for showing a share message on the page. */
export function linkify(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out.push(text.slice(last, m.index), h("a", { href: m[0], target: "_blank", rel: "noopener" }, m[0]));
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/**
 * Copies a share message. Rich editors (email, Slack, Teams, Docs) get an HTML copy whose URLs are
 * real links; plain-text places (most chat apps, which link URLs themselves) get the text as is.
 */
export async function copyText(text: string) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    const html = escapeHtml(text)
      .replace(URL_RE, (u) => `<a href="${u}">${u}</a>`)
      .replace(/\n/g, "<br>");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Some browsers refuse text/html: fall back to plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

/** A link styled as a button, for moving between modes (each mode is its own page load). */
export const linkButton = (href: string, text: string, quiet = false) =>
  // A no-break space keeps the ▶ with its last word when a long label wraps on a phone.
  h("a", { class: quiet ? "btn btn--quiet" : "btn", href }, text.replace(/ ▶$/, " ▶"));
