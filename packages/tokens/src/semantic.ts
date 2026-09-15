import { PRIMITIVES as P } from "./primitives.ts";

/**
 * TIER 2 — semantic. ROLES, not colours. This tier is what makes white-label a
 * configuration change: a role can be re-pointed, a colour cannot.
 *
 * `color.status-breached`, never `oxblood-600`. The day a tenant's brand red is
 * our error red, a component named after the colour renders a breach as
 * branding.
 *
 * This is the light tier — console and comfort. The field tier re-points the
 * same role names at dark-surface primitives in css.ts; a component written for
 * console renders in the field with no change, which is why the roles exist.
 */
export const SEMANTIC = Object.freeze({
  "color.surface": P.stock[100],
  "color.surface-sunken": P.stock[200],
  "color.border": P.ink[300],
  "color.text": P.ink[900],
  "color.text-muted": P.ink[700],
  "color.action": P.copper[500],
  "color.action-pressed": P.copper[700],
  /**
   * The focus ring is INK, not copper — deliberately not the action hue.
   * A copper ring on a copper control is a ring nobody sees, which is the same
   * reason the field tier does not ring in copper either. Neutral on both
   * surfaces is one rule instead of two, and it is the more visible one.
   */
  "color.focus-ring": P.ink[900],
  "color.status-ok": P.olive[600],
  "color.status-at-risk": P.ochre[600],
  "color.status-breached": P.oxblood[600],
  "color.status-blocked": P.ink[500],
});

export type SemanticToken = keyof typeof SEMANTIC;

/**
 * Seven tokens are overridable. Seven.
 *
 * Structural tokens — spacing, control sizes, focus-ring geometry — are NOT,
 * because a themeable focus ring is an accessibility regression shipped under
 * someone else's logo and our liability.
 *
 * Note what is absent: the four status roles. A tenant cannot re-point what
 * "breached" looks like, because a breach rendered in a tenant's brand green is
 * a breach nobody escalated. White-label buys a surface, a text colour and an
 * action colour — not the meaning of the board.
 */
export const BRAND_OVERRIDABLE = Object.freeze([
  "color.surface",
  "color.surface-sunken",
  "color.border",
  "color.text",
  "color.text-muted",
  "color.action",
  "color.action-pressed",
] as const satisfies readonly SemanticToken[]);
