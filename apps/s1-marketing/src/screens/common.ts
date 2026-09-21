import { html, refusalHeading, PrimaryAction, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, CoverageOutput } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import { keyOf } from "../state.ts";
import type { LeadBuffer } from "../buffer.ts";
import type { SCREENS } from "../screens.ts";

/** What every S1 screen receives. A screen is a function of this and its route params — nothing else. */
export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly buffer: LeadBuffer;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S1">;
  readonly degraded: boolean;
  /** Queue this lead. Returns the submission id the buffer will replay it under. */
  readonly submit: (form: { name: string; email: string; phone: string; note: string; metro: string; source: "web_form" | "call_button" }) => string;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

/** The coverage read, shared by both screens that make it. One key, so it is fetched once. */
export const coverage = (ctx: ScreenContext): Resource<CoverageOutput> =>
  ctx.store.read<CoverageOutput>(keyOf("coverage.list"), () => ctx.shell.gateway.coverage()).value;

/**
 * Render a resource. S1's loading and refused states are written for a member
 * of the public rather than for an operator: "Loading…" is fine, and a
 * refusal is a sentence about us, not a code.
 */
export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s1-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalView(ctx, r.refusal, retry ? [{ label: "Try again", onSelect: retry, primary: true }] : []);
  }
};

/**
 * A refusal, as a stranger reads it. NOT RefusalCard — that component is
 * console-only by spec, and its admission axis and permitted authoring tiers
 * are the office's to act on. The discipline S6 set for the customer and S8
 * kept for the firm: the same heading, the gateway's own message, a way
 * forward.
 */
export const refusalView = (ctx: ScreenContext, refusal: Refusal, routes: readonly { label: string; onSelect: () => void; primary?: boolean }[] = []): VNode =>
  html`<section class="s1-refusal" role="alert" data-kind=${refusal.kind} data-density=${ctx.density}>
    <h2 class="s1-refusal__heading">${refusalHeading(refusal)}</h2>
    <p class="s1-refusal__message">${refusal.message}</p>
    ${routes.length ? html`<div class="s1-refusal__routes">
      ${routes.map((r) => html`<button type="button" class="ac-action" data-kind=${r.primary ? "primary" : "quiet"} data-density=${ctx.density} onClick=${r.onSelect}>${r.label}</button>`)}
    </div>` : null}
  </section>`;

/**
 * S1's submit button, and the one place this surface differs from every other
 * one in the repository.
 *
 * S6's and S8's equivalents DISABLE themselves when the gateway is
 * unreachable, with the declared reason, because on those surfaces a write
 * shown as accepted and never received is a crew that cannot be sent or a
 * statement nobody has answered. Here the opposite is true: the registry says
 * S1 queues and replays, and a stranger who came to the site to ask for help
 * and found a dead button is a stranger who calls someone else. So the button
 * stays live, the form is taken, and what changes is what the page then SAYS
 * — queued, not sent.
 */
export const submitAction = (ctx: ScreenContext, label: string, id?: string): VNode =>
  PrimaryAction({ density: ctx.density, label, type: "submit", ...(id ? { id } : {}) }) ?? html``;

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "s1-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;
