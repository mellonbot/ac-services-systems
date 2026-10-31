import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import { SURFACES, SURFACE_IDS, SURFACE_PATHS, isLive } from "../../../../packages/contracts/src/index.ts";
import { linkTo, type ScreenContext } from "./common.ts";

/**
 * THE ADDRESS NOBODY ANSWERS. Pages rewrites every unmatched path to S1, so
 * this is what a stale bookmark, a mistyped portal or a link cut short in a
 * text message lands on. It names the address it was given, then offers the
 * three ways on: the portals (the usual intent of a typed path), a call, the
 * front page.
 */
export const missing = (ctx: ScreenContext, path: string): VNode => {
  const portals = SURFACE_IDS.filter((id) => id !== "S1" && isLive(id));
  return html`<section class="s1-missing" aria-labelledby="missing-title">
    <p class="s1-label">Not found</p>
    <h2 class="s1-h2 s1-welcome" id="missing-title">Nothing at this address</h2>
    <p class="s1-missing__path"><code>${path}</code></p>
    <p class="s1-lede">The page may have moved, or the link was cut short. If you were heading for a portal, it is one of these.</p>

    <ul class="s1-missing__portals">
      ${portals.map((id) => html`<li>
        <a class="s1-portal" href="${SURFACE_PATHS[id]}/">
          <strong>${SURFACES[id].name}</strong>
          <span>${SURFACE_PATHS[id]}/</span>
        </a>
      </li>`)}
    </ul>

    <div class="s1-missing__ways">
      ${linkTo(ctx, "enquire", {}, "Ask us to call", "ac-action s1-callout__action")}
      ${linkTo(ctx, "home", {}, "Back to the front page")}
    </div>
  </section>`;
};
