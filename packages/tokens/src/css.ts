import { PRIMITIVES as P } from "./primitives.ts";
import { SEMANTIC, BRAND_OVERRIDABLE, BRAND_ROLES, type SemanticToken } from "./semantic.ts";
import { DENSITY, TYPE_SCALE, type Density } from "./density.ts";
import { FACES } from "./type.ts";
import { contrastRatio, validateBrandTheme } from "./whitelabel.ts";

/**
 * TOKENS → CSS. The one place a token becomes a stylesheet.
 *
 * A component never contains a colour: it names a role as a CSS variable
 * (`var(--color-status-breached)`) and this file decides what the variable
 * holds for a given density and surface. The frame emitter inlines
 * `tokenCss(...)` at build time; the guard fails any `#rrggbb` outside
 * packages/tokens, so the only way to get a colour onto a screen is through
 * here.
 *
 * Variable naming is mechanical — `color.status-breached` →
 * `--color-status-breached` — so a reviewer can go from a stylesheet to the
 * semantic tier by reading, not by searching a mapping table.
 */
export const cssVar = (token: string): string => `--${token.replace(/\./g, "-")}`;

/**
 * THE FIELD GROUND. Not a dark theme — a second substrate. The tablet is read
 * on a roof at 2pm in July, so this ground does not follow the viewer's
 * preference, because the roof does not follow the viewer's preference.
 *
 * A light state ramp measured here fails outright, and raising all three states
 * to pass lands them at the same relative luminance — identical in monochrome,
 * identical to a fully colour-blind technician, identical through a sun-washed
 * screen. Passing the ratio is not the same as passing the surface.
 *
 * So this tier does not encode state in hue at all. It encodes state in FORM
 * and lets hue confirm: the rule carries shape, the fill carries salience, the
 * word carries meaning. `color.status-breached` is frost here — the rule and
 * the word — and `color.status-breached-fill` is the oxide the fill is drawn
 * in. Greyscale the screen and the order still reads outline-mute,
 * outline-bright, solid.
 *
 * The arc FILL is identical in both stocks, verified on both grounds: a button
 * is the same artwork in a console and on the tablet.
 */
export const SEMANTIC_DARK = Object.freeze({
  "color.page": P.plate.page,
  "color.surface": P.plate.ground,
  "color.surface-sunken": P.plate.well,
  "color.border": P.plate.rule,
  "color.border-hard": P.plate.ruleHard,
  "color.text": P.plate.frost,
  "color.text-muted": P.plate.frostMute,
  "color.action": P.arc.fill,
  "color.action-ink": P.arc.onFill,
  "color.action-text": P.arc.core,
  "color.action-pressed": P.arc.core,
  "color.focus-ring": P.arc.core,
  "color.brand": P.brand.fill,
  "color.brand-ink": P.brand.onFill,
  "color.brand-text": P.brand.bright,
  "color.status-ok": P.plate.jade,
  "color.status-at-risk": P.plate.amber,
  "color.status-breached": P.plate.frost,
  "color.status-blocked": P.plate.frostMute,
  "color.status-breached-fill": P.plate.oxide,
} as const satisfies Record<SemanticToken, string>);

/** The semantic tier as a density sees it, before the brand layer is resolved. */
export const semanticFor = (density: Density): Readonly<Record<SemanticToken, string>> =>
  DENSITY[density].surface === "dark" ? SEMANTIC_DARK : SEMANTIC;

/**
 * What the brand roles resolve to on a surface that renders a state ramp.
 *
 * Plate 04's verdict, applied to the house: an accent inside the state ramp's
 * hue range is admitted for the wordmark, the livery and marketing, and falls
 * back to Ink Black everywhere a state renders. In the field tier "Ink Black"
 * is frost — the plate ground's own ink.
 */
export const neutralBrand = (density: Density): Readonly<Record<string, string>> => {
  const sem = semanticFor(density);
  return {
    "color.brand": sem["color.text"],
    "color.brand-ink": sem["color.surface"],
    "color.brand-text": sem["color.text"],
  };
};

