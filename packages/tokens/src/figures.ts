import { PRIMITIVES as P } from "./primitives.ts";
import { SEMANTIC } from "./semantic.ts";
import { SEMANTIC_DARK } from "./css.ts";
import { contrastRatio, hueSeparation } from "./whitelabel.ts";

/**
 * THE PUBLISHED FIGURES — every number this system states about itself in
 * prose, computed from the tokens rather than typed beside them.
 *
 * `contrastFailures` already proves the schedule PASSES. It cannot prove the
 * schedule is DESCRIBED correctly, and those are different failures. The
 * thresholds are enforced; the figures quoted in a doc comment, an errata row
 * or docs/BRAND.md were hand-carried, and four of them had drifted before this
 * file existed:
 *
 *   the heavy rule        published 2.65:1   measured 2.22:1
 *   the published caption published 3.17:1   measured 3.27:1
 *   the oxide fault fill  published 2.13:1   measured 1.84:1
 *   red from the fault    published 1.2°     measured 0.55°
 *
 * (Both of the last two describe Bulletin 2 as issued. Rev C moved the fault
 * from oxide to garnet; the corrections are kept as the record.)
 *
 * None of them moved a pixel — every one is a sentence explaining a decision,
 * which is exactly why nothing caught them. A wrong number in the reasoning is
 * how a correct decision gets reversed later by someone who checks the
 * arithmetic and concludes the rule was never real.
 *
 * So: state a figure HERE, cite it in prose, and `figures.test.ts` fails the
 * build when the two part company. A figure that is not in this table is a
 * figure nobody is checking — when you write one into a comment, add it here.
 */

/** A figure the documentation states, and the measurement it is supposed to be. */
export type Figure = {
  /** Where the number is quoted, so a failure names the file to edit. */
  readonly cited: readonly string[];
  /** What the number means, in the voice the prose uses. */
  readonly claim: string;
  /** The value the prose states. */
  readonly published: number;
  /** The same value, measured from the tokens at module load. */
  readonly measured: number;
  /** `:1` for a contrast ratio, `°` for hue separation. */
  readonly unit: "ratio" | "degrees";
};

const ratio = (
  cited: readonly string[],
  claim: string,
  published: number,
  fg: string,
  bg: string,
): Figure => ({ cited, claim, published, measured: contrastRatio(fg, bg), unit: "ratio" });

const degrees = (
  cited: readonly string[],
  claim: string,
  published: number,
  a: string,
  b: string,
): Figure => ({ cited, claim, published, measured: hueSeparation(a, b), unit: "degrees" });

/**
 * The header ground is the darkest in the light stock and therefore the one a
 * light-stock figure is stated against (E-01). The plate ground is the field
 * tier's panel, which is what an ink on the tablet actually sits on.
 */
const HEADER = P.stock.header;
const PLATE = P.plate.ground;

