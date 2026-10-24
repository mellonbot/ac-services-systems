import { html, RefusalNotice, type VNode, type Router, type Signal } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { OfflineQueue } from "../offline.ts";
import type { SCREENS } from "../screens.ts";
export { linkTo } from "../../../../packages/ui/src/screen-helpers.ts";

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
 * the queue's (`queue.clock`), saved with it in this device's storage under
 * the same device-and-technician key, so a running clock outlives a reload or
 * a sign-in again after the token expires.
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
 * A refusal on the tablet: RefusalNotice, never RefusalCard (console-only; a
 * field screen has no admitted variant to import). A crew cannot act on a
 * refusal's axis or its permitted tiers; the heading, the gateway's own
 * message and the fault mark are enough.
 */
export const refusalView = (ctx: ScreenContext, refusal: Refusal): VNode =>
  RefusalNotice({ density: ctx.density, refusal }) ?? html``;
