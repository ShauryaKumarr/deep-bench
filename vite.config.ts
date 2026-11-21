import { defineConfig, type Plugin } from "vite";
import { LEVELS } from "./src/scoring";
import { CHALLENGE_DESCRIPTION, SITE_DESCRIPTION, headline, levelSlug } from "./src/share";

// Link previews (WhatsApp, iMessage, Discord, X…) need absolute URLs. The canonical host is
// www.deepbenchgame.com (the bare domain 308s to it, and some chat apps won't follow a redirect
// for an image). SITE_URL overrides it if the domain ever changes.
const site = (process.env.SITE_URL || "https://www.deepbenchgame.com").replace(/\/+$/, "");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function previewTags(o: { title: string; description: string; image: string; path: string }) {
  const image = `${site}${o.image}`;
  return [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Deep Bench" />`,
    `<meta property="og:title" content="${esc(o.title)}" />`,
    `<meta property="og:description" content="${esc(o.description)}" />`,
    `<meta property="og:url" content="${site}${o.path}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="A pixel-art football ground under the Deep Bench wordmark" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(o.title)}" />`,
    `<meta name="twitter:description" content="${esc(o.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ].join("\n    ");
}

/**
 * One tiny page per pyramid level at /r/<level>. Shared results link there, so the chat preview
 * shows the level the sharer reached; the page itself forwards straight to the game, keeping
 * the challenge in the query string.
 */
function sharePage(slug: string, title: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(CHALLENGE_DESCRIPTION)}" />
    <meta name="robots" content="noindex" />
    <link rel="canonical" href="${site}/" />
    ${previewTags({ title, description: CHALLENGE_DESCRIPTION, image: `/og/${slug}.png`, path: `/r/${slug}` })}
    <script>location.replace("/" + location.search);</script>
    <meta http-equiv="refresh" content="0; url=/" />
  </head>
  <body style="margin:0;padding:24px;background:#070d1c;color:#f1efe4;font:20px monospace">
    <p><a href="/" style="color:#ffd23f">Play Deep Bench</a></p>
  </body>
</html>
`;
}

function sharePreviews(): Plugin {
  const pages = new Map(LEVELS.map((l) => [levelSlug(l), sharePage(levelSlug(l), `${headline(l)} on Deep Bench`)]));
  return {
    name: "deep-bench-share-previews",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(
          "<!-- preview-tags -->",
          previewTags({
            title: "Deep Bench: how deep is your ball knowledge?",
            description: SITE_DESCRIPTION,
            image: "/og/default.png",
            path: "/",
          }),
        ),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const slug = req.url?.match(/^\/r\/([a-z0-9]+)(?:\.html)?\/?(?:\?|$)/)?.[1];
        const page = slug && pages.get(slug);
        if (!page) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(page);
      });
    },
    generateBundle() {
      for (const [slug, source] of pages) this.emitFile({ type: "asset", fileName: `r/${slug}.html`, source });
    },
  };
}

export default defineConfig({ plugins: [sharePreviews()] });
