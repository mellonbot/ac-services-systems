/**
 * TIER 1 — primitives. Raw values, referenced by NOTHING outside tier 2.
 * A component that reaches in here has hard-coded a colour, and a hard-coded
 * colour cannot be re-pointed for a white-label tenant.
 *
 * The palette is Rankine Operating Company: a two-ink identity — warm printing
 * black and copper on uncoated stock. Families are named for the ink, not for
 * a hue word that will stop being true. There is no `blue` here because there
 * is no blue in the company.
 */
export const PRIMITIVES = Object.freeze({
  /** Uncoated stock. The light grounds. Never pure white above 0 — paper isn't. */
  stock: { 0: "#ffffff", 50: "#f6f2e8", 100: "#f1ece0", 200: "#e7e1d2", 300: "#dcd4c1" },
  /** Warm printing black and its greys. 900 is the body ink and the equipment ground. */
  ink: { 300: "#b9af98", 500: "#7d735f", 700: "#4e463a", 900: "#1c1813", 1000: "#0d0b08" },
  /**
   * The second ink — the metal in every line set and brazing rod in the trade.
   * 500 is display and UI only: it measures 4.15:1 on stock.100, which clears
   * the 3:1 a control needs and misses the 4.5:1 a word needs. 700 is the
   * text-safe shade at 6.5:1, and it exists for exactly that reason.
   */
  copper: { 300: "#c98a4f", 500: "#a65f2e", 700: "#7e441f" },
  /**
   * Status inks. Each family carries a 600 for light surfaces and a 400 for the
   * dark field surface, because one value cannot clear 3:1 against both.
   * These are never decorative — see SEMANTIC.
   */
  olive: { 400: "#7ba05b", 600: "#4a5f2f" },
  ochre: { 400: "#d9ae55", 600: "#7d5b14" },
  oxblood: { 400: "#d9756a", 600: "#7a2b22" },

  space: { 0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px" },
  /**
   * Square by default. The identity is ruled plates and cut vinyl, not rounded
   * cards; `lg` is 3px so a control reads as machined rather than soft.
   */
  radius: { sm: "0px", md: "2px", lg: "3px" },
  text: { xs: "11px", sm: "13px", md: "15px", lg: "18px", xl: "22px" },

  /**
   * Four faces, four jobs — and the split that keeps the period identity from
   * becoming costume: HERITAGE IN PRINT, INSTRUMENT ON SCREEN.
   *
   * `display` and `engraved` carry the brand and are the same faces as the
   * printed bulletin. `text` and `instrument` are the screen faces: the
   * bulletin sets body in Libre Baskerville and figures in Courier, which are
   * right on paper and wrong in a console at 13px with forty rows on it.
   *
   * `instrument` is mandatory for every numeral in the company — SLA timers,
   * staleness clocks, job numbers, gauge readings, invoice totals, tonnage,
   * CFM. Digits that hold their column are the whole effect.
   */
  font: {
    display: '"Big Shoulders Display","Oswald","Arial Narrow",Arial,sans-serif',
    engraved: '"Playfair Display",Georgia,serif',
    text: '"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',
    instrument: '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  },
});
