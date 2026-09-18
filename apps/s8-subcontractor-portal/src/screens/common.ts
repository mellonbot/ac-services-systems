import { html, refusalHeading, PrimaryAction, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, FirmWire, CrewWire } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import { keyOf } from "../state.ts";
import type { SCREENS } from "../screens.ts";

/** What every S8 screen receives. A screen is a function of this and its route params — nothing else. */
export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S8">;
  readonly degraded: boolean;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

/** Render a resource: the value when ready, a quiet line while loading, the refusal as a decision otherwise. */
export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s8-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalView(ctx, r.refusal, retry ? [{ label: "Try again", onSelect: retry, primary: true }] : []);
  }
};

/**
 * A refusal, as a firm reads it. NOT RefusalCard — that component is
 * console-only by spec, and the admission axis, the permitted authoring
 * tiers and the code are the office's to act on. The firm needs the same
 * heading the console uses, the gateway's message verbatim, and a way
 * forward. The discipline S6 follows for the customer.
 */
export const refusalView = (ctx: ScreenContext, refusal: Refusal, routes: readonly { label: string; onSelect: () => void; primary?: boolean }[] = []): VNode =>
  html`<section class="s8-refusal" role="alert" data-kind=${refusal.kind} data-density=${ctx.density}>
    <h2 class="s8-refusal__heading">${refusalHeading(refusal)}</h2>
    <p class="s8-refusal__message">${refusal.message}</p>
    ${routes.length ? html`<div class="s8-refusal__routes">
      ${routes.map((r) => html`<button type="button" class="ac-action" data-kind=${r.primary ? "primary" : "quiet"} data-density=${ctx.density} onClick=${r.onSelect}>${r.label}</button>`)}
    </div>` : null}
  </section>`;

/**
 * A mutation button. Disabled with the declared reason while the gateway is
 * unreachable: the registry says "acknowledges on receipt, not on processing"
 * — and a receipt needs a gateway to give it. There is no queue here
 * (`offline: false`); a document shown as filed that nobody received is a
 * crew that cannot be sent and a firm that does not know it.
 */
export const submitAction = (ctx: ScreenContext, label: string, id?: string, busy = false): VNode =>
  PrimaryAction({
    density: ctx.density, label, type: "submit",
    ...(id ? { id } : {}),
    ...(ctx.degraded ? { disabledReason: `Gateway unreachable — ${ctx.shell.degradedMode}` } : busy ? { disabledReason: "Sending…" } : {}),
  }) ?? html``;

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "s8-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

/** The firm's own row — `firms.list` returns exactly one to a firm principal (0005). */
export const readFirm = (ctx: ScreenContext) =>
  ctx.store.read(keyOf("firms.list", {}), () => ctx.shell.gateway.listFirms({}));
export const firmOf = (out: { readonly firms: readonly FirmWire[] }): FirmWire | null => out.firms[0] ?? null;

/** The firm's own crews — no firm filter: the rows are the scope. */
export const readCrews = (ctx: ScreenContext) =>
  ctx.store.read(keyOf("crews.list", {}), () => ctx.shell.gateway.listCrews({}));

/** What the gate would say about a crew today, from the summary the gateway computed. */
export type Readiness = { readonly status: "ok" | "at_risk" | "blocked"; readonly word: string; readonly detail: string };
export const readiness = (c: CrewWire): Readiness => {
  const d = c.documents;
  if (!c.active) return { status: "blocked", word: "Retired", detail: "Not on the roster" };
  if (d.missing.length > 0) return { status: "blocked", word: "Cannot be sent", detail: `No ${d.missing.map(kindWord).join(", ")} on file` };
  if (d.expired.length > 0) return { status: "blocked", word: "Cannot be sent", detail: `${d.expired.map(kindWord).join(", ")} expired` };
  if (d.unverified.length > 0) return { status: "at_risk", word: "Awaiting Rankine", detail: `${d.unverified.map(kindWord).join(", ")} filed, not yet verified` };
  return { status: "ok", word: "Ready to dispatch", detail: d.earliestExpiry ? `Earliest expiry ${d.earliestExpiry}` : "All documents verified" };
};

export const kindWord = (k: string): string => ({ insurance: "insurance", license: "licence", certification: "certification", background_check: "background check" } as Record<string, string>)[k] ?? k.replace(/_/g, " ");
export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "—");
export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "—");

/** Integer minor units as a string → a human amount. Not arithmetic: a formatting of the wire's digits. */
export const money = (minor: string, currency: string): string => {
  const neg = minor.startsWith("-");
  const digits = neg ? minor.slice(1) : minor;
  const whole = digits.length > 2 ? digits.slice(0, -2) : "0";
  const cents = digits.padStart(3, "0").slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}${grouped}.${cents} ${currency}`;
};
