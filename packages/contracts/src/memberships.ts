/**
 * THE RESIDENTIAL MEMBERSHIP — Premium Cool Club, as sold on estimate
 * 33308676CS (2025-07-09): preventive maintenance twice a year at $100 a
 * visit, one year, taxable, and the first year's filter replacements
 * included.
 *
 * One plan, so it is a constant until the plan catalogue (scope 2026-10-21,
 * R2) gives the office a screen to author tiers. What a membership BILLS is
 * still the terms resolver's (`membership_fee_minor`, `included_visits`),
 * which are not registered yet — this is what the portal and the office's
 * form CALL the plan and promise under it, never a second source the billing
 * path reads.
 */
export type MembershipPlan = {
  readonly name: string;
  /** Integer cents, before tax. */
  readonly feeMinor: number;
  readonly period: "year";
  readonly pmVisitsPerYear: number;
  readonly perVisitMinor: number;
  readonly taxable: boolean;
  /** What the plan includes beyond the visits, in the customer's words. */
  readonly includes: readonly string[];
};

export const COOL_CLUB: MembershipPlan = {
  name: "Premium Cool Club",
  feeMinor: 20_000,
  period: "year",
  pmVisitsPerYear: 2,
  perVisitMinor: 10_000,
  taxable: true,
  includes: ["Filter replacements included the first year"],
};