export type FrameOptions = {
  /**
   * True only for a surface that renders NO state ramp — S1 marketing, the
   * livery, the badge. Defaults to FALSE, so a screen cannot paint red by
   * forgetting the rule: the unsafe direction requires an explicit opt-in.
   */
  readonly brandLayer?: boolean;
};

/** The roles a frame emits, with the brand layer resolved for this surface. */
export const rolesFor = (
  density: Density,
  opts: FrameOptions = {},
): Readonly<Record<SemanticToken, string>> =>
  opts.brandLayer ? semanticFor(density) : { ...semanticFor(density), ...neutralBrand(density) };

/**
 * Everything the frame needs in one `:root` block: the semantic roles with the
 * brand layer resolved, the density's structural values, the five type roles,
 * and the spacing / radius / type / tracking scales. Deterministic — sorted
 * roles, no timestamps — so the frame is byte-comparable.
 */
export const tokenCss = (density: Density, opts: FrameOptions = {}): string => {
  const d = DENSITY[density];
  const lines: string[] = [];
  const sem = rolesFor(density, opts);
  for (const k of Object.keys(sem).sort() as SemanticToken[]) lines.push(`${cssVar(k)}:${sem[k]}`);
  lines.push(
    `--density:${density}`,
    `--control-height:${d.controlHeight}`,
    `--row-height:${d.rowHeight}`,
    `--body-text:${d.bodyText}`,
    `--gutter:${d.gutter}`,
    `--focus-ring:${d.focusRing}`,
    // 1 or 0, so a stylesheet can gate a hover affordance without a second
    // stylesheet per density: `opacity: calc(var(--hover) * ...)`.
    `--hover:${d.hoverAffordances ? 1 : 0}`,
    `--color-scheme:${d.surface}`,
    `--brand-layer:${opts.brandLayer ? 1 : 0}`,
  );
  for (const [role, f] of Object.entries(FACES)) lines.push(`--font-${role}:${f.stack}`);
  for (const [k, v] of Object.entries(P.space)) lines.push(`--space-${k}:${v}`);
  // `none` only. `radius.icon` and `radius.app` are artwork primitives with their
  // own substrate rules (an OS icon, an embroidered patch); a surface that could
  // read them is a surface that could round a corner.
  lines.push(`--radius-none:${P.radius.none}`);
  // The type scale is the DENSITY's, not a shared constant — see TYPE_SCALE.
  for (const [k, v] of Object.entries(TYPE_SCALE[density])) lines.push(`--text-${k}:${v}`);
  for (const [k, v] of Object.entries(P.track)) lines.push(`--track-${k}:${v}`);
  return `:root{${lines.join(";")}}`;
};

/**
 * THE SCOPE A TENANT THEME IS VALIDATED FOR, and therefore the only scope it may
 * apply in. `validateBrandTheme` measures an override against the LIGHT stock —
 * a tenant's ground against our ink, our ground against their ink — and a
 * `:root{}` block carries none of that with it: emitted unscoped, a tenant
 * surface token validated against Ink Black lands on the field frame, where
 * `--color-text` is cream. Nobody has to make a mistake for that to happen; it
 * is what an unscoped block MEANS.
 *
 * So the block says where it was measured. The field frame is `<html
 * data-density="field">` (tools/ci/emit-surfaces.ts), and the tablet keeps
 * Rankine's plate whatever a tenant sends — which is the instrument argument
 * `admitAccent` already makes, spelled as a selector instead of a policy.
 */
export const TENANT_SCOPE = `:root:not([data-density="field"])`;

/**
 * A tenant's brand stylesheet (S6). Validated first — the theme that breaks the
 * portal never becomes a file. Only the accent slots can appear; the validator
 * says so with the number if they do not.
 */
export const brandCss = (overrides: Readonly<Record<string, string>>): string => {
  const rejections = validateBrandTheme(overrides);
  if (rejections.length) {
    throw new Error(`brand theme rejected: ${rejections.map((r) => `${r.token} — ${r.reason}`).join("; ")}`);
  }
  const allowed = new Set<string>(BRAND_OVERRIDABLE);
  const lines = Object.keys(overrides).filter((k) => allowed.has(k)).sort().map((k) => `${cssVar(k)}:${overrides[k]}`);
  return `${TENANT_SCOPE}{${lines.join(";")}}`;
};

