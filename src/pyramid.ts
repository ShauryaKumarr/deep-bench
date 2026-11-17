import { LEVELS, MAX_TOTAL, levelFor } from "./scoring";

// A 7 × 7 pixel football.
const BALL_SVG = `<svg class="pyramid__ball" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#F1EFE4" d="M2 0h3v1h1v1h1v3h-1v1h-1v1h-3v-1h-1v-1h-1v-3h1v-1h1z"/>
  <path fill="#10241a" d="M3 2h1v1h1v1h-1v1h-1v-1h-1v-1h1zM0 3h1v1h-1zM6 3h1v1h-1zM3 0h1v1h-1zM3 6h1v1h-1z"/>
</svg>`;

/** The pyramid strip down the left edge. The marker sinks as depth grows. */
export function createPyramid(root: HTMLElement) {
  const list = document.createElement("ol");
  list.className = "pyramid__levels";
  const items = LEVELS.map((level, i) => {
    const end = LEVELS[i + 1]?.at ?? MAX_TOTAL;
    const li = document.createElement("li");
    li.className = "pyramid__level";
    li.style.setProperty("--top", `${(level.at / MAX_TOTAL) * 100}%`);
    li.style.setProperty("--height", `${((end - level.at) / MAX_TOTAL) * 100}%`);
    const shade = i / (LEVELS.length - 1);
    li.style.setProperty("--shade", String(shade));
    li.classList.toggle("is-dark", shade > 0.45);
    li.innerHTML = `
      <span class="pyramid__name"><abbr title="${level.name}">${level.short}</abbr><span class="pyramid__full">${level.name}</span></span>
      <span class="pyramid__at">${level.at}m</span>`;
    list.append(li);
    return li;
  });

  const marker = document.createElement("div");
  marker.className = "pyramid__marker";
  marker.innerHTML = `${BALL_SVG}<span class="pyramid__depth">0m</span>`;
  const depthEl = marker.querySelector(".pyramid__depth") as HTMLElement;

  const live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");

  root.append(list, marker, live);

  return {
    set(total: number) {
      const level = levelFor(total);
      marker.style.setProperty("--pos", `${(Math.min(total, MAX_TOTAL) / MAX_TOTAL) * 100}%`);
      depthEl.textContent = `${total}m`;
      items.forEach((li, i) => li.classList.toggle("is-current", LEVELS[i] === level));
      live.textContent = `${total} metres deep: ${level.name}`;
    },
  };
}
