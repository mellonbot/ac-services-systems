import { html, StatusPill, type VNode, type Router, type Signal } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { OfflineQueue } from "../offline.ts";
import type { SCREENS } from "../screens.ts";

/**
 * What every S5 screen receives. `crew` and `queue` are what S2's and S3's
 * ScreenContext have no equivalent of: the shift's own crew (`shell.deviceCrew`,
 * read once at login and never a token claim) and the offline mutation queue
 * every write in this surface goes through instead of the gateway directly.
 *
 * `clock` is the one piece of state that belongs to neither: a running time
 * clock is not a server resource (there is nothing to fetch — nobody has
 * started a span until this device says so) and not a queued mutation either
 * (the mutation is only minted at Stop, once the span has an end). It is
 * per-app instance, created once in app.ts's `become()`, the same lifetime as
 * `store` and `queue`.
 */
export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly queue: OfflineQueue;
  readonly crew: { readonly id: string; readonly label: string };
  readonly clock: Signal<Readonly<Record<string, string>>>;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S5">;
  readonly degraded: boolean;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s5-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalView(ctx, r.refusal);
  }
};

/**
 * S5's own refusal rendering — never `RefusalCard` (console-only; a field
 * screen has no admitted variant to import, so this is not a style choice,
 * it is what compiles). A crew cannot act on a refusal's axis or its
 * permitted tiers either way; the gateway's own message, plainly, is enough.
 */
export const refusalView = (ctx: ScreenContext, refusal: Refusal): VNode =>
  html`<div class="s5-refusal" role="alert">
    ${StatusPill({ density: ctx.density, status: "blocked", label: "Not available" })}
    <p class="s5-refusal__message">${refusal.message}</p>
  </div>`;

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "s5-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;
