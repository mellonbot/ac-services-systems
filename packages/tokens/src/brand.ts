import { PRIMITIVES as P } from "./primitives.ts";

/**
 * THE BRAND TIER — who the marks belong to, and what they are allowed to say.
 *
 * Data, like the surface registry, and for the same reason: the frame emitter
 * reads this file, so the name in a <title> and the name in the masthead cannot
 * disagree, and a rename is one reviewed diff rather than eight HTML files.
 *
 * Plate 9 — the structure the marks have to carry:
 *   Rankine Operating Company     national network, the platform, the contracting entity
 *   ├── AC Services DFW           Works No. 1, owned — keeps its name and its local book
 *   ├── Vance Mechanical          member firm, subcontracted — same gate, same tablet
 *   └── Amped Fitness             customer, white-label tenant — gated accent, no fork
 *
 * The network name is what a customer contracts with; the local firm keeps its
 * name, its reviews and its search equity. Both appear, and which one leads is
 * `endorsement`, not a judgement call made per page.
 */
export const BRAND = Object.freeze({
  name: "Rankine",
  legalName: "Rankine Operating Company",
  /** Set in the engraved face, +0.42em, under the wordmark. Never abbreviated to "ROC". */
  descriptor: "Operating Company",
  trade: "Heating · Ventilating · Refrigerating",
  /**
   * The motto is a constraint before it is a line. It is the reason the
   * marketing surface prints no availability figure: the brand never writes a
   * cheque the gateway cannot clear.
   */
  motto: "Measured, not promised.",
  established: { roman: "MMXIV", year: 2014, city: "Dallas", state: "Texas" },
  /**
   * The monogram is a real unit of measurement — degrees Rankine, the absolute
   * scale American engineers work in — not an invented glyph. It is legible at
   * 16px, it stamps into a nameplate, and it needs no redraw for a favicon.
   */
  monogram: "°R",
  /** Works No. 1. The first firm on the network; `firm` leads on its own local surfaces. */
  works: Object.freeze({ firm: "AC Services", locality: "Dallas · Fort Worth", endorsement: "A Rankine Member Firm" }),
});

/**
 * The favicon and the app icon are the monogram on the plate ground, in copper.
 * One artwork: truck lettering, embroidery, a 16px favicon and an anodised
 * faceplate all take it. Rendered as SVG text rather than a path so it stays a
 * single reviewed string — and deliberately with the fallback stack inline,
 * because a favicon is fetched before any stylesheet this system controls.
 */
export const monogramSvg = (ground: string = P.plate.ground, ink: string = P.copper.dark): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" fill="${ground}"/>` +
  `<text x="32" y="46" fill="${ink}" font-family="Big Shoulders Display,Oswald,Arial Narrow,sans-serif" ` +
  `font-size="42" font-weight="800" text-anchor="middle" letter-spacing="1">${BRAND.monogram}</text></svg>`;

/** The same artwork as a data URI the frame can carry inline — no second request, no second file to drift. */
export const faviconDataUri = (): string =>
  `data:image/svg+xml,${encodeURIComponent(monogramSvg()).replace(/'/g, "%27").replace(/"/g, "%22")}`;

/**
 * The bulletin's own errata, continued in code. Rev. B published six; two more
 * were found by measuring every ink against every ground it is permitted on
 * while implementing the schedule, and eight more by reviewing the schedule as
 * IMPLEMENTED rather than as published. They are recorded here rather than
 * fixed silently — a standard that hides its corrections is the franchise
 * manual nobody reads.
 *
 * E-07 and E-08 are colour. E-09 onward are not, and that is the finding behind
 * all of them: every ratio Rev. B states is correct and was verified, and the
 * theme still shipped broken, because a ratio does not survive a cascade, a
 * shared type scale, a font subset or a gate that measures the wrong threshold.
 * The ink schedule was never the risk. What the ink schedule does not measure
 * was.
 */
