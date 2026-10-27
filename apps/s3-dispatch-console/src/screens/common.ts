import { html, signal, retryable, RefusalCard, PrimaryAction, type Signal, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf, CustomerSegment } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { SCREENS } from "../screens.ts";
export { linkTo } from "../../../../packages/ui/src/screen-helpers.ts";

/** What every S3 screen receives. A screen is a function of this and its route params — nothing else. */
export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S3">;
  readonly degraded: boolean;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

/** Render a resource: the value when ready, a quiet line while loading, the refusal as a decision otherwise. */
export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s3-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalView(ctx, r.refusal, retry && retryable(r.refusal) ? [{ label: "Try again", onSelect: retry, primary: true }] : []);
  }
};

export const refusalView = (ctx: ScreenContext, refusal: Refusal, routes: readonly { label: string; onSelect: () => void; primary?: boolean }[] = []): VNode =>
  RefusalCard({ density: ctx.density, refusal, routes }) ?? html``;

/**
 * The mutation button: disabled with the declared reason while degraded — the
 * board freezes and stops accepting assignments (SURFACES.S3.degraded), with
 * no override path. This is the one place that sentence is enforced in the UI;
 * the gateway enforces it again regardless of what this button does.
 */
export const submitAction = (ctx: ScreenContext, label: string, onClick: () => void, id?: string, kind?: "primary" | "quiet" | "danger"): VNode =>
  PrimaryAction({
    density: ctx.density, label, onClick, ...(kind ? { kind } : {}),
    ...(id ? { id } : {}),
    ...(ctx.degraded ? { disabledReason: ctx.shell.degradedNotice } : {}),
  }) ?? html``;

/** Once the click's render has landed: move focus to what it opened. Nothing to do without a DOM (node --test). */
export const afterRender = (fn: (doc: Document) => void): void => {
  if (typeof document !== "undefined") setTimeout(() => fn(document), 0);
};
export const focusId = (id: string): void => afterRender((d) => (d.getElementById(id) as HTMLElement | null)?.focus());

/** A signal per store: screen state that lives as long as the session's store, and no longer. */
export const perStore = <T>(initial: T) => {
  const m = new WeakMap<Store, Signal<T>>();
  return (store: Store): Signal<T> => {
    let s = m.get(store);
    if (!s) { s = signal<T>(initial); m.set(store, s); }
    return s;
  };
};

/** A homeowner, marked where the office reads a site (0019) — commercial is the default and carries no mark. */
export const homeMark = (segment: CustomerSegment | null): VNode | null =>
  segment === "residential" ? html`<span class="s3-flag" data-segment="residential">Residential</span>` : null;
