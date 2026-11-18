import { LEVELS, MAX_TOTAL, levelFor } from "./scoring";

// A 7 × 7 pixel football.
const BALL_SVG = `<svg class="pyramid__ball" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#F1EFE4" d="M2 0h3v1h1v1h1v3h-1v1h-1v1h-3v-1h-1v-1h-1v-3h1v-1h1z"/>
  <path fill="#10241a" d="M3 2h1v1h1v1h-1v1h-1v-1h-1v-1h1zM0 3h1v1h-1zM6 3h1v1h-1zM3 0h1v1h-1zM3 6h1v1h-1z"/>
</svg>`;

/** Share of the strip's height measured from the top, for a points total. */
const fromTop = (points: number) => (1 - Math.min(points, MAX_TOTAL) / MAX_TOTAL) * 100;

/** The pyramid strip down the left edge, Premier League at the top. The ball climbs as points come in. */
export function createPyramid(root: HTMLElement) {
  const list = document.createElement("ol");
  list.className = "pyramid__levels";
  const items = LEVELS.map((level, i) => {
    const end = LEVELS[i + 1]?.at ?? MAX_TOTAL;
    const li = document.createElement("li");
    li.className = "pyramid__level";
    li.style.setProperty("--top", `${fromTop(end)}%`);
    li.style.setProperty("--height", `${((end - level.at) / MAX_TOTAL) * 100}%`);
    // Chalk-bright at the top of the pyramid, darkening towards Sunday league.
    const shade = 1 - i / (LEVELS.length - 1);
    li.style.setProperty("--shade", String(shade));
    li.classList.toggle("is-dark", shade > 0.45);
    li.innerHTML = `
      <span class="pyramid__name"><abbr title="${level.name}">${level.short}</abbr><span class="pyramid__full">${level.name}</span></span>
      <span class="pyramid__at">${level.at}</span>`;
    list.append(li);
    return li;
  });

  const marker = document.createElement("div");
  marker.className = "pyramid__marker";
  marker.innerHTML = `${BALL_SVG}<span class="pyramid__points">0</span>`;
  const pointsEl = marker.querySelector(".pyramid__points") as HTMLElement;

  const live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");

  root.append(list, marker, live);

  return {
    set(total: number) {
      const level = levelFor(total);
      marker.style.setProperty("--pos", `${fromTop(total)}%`);
      // The tag sits above the line, except right at the top where it would be cut off.
      marker.classList.toggle("is-top", total / MAX_TOTAL > 0.93);
      pointsEl.textContent = `${total} pts`;
      items.forEach((li, i) => li.classList.toggle("is-current", LEVELS[i] === level));
      live.textContent = `${total} points: ${level.name}`;
    },
  };
}
