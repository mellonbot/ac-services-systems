import { PRIMITIVES as P } from "./primitives.ts";

/**
 * TIER 2 — semantic. ROLES, not colours. This tier is what makes white-label a
 * configuration change: a role can be re-pointed, a colour cannot.
 *
 * `color.status-breached`, never `red-600`. The day a tenant's brand red is our
 * error red, a component named after the colour renders a breach as branding.
 */
export const SEMANTIC = Object.freeze({
  "color.surface": P.gray[0],
  "color.surface-sunken": P.gray[50],
  "color.border": P.gray[300],
  "color.text": P.gray[900],
  "color.text-muted": P.gray[500],
  "color.action": P.blue[500],
  "color.action-pressed": P.blue[700],
  "color.focus-ring": P.blue[600],
  "color.status-ok": P.green[500],
  "color.status-at-risk": P.amber[600],
  "color.status-breached": P.red[500],
  "color.status-blocked": P.gray[700],
});

export type SemanticToken = keyof typeof SEMANTIC;

/**
 * Seven tokens are overridable. Seven.
 *
 * Structural tokens — spacing, control sizes, focus-ring geometry — are NOT,
 * because a themeable focus ring is an accessibility regression shipped under
 * someone else's logo and our liability.
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
