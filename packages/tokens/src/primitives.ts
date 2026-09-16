/**
 * TIER 1 — primitives. Raw values, referenced by NOTHING outside tier 2.
 * A component that reaches in here has hard-coded a colour, and a hard-coded
 * colour cannot be re-pointed for a white-label tenant.
 *
 * These are the inks of RANKINE OPERATING COMPANY — Identity Standards,
 * Bulletin No. 1, Rev. B, Plates 3 (light stock) and 4 (dark ground). Every
 * value below is stated in the bulletin; css.test.ts re-measures each one
 * against every ground it is permitted on, so the schedule cannot be wrong
 * here and right on paper.
 *
 * Two corrections this file makes to the bulletin as published, both measured
 * (see BULLETIN_ERRATA in ./brand.ts):
 *   E-07  ink.light #7D735F is 3.17:1 on the header ground — it cannot carry a
 *         word. Muted text and the `blocked` state use ink.mid instead.
 *   E-08  stock.ruleHard is 2.65:1 — it cannot carry chip SHAPE either. A
 *         state chip's rule is drawn in the state's own ink (currentColor);
 *         stock.rule* stays a decorative hairline.
 */
export const PRIMITIVES = Object.freeze({
  /** Light stock. `paper` is the page, `surface` the panel, `paper2` the header ground — the darkest, so it governs. */
  stock: { paper: "#E7E1D2", paper2: "#DCD4C1", surface: "#F1ECE0", rule: "#B9AF98", ruleHard: "#8A8069" },
  /** A warm printing black, never pure. `light` is caption-weight only — it does not clear AA (E-07). */
  ink: { black: "#1C1813", mid: "#4E463A", light: "#7D735F" },
  /**
   * The second ink. Copper is the metal in every line set and brazing rod in
   * the trade — a material, not a metaphor, and the one ink that never
   * indicates state. `fill` is display type 24px+ and button fills; any copper
   * word under 24px is `text`; `onFill` is the ink that sits on a copper fill.
   */
  copper: { fill: "#A65F2E", text: "#7E441F", onFill: "#FFF8EC", wash: "#E0D2BE", dark: "#D1976E" },
  /** State, light stock. Reserved exclusively for system state — never emphasis, never a chart series. */
  state: { olive: "#4A5F2F", ochre: "#775713", oxblood: "#7A2B22" },
  /**
   * The field tier's ground and its own ink schedule (Plate 4). Not a dark
   * theme — a sunlight decision, and a second substrate. The light ramp reads
   * 2.50, 2.84 and 1.85:1 here; all three fail, and the worst failure is the
   * most urgent state.
   */
  plate: {
    page: "#14110D", ground: "#1C1813", well: "#0D0B08", rule: "#3A3227", ruleHard: "#6A6052",
    cream: "#EDE5D4", creamMid: "#C9BFA9", creamMute: "#A99C85",
    olive: "#9DBE6B", ochre: "#CD9B30", oxide: "#8C2E22",
  },
  /** The builder's plate. Artwork, not a UI role — the floor is raised so the 10.5px spec line clears 4.55:1 at the gradient's darkest point. */
  brass: { face: "#B08B4F", floor: "#977744", ink: "#14100A" },

  space: { 0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px", 12: "48px" },
  /**
   * A period catalogue has no rounded corner. `none` is the answer for every
   * surface the system draws; the other two exist because an OS app icon and an
   * embroidered patch are artwork with their own substrate rules.
   */
  radius: { none: "0px", icon: "8px", app: "16px" },
  text: { xs: "11px", sm: "13px", md: "15px", lg: "18px", xl: "22px", display: "28px", mast: "40px" },
  /** Tracking is load-bearing in this identity: the wordmark is +0.07em, a typed label +0.14em and up. */
  track: { tight: "0.02em", normal: "0.05em", mark: "0.07em", wide: "0.14em", wider: "0.24em", widest: "0.34em" },
});
