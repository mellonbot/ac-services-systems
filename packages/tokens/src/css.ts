import { PRIMITIVES as P } from "./primitives.ts";
import { SEMANTIC, BRAND_OVERRIDABLE, type SemanticToken } from "./semantic.ts";
import { DENSITY, type Density } from "./density.ts";
import { FACES } from "./type.ts";
import { contrastRatio, validateBrandTheme } from "./whitelabel.ts";

/**
 * TOKENS → CSS. The one place a token becomes a stylesheet.
 *
 * A component never contains a colour: it names a role as a CSS variable
 * (`var(--color-status-breached)`) and this file decides what the variable
 * holds for a given density. The frame emitter inlines `tokenCss(density)` at
 * build time; the guard fails any `#rrggbb` outside packages/tokens, so the
 * only way to get a colour onto a screen is through here.
 *
 * Variable naming is mechanical — `color.status-breached` →
 * `--color-status-breached` — so a reviewer can go from a stylesheet to the
 * semantic tier by reading, not by searching a mapping table.
 */
export const cssVar = (token: string): string => `--${token.replace(/\./g, "-")}`;

/**
 * THE FIELD GROUND (bulletin Plate 4). Not a dark theme — a second substrate.
 * The tablet is read on a roof at 2pm in July, so this ground does not follow
 * the viewer's preference, because the roof does not follow the viewer's
 * preference.
 *
 * Measured on #1C1813 the light state ramp reads olive 2.50, ochre 2.84 and
 * oxblood 1.85:1. All three fail, and oxblood at 1.85:1 meant GATE CLOSED was
 * invisible on the one surface a technician reads in sunlight. Raising all
 * three to pass lands them at the same relative luminance — identical in
 * monochrome, identical to a fully colour-blind technician. Passing the ratio
 * is not the same as passing the surface.
 *
 * So this tier does not encode state in hue at all. It encodes state in FORM
 * and lets hue confirm: the rule carries shape, the fill carries salience, the
 * word carries meaning. `color.status-breached` is cream here — the rule and
 * the word — and `color.status-breached-fill` is the oxide the fill is drawn
 * in. Greyscale the screen and the order still reads: outline-mute,
 * outline-bright, solid.
 *
 * The copper FILL is identical in both stocks, verified on both grounds: a
 * button is the same artwork in a console and on the tablet.
 */
export const SEMANTIC_DARK = Object.freeze({
  "color.page": P.plate.page,
  "color.surface": P.plate.ground,
  "color.surface-sunken": P.plate.well,
  "color.border": P.plate.rule,
  "color.border-hard": P.plate.ruleHard,
  "color.text": P.plate.cream,
  "color.text-muted": P.plate.creamMute,
  "color.action": P.copper.fill,
  "color.action-ink": P.copper.onFill,
  "color.action-text": P.copper.dark,
  "color.action-pressed": P.copper.text,
  "color.focus-ring": P.copper.dark,
  "color.status-ok": P.plate.olive,
  "color.status-at-risk": P.plate.ochre,
  "color.status-breached": P.plate.cream,
  "color.status-blocked": P.plate.creamMute,
  "color.status-breached-fill": P.plate.oxide,
} as const satisfies Record<SemanticToken, string>);

/** The semantic tier as a density sees it. */
export const semanticFor = (density: Density): Readonly<Record<SemanticToken, string>> =>
  DENSITY[density].surface === "dark" ? SEMANTIC_DARK : SEMANTIC;

/**
 * Everything the frame needs in one `:root` block: the semantic roles, the
 * density's structural values, the four faces, and the spacing / radius / type
 * / tracking scales. Deterministic — sorted roles, no timestamps — so the frame
 * is byte-comparable.
 */
export const tokenCss = (density: Density): string => {
  const d = DENSITY[density];
  const lines: string[] = [];
  const sem = semanticFor(density);
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
  );
  for (const [role, f] of Object.entries(FACES)) lines.push(`--font-${role}:${f.stack}`);
  for (const [k, v] of Object.entries(P.space)) lines.push(`--space-${k}:${v}`);
  for (const [k, v] of Object.entries(P.radius)) lines.push(`--radius-${k}:${v}`);
  for (const [k, v] of Object.entries(P.text)) lines.push(`--text-${k}:${v}`);
  for (const [k, v] of Object.entries(P.track)) lines.push(`--track-${k}:${v}`);
  return `:root{${lines.join(";")}}`;
};

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
  return `:root{${lines.join(";")}}`;
};

/**
 * THE GROUNDS an ink is permitted to sit on. Errata E-01: Rev. A published its
 * ratios against the paper, and every ink actually sits on the panel or the
 * header ground. A ratio is stated against the WORST ground the ink is
 * permitted on, because that is the only number that governs — so the check
 * takes the minimum across all three rather than nominating one.
 */
export const GROUNDS = Object.freeze([
  "color.page", "color.surface", "color.surface-sunken",
] as const satisfies readonly SemanticToken[]);

/** Roles that carry a WORD. 4.5:1 against every ground, in every density. */
export const WORD_ROLES = Object.freeze([
  "color.text", "color.text-muted", "color.action-text",
  "color.status-ok", "color.status-at-risk", "color.status-breached", "color.status-blocked",
] as const satisfies readonly SemanticToken[]);

/**
 * Roles that carry SHAPE and no word: the resting fill of a control, and the
 * focus ring. 3:1, WCAG 1.4.11.
 *
 * `color.action-pressed` is deliberately absent. A pressed fill is transient
 * and darker than its resting state by construction; the control's shape is
 * carried by its rule (`color.action-text`), which is held to 4.5:1 above. The
 * requirement it does carry is the word on it, checked in ON_FILL.
 */
export const SHAPE_ROLES = Object.freeze([
  "color.action", "color.focus-ring",
] as const satisfies readonly SemanticToken[]);

/**
 * Form R-4: the word carries meaning at 4.5:1 against ITS OWN FILL, not against
 * the ground behind it. This is what lets the oxide fault fill be a saturated
 * period red at 2.13:1 against the plate ground — it is not carrying the word
 * and it is not carrying the shape.
 */
export const ON_FILL = Object.freeze([
  ["color.action-ink", "color.action"],
  ["color.action-ink", "color.action-pressed"],
  ["color.status-breached", "color.status-breached-fill"],
] as const satisfies readonly (readonly [SemanticToken, SemanticToken])[]);

/**
 * Every failure in a density, stated with the number — "insufficient contrast"
 * starts an argument and "3.17:1, needs 4.5:1" ends one. Read by the test and
 * by nothing else at runtime.
 */
export const contrastFailures = (density: Density): readonly string[] => {
  const sem = semanticFor(density);
  const out: string[] = [];
  const check = (fg: SemanticToken, bg: SemanticToken, min: number, what: string) => {
    if (sem[bg] === "transparent") return;
    const r = contrastRatio(sem[fg], sem[bg]);
    if (r < min) out.push(`${density}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min.toFixed(1)}:1 (${what})`);
  };
  for (const fg of WORD_ROLES) for (const bg of GROUNDS) check(fg, bg, 4.5, "carries a word");
  for (const fg of SHAPE_ROLES) for (const bg of GROUNDS) check(fg, bg, 3.0, "carries shape");
  for (const [ink, fill] of ON_FILL) check(ink, fill, 4.5, "the word on its own fill");
  return out;
};
