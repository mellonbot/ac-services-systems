import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import { SURFACES, SURFACE_IDS, SURFACE_PATHS, type CoverageOutput, type SurfaceId } from "../../../../packages/contracts/src/index.ts";
import { BRAND } from "../../../../packages/tokens/src/brand.ts";
import { coverage, whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";

/** The site's name, as the visitor reads it in the heading and the tab. */
export const SITE_TITLE = `${BRAND.works.firm} — Service System`;

const surfaceLoginLabel = (id: SurfaceId): string => {
  switch (SURFACES[id].namespace) {
    case "internal": return "Staff sign-in";
    case "device": return "Technician sign-in";
    case "customer": return "Customer sign-in";
    case "vendor": return "Vendor sign-in";
    case "subcontractor": return "Subcontractor sign-in";
    case "anonymous": return "Public site";
  }
};

let stopScene: (() => void) | undefined;

/**
 * The sign-in floor's canvas, mounted and unmounted. Module-level so preact
 * sees the same ref on every render and calls it only when the canvas comes or
 * goes; three.js loads in its own chunk, after the page has rendered.
 */
const sceneRef = (canvas: HTMLCanvasElement | null): void => {
  stopScene?.();
  stopScene = undefined;
  if (!canvas) return;
  let stopped = false;
  stopScene = () => { stopped = true; };
  void import("../scene.ts").then(({ mountScene }) => {
    if (!stopped) stopScene = mountScene(canvas);
  });
};

/**
 * THE FRONT PAGE, and a short list of things it does not say.
 *
 * It does not state a response time, an availability figure, a number of
 * hours, or the word "emergency" as a promise. Not because the copy is timid
 * — because the ceiling on what this surface may claim is D7a (the response
 * obligation behind a single named owner) and OQ6 (the single-site
 * constraint), neither has been written down, and action plan F9 is where
 * they will be. 05 §S1 says it plainly: those two are "not visible to whoever
 * writes the copy". Until F9 lands, the copy is written as though every
 * sentence will be read back in a contract dispute, because the one about
 * response times would be.
 *
 * It also does not name a metro the hierarchy does not. The coverage page's
 * list is `regions`, through `ac_public_coverage()`, and if the gateway does
 * not answer the page says so rather than falling back to a list in the bundle.
 * A hard-coded coverage map is the exact failure D14 exists to prevent: a map
 * that says we serve a metro, and no crew density behind it.
 */
export const home: Screen = (): VNode => {
  const portals = SURFACE_IDS.filter((id) => id !== "S1" && SURFACES[id].enabled);
  return html`<section class="s1-home">
    <h1 class="s1-h1">${SITE_TITLE}</h1>
    <p class="s1-lede">Sign in to the workspace for your role.</p>

    <section class="s1-surface-access" id="surface-logins" aria-labelledby="surface-logins-title">
      <h2 class="s1-label" id="surface-logins-title">Sign in to a portal</h2>
      <div class="s1-scene">
        <div class="s1-scene__stage" role="img" aria-label="AC Services service truck, Unit TACLA-14402C, on a turntable in the service bay"><canvas ref=${sceneRef}></canvas></div>
        <ul class="s1-scene__plates">
          ${portals.map((id, i) => html`<li class="s1-scene__plate" style=${`--slot:${30 + (i * 360) / portals.length}deg`}>
            <a class="s1-portal" href="${SURFACE_PATHS[id]}/">
              <strong>${SURFACES[id].name}</strong>
              <span>${surfaceLoginLabel(id)}</span>
            </a>
          </li>`)}
        </ul>
      </div>
    </section>

  </section>`;
};

/** The same read, on its own page, for someone who arrived looking only for this. */
export const coverageScreen: Screen = (ctx: ScreenContext): VNode => {
  const cov = coverage(ctx);
  return html`<section class="s1-coverage">
    <h1 class="s1-h1">Where we work</h1>
    ${whenReady<CoverageOutput>(ctx, cov, (v) => v.metros.length
      ? html`<ul class="s1-metros" id="metros">
          ${v.metros.map((m) => html`<li><span class="s1-metros__code">${m.code}</span>${m.name}</li>`)}
        </ul>`
      : html`<p class="s1-empty" id="metros-empty">Our coverage list is being updated.</p>`,
      () => ctx.store.invalidate("coverage.list"))}
    <p class="s1-coverage__caveat">
      Read from our own service regions, not a marketing map. If your site is
      near one of these and not in it, ask anyway.
    </p>
    <p>${linkTo(ctx, "enquire", {}, "Ask us to call")}</p>
  </section>`;
};
