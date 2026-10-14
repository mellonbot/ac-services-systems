import { html, type VNode, type ComponentChildren } from "./render.ts";

/**
 * Rev A PAGE STRUCTURE (Bulletin No. 2 Rev A, 2026-09-27) — the two pieces
 * every surface's screens share: a page head (the screen's name and one plain
 * sentence of what it is for) and a stat strip (the figures that lead the
 * screen, each a count of rows the gateway returned — never a filter of the
 * screen's own). Plain markup over the .ac-page-head / .ac-stats rules in
 * UI_CSS; no density variant, because the variables already carry it.
 */
export const pageHead = (title: ComponentChildren, lede?: ComponentChildren, side?: ComponentChildren): VNode =>
  html`<header class="ac-page-head">
    <div><h1 class="ac-page-head__title">${title}</h1>${lede ? html`<p class="ac-page-head__lede">${lede}</p>` : null}</div>
    ${side ? html`<div class="ac-page-head__side">${side}</div>` : null}
  </header>`;

export type StatTone = "ok" | "at_risk" | "breached" | "info";
export type StatTile = { readonly n: ComponentChildren; readonly label: string; readonly sub?: string; readonly tone?: StatTone };

/** A tone is set only where the number IS a state (a count of breaches, of things waiting); a plain count stays ink. */
export const statStrip = (tiles: readonly StatTile[], id?: string): VNode =>
  html`<div class="ac-stats" id=${id}>
    ${tiles.map((t) => html`<div class="ac-stat" data-tone=${t.tone}><span class="ac-stat__n">${t.n}</span><span class="ac-stat__l">${t.label}</span>${t.sub ? html`<span class="ac-stat__s">${t.sub}</span>` : null}</div>`)}
  </div>`;

export type NoticeTone = "ok" | "at_risk" | "breached";

/**
 * One sentence with a tone, as a status line: what a form did, in the
 * surface's words — filed, queued, acknowledged. A refusal is RefusalNotice,
 * which carries a heading and routes; this carries neither.
 */
export const notice = (tone: NoticeTone, body: ComponentChildren, id?: string): VNode =>
  html`<p class="ac-notice" role="status" data-tone=${tone} id=${id}>${body}</p>`;