export const BULLETIN_ERRATA = Object.freeze([
  {
    code: "E-07", subject: "ink.light",
    finding: "#7D735F measures 3.17:1 against the header ground #DCD4C1, below AA. Rev. B sets captions, field labels and the muted state chip in it.",
    resolution: "color.text-muted and color.status-blocked point at ink.mid #4E463A (6.29:1). ink.light survives as a non-text rule only.",
  },
  {
    code: "E-08", subject: "stock.ruleHard",
    finding: "#8A8069 measures 2.65:1 against the panel ground. Form R-4 requires a chip's rule to carry SHAPE at 3:1, and this cannot.",
    resolution: "A state chip's rule is drawn in the state's own ink (currentColor), which clears 4.5:1 by the word's own requirement. color.border* stays decorative.",
  },
  {
    code: "E-09", subject: "the type schedule's one rule",
    finding: "body set its font with the `font` SHORTHAND, one line under html,body{font-variant-numeric:tabular-nums}. The shorthand resets every font-variant-* longhand to initial, so body computed `normal` and inherited it to the document. Measured in Chromium. No numeral in the system held its column; .ac-num was defined with no call site and DataGrid rendered figures in the body face.",
    resolution: "Longhands on body. Column.numeric puts a figure column in the instrument face. styles.test.ts rejects the shorthand except `inherit`.",
  },
  {
    code: "E-10", subject: ".ac-grid__sort",
    finding: "`all:unset` ties :focus-visible on specificity (0,1,0) and is declared later, and the cascade resolves per property and not per state — so the sort button, the dispatch board's only keyboard control, computed outline-style:none while focused. WCAG 2.4.7.",
    resolution: "Reset what a button brings, not everything. The test rejects all:unset / initial / revert anywhere in the sheet.",
  },
  {
    code: "E-11", subject: "color.action-pressed",
    finding: "It is color.action-text by value, and :active repainted the fill without the ink. A variant carrying its own resting colour kept it: a quiet button pressed its own label to 1.00:1 and danger to 1.24:1 — every secondary route on a RefusalCard.",
    resolution: "The ink moves with the fill. Danger inverts onto color.page (7.33:1 light, 15.02:1 plate) rather than borrowing the primary's copper. ON_FILL measures both pairs; the test fails any :active that moves a background and not a colour.",
  },
  {
    code: "E-12", subject: "the type scale",
    finding: "One scale for three densities, so only --body-text moved. The field frame shipped 56px targets and 18px body over a scale whose smallest step was 11px: the tablet's state chip was set two points SMALLER than console body copy, and the disabled reason a technician needs at 13px. The tier that exists because averaging serves neither was averaged at the component level.",
    resolution: "TYPE_SCALE is per density, with TYPE_FLOOR as the promise — nothing on the plate under 15px. comfort remains PRIMITIVES.text, the ramp the plates are drawn at.",
  },
  {
    code: "E-13", subject: "SUBSET_GLYPHS",
    finding: "It carried ° and the fractions and not ● ▲ ■ ✕ — the four marks the second channel is drawn with. Once the faces are subset and pinned as E-05 requires, the channel that exists for the case where colour fails would have been resolved by the fallback chain: another face, other metrics, tofu on a locked-down tablet.",
    resolution: "The marks are in the subset, named in MARK_GLYPHS, imported by the components that draw them, and asserted contained by css.test.ts.",
  },
  {
    code: "E-14", subject: "the degraded banner on the plate ground",
    finding: "SEMANTIC_DARK maps color.status-breached to cream — the same ink as body copy, correctly, because Plate 4 moves state into FORM. The banner drew its mark and its rule in that role and carried no fill, so on the one surface read in sunlight the alarm rendered in body-copy cream. Form R-4 decomposed into three channels and the banner used two of them, both collapsed.",
    resolution: "The mark carries the oxide fill, the way the breached chip does: transparent on the light stock where a fault is an outline, 6.63:1 on the plate.",
  },
  {
    code: "E-15", subject: "admitAccent",
    finding: "Every tier was gated at 4.5:1 — the WORD threshold — against a system whose semantic tier spends three roles separating the fill from the word. Any accent supplied as a brand fill was rejected, and the house copper failed its own gate on all three tiers: {console:false, comfort:false, field:false} for the ink the buttons are drawn in.",
    resolution: "Two verdicts per tier, text at 4.5 and fill at 3.0 — the split the semantic tier already made. Amped's red now reads as what Plate 5 says it is: a fill everywhere, a word nowhere, barred from any state-bearing surface by hue.",
  },
  {
    code: "E-16", subject: "hueOf, and the tenant stylesheet's scope",
    finding: "hueOf returns 0° for any grey — what the HSL formula does when the channels are equal — so a charcoal accent scored 6.1° from oxblood and was barred from every state surface for a hue it does not have. Separately, brandCss emitted an unscoped :root{} block: overrides measured against the light stock, applied to the field frame, where --color-text is cream.",
    resolution: "A chroma floor; an accent with no hue skips the hue gate. brandCss emits under TENANT_SCOPE, so a theme applies only where it was measured and the tablet keeps Rankine's plate — the instrument argument, spelled as a selector.",
  },
] as const);
