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
   * CORRECTED from 2.13:1. The fill is licensed to sit here BECAUSE it carries
   * neither shape nor word, so a lower number is not a worse position — but the
   * number has to be the real one, or the licence reads as having been granted
   * to something else.
   */
  oxideFill: ratio(
    ["packages/tokens/src/css.ts", "packages/tokens/src/primitives.ts", "packages/tokens/src/css.test.ts"],
    "the oxide fault fill on the plate ground — a fill only, carrying neither shape nor word",
    1.84,
    P.plate.oxide,
    PLATE,
  ),

  /** The arc fill, licensed at the same decomposition. Correct as published. */
  arcFill: ratio(
    ["packages/tokens/src/primitives.ts", "packages/tokens/src/semantic.ts"],
    "the arc fill on the header ground — never a word",
    2.09,
    P.arc.fill,
    HEADER,
  ),

  /** The arc's text-safe step. Correct as published. */
  arcEnvelope: ratio(
    ["packages/tokens/src/primitives.ts"],
    "the arc envelope on the header ground — every arc word under 24px, every rule, the focus ring",
    6.52,
    P.arc.envelope,
    HEADER,
  ),

  /** Form R-4's word-on-fill, the half that makes the fill's licence legitimate. */
  arcOnFill: ratio(
    ["packages/tokens/src/primitives.ts", "packages/tokens/src/semantic.ts", "packages/ui/src/styles.ts"],
    "the ink on the arc fill — the word, measured against its own fill",
    6.40,
    P.arc.onFill,
    P.arc.fill,
  ),

  /**
   * The arc fill on the field ground. The SAME ink as `arcFill`, three times
   * the ratio, because the ground moved — which is the whole argument for the
   * plate being a second substrate rather than a dark theme. PrimaryAction
   * quotes it; it read 3.61:1 while the fill was copper.
   */
  arcFillOnPlate: ratio(
    ["packages/ui/src/styles.ts"],
    "the arc fill on the field ground — the fill the control's rule is drawn around",
    6.07,
    P.arc.fill,
    PLATE,
  ),

  /**
   * The danger variant's press, which INVERTS rather than borrowing the
   * primary's ink. Both numbers were carried over from copper — 7.33:1 and
   * 15.02:1 — and neither is this palette.
   */
  dangerInvertLight: ratio(
    ["packages/ui/src/styles.ts", "packages/tokens/src/brand.ts"],
    "the danger press on the light stock — the page ground used as an ink on the fault",
    6.23,
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

  /** The frost word on the one solid chip in the system. */
  frostOnOxide: ratio(
    ["docs/BRAND.md"],
    "frost on the oxide fill — the word on the field tier's only solid chip",
    8.00,
    P.plate.frost,
    P.plate.oxide,
  ),

  /**
   * CORRECTED from 1.2°. By this repository's own `hueOf`, brand red sits at
   * 4.20° and the fault ink at 4.75°: 0.55° apart, not 1.2°. The correction
   * makes the argument STRONGER, not weaker — the two are nearly the same hue,
   * which is precisely why the slot is barred rather than the colour retuned.
   */
  redFromFault: degrees(
    ["packages/tokens/src/primitives.ts", "packages/tokens/src/semantic.ts", "packages/tokens/src/whitelabel.ts", "docs/BRAND.md"],
    "brand red from the fault ink — why no bright red clears the 30° gate",
    0.55,
    P.brand.fill,
    P.state.oxide,
  ),

  /** The band red would have to fit inside. Correct as published. */
  faultToWarning: degrees(
    ["packages/tokens/src/primitives.ts", "docs/BRAND.md"],
    "the fault ink to the warning ink — the whole width red has to find 30° inside",
    34.78,
    P.state.oxide,
    P.state.amber,
  ),

  /** The arc, clearing the same gate the house red fails. Correct as published. */
  arcFromNearestState: degrees(
    ["packages/ui/src/styles.ts", "docs/BRAND.md"],
    "the arc from the nearest state hue on the light stock",
    38.41,
    P.arc.fill,
    P.state.jade,
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
