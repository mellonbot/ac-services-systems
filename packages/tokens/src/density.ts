import { PRIMITIVES as P } from "./primitives.ts";

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
   * S5 and the tablet. 56px targets for gloves, 18px body, amber focus ring and
   * a dark surface for direct sunlight, and NO hover-dependent affordance
   * anywhere — there is no cursor, so a hover-only control is an invisible one.
   */
  field: {
    controlHeight: "56px", rowHeight: "56px", bodyText: "18px", gutter: "16px",
    focusRing: "3px solid", hoverAffordances: false, surface: "dark",
  },
});

export type Density = keyof typeof DENSITY;

export type TypeStep = keyof typeof P.text;

/**
 * THE TYPE SCALE IS PART OF THE DENSITY, not a constant the densities share.
 *
 * It was a constant, and that quietly undid the tier it mattered most in: the
 * field frame shipped 56px targets and 18px body over a scale whose smallest
 * step was 11px, so the tablet's state chip — the thing a technician reads
 * across a mechanical room — was set two points SMALLER than the console's body
 * copy, inside a 48px chip. A bigger hit box around console type is a console
 * button with a bigger hit box.
 *
 * So every step moves with the tier, and `FLOOR` is the promise: nothing in a
 * density is set below its floor, checked in css.test.ts. The field floor is
 * 15px because that is the smallest uppercase instrument label that survives a
 * roof at 2pm — the same argument that chose the ground it sits on.
 *
 * `comfort` IS `PRIMITIVES.text`, unchanged: it is the reference ramp the
 * bulletin's plates are drawn at, and the other two are struck from it.
 */
export const TYPE_SCALE = Object.freeze({
  console: Object.freeze({ xs: "11px", sm: "12px", md: "13px", lg: "15px", xl: "18px", display: "24px", mast: "34px" }),
  comfort: P.text,
  field: Object.freeze({ xs: "15px", sm: "16px", md: "18px", lg: "22px", xl: "26px", display: "34px", mast: "48px" }),
} as const satisfies Record<Density, Readonly<Record<TypeStep, string>>>);

/**
 * The smallest type a density may set, in px. Read by the test; there is no
 * other way to state a promise like this.
 *
 * 11px on the two light tiers is the bulletin's own smallest step, on a desk
 * monitor, in the instrument face, uppercase at +0.14em — it is a caption and a
 * column head and it is read sitting down. 15px on the plate is a different
 * argument entirely, and the tier exists because that argument is different.
 */
export const TYPE_FLOOR = Object.freeze({ console: 11, comfort: 11, field: 15 } as const satisfies Record<Density, number>);
