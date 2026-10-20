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
