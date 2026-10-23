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
   * THE ARC — the instrument accent of Bulletin 2 as issued. Rev C moved the
   * accent to red, and the arc keeps one job: the focus ring (`envelope` on the
   * light stock, `core` on the field ground). A focus ring in a hue no control
   * is painted in is easier to find, not harder.
   */
  arc: { envelope: "#0A4F66", fill: "#00A3D9", core: "#7FE9FF", onFill: "#0E1418" },
  /**
   * THE RED — the house brand, and since Rev C the instrument accent too.
   *
   * Bulletin 2 as issued drew the fault in oxide, 0.55° from this red, so a red
   * button on a dispatch board read as an alarm and red was barred from every
   * surface that showed state. Rev C moved the FAULT, not the red: the fault is
   * garnet, and red measures 42.12° from it and 35.32° from its nearest state
   * hue, the warning amber — clear of the accent gate's 30°.
   *
   *   fill    the action fill and the livery. 3.65:1 on the header — a fill, never a small word
   *   text    every red word under 24px, and the pressed fill              5.50:1
   *   onFill  the label on the fill                                        5.05:1
   *   bright  a red word on the field ground, where `fill` is a fill
   */
  brand: { fill: "#D91F11", text: "#A81208", onFill: "#FFFFFF", bright: "#F4796C" },
  /**
   * State, light stock. Reserved exclusively for system state — never emphasis, never a chart series.
   * The fault is GARNET (Rev C), a deep red-violet on the far side of the wheel from the warning,
   * so the house red can stand between them without reading as either.
   */
  state: { jade: "#0E6A46", amber: "#7E5300", garnet: "#9C1F6E" },
  /**
   * The field tier's ground and its own ink schedule. Not a dark theme — a
   * sunlight decision, and a second substrate. A light ramp measured here fails
   * outright, and the worst failure is always the most urgent state, which is
   * why this schedule is computed rather than re-pointed. `garnet` is the fault
   * FILL here, 1.95:1 on the plate ground — a fill only; the frost word carries it.
   */
  plate: {
    page: "#080D11", ground: "#111A20", well: "#050A0D", rule: "#253039", ruleHard: "#55636F",
    frost: "#E4ECF2", frostMid: "#BFCDD8", frostMute: "#91A1AE",
    jade: "#5FD39B", amber: "#E8B23C", garnet: "#7A2A5E",
  },

  space: { 0: "0px", 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px", 12: "48px" },
  /**
   * Bulletin No. 2 Rev A (2026-09-27): the system draws rounded corners at three
   * steps — a control, a card, and a pill (a chip or a segmented tab). `none`
   * stays for the rules and plates that are straight on purpose (the masthead
   * rule, a table's head). `icon` and `app` remain artwork primitives with their
   * own substrate rules and are not emitted to a surface.
   *
   * Rev B (2026-10-22): the control and card corners tighten to 4px and 6px —
   * machined, not moulded. Rev A's page structure stays; the pill stays, and
   * only a chip draws it.
   */
  radius: { none: "0px", control: "4px", card: "6px", pill: "999px", icon: "8px", app: "16px" },
  text: { xs: "11px", sm: "13px", md: "15px", lg: "18px", xl: "22px", display: "28px", mast: "40px" },
  /** Tracking is load-bearing: a typed label is +0.14em and up; the script wordmark takes none at all. */
  track: { tight: "0.02em", normal: "0.05em", mark: "0.07em", wide: "0.14em", wider: "0.24em", widest: "0.34em" },
  /**
   * Motion, Bulletin No. 2: three durations on one curve. A control's state
   * change moves; data does not ("no entrance animation on data"). Named here
   * so a stylesheet reads `var(--motion-fast)` and never types a number — the
   * same argument as the type scale, and the figures lived in prose until now.
   */
  motion: { fast: "110ms", base: "170ms", slow: "260ms" },
  /**
   * Widths. A measure is a line length, so it is set in ch and scales with the
   * density's type: a one-line preview cut short inside a row, a sign-in card,
   * a short confirmation, running text and forms. Layout widths are the page,
   * a side column beside the work, a rail of row labels, a label column, and
   * the two minimums an auto-fit grid of tiles takes. A breakpoint is not here:
   * a media query cannot read a variable.
   */
  measure: { cell: "30ch", narrow: "40ch", short: "48ch", text: "64ch" },
  layout: { page: "1400px", side: "20rem", rail: "14rem", label: "7rem", tile: "18ch", tileWide: "28ch" },
  ease: "cubic-bezier(.2,.6,.3,1)",
});
