import { PRIMITIVES as P } from "./primitives.ts";
import { FACES } from "./type.ts";

/**
 * THE BRAND TIER — who the marks belong to, and what they are allowed to say.
 *
 * Data, like the surface registry, and for the same reason: the frame emitter
 * reads this file, so the name in a <title> and the name in the masthead cannot
 * disagree, and a rename is one reviewed diff rather than eight HTML files.
 *
 * The structure the marks have to carry:
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
  /** Set beneath the wordmark in tracked caps. Never abbreviated to "ROC". */
  descriptor: "Operating Company",
  trade: "Heating · Ventilating · Refrigerating",
  /**
   * The motto is a constraint before it is a line. It is why the marketing
   * surface prints no availability figure: the brand never writes a cheque the
   * gateway cannot clear.
   */
  motto: "Measured, not promised.",
  established: { roman: "MMXIV", year: 2014, city: "Dallas", state: "Texas" },
  /**
   * The monogram is a real unit of measurement — degrees Rankine, the absolute
   * scale American engineers work in — not an invented glyph. The ring precedes
   * the letter because `°R` is one indivisible symbol, as `°F` and `°C` are; a
   * number, when there is one, precedes the whole symbol: 531.67 °R.
   */
  monogram: "°R",
  /** Works No. 1. The first firm on the network; `firm` leads on its own local surfaces. */
  works: Object.freeze({ firm: "AC Services", locality: "Dallas · Fort Worth", endorsement: "A Rankine Member Firm" }),
});

/**
 * THE BADGE GEOMETRY, in the 64-unit square the mark is drawn on.
 *
 * Isolated in one object because it is the one part of the identity still being
 * tuned by eye, and because "nudge the badge" must stay a four-number diff
 * rather than a hunt through an SVG string.
 *
 * `thickenAt` is the optical correction, not a style: the wordmark face is a
 * display script whose joins close up below roughly 28px (see WORDMARK_FLOOR),
 * so the badge letter carries a same-colour stroke that grows as the mark
 * shrinks. A drawn badge does this by hand; this does it by rule.
 */
export const BADGE = Object.freeze({
  /** The degree ring — a stroked circle, never a `°` glyph, so its weight scales independently of the letter. */
  ring: { cx: 17, cy: 20, r: 5.5, width: 5 },
  /** The letter, set in the wordmark face and centred on `x`. */
  letter: { size: 50, x: 41, baseline: 48 },
  /** Extra same-colour stroke by rendered size, smallest first. */
  thickenAt: [
    { maxPx: 16, stroke: 2.6 },
    { maxPx: 32, stroke: 1.2 },
    { maxPx: Infinity, stroke: 0 },
  ],
  /** The bar beneath the mark, which does the job the swash gives up when the strokes thicken. */
  bar: { x: 12, y: 53, width: 40, height: 4 },
  /**
   * THE STYLE, named rather than reached for. Position alone does not make a
   * mark reproducible: the four roles below are as much a part of "the badge"
   * as the coordinates, and spelling them out here is what stops a second
   * drawing of it picking its own.
   */
  treatment: {
    ground: P.plate.ground,
    letter: P.brand.fill,
    ring: P.arc.core,
    bar: P.arc.core,
  },
});

/**
 * Every size the mark is cut at. One list, so a new icon slot is a row here
 * rather than a second drawing with its own idea of the geometry.
 */
export const ICON_SIZES = Object.freeze({
  favicon: 16,
  faviconHi: 32,
  masthead: 64,
  appIcon: 180,
  store: 512,
});

/** The optical correction for a given rendered size. */
export const thickenFor = (px: number): number =>
  BADGE.thickenAt.find((t) => px <= t.maxPx)!.stroke;

/**
 * The badge: the monogram on the plate ground, letter in brand red, ring and
 * bar in arc core. One artwork — truck lettering, embroidery, a 16px favicon
 * and an anodised faceplate all take it.
 *
 * KNOWN DEFECT, recorded rather than hidden (E-17): this renders the letter as
 * SVG <text> naming the wordmark family. A favicon is fetched before any
 * stylesheet this system controls, so on a machine without the face installed
 * it falls back down the stack and the mark is not our mark. The fix is to ship
 * the letter as an outlined path; until that lands, treat this as a
 * development badge and not a released one.
 */
export const badgeSvg = (px: number = ICON_SIZES.masthead): string => {
  const { ring: g, letter: l, bar: b, treatment: t } = BADGE;
  const sw = thickenFor(px);
  const stroke = sw > 0 ? ` stroke="${t.letter}" stroke-width="${sw}" paint-order="stroke"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${t.ground}"/>` +
    `<circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="${t.ring}" stroke-width="${g.width}"/>` +
    `<text x="${l.x}" y="${l.baseline}" fill="${t.letter}"${stroke} ` +
    `font-family="${FACES.wordmark.stack.replace(/"/g, "'")}" font-size="${l.size}" text-anchor="middle">R</text>` +
    `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${t.bar}"/></svg>`;
};

