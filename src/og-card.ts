// The link-preview cards (1200 × 630) and app icons, drawn with the game's own pixel grounds.
// Opened by scripts/render_images.mjs through scripts/og.html, which screenshots each one:
//   og.html               the default card
//   og.html?level=6       the card for a level (League One here)
//   og.html?icon          the app icon, full bleed
//   og.html?icon=maskable the app icon with room for Android's mask
// Add &w=…&h=… for any size other than 1200 × 630.
import "@fontsource/jersey-10/400";
import "@fontsource/vt323/400";

import { fit } from "./pixel/engine";
import { Ground } from "./pixel/ground";
import { LEVELS } from "./scoring";
import { headline } from "./share";

const params = new URLSearchParams(location.search);
// Sizes come from the URL: headless browsers report a viewport smaller than the window they screenshot.
const W = Number(params.get("w")) || 1200;
const H = Number(params.get("h")) || 630;

const css = `
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #070d1c; }
  canvas { position: absolute; inset: 0; image-rendering: pixelated; }
  .scan { position: absolute; inset: 0; background: repeating-linear-gradient(180deg, transparent 0 3px, rgb(0 0 0 / 0.1) 3px 5px); }
  .card {
    position: absolute; left: 56px; top: 52px; max-width: 700px; padding: 26px 34px 30px;
    background: rgb(7 16 12 / 0.9); color: #f1efe4; font-family: "VT323", monospace;
    box-shadow: 0 -6px 0 0 #f1efe4, 0 6px 0 0 #f1efe4, -6px 0 0 0 #f1efe4, 6px 0 0 0 #f1efe4, 14px 14px 0 0 rgb(0 0 0 / 0.45);
  }
  .wordmark {
    margin: 0; font: 400 128px/0.82 "Jersey 10", monospace; text-transform: uppercase; letter-spacing: 0.02em; color: #ffd23f;
    text-shadow: 5px 5px 0 #8a5a00, 10px 10px 0 rgb(0 0 0 / 0.45);
  }
  .eyebrow { margin: 26px 0 0; color: #ffd23f; font-size: 34px; text-transform: uppercase; letter-spacing: 0.12em; }
  .big { margin: 2px 0 0; font: 400 86px/0.9 "Jersey 10", monospace; text-transform: uppercase; }
  .line { margin: 16px 0 0; font-size: 36px; line-height: 1.1; text-transform: uppercase; letter-spacing: 0.08em; }
  .dim { color: rgb(241 239 228 / 0.74); }
`;
document.head.append(Object.assign(document.createElement("style"), { textContent: css }));

function el(tag: string, cls: string, text: string) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}

if (params.has("icon")) {
  // The favicon's "DB" mark, square and full bleed: home screens round the corners themselves.
  const inset = params.get("icon") === "maskable" ? 0.17 : 0; // keep inside Android's safe circle
  const s = 32 / (1 - inset * 2);
  const o = (s - 32) / 2;
  document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-o} ${-o} ${s} ${s}" width="${W}" height="${H}" style="display:block">
    <rect x="${-o}" y="${-o}" width="${s}" height="${s}" fill="#1E4A34"/>
    <rect x="5" y="6" width="5" height="20" fill="#F1EFE4"/>
    <rect x="5" y="20" width="5" height="6" fill="#FFD23F"/>
    <path d="M14 9h7a6 6 0 0 1 0 14h-7z" fill="none" stroke="#F1EFE4" stroke-width="3"/>
  </svg>`;
} else {
  const levelParam = params.get("level");
  const level = levelParam === null ? null : Math.min(LEVELS.length - 1, Math.max(0, Number(levelParam) || 0));
  // The default card shows the top ground; a level's card shows that level's ground.
  const groundLevel = level ?? LEVELS.length - 1;

  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const { w, h, ctx } = fit(canvas, W, H, 5);
  const ground = new Ground(groundLevel, w, h, 0.56);
  ground.screen = { top: "DEEP", bottom: "BENCH" };
  ground.draw(ctx, 1.3, level === 0 ? "groan" : "cheer");

  const card = el("div", "card", "");
  card.append(el("h1", "wordmark", "Deep Bench"));
  if (level === null) {
    card.append(el("p", "eyebrow", "How deep is your"), el("p", "big", "Ball knowledge?"));
    card.append(el("p", "line dim", "A new team sheet every day"));
  } else {
    const l = LEVELS[level];
    const lead = headline(l).replace(l.name, "").trim();
    card.append(el("p", "eyebrow", lead), el("p", "big", l.name), el("p", "line", "Can you beat it?"));
  }
  document.body.append(card, el("div", "scan", ""));
}
