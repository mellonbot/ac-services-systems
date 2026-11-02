import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import { linkTo, type ScreenContext } from "./common.ts";

/**
 * THE ADDRESS NOBODY ANSWERS. Pages rewrites every unmatched path to S1, so
 * this is what a stale bookmark, a mistyped portal or a link cut short in a
 * text message lands on. It names the address it was given and sends the
 * person to the one place that knows where they belong: the sign-in.
 */
export const missing = (ctx: ScreenContext, path: string): VNode => html`<section class="s1-missing" aria-labelledby="missing-title">
  <p class="s1-label">Not found</p>
  <h2 class="s1-h2 s1-welcome" id="missing-title">Nothing at this address</h2>
  <p class="s1-missing__path"><code>${path}</code></p>
  <p class="s1-lede">The page may have moved, or the link was cut short. Sign in and we will take you to your workspace.</p>
  <div class="s1-missing__ways">
    ${linkTo(ctx, "home", {}, "Go to sign-in", "ac-action s1-missing__action")}
  </div>
</section>`;
