/**
 * TIER 3 — density. THREE densities, because there are three ergonomics
 * problems, and one component library that pretends otherwise produces a field
 * app crews work around with paper — already on the risk register as a P1
 * product defect, not a cosmetic one.
 *
 * A dispatcher scanning forty rows with a mouse and a technician tapping with
 * gloves in direct sun are opposite requirements. Averaging them serves neither.
 */
export const DENSITY = Object.freeze({
  /** S2 / S3 / S4 — information density is the feature. */
  console: {
    controlHeight: "36px", rowHeight: "28px", bodyText: "13px", gutter: "8px",
    focusRing: "2px solid", hoverAffordances: true, surface: "light",
  },
  /** S1 / S6 / S7 / S8 — occasional users, their own hardware, once a month. */
  comfort: {
    controlHeight: "44px", rowHeight: "40px", bodyText: "15px", gutter: "16px",
    focusRing: "2px solid", hoverAffordances: true, surface: "light",
  },
  /**
   * S5 and the tablet. 56px targets for gloves, 18px body, a 3px neutral focus
   * ring and a dark surface for direct sunlight, and NO hover-dependent
   * affordance anywhere — there is no cursor, so a hover-only control is an
   * invisible one.
   *
   * The ring is neutral rather than amber: the rule is that a ring never shares
   * the action's hue, and the action is now copper. See SEMANTIC_DARK.
   */
  field: {
    controlHeight: "56px", rowHeight: "56px", bodyText: "18px", gutter: "16px",
    focusRing: "3px solid", hoverAffordances: false, surface: "dark",
  },
});

export type Density = keyof typeof DENSITY;
