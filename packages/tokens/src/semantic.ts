import { PRIMITIVES as P } from "./primitives.ts";

/**
 * TIER 2 — semantic. ROLES, not colours. This tier is what makes white-label a
 * configuration change: a role can be re-pointed, a colour cannot.
 *
 * `color.status-breached`, never `oxblood`. The day a tenant's brand red is our
 * error red, a component named after the colour renders a breach as branding —
 * which is exactly the hole Plate 5 of the bulletin closes, in ./whitelabel.ts.
 *
 * THREE ROLES CARRY WHAT WAS ONE. Bulletin Form R-4 decomposes a state chip
 * into rule (shape), fill (salience) and word (meaning), because stacking every
 * requirement onto one colour is what forced Rev. A into a ramp that could not
 * exist. The same decomposition is why an action has three roles and not one:
 *
 *   color.action        the FILL. Copper. Never a word — 3.31:1 is large-type only.
 *   color.action-ink    the ink that sits ON that fill, at 4.63:1.
 *   color.action-text   the text-safe shade, for any copper word under 24px.
 *
 * A component that sets `color: var(--color-action)` on 13px body text is the
 * erosion this split makes visible in review.
 */
export const SEMANTIC = Object.freeze({
  /** The page ground. Panels sit on it; it is not itself a panel. */
  "color.page": P.stock.paper,
  /** The panel and row ground. */
  "color.surface": P.stock.surface,
  /** Table headers, status bars, inset wells — the darkest ground in the light stock, so ink is measured against it. */
  "color.surface-sunken": P.stock.paper2,
  /** A decorative hairline. It does NOT carry shape — 1.47:1 (E-08). */
  "color.border": P.stock.rule,
  /** The heavier rule: plate heads, the underline beneath a table head. Still decorative. */
  "color.border-hard": P.stock.ruleHard,
  "color.text": P.ink.black,
  /** ink.mid, not ink.light: the published ink.light is 3.17:1 on the header ground (E-07). */
  "color.text-muted": P.ink.mid,
  "color.action": P.copper.fill,
  "color.action-ink": P.copper.onFill,
  "color.action-text": P.copper.text,
  "color.action-pressed": P.copper.text,
  "color.focus-ring": P.copper.fill,
  "color.status-ok": P.state.olive,
  "color.status-at-risk": P.state.ochre,
  "color.status-breached": P.state.oxblood,
  "color.status-blocked": P.ink.mid,
  /**
   * The only fill in the state ramp. Transparent here on purpose: in the light
   * stock a fault is an outline chip, and the one solid chip in the system
   * exists on the field ground alone, where hue has stopped working (Plate 4).
   */
  "color.status-breached-fill": "transparent",
});

export type SemanticToken = keyof typeof SEMANTIC;

/**
 * The tenant accent slots, and nothing else.
 *
 * Structural tokens — spacing, control sizes, focus-ring geometry, the state
 * ramp — are NOT overridable, because a themeable focus ring is an
 * accessibility regression shipped under someone else's logo and our liability,
 * and a themeable state ramp is an instrument a tenant re-keyed.
 *
 * The board inside a tenant's portal stays in Rankine's ramp. A technician
 * reads it the same way in every tenant, or it is not an instrument.
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
] as const satisfies readonly SemanticToken[]);

/**
 * The state ramp, by name. Read by the accent gate (Plate 5): a tenant accent
 * must clear 30° of hue from every one of these, or it is barred from any
 * surface that renders one.
 */
export const STATE_ROLES = Object.freeze([
  "color.status-ok",
  "color.status-at-risk",
  "color.status-breached",
] as const satisfies readonly SemanticToken[]);
