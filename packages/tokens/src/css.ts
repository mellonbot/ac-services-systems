import { PRIMITIVES as P } from "./primitives.ts";
import { SEMANTIC, BRAND_OVERRIDABLE, type SemanticToken } from "./semantic.ts";
import { DENSITY, type Density } from "./density.ts";
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
 * The field surface is dark (DENSITY.field.surface), for direct sunlight on a
 * tablet. These are the semantic roles re-pointed at dark-surface primitives;
 * every other density uses SEMANTIC as declared. Same roles, same names —
 * a component written for console renders in the field with no change,
 * which is the whole reason the roles exist.
 *
 * The focus ring keeps the rule the light tier keeps: never the action hue.
 * That rule used to read "amber, because the action is blue" — with a copper
 * action, amber IS the action hue, so the value moves and the reason does not.
 * Stock white is hue-neutral against copper and reads at 18:1 on the ground.
 *
 * Status carries a 400 here where the light tier carries a 600: one value
 * cannot clear 3:1 against both stock and ink.
 */
export const SEMANTIC_DARK = Object.freeze({
  "color.surface": P.ink[900],
  "color.surface-sunken": P.ink[1000],
  "color.border": P.ink[500],
  "color.text": P.stock[0],
  "color.text-muted": P.stock[300],
  /**
   * copper.500, not the brighter copper.300, and the label is why: a filled
   * action carries stock.0 white, which reads at 4.89:1 on copper.500 and
   * 2.92:1 on copper.300. The brighter ink looks better in a palette and ships
   * an unreadable button into the one tier that exists for direct sunlight.
   */
  "color.action": P.copper[500],
  "color.action-pressed": P.copper[700],
  "color.focus-ring": P.stock[0],
  "color.status-ok": P.olive[400],
  "color.status-at-risk": P.ochre[400],
  "color.status-breached": P.oxblood[400],
  "color.status-blocked": P.stock[300],
} as const satisfies Record<SemanticToken, string>);

/** The semantic tier as a density sees it. */
export const semanticFor = (density: Density): Readonly<Record<SemanticToken, string>> =>
  DENSITY[density].surface === "dark" ? SEMANTIC_DARK : SEMANTIC;

/**
 * Everything the frame needs in one `:root` block: the semantic roles, the
 * density's structural values, and the spacing / radius / type scale.
 * Deterministic — sorted keys, no timestamps — so the frame is byte-comparable.
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
  for (const [k, v] of Object.entries(P.space)) lines.push(`--space-${k}:${v}`);
  for (const [k, v] of Object.entries(P.radius)) lines.push(`--radius-${k}:${v}`);
  for (const [k, v] of Object.entries(P.text)) lines.push(`--text-${k}:${v}`);
  // A face is a role too. `--font-instrument` is the one every numeral uses, so
  // a stylesheet can hold the rule in one declaration instead of a convention.
  for (const [k, v] of Object.entries(P.font)) lines.push(`--font-${k}:${v}`);
  return `:root{${lines.join(";")}}`;
};

/**
 * A tenant's brand stylesheet (S6). Validated first — the theme that breaks the
 * portal never becomes a file. Only the seven overridable roles can appear;
 * the validator says so with the number if they do not.
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

/** The contrast pairs every density's semantic tier must satisfy. Read by the test and by nothing else at runtime. */
export const CONTRAST_PAIRS: readonly [SemanticToken, SemanticToken, number][] = [
  ["color.text", "color.surface", 4.5],
  ["color.text-muted", "color.surface", 4.5],
  ["color.action", "color.surface", 3.0],
  ["color.focus-ring", "color.surface", 3.0],
  ["color.status-ok", "color.surface", 3.0],
  ["color.status-at-risk", "color.surface", 3.0],
  ["color.status-breached", "color.surface", 3.0],
  ["color.status-blocked", "color.surface", 3.0],
];

export const contrastFailures = (density: Density): readonly string[] => {
  const sem = semanticFor(density);
  return CONTRAST_PAIRS.flatMap(([fg, bg, min]) => {
    const r = contrastRatio(sem[fg], sem[bg]);
    return r < min ? [`${density}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min.toFixed(1)}:1`] : [];
  });
};
