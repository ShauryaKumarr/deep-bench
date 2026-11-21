// Renders the link-preview cards and app icons into public/, using headless Chrome or Edge:
//   npm run images
// Set CHROME_PATH if your browser isn't found. Re-run after changing a ground or the levels.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));
if (!browser) throw new Error("No Chrome, Edge or Chromium found. Set CHROME_PATH.");

// No HMR: its open socket keeps headless Chrome from ever deciding the page has settled.
const server = await createServer({ root, logLevel: "error", server: { port: 5190, hmr: false } });
await server.listen();
const base = server.resolvedUrls.local[0];
const { LEVELS } = await server.ssrLoadModule("/src/scoring.ts");
const { levelSlug } = await server.ssrLoadModule("/src/share.ts");

const shots = [
  ["public/og/default.png", "", 1200, 630],
  ...LEVELS.map((l, i) => [`public/og/${levelSlug(l)}.png`, `?level=${i}`, 1200, 630]),
  ["public/icon-192.png", "?icon", 192, 192],
  ["public/icon-512.png", "?icon", 512, 512],
  ["public/icon-maskable-512.png", "?icon=maskable", 512, 512],
  ["public/apple-touch-icon.png", "?icon", 180, 180],
];

// A throwaway profile, so this never touches (or hands off to) a Chrome you have open.
const profile = mkdtempSync(join(tmpdir(), "deep-bench-shots-"));
try {
  for (const [out, query, w, h] of shots) {
    const file = join(root, out);
    mkdirSync(dirname(file), { recursive: true });
    // Async on purpose: a sync call would block the Vite server in this process from serving the page.
    await promisify(execFile)(browser, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      `--window-size=${w},${h}`,
      "--virtual-time-budget=3000",
      `--screenshot=${file}`,
      `${base}scripts/og.html?w=${w}&h=${h}${query.replace("?", "&")}`,
    ], { timeout: 60_000 });
    console.log(`${out}  ${w}×${h}`);
  }
} finally {
  await server.close();
  rmSync(profile, { recursive: true, force: true });
}
