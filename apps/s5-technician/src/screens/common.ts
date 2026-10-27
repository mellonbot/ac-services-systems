import { html, RefusalNotice, type VNode, type Router, type Signal } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, AddressWire, FieldSiteWire } from "../../../../packages/contracts/src/index.ts";
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
  /** The app's clock, read once per render and moved on every minute — what a running shift clock counts to. */
  readonly now: number;
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

/**
 * Send what is queued, best-effort. An answer refetches jobs.mine; no answer
 * leaves the work queued for app.ts's next tick — a tap never waits on the
 * network.
 */
export const flushQueue = (ctx: ScreenContext): void => {
  void ctx.queue.flush((mutations) =>
    ctx.shell.gateway.replaySync({ orgId: ctx.shell.principal.orgId, regionId: ctx.shell.principal.regionId, mutations }),
  ).then((answered) => { if (answered) { ctx.store.invalidate("jobs.mine"); ctx.store.invalidate("punches.mine"); } });
};

/** What a device's state change says on its button — the verb a crew would use, not the enum. */
export const ACTION_LABEL: Readonly<Record<string, string>> = {
  en_route: "Head out", on_site: "On site", in_progress: "Start work", awaiting_parts: "Waiting on parts",
  awaiting_customer: "Waiting on customer", complete: "Complete", aborted: "Abort",
};

export const stateText = (state: string): string => state.replace(/_/g, " ");

export const addressLine = (a: AddressWire | null): string =>
  a ? [a.line1, a.line2, a.city, [a.state, a.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";

/** A maps link to the site: its coordinates when the record has them, else its street address; null when it has neither. */
export const directionsHref = (site: FieldSiteWire | null): string | null => {
  const a = site?.address ?? null;
  const to = a?.lat !== undefined && a?.lng !== undefined ? `${a.lat},${a.lng}` : addressLine(a);
  return to ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(to)}` : null;
};

export const telHref = (phone: string): string => `tel:${phone.replace(/[^\d+]/g, "")}`;

const clock = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
/** "8:00 AM – 4:00 PM", with the day in front when the window does not open today. */
export const windowText = (start: string, end: string, now: number): string => {
  const s = new Date(start), e = new Date(end);
  const day = s.toDateString() === new Date(now).toDateString() ? "" : `${s.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} `;
  return `${day}${clock(s)} – ${clock(e)}`;
};
