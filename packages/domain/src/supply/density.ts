/**
 * D14 — SUPPLY BEFORE SIGNATURE, as a decision function.
 *
 * `regions.min_crew_density` is the rule; it is 0 until the partners set it,
 * and the registry's own comment says the check must report "rule not set"
 * rather than pass silently. So there are three outcomes, not two:
 *
 *   rule set, supply meets it      → admitted, no caveat
 *   rule set, supply below it      → REFUSED, commercial — somebody has to
 *                                    staff the region or price the gap;
 *                                    the row is not wrong, the business is
 *                                    not ready (09 §3.6, §5 D14 row)
 *   rule not set (0)               → admitted WITH a caveat naming the
 *                                    region, which S2 renders as a banner
 *
 * Pure: the caller counts the crews and reads the rule; this decides.
 */
export type SupplyInput = {
  readonly regionName: string;
  /** `regions.min_crew_density`. 0 means the partners have not set it. */
  readonly minCrewDensity: number;
  /** Active crews whose tenancy is this region. */
  readonly activeCrews: number;
};

export type SupplyDecision =
  | { readonly kind: "admitted"; readonly caveats: readonly string[] }
  | { readonly kind: "refused"; readonly code: "supply_below_density"; readonly message: string };

export const D14_RULE_NOT_SET = (region: string): string => `D14 rule not set for ${region}`;

export const admitLocationSupply = (s: SupplyInput): SupplyDecision => {
  if (!Number.isInteger(s.minCrewDensity) || s.minCrewDensity < 0) {
    throw new RangeError(`min_crew_density must be a non-negative integer, got ${s.minCrewDensity}`);
  }
  if (s.minCrewDensity === 0) return { kind: "admitted", caveats: [D14_RULE_NOT_SET(s.regionName)] };
  if (s.activeCrews < s.minCrewDensity) {
    return {
      kind: "refused",
      code: "supply_below_density",
      message:
        `${s.regionName} has ${s.activeCrews} active crew${s.activeCrews === 1 ? "" : "s"}; the D14 rule for the region is ${s.minCrewDensity}. ` +
        `A location cannot be signed into a region we cannot yet serve — staff the region or price the gap before this row exists.`,
    };
  }
  return { kind: "admitted", caveats: [] };
};
