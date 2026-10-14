import { html, RefusalCard, PrimaryAction, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { SCREENS } from "../screens.ts";

/** What every screen receives. A screen is a function of this and its route params — nothing else. */
export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S2">;
  readonly degraded: boolean;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

/** Render a resource: the value when ready, a quiet line while loading, the refusal as a decision otherwise. */
export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s2-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return refusalView(ctx, r.refusal, retry ? [{ label: "Try again", onSelect: retry, primary: true }] : []);
  }
};

export const refusalView = (ctx: ScreenContext, refusal: Refusal, routes: readonly { label: string; onSelect: () => void; primary?: boolean }[] = []): VNode =>
  RefusalCard({ density: ctx.density, refusal, routes }) ?? html``;

/** The mutation button: disabled with the declared reason while degraded — S2 is read-only from last server state. */
export const submitAction = (ctx: ScreenContext, label: string, id?: string): VNode =>
  PrimaryAction({
    density: ctx.density, label, type: "submit",
    ...(id ? { id } : {}),
    ...(ctx.degraded ? { disabledReason: `Gateway unreachable — ${ctx.shell.degradedMode}` } : {}),
  }) ?? html``;

/** Read a form as strings. Uncontrolled inputs, read at submit (09 §3.5). */
export const formValues = (form: HTMLFormElement): Record<string, string> => {
  const out: Record<string, string> = {};
  // lib is es2023 without dom.iterable; forEach is on the base FormData type.
  new FormData(form).forEach((v, k) => { if (typeof v === "string") out[k] = v.trim(); });
  return out;
};

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "ac-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

export const confirmPanel = (p: {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}): VNode => html`<div class="s2-confirm" id=${p.id} role="group" aria-labelledby=${`${p.id}-title`}>
  <strong id=${`${p.id}-title`}>${p.title}</strong>
  <p>${p.detail}</p>
  <div class="s2-confirm__actions">
    <button type="button" class=${`s2-mutation${p.danger ? " s2-mutation--danger" : ""}`} disabled=${Boolean(p.busy || p.disabled)} onClick=${p.onConfirm}>${p.busy ? "Saving…" : p.confirmLabel}</button>
    <button type="button" class="s2-mutation s2-mutation--quiet" disabled=${p.busy ?? false} onClick=${p.onCancel}>Keep as is</button>
  </div>
</div>`;
