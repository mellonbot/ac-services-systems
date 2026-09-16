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
 * while implementing the schedule, and they are recorded here rather than fixed
 * silently — a standard that hides its corrections is the franchise manual
 * nobody reads.
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
] as const);
