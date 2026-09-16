/**
 * TIER 1 — primitives. Raw values, referenced by NOTHING outside tier 2.
 * A component that reaches in here has hard-coded a colour, and a hard-coded
 * colour cannot be re-pointed for a white-label tenant.
 *
 * RANKINE OPERATING COMPANY — Identity Standards, Bulletin No. 2 "Arc Foundry",
 * which supersedes Bulletin No. 1 Rev. B. The reference is the electric arc
 * furnace: the machine that electrified steelmaking, and the one hinge that is
 * industrial-revolution in origin and unmistakably electric in the present.
 *
 * Every value below is measured by css.test.ts against every ground it is
 * permitted on, so the schedule cannot be wrong here and right on paper.
 */
export const PRIMITIVES = Object.freeze({
  /** Light stock, cold. `header` is the darkest ground in the stock, so it governs every ink. */
  stock: { page: "#E6EBF0", surface: "#F3F6F9", header: "#D4DCE4", rule: "#B3BFC9", ruleHard: "#8695A2" },
  /** A cold near-black, never pure. `light` is a non-text rule only — it does not clear AA (E-07). */
  ink: { black: "#0E1418", mid: "#3C4A55", light: "#6A7885" },
  /**
   * THE ARC — the instrument accent, in three steps at ONE hue. An arc has a
   * cooler envelope and a hot core, so the ramp is the phenomenon rather than
   * decoration: three steps without breaking Rule One (colour carries meaning
   * or it is not used), which a second decorative HUE would have broken.
   *
   *   envelope  every arc word under 24px, every rule, the focus ring   6.52:1
   *   fill      the fill, fully saturated. Never a word.                2.09:1
   *   core      SLA timers, the monogram, rules — FIELD GROUND ONLY     1.01:1 on light stock
   *
   * The fill is licensed to sit at 2.09:1 by the decomposition that lets the
   * oxide fault fill sit at 2.13:1: the rule carries shape at 6.52:1 and
   * `onFill` carries the word at 6.40:1, so the fill is free to be an arc.
   */
  arc: { envelope: "#0A4F66", fill: "#00A3D9", core: "#7FE9FF", onFill: "#0E1418" },
  /**
   * THE BRAND RED — the one ink in this file fenced by SURFACE rather than by size.
   *
   * Red measures 1.2° from the fault ink. No bright red clears the accent
   * gate's 30°, and there is nowhere to move it: the band between the fault at
   * 4.7° and the warning at 39.5° is 34.8° wide. A red button on a dispatch
   * board is an alarm, whatever the style guide calls it.
   *
   * So red is admitted exactly where a colliding TENANT accent is admitted —
   * the wordmark, the livery, the badge and the marketing surface — and barred
   * from every surface that renders a state ramp, where it falls back to Ink
   * Black. We do not hold a tenant to a rule the house exempts itself from.
   *
   * `bright` is for a red word on the field ground, where `fill` is a fill.
   */
  brand: { fill: "#D91F11", text: "#A81208", onFill: "#FFFFFF", bright: "#F4796C" },
  /** State, light stock. Reserved exclusively for system state — never emphasis, never a chart series. */
  state: { jade: "#0E6A46", amber: "#7E5300", oxide: "#A32318" },
  /**
   * The field tier's ground and its own ink schedule. Not a dark theme — a
   * sunlight decision, and a second substrate. A light ramp measured here fails
   * outright, and the worst failure is always the most urgent state, which is
   * why this schedule is computed rather than re-pointed.
   */
  plate: {
    page: "#080D11", ground: "#111A20", well: "#050A0D", rule: "#253039", ruleHard: "#55636F",
    frost: "#E4ECF2", frostMid: "#BFCDD8", frostMute: "#91A1AE",
    jade: "#5FD39B", amber: "#E8B23C", oxide: "#7A2A2E",
  },

  space: { 0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px", 12: "48px" },
  /** No rounded corner anywhere the system draws. The other two exist because an OS app icon has its own substrate rules. */
  radius: { none: "0px", icon: "8px", app: "16px" },
  text: { xs: "11px", sm: "13px", md: "15px", lg: "18px", xl: "22px", display: "28px", mast: "40px" },
  /** Tracking is load-bearing: a typed label is +0.14em and up; the script wordmark takes none at all. */
  track: { tight: "0.02em", normal: "0.05em", mark: "0.07em", wide: "0.14em", wider: "0.24em", widest: "0.34em" },
});
