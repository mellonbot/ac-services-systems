import { PRIMITIVES as P } from "./primitives.ts";

/**
 * TIER 2 — semantic. ROLES, not colours. This tier is what makes white-label a
 * configuration change: a role can be re-pointed, a colour cannot.
 *
 * `color.status-breached`, never `oxide`. The day a tenant's brand red is our
 * error red, a component named after the colour renders a breach as branding —
 * the hole Plate 04 closes, in ./whitelabel.ts.
 *
 * TWO ACCENT LAYERS, and the split is the load-bearing decision of Bulletin 2:
 *
 *   color.brand*   RED. The wordmark, the livery, the badge, S1 marketing.
 *                  Barred from any surface that renders a state ramp, because
 *                  red measures 1.2° from the fault ink and a red control on a
 *                  dispatch board is an alarm whatever we name it.
 *   color.action*  ARC. Every interface that shows state. The board reads the
 *                  same in every tenant, including ours.
 *
 * `css.ts` resolves `color.brand` to Ink Black on a state-rendering surface, so
 * painting red is an explicit opt-in and the safe direction is the default.
 *
 * THREE ROLES CARRY WHAT WAS ONE, on both accents. Form R-4 decomposes a state
 * chip into rule (shape), fill (salience) and word (meaning), because stacking
 * every requirement onto one colour forces a ramp that cannot exist:
 *
 *   color.action        the FILL. 2.09:1 — never a word.
 *   color.action-ink    the ink ON that fill, at 6.40:1.
 *   color.action-text   the text-safe step, for any arc word under 24px.
 */
export const SEMANTIC = Object.freeze({
  /** The page ground. Panels sit on it; it is not itself a panel. */
  "color.page": P.stock.page,
  /** The panel and row ground. */
  "color.surface": P.stock.surface,
  /** Table headers, status bars, inset wells — the darkest ground in the stock, so ink is measured against it. */
  "color.surface-sunken": P.stock.header,
  /** A decorative hairline. It does NOT carry shape (E-08). */
  "color.border": P.stock.rule,
  /** The heavier rule: plate heads, the underline beneath a table head. Still decorative. */
  "color.border-hard": P.stock.ruleHard,
  "color.text": P.ink.black,
  /** ink.mid, not ink.light: the published ink.light is 3.17:1 on the header ground (E-07). */
  "color.text-muted": P.ink.mid,

  "color.action": P.arc.fill,
  "color.action-ink": P.arc.onFill,
  "color.action-text": P.arc.envelope,
  /** A press brightens toward the core. The ink on it is the same graphite, at a higher ratio. */
  "color.action-pressed": P.arc.core,
  "color.focus-ring": P.arc.envelope,

  /** The brand layer. Resolved to Ink Black by `tokenCss` on any state-rendering surface. */
  "color.brand": P.brand.fill,
  "color.brand-ink": P.brand.onFill,
  "color.brand-text": P.brand.text,

  "color.status-ok": P.state.jade,
  "color.status-at-risk": P.state.amber,
  "color.status-breached": P.state.oxide,
  "color.status-blocked": P.ink.mid,
  /**
   * The only fill in the state ramp. Transparent here on purpose: in the light
   * stock a fault is an outline chip, and the one solid chip in the system
   * exists on the field ground alone, where hue has stopped working.
   */
  "color.status-breached-fill": "transparent",
});

export type SemanticToken = keyof typeof SEMANTIC;

/**
 * The tenant accent slots, and nothing else.
 *
 * The state ramp and the structural tokens are NOT overridable: a themeable
 * focus ring is an accessibility regression shipped under someone else's logo,
 * and a themeable state ramp is an instrument a tenant re-keyed. The board
 * inside a tenant's portal stays in Rankine's ramp, or it is not an instrument.
 */
export const BRAND_OVERRIDABLE = Object.freeze([
  "color.page",
  "color.surface",
  "color.surface-sunken",
  "color.border",
  "color.border-hard",
  "color.text",
  "color.text-muted",
  "color.action",
  "color.action-ink",
  "color.action-text",
  "color.action-pressed",
  "color.brand",
  "color.brand-ink",
  "color.brand-text",
] as const satisfies readonly SemanticToken[]);

/**
 * The state ramp, by name. Read by the accent gate: a tenant accent must clear
 * 30° of hue from every one of these, or it is barred from any surface that
 * renders one — which is the same fence the house red sits behind.
 */
export const STATE_ROLES = Object.freeze([
  "color.status-ok",
  "color.status-at-risk",
  "color.status-breached",
] as const satisfies readonly SemanticToken[]);

/** The brand-layer roles, which `tokenCss` resolves to neutral on a state-rendering surface. */
export const BRAND_ROLES = Object.freeze([
  "color.brand",
  "color.brand-ink",
  "color.brand-text",
] as const satisfies readonly SemanticToken[]);
