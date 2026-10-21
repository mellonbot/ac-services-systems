import { TYPE_FLOOR, type Density } from "./density.ts";

/**
 * THE SHEET AUDIT — the bulletin's "parse the artefact and check every colour
 * mechanically", as a function any stylesheet can be handed to.
 *
 * `css.test.ts` proves the ROLES clear their grounds. It cannot see what a
 * stylesheet then does with them, and the component sheet was the only sheet
 * anything looked at: eight surfaces each carry a stylesheet the guard read
 * for hex literals and nothing else, and fourteen of their rules painted
 * `--color-action` — the arc FILL, 2.09:1 on the header ground, "never a
 * word" — as link and sign-out text. A role being right does not make its use
 * right, and these three checks are the uses the schedule forbids by name:
 *
 *   fill-as-word   a fill role sets `color`. The fill is licensed to sit at
 *                  2.09:1 because its ink and its envelope carry the word and
 *                  the shape; a word set IN the fill has neither.
 *   fill-as-rule   a fill role draws a border or outline. SHAPE_ROLES omits
 *                  the fills on purpose — a rule carries shape at 3:1, and the
 *                  fill does not clear it.
 *   below-floor    `font-size` in absolute px under TYPE_FLOOR[density]. The
 *                  scale is the density's; a hand-typed 10px on the comfort
 *                  tier is under the bulletin's own smallest step.
 *   relative-type  `font-size` in em or % below 1. The size is a fraction of
 *                  whatever it sits in, so no parse can prove the floor: a
 *                  .85em pill glyph inside an 11px pill rendered at 9.35px
 *                  and passed below-floor because it was never in px.
 *   state-as-category  a status ink in a rule keyed to a tone that is not a
 *                  state (`[data-tone="scheduled"]`). Rule 1: colour is state
 *                  or category, never both — a category drawn in the fault
 *                  ink reads as a fault to everyone who learned the ramp.
 *   control-without-height  a rule that makes something clickable
 *                  (`cursor:pointer`) where no rule for that selector sets a
 *                  height. Text buttons sized by their padding came out 17 to
 *                  33px on a tier whose control is 36 to 56.
 *
 * `color-mix(...)` is exempt everywhere: a fill mixed toward the surface is
 * a soft fill, which is how a chip and a pressed filter are drawn. box-shadow
 * is not checked — a selected row's inset bar is a fill carrying salience,
 * not a rule carrying shape.
 */
export type SheetViolation = {
  readonly rule: "fill-as-word" | "fill-as-rule" | "below-floor" | "relative-type" | "state-as-category" | "control-without-height";
  readonly selector: string;
  readonly message: string;
};

/**
 * The fill roles, and the role that carries a WORD against each. `--color-livery`
 * is absent on purpose: the lockup is fenced by ELEMENT (LIVERY_SELECTORS in
 * packages/ui/src/styles.test.ts), and the wordmark is the one place the red is a
 * word — always above WORDMARK_FLOOR, measured at 3.48:1 worst case.
 */
export const FILL_ROLES = Object.freeze({
  "--color-action": "--color-action-text",
  "--color-action-pressed": "--color-action-ink",
  "--color-brand": "--color-brand-text",
  "--color-status-breached-fill": "--color-status-breached",
} as const);

const RULE_PROPS = /^(?:border(?:-(?:top|right|bottom|left|inline-start|inline-end|block-start|block-end))?(?:-color)?|outline(?:-color)?)$/;

/** Remove every `color-mix(...)` call, balancing its parentheses, so a mixed fill is not mistaken for a painted one. */
const withoutColorMix = (value: string): string => {
  let out = "", i = 0;
  while (i < value.length) {
    const at = value.indexOf("color-mix(", i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let depth = 0, j = at + "color-mix".length;
    for (; j < value.length; j++) {
      if (value[j] === "(") depth++;
      else if (value[j] === ")" && --depth === 0) { j++; break; }
    }
    i = j;
  }
  return out;
};

const paintedFill = (value: string): keyof typeof FILL_ROLES | null => {
  const v = withoutColorMix(value);
  for (const role of Object.keys(FILL_ROLES) as (keyof typeof FILL_ROLES)[])
    if (new RegExp(`var\\(${role}\\s*[,)]`).test(v)) return role;
  return null;
};

/** The tone values that ARE states — the ramp's own names. Any other tone keyed to a status ink is a category in a state's colour. */
const STATE_TONES: readonly string[] = ["ok", "at_risk", "breached", "blocked"];
const STATUS_INK = /var\(--color-status-(?:ok|at-risk|breached|blocked)\s*[,)]/;

export const sheetViolations = (css: string, density: Density): readonly SheetViolation[] => {
  const out: SheetViolation[] = [];
  const declared = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const floor = TYPE_FLOOR[density];
  const rules = [...declared.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
  // A height set for a selector anywhere in the sheet counts, so a base rule and a state rule can split the declarations.
  const sized = new Set(rules.filter((r) => /(?:^|;)\s*(?:min-)?height\s*:/.test(r.body)).flatMap((r) => r.selector.split(",").map((s) => s.trim())));
  for (const { selector, body } of rules) {
    if (/(?:^|;)\s*cursor\s*:\s*pointer/.test(body))
      for (const part of selector.split(",").map((s) => s.trim()))
        if (!sized.has(part)) out.push({ rule: "control-without-height", selector: part, message: "is clickable but no rule sets its height — give it min-height:var(--control-height)" });
    const tone = /\[data-(?:tone|status|state)="([^"]+)"\]/.exec(selector);
    if (tone && !STATE_TONES.includes(tone[1]!) && STATUS_INK.test(body))
      out.push({ rule: "state-as-category", selector, message: `draws the "${tone[1]}" tone in a status ink — "${tone[1]}" is not a state; use ink, the arc family or line form` });
    for (const decl of body.split(";")) {
      const colon = decl.indexOf(":");
      if (colon < 0) continue;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      const value = decl.slice(colon + 1).trim();
      if (prop === "color") {
        const fill = paintedFill(value);
        if (fill) out.push({ rule: "fill-as-word", selector, message: `paints ${fill} as a word — the fill is never a word; set the text in ${FILL_ROLES[fill]}` });
      } else if (RULE_PROPS.test(prop)) {
        const fill = paintedFill(value);
        if (fill) out.push({ rule: "fill-as-rule", selector, message: `draws a rule in ${fill} — a fill carries salience, not shape; draw the rule in ${FILL_ROLES[fill]}` });
      } else if (prop === "font-size") {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
        if (px && Number(px[1]) < floor) out.push({ rule: "below-floor", selector, message: `sets ${value}, below the ${density} tier's ${floor}px floor — use the density's scale (--text-*)` });
        const rel = /^(\d*\.?\d+)(em|%)$/.exec(value);
        if (rel && Number(rel[1]) / (rel[2] === "%" ? 100 : 1) < 1) out.push({ rule: "relative-type", selector, message: `sets ${value}, a fraction of its parent that no parse can hold to the floor — use the density's scale (--text-*)` });
      }
    }
  }
  return out;
};
