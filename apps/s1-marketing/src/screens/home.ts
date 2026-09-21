import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CoverageOutput } from "../../../../packages/contracts/src/index.ts";
import { coverage, whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";

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
 * It also does not name a metro the hierarchy does not. The list below is
 * `regions`, through `ac_public_coverage()`, and if the gateway does not
 * answer the page says so rather than falling back to a list in the bundle.
 * A hard-coded coverage map is the exact failure D14 exists to prevent: a map
 * that says we serve a metro, and no crew density behind it.
 */
export const home: Screen = (ctx: ScreenContext): VNode => {
  const cov = coverage(ctx);
  return html`<section class="s1-home">
    <h1 class="s1-h1">Commercial HVAC service, run as one network</h1>
    <p class="s1-lede">
      Rankine Operating Company runs commercial heating, ventilation and air-conditioning
      service across several metros, through local firms that keep their own names.
      Tell us what you need and the office for your area will get in touch.
    </p>
    <p><a class="s1-cta" href=${ctx.router.href("enquire", {})}
          onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate("enquire", {}); }}
          id="ask-us">Ask us to call</a></p>

    <h2 class="s1-h2">Where we work</h2>
    ${whenReady<CoverageOutput>(ctx, cov, (v) => v.metros.length
      ? html`<ul class="s1-metros" id="metros">
          ${v.metros.map((m) => html`<li><span class="s1-metros__code">${m.code}</span>${m.name}</li>`)}
        </ul>`
      : html`<p class="s1-empty" id="metros-empty">Our coverage list is being updated. Send us a note and we will tell you whether we reach you.</p>`,
      () => ctx.store.invalidate("coverage.list"))}
    <p class="s1-coverage__caveat">
      This is where we have crews. Whether we can take on a particular building
      is a conversation, not a map — ask and we will answer.
    </p>
    <p>${linkTo(ctx, "coverage", {}, "The full list")}</p>
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
