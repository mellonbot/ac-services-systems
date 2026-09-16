import { PRIMITIVES as P } from "./primitives.ts";

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
  ring: { cx: 18, cy: 21, r: 5, width: 5 },
  /** The letter, set in the wordmark face and centred on `x`. */
  letter: { size: 46, x: 40, baseline: 47 },
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

/**
 * THE LETTER, AS AN OUTLINE — errata E-17, closed.
 *
 * A favicon is fetched before any stylesheet this system controls, so an SVG
 * that names a font family renders in whatever the machine happens to have:
 * the mark silently became a different mark, with no fallback chain to catch
 * it and nobody to notice. So the letter is no longer a font reference. It is
 * the Yellowtail R itself, extracted from the face and frozen as a path.
 *
 * Derived from Yellowtail (Astigmatic, Apache License 2.0) by reading the
 * `glyf` table directly: glyph 53, 2048 units/em, advance 1502, one contour of
 * 86 points, converted to quadratic SVG segments and transformed into the
 * 64-unit square at the approved geometry — size 46, centred on x 40 the way
 * `text-anchor="middle"` centres an advance, baseline 47. The extraction was
 * cross-checked against the glyph header's own bounding box before it was
 * trusted.
 *
 * It is a path, so nothing about it depends on a font being installed, and the
 * optical thickening still works: a stroke on a path behaves exactly as a
 * stroke on text did.
 *
 * THE INK BOX FITS. At the geometry this was first cut at — size 50 on x 41 —
 * the swash reached x 66.17 and the viewport trimmed 2.17 units off it, which
 * only became measurable once the letter stopped being a font reference. The
 * tighter setting here pulls the whole mark inside the square: the swash ends
 * at 63.16, and a test holds that line so a future nudge cannot quietly push
 * the letter back off the edge.
 */
export const BADGE_LETTER = Object.freeze({
  /** Yellowtail R, at size 50, centred on x 41, baseline 48, in the 64-unit square. */
  path: "M37.53 23.93Q37.87 23.93 37.87 24.31Q37.87 24.45 37.75 24.56Q35.87 26.45 33.4 26.45Q32.81 26.45 32.09 25.79Q31.38 25.12 31.38 23.87Q31.38 22.61 32.9 21.07Q34.43 19.53 37.16 18.15Q39.89 16.77 43.98 15.69Q48.06 14.61 51.32 14.61Q54.58 14.61 56.67 15.14Q58.75 15.67 59.93 16.44Q61.11 17.22 61.88 18.18Q63.16 19.8 63.16 21.47Q63.16 23.15 62.08 24.92Q61 26.7 59.28 28.08Q57.56 29.46 55.34 30.65Q51.19 32.85 46.45 33.88Q47.25 34.71 49.87 38.05Q52.49 41.38 54.66 43.63Q56.82 45.88 58.01 45.88L58.75 45.61Q59 45.61 59 45.8Q59 45.99 58.18 46.9Q57.36 47.81 56.76 48.28Q56.15 48.75 55.1 48.75Q54.06 48.75 52.74 47.74Q51.41 46.73 49.84 44.89Q48.27 43.05 47.01 41.42Q45.75 39.79 44.13 37.58Q42.52 35.37 41.91 34.58Q41.68 34.94 40.76 36.36Q39.84 37.79 39.42 38.46Q38.99 39.14 38.18 40.43Q37.37 41.72 36.92 42.51Q35.69 44.6 35.2 45.63Q34.72 46.66 33.62 46.66L32.83 46.64L32.16 46.66Q30.77 46.66 30.77 45.5Q30.77 44.62 31.52 42.99Q32.27 41.36 39.51 30.84Q46.74 20.32 47.48 19.61Q48.22 18.9 48.58 18.81Q48.85 18.61 48.94 18.61L49.34 18.68L49.73 18.61Q49.93 18.61 50.08 18.78Q50.24 18.95 50.31 18.99Q51.25 19.69 51.25 20.16Q51.25 20.63 51.02 21.07Q50.78 21.51 49.73 23.03Q48.67 24.56 46.95 27Q45.23 29.44 44.47 30.54Q46.31 30.45 48.89 29.41Q51.48 28.38 53.73 26.93Q55.99 25.48 57.6 23.79Q59.2 22.09 59.2 20.83Q59.2 20.16 58.51 19.61Q57.81 19.06 56.76 18.74Q54.64 18.12 51.99 18.12Q49.34 18.12 45.28 19.26Q41.21 20.41 39.35 21.45Q37.48 22.5 36.65 23.23Q35.82 23.96 35.82 24.25Q35.82 24.4 36.28 24.4Q36.74 24.4 37.1 24.17Q37.46 23.93 37.53 23.93Z",
  source: "Yellowtail — Astigmatic, Apache License 2.0",
  glyph: { id: 53, unitsPerEm: 2048, advance: 1502, contours: 1, points: 86 },
  /** Where the ink actually lands, measured from the outline rather than guessed. */
  ink: { x1: 30.77, y1: 14.61, x2: 63.16, y2: 48.75 },
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
  const { ring: g, bar: b, treatment: t } = BADGE;
  const sw = thickenFor(px);
  const stroke = sw > 0 ? ` stroke="${t.letter}" stroke-width="${sw}" paint-order="stroke"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="${t.ground}"/>` +
    `<circle cx="${g.cx}" cy="${g.cy}" r="${g.r}" fill="none" stroke="${t.ring}" stroke-width="${g.width}"/>` +
    `<path d="${BADGE_LETTER.path}" fill="${t.letter}"${stroke}/>` +
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
    code: "E-17", subject: "the badge", status: "closed",
    finding: "badgeSvg() named a font family. A favicon is fetched before any stylesheet, so on a machine without the face the mark silently became a different mark.",
    resolution: "The letter is an outlined path extracted from Yellowtail's glyf table (BADGE_LETTER), cross-checked against the glyph header's own bbox. Nothing about the mark now depends on an installed font.",
  },
  {
    code: "E-18", subject: "the wordmark", status: "accepted",
    finding: "A connected script fails the small end of the substrate list: joins close in thread and the word smears below the size floor.",
    resolution: `Accepted, because the system carries two marks. The script is the name at display size and never below ${28}px; the badge is the small end. Neither is asked to be the other.`,
  },
  {
    code: "E-19", subject: "the badge ink box", status: "closed",
    finding: "At size 50 on x 41 the R's swash reached x 66.17 — 2.17 units past the right edge of the square — and the viewport silently trimmed it. Invisible while the letter was a font reference; measurable the moment it became an outline.",
    resolution: "The letter was cut down to size 46 on x 40, baseline 47, with the ring at 18/21. The swash now ends at 63.16, inside the square, and a test asserts the whole ink box stays within the 64 units.",
  },
] as const);
