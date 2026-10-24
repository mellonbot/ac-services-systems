import { html, type VNode } from "./render.ts";
import type { Params, Router, ScreenSpec } from "./router.ts";

export const linkTo = <S extends Record<string, ScreenSpec>, K extends keyof S & string>(
  ctx: { readonly router: Router<S> },
  screen: K,
  params: Params,
  label: string,
  cls = "ac-link",
): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

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
