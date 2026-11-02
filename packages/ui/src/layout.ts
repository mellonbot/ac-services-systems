import { html, MastTools, type VNode, type ComponentChildren } from "./render.ts";
import { SURFACES, SURFACE_PATHS, ROLLOUT, surfacesAdmitting, type SurfaceId, type Namespace } from "../../contracts/src/index.ts";

/**
 * Rev A PAGE STRUCTURE (Bulletin No. 2 Rev A, 2026-09-27) — the two pieces
 * every surface's screens share: a page head (the screen's name and one plain
 * sentence of what it is for) and a stat strip (the figures that lead the
 * screen, each a count of rows the gateway returned — never a filter of the
 * screen's own). Plain markup over the .ac-page-head / .ac-stats rules in
 * UI_CSS; no density variant, because the variables already carry it.
 */
/**
 * The signed-in person's Account control and Sign out. The frame's masthead
 * slot is on the lockup row, above the red rule and in line with the company
 * descriptor. One place draws them, so every surface agrees.
 */
export const sessionTools = (account: ComponentChildren, onSignOut: () => void, switcher?: VNode | null): VNode =>
  html`<${MastTools}>${switcher}${account}<button type="button" class="ac-nav__signout" onClick=${onSignOut}>Sign out</button></${MastTools}>`;

type Who = { readonly namespace: Namespace; readonly roles: readonly string[] };

/**
 * The other live surfaces this principal may open — the registry's answer
 * (`surfacesAdmitting`, the same check the gateway makes at the door) narrowed
 * to what is published (`ROLLOUT`). Empty for anyone whose role opens only
 * this surface, so a dispatcher never sees a link to a door that refuses them.
 */
export const switchTargets = (current: SurfaceId, who: Who): readonly SurfaceId[] =>
  surfacesAdmitting(who).filter((id) => id !== current && ROLLOUT.includes(id));

/**
 * Switch surface without signing in again. A plain link: the next page boots
 * with `{ session: "cookie" }`, and the gateway's `ac_session` cookie — set
 * once at the front door, shared by every surface on the site — resumes it.
 * No token moves through script and nothing is re-asked.
 */
export const surfaceSwitch = (current: SurfaceId, who: Who): VNode | null => {
  const targets = switchTargets(current, who);
  if (targets.length === 0) return null;
  return html`<nav class="ac-nav__switch-group" aria-label="Switch surface">${targets.map((id) =>
    html`<a class="ac-nav__switch" href=${SURFACE_PATHS[id]}>${SURFACES[id].name}</a>`)}</nav>`;
};

export const pageHead = (title: ComponentChildren, lede?: ComponentChildren, side?: ComponentChildren): VNode =>
  html`<header class="ac-page-head">
    <div><h1 class="ac-page-head__title">${title}</h1>${lede ? html`<p class="ac-page-head__lede">${lede}</p>` : null}</div>
    ${side ? html`<div class="ac-page-head__side">${side}</div>` : null}
  </header>`;

export type StatTone = "ok" | "at_risk" | "breached";
export type StatTile = { readonly n: ComponentChildren; readonly label: string; readonly sub?: string; readonly tone?: StatTone };

/** A tone is set only where the number IS a state (a count of breaches, of things waiting); a plain count stays ink. */
export const statStrip = (tiles: readonly StatTile[], id?: string): VNode =>
  html`<div class="ac-stats" id=${id}>
    ${tiles.map((t) => html`<div class="ac-stat" data-tone=${t.tone}><span class="ac-stat__n">${t.n}</span><span class="ac-stat__l">${t.label}</span>${t.sub ? html`<span class="ac-stat__s">${t.sub}</span>` : null}</div>`)}
  </div>`;

/**
 * A panel: the card content sits in on the page ground. Title and one line of
 * sub are optional — a panel holding a single captioned grid needs neither.
 * Given an id and a title, the panel is a named region labelled by its h2.
 */
export const panel = (body: ComponentChildren, title?: ComponentChildren, sub?: ComponentChildren, side?: ComponentChildren, id?: string): VNode =>
  html`<section class="ac-panel" id=${id} aria-labelledby=${title && id ? `${id}__title` : undefined}>
    ${title ? html`<header class="ac-panel__head"><div><h2 class="ac-panel__title" id=${id ? `${id}__title` : undefined}>${title}</h2>${sub ? html`<p class="ac-panel__sub">${sub}</p>` : null}</div>${side ?? null}</header>` : null}
    ${body}
  </section>`;

export type NoticeTone = "ok" | "at_risk" | "breached";

/**
 * One sentence with a tone, as a status line: what a form did, in the
 * surface's words — filed, queued, acknowledged. A refusal is RefusalNotice,
 * which carries a heading and routes; this carries neither.
 */
export const notice = (tone: NoticeTone, body: ComponentChildren, id?: string): VNode =>
  html`<p class="ac-notice" role="status" data-tone=${tone} id=${id}>${body}</p>`;
