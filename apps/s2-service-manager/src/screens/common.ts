import { html, retryable, RefusalCard, PrimaryAction, type VNode, type Router } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import type { Refusal, DensityOf } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import type { SCREENS } from "../screens.ts";
import { resourceView } from "../../../../packages/ui/src/screen-helpers.ts";
export { formValues, linkTo } from "../../../../packages/ui/src/screen-helpers.ts";

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
export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode =>
  resourceView(r, view, {
    loadingClass: "s2-loading",
    refused: (refusal) => refusalView(ctx, refusal, retry && retryable(refusal) ? [{ label: "Try again", onSelect: retry, primary: true }] : []),
  });

export const refusalView = (ctx: ScreenContext, refusal: Refusal, routes: readonly { label: string; onSelect: () => void; primary?: boolean }[] = []): VNode =>
  RefusalCard({ density: ctx.density, refusal, routes }) ?? html``;

/**
 * The mutation button: disabled with the declared reason while degraded — S2 is read-only from last server state.
 * `blocked` is the other reason a form cannot go: a required choice with nothing to choose.
 */
export const submitAction = (ctx: ScreenContext, label: string, id?: string, blocked?: string | null): VNode =>
  PrimaryAction({
    density: ctx.density, label, type: "submit",
    ...(id ? { id } : {}),
    ...(ctx.degraded ? { disabledReason: ctx.shell.degradedNotice } : blocked ? { disabledReason: blocked } : {}),
  }) ?? html``;

/** Once the regions are read and none of ours is active, why a form that needs one cannot go. */
export const noActiveRegion = (r: Resource<{ readonly regions: readonly { readonly assignable: boolean }[] }>): string | null =>
  r.state === "ready" && !r.value.regions.some((x) => x.assignable) ? "No region of ours is active to choose." : null;

/** Once the click's render has landed: focus or reveal what it opened. Nothing to do without a DOM (node --test). */
export const afterRender = (fn: (doc: Document) => void): void => {
  if (typeof document !== "undefined") setTimeout(() => fn(document), 0);
};

/** On a window's first day: hold its last day to it, so a reversed window is the browser's word at the field, not a refusal after it. */
export const boundEnd = (endName: string) => (e: Event): void => {
  const start = e.currentTarget as HTMLInputElement;
  const end = start.form?.elements.namedItem(endName);
  if (end && "min" in end) end.min = start.value;
};

/** A required choice with nothing to choose, said where the select would be — an empty required select can only fail. */
export const noChoice = (label: string, why: string, fix?: VNode | null): VNode =>
  html`<div class="ac-field"><span>${label}</span><p class="s2-empty">${why}${fix ? html` ${fix}` : null}</p></div>`;

/** Read a form as strings. Uncontrolled inputs, read at submit (09 §3.5). */
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