/** The badge as a data URI the frame carries inline — no second request, no second file to drift. */
export const faviconDataUri = (px: number = ICON_SIZES.favicon): string =>
  `data:image/svg+xml,${encodeURIComponent(badgeSvg(px)).replace(/'/g, "%27").replace(/"/g, "%22")}`;

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
    code: "E-07", subject: "ink.light", status: "closed",
    finding: "The published caption ink measured 3.17:1 against the header ground, below AA, and was used for the muted state chip.",
    resolution: "color.text-muted and color.status-blocked point at ink.mid (6.29:1). ink.light survives as a non-text rule only.",
  },
  {
    code: "E-08", subject: "rule-hard", status: "closed",
    finding: "The heavy rule measured 2.65:1. Form R-4 requires a chip's rule to carry SHAPE at 3:1, and it cannot.",
    resolution: "A state chip's rule is drawn in the state's own ink, which clears 4.5:1 by the word's own requirement. color.border* stays decorative.",
  },
  {
    code: "E-09", subject: "the type schedule's one rule", status: "closed",
    finding: "body set its font with the `font` SHORTHAND, one line under html,body{font-variant-numeric:tabular-nums}. The shorthand resets every font-variant-* longhand to initial, so body computed `normal` and inherited it to the document. Measured in Chromium. No numeral in the system held its column; .ac-num was defined with no call site and DataGrid rendered figures in the body face.",
    resolution: "Longhands on body. Column.numeric puts a figure column in the instrument face. styles.test.ts rejects the shorthand except `inherit`.",
  },
  {
    code: "E-10", subject: ".ac-grid__sort", status: "closed",
    finding: "`all:unset` ties :focus-visible on specificity (0,1,0) and is declared later, and the cascade resolves per property and not per state — so the sort button, the dispatch board's only keyboard control, computed outline-style:none while focused. WCAG 2.4.7.",
    resolution: "Reset what a button brings, not everything. The test rejects all:unset / initial / revert anywhere in the sheet.",
  },
  {
    code: "E-11", subject: "color.action-pressed", status: "closed",
    finding: "It is color.action-text by value, and :active repainted the fill without the ink. A variant carrying its own resting colour kept it: a quiet button pressed its own label to 1.00:1 and danger to 1.24:1 — every secondary route on a RefusalCard.",
    resolution: "The ink moves with the fill. Danger inverts onto color.page (7.33:1 light, 15.02:1 plate) rather than borrowing the primary's copper. ON_FILL measures both pairs; the test fails any :active that moves a background and not a colour.",
  },
  {
    code: "E-12", subject: "the type scale", status: "closed",
    finding: "One scale for three densities, so only --body-text moved. The field frame shipped 56px targets and 18px body over a scale whose smallest step was 11px: the tablet's state chip was set two points SMALLER than console body copy, and the disabled reason a technician needs at 13px. The tier that exists because averaging serves neither was averaged at the component level.",
    resolution: "TYPE_SCALE is per density, with TYPE_FLOOR as the promise — nothing on the plate under 15px. comfort remains PRIMITIVES.text, the ramp the plates are drawn at.",
  },
  {
    code: "E-13", subject: "SUBSET_GLYPHS", status: "closed",
    finding: "It carried ° and the fractions and not ● ▲ ■ ✕ — the four marks the second channel is drawn with. Once the faces are subset and pinned as E-05 requires, the channel that exists for the case where colour fails would have been resolved by the fallback chain: another face, other metrics, tofu on a locked-down tablet.",
    resolution: "The marks are in the subset, named in MARK_GLYPHS, imported by the components that draw them, and asserted contained by css.test.ts.",
  },
  {
    code: "E-14", subject: "the degraded banner on the plate ground", status: "closed",
    finding: "SEMANTIC_DARK maps color.status-breached to cream — the same ink as body copy, correctly, because Plate 4 moves state into FORM. The banner drew its mark and its rule in that role and carried no fill, so on the one surface read in sunlight the alarm rendered in body-copy cream. Form R-4 decomposed into three channels and the banner used two of them, both collapsed.",
    resolution: "The mark carries the oxide fill, the way the breached chip does: transparent on the light stock where a fault is an outline, 6.63:1 on the plate.",
  },
  {
    code: "E-15", subject: "admitAccent", status: "closed",
    finding: "Every tier was gated at 4.5:1 — the WORD threshold — against a system whose semantic tier spends three roles separating the fill from the word. Any accent supplied as a brand fill was rejected, and the house copper failed its own gate on all three tiers: {console:false, comfort:false, field:false} for the ink the buttons are drawn in.",
    resolution: "Two verdicts per tier, text at 4.5 and fill at 3.0 — the split the semantic tier already made. Amped's red now reads as what Plate 5 says it is: a fill everywhere, a word nowhere, barred from any state-bearing surface by hue.",
  },
  {
    code: "E-16", subject: "hueOf, and the tenant stylesheet's scope", status: "closed",
    finding: "hueOf returns 0° for any grey — what the HSL formula does when the channels are equal — so a charcoal accent scored 6.1° from oxblood and was barred from every state surface for a hue it does not have. Separately, brandCss emitted an unscoped :root{} block: overrides measured against the light stock, applied to the field frame, where --color-text is cream.",
    resolution: "A chroma floor; an accent with no hue skips the hue gate. brandCss emits under TENANT_SCOPE, so a theme applies only where it was measured and the tablet keeps Rankine's plate — the instrument argument, spelled as a selector.",
  },
  {
    code: "E-17", subject: "the badge", status: "OPEN",
    finding: "badgeSvg() names a font family. A favicon is fetched before any stylesheet, so on a machine without the face the mark silently becomes a different mark.",
    resolution: "Ship the letter as an outlined path. Until then the badge is development-only, and this entry is the reason it is not released.",
  },
  {
    code: "E-18", subject: "the wordmark", status: "accepted",
    finding: "A connected script fails the small end of the substrate list: joins close in thread and the word smears below the size floor.",
    resolution: `Accepted, because the system carries two marks. The script is the name at display size and never below ${28}px; the badge is the small end. Neither is asked to be the other.`,
  },
] as const);