export const FIGURES = Object.freeze({
  /**
   * CORRECTED from 2.65:1. The heavy rule is decorative and openly below 3:1 —
   * that is E-08's finding and it still stands — but it is below 3:1 by more
   * than the errata said. Against the header ground it is 2.22:1; 2.65:1 is not
   * this ink against any ground in the stock (2.56 on the page, 2.83 on the
   * panel). The decision does not change: no chip rule is drawn in a border
   * role, and `styles.test.ts` holds that line.
   */
  borderHard: ratio(
    ["packages/tokens/src/brand.ts BULLETIN_ERRATA E-08", "packages/ui/src/styles.ts", "docs/BRAND.md"],
    "the heavy rule, against the header ground — decorative, and below the 3:1 a shape needs",
    2.22,
    P.stock.ruleHard,
    HEADER,
  ),

  /** CORRECTED from 3.17:1. Still below AA, still off text duty — E-07 unchanged. */
  inkLight: ratio(
    ["packages/tokens/src/brand.ts BULLETIN_ERRATA E-07", "packages/tokens/src/semantic.ts", "docs/BRAND.md"],
    "the published caption ink, against the header ground — below AA, which is why text-muted is ink.mid",
    3.27,
    P.ink.light,
    HEADER,
  ),

  /**
   * The garnet fault fill on the plate ground. Licensed to sit low BECAUSE it
   * carries neither shape nor word — the rule and the frost word do — so a low
   * number is not a worse position. (Bulletin 2 as issued drew this fill in
   * oxide at 1.84:1; Rev C moved the fault off red.)
   */
  garnetFill: ratio(
    ["packages/tokens/src/css.ts", "packages/tokens/src/primitives.ts", "packages/tokens/src/css.test.ts"],
    "the garnet fault fill on the plate ground — a fill only, carrying neither shape nor word",
    1.95,
    P.plate.garnet,
    PLATE,
  ),

  /** The red action fill on the header ground: a fill and a rule, never a word under 24px. */
  actionFill: ratio(
    ["packages/tokens/src/primitives.ts", "packages/tokens/src/semantic.ts"],
    "the red action fill on the header ground — a fill, never a small word",
    3.65,
    P.brand.fill,
    HEADER,
  ),

  /** The red's text-safe step. */
  actionText: ratio(
    ["packages/tokens/src/primitives.ts"],
    "the text-safe red on the header ground — every red word under 24px",
    5.50,
    P.brand.text,
    HEADER,
  ),

  /** Form R-4's word-on-fill, the half that makes the fill's licence legitimate. */
  actionOnFill: ratio(
    ["packages/tokens/src/primitives.ts", "packages/tokens/src/semantic.ts", "packages/ui/src/styles.ts"],
    "the white label on the red action fill — the word, measured against its own fill",
    5.05,
    P.brand.onFill,
    P.brand.fill,
  ),

  /**
   * The red fill on the field ground. The SAME ink as `actionFill`, because a
   * button is the same artwork in a console and on the tablet.
   */
  actionFillOnPlate: ratio(
    ["packages/ui/src/styles.ts"],
    "the red action fill on the field ground — the fill the control's rule is drawn around",
    3.48,
    P.brand.fill,
    PLATE,
  ),

  /**
   * The danger variant's press, which INVERTS rather than borrowing the
   * primary's ink.
   */
  dangerInvertLight: ratio(
    ["packages/ui/src/styles.ts", "packages/tokens/src/brand.ts"],
    "the danger press on the light stock — the page ground used as an ink on the fault",
    6.18,
    SEMANTIC["color.page"],
    SEMANTIC["color.status-breached"],
  ),

  dangerInvertPlate: ratio(
    ["packages/ui/src/styles.ts", "packages/tokens/src/brand.ts"],
    "the danger press on the field ground",
    16.34,
    SEMANTIC_DARK["color.page"],
    SEMANTIC_DARK["color.status-breached"],
  ),

  /**
   * E-23. The field tier's heavy rule, which no errata row had ever measured.
   * E-08 measured the light stock's and fenced the ROLE; the plate's twin was
   * left to inference for two revisions. It is 2.85:1 against the plate
   * ground — the same position, on the substrate where a missed rule costs
   * most — and it is fenced by the same sentence, not repainted.
   */
  borderHardPlate: ratio(
    ["packages/tokens/src/brand.ts", "packages/tokens/src/css.test.ts"],
    "the heavy rule on the field ground — decorative there too, and below the 3:1 a shape needs",
    2.85,
    P.plate.ruleHard,
    PLATE,
  ),

  /** The frost word on the one solid chip in the system. */
  frostOnGarnet: ratio(
    ["docs/BRAND.md"],
    "frost on the garnet fill — the word on the field tier's only solid chip",
    7.58,
    P.plate.frost,
    P.plate.garnet,
  ),

  /**
   * Rev C. Red sat 0.55° from the oxide fault (E-21), so it was barred from
   * every surface that showed state. The fault moved to garnet instead, and red
   * now clears the gate with room to spare.
   */
  redFromFault: degrees(
    ["packages/tokens/src/primitives.ts", "packages/tokens/src/semantic.ts", "packages/tokens/src/whitelabel.ts", "docs/BRAND.md"],
    "brand red from the garnet fault ink",
    42.12,
    P.brand.fill,
    P.state.garnet,
  ),

  /** The red's NEAREST state hue — the warning amber — and the figure that admits it to the board. */
  redFromNearestState: degrees(
    ["packages/tokens/src/primitives.ts", "packages/ui/src/styles.ts", "docs/BRAND.md"],
    "the red from the nearest state hue on the light stock, the warning amber",
    35.32,
    P.brand.fill,
    P.state.amber,
  ),
} as const satisfies Record<string, Figure>);

export type FigureName = keyof typeof FIGURES;

/** How close a published figure has to be to its measurement. Two decimals, as quoted. */
export const FIGURE_TOLERANCE = 0.005;

/** Every figure whose published value has parted company with its measurement. */
export const figureDrift = (): readonly string[] =>
  (Object.entries(FIGURES) as [FigureName, Figure][])
    .filter(([, f]) => Math.abs(f.published - f.measured) > FIGURE_TOLERANCE)
    .map(([name, f]) =>
      `${name}: published ${format(f)}, measured ${format({ ...f, published: f.measured })} — ` +
      `${f.claim}. Quoted in ${f.cited.join(", ")}`,
    );

/** The figure as prose writes it, so a doc can be searched for the exact string. */
export const format = (f: Figure): string =>
  f.unit === "ratio" ? `${f.published.toFixed(2)}:1` : `${f.published.toFixed(2)}°`;

/**
 * THE STATE RAMP IN GREYSCALE, which is the question a contrast ratio does not
 * ask. Every ink here clears AA against its ground and the ramp could still be
 * three indistinguishable greys to a fully colour-blind technician or through a
 * sun-washed screen — the exact failure the plate ground was built to avoid.
 *
 * Returned as relative luminance in percent, in ramp order.
 */
export const stateLuminance = (stock: "light" | "plate"): readonly { readonly role: string; readonly pct: number }[] => {
  const sem = stock === "light" ? SEMANTIC : SEMANTIC_DARK;
  const breached = stock === "light" ? sem["color.status-breached"] : sem["color.status-breached-fill"];
  return [
    { role: "color.status-ok", pct: lum(sem["color.status-ok"]) },
    { role: "color.status-at-risk", pct: lum(sem["color.status-at-risk"]) },
    { role: "color.status-breached", pct: lum(breached) },
  ];
};

const lum = (hex: string): number => {
  // contrastRatio against black recovers luminance without a second import path:
  // (L + 0.05) / 0.05, inverted.
  return (contrastRatio(hex, "#000000") * 0.05 - 0.05) * 100;
};

/**
 * The thinnest gap anywhere in a stock's ramp, in luminance points.
 *
 * On the light stock this is 0.22 — jade and amber are ONE VALUE in greyscale.
 * That is not a defect to fix by retuning: both inks clear AA as words, and
 * moving either to open a greyscale gap costs the ratio that makes it readable
 * in the first place. It is the measurement that makes the second channel
 * load-bearing rather than belt-and-braces — a status is a glyph AND a word AND
 * a colour, and on the light stock the colour is the channel carrying least.
 */
export const thinnestGreyscaleGap = (stock: "light" | "plate"): number => {
  const l = stateLuminance(stock).map((s) => s.pct);
  return Math.min(...l.slice(1).map((v, i) => Math.abs(v - l[i]!)));
};
