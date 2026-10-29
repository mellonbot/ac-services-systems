import type { Refusal } from "../../contracts/src/index.ts";
import { html, type VNode } from "./render.ts";
import type { Params, Router, ScreenSpec } from "./router.ts";

/**
 * A resource as a screen renders it. Structural, so this package does not
 * import each surface's store: loading, the value, or the gateway's refusal.
 */
export type ViewResource<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "refused"; readonly refusal: Refusal };

/**
 * The shared skeleton of `whenReady`. The loading class and the refusal
 * component stay with the surface: a console card and a customer's notice
 * are not the same reading of one refusal.
 */
export const resourceView = <T>(
  r: ViewResource<T>,
  view: (value: T) => VNode,
  opts: { readonly loadingClass: string; readonly refused: (refusal: Refusal) => VNode },
): VNode => {
  switch (r.state) {
    case "loading": return html`<p class=${opts.loadingClass} role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return opts.refused(r.refusal);
  }
};


export const linkTo = <S extends Record<string, ScreenSpec>, K extends keyof S & string>(
  ctx: { readonly router: Router<S> },
  screen: K,
  params: Params,
  label: string,
  cls = "ac-link",
  /** The name a screen reader hears, when the visible label repeats row to row ("Move", "Edit"). */
  ariaLabel?: string,
): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} aria-label=${ariaLabel} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

export const formValues = (form: HTMLFormElement): Record<string, string> => {
  const values: Record<string, string> = {};
  new FormData(form).forEach((value, key) => { if (typeof value === "string") values[key] = value.trim(); });
  return values;
};

/**
 * The short reference a customer reads back to the office: the first block
 * of the row's id, upper-cased. One function, so the portal and the console
 * print the same eight characters for the same request.
 */
export const shortRef = (id: string): string => id.slice(0, 8).toUpperCase();

/**
 * The viewer's own calendar date, `YYYY-MM-DD`. Not `toISOString().slice(0, 10)`,
 * which is the date in UTC: in Texas every evening after 7 PM that is already
 * tomorrow, and a document expiring today reads as expired.
 */
export const localDay = (at: Date = new Date()): string =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