/**
 * THE GROUNDS an ink is permitted to sit on. Errata E-01: Rev. A published its
 * ratios against the page, and every ink actually sits on the panel or the
 * header ground. A ratio is stated against the WORST ground the ink is
 * permitted on — so the check takes the minimum across all three rather than
 * nominating one and being wrong on the others.
 */
export const GROUNDS = Object.freeze([
  "color.page", "color.surface", "color.surface-sunken",
] as const satisfies readonly SemanticToken[]);

/** Roles that carry a WORD. 4.5:1 against every ground, in every density. */
export const WORD_ROLES = Object.freeze([
  "color.text", "color.text-muted", "color.action-text", "color.brand-text",
  "color.status-ok", "color.status-at-risk", "color.status-breached", "color.status-blocked",
] as const satisfies readonly SemanticToken[]);

/**
 * Roles that carry SHAPE and no word: the focus ring, and the rules a control
 * is drawn with. 3:1, WCAG 1.4.11.
 *
 * The FILLS — `color.action`, `color.brand`, `color.action-pressed`,
 * `color.status-breached-fill` — are deliberately absent. A fill carries
 * salience, not shape; its rule carries the shape and its ink carries the word,
 * both checked below. That decomposition is what lets the arc be an arc at
 * 2.09:1 and the oxide fault fill be a saturated oxide at 1.84:1.
 */
export const SHAPE_ROLES = Object.freeze([
  "color.focus-ring", "color.action-text",
] as const satisfies readonly SemanticToken[]);

/**
 * Form R-4: the word carries meaning at 4.5:1 against ITS OWN FILL, not against
 * the ground behind it.
 */
export const ON_FILL = Object.freeze([
  ["color.action-ink", "color.action"],
  // Every variant's pressed label, not just the primary's. `:active` sets a
  // fill; a variant that sets its own resting colour and does not set one here
  // keeps it, and `action-pressed` IS `action-text` by value — a quiet button
  // pressed to 1.00:1 (styles.ts holds the other half of this).
  ["color.action-ink", "color.action-pressed"],
  ["color.brand-ink", "color.brand"],
  ["color.status-breached", "color.status-breached-fill"],
  // The danger variant inverts on press rather than filling with the arc: a
  // destructive control does not borrow the primary's ink to say "pressed".
  ["color.page", "color.status-breached"],
  // The plate number: the one place the page ground is used AS an ink.
  ["color.page", "color.text"],
] as const satisfies readonly (readonly [SemanticToken, SemanticToken])[]);

/**
 * Every failure in a density, stated with the number — "insufficient contrast"
 * starts an argument and "3.27:1, needs 4.5:1" ends one. Checked for BOTH
 * resolutions of the brand layer, because a surface gets one or the other and
 * a schedule that only holds for one of them is half a schedule.
 */
export const contrastFailures = (density: Density): readonly string[] => {
  const out: string[] = [];
  for (const brandLayer of [true, false]) {
    const sem = rolesFor(density, { brandLayer });
    const tag = `${density}${brandLayer ? " (brand layer)" : ""}`;
    const check = (fg: SemanticToken, bg: SemanticToken, min: number, what: string) => {
      if (sem[bg] === "transparent") return;
      const r = contrastRatio(sem[fg], sem[bg]);
      if (r < min) out.push(`${tag}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min.toFixed(1)}:1 (${what})`);
    };
    for (const fg of WORD_ROLES) for (const bg of GROUNDS) check(fg, bg, 4.5, "carries a word");
    for (const fg of SHAPE_ROLES) for (const bg of GROUNDS) check(fg, bg, 3.0, "carries shape");
    for (const [ink, fill] of ON_FILL) check(ink, fill, 4.5, "the word on its own fill");
  }
  return out;
};

/** The brand roles a surface would paint, for the docs and the guard. */
export const brandRolesResolved = (density: Density, brandLayer: boolean): Readonly<Record<string, string>> =>
  Object.fromEntries(BRAND_ROLES.map((r) => [r, rolesFor(density, { brandLayer })[r]]));
