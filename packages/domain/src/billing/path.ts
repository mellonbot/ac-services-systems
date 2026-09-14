import type { Tier } from "@ac/contracts";

export type BillableEvent = {
  readonly jobId: string;
  readonly accountId: string;
  readonly serviceCode: string;
  readonly quantityMilli: bigint;
  readonly unitPriceMinor: bigint;
};

export type InvoiceLine = {
  readonly accountId: string;
  readonly jobId: string | null;
  readonly description: string;
  readonly quantityMilli: bigint;
  readonly unitPriceMinor: bigint;
  readonly amountMinor: bigint;
};

export type DraftInvoice = {
  readonly billToAccountId: string;
  readonly billToTier: Tier;
  readonly totalMinor: bigint;
  readonly lines: readonly InvoiceLine[];
};

/**
 * FOUR PATHS STAY FOUR.
 *
 * Each path implements this interface completely and independently, in its own
 * directory, with no shared mutable state. A lint rule and a CI guard fail the
 * build on a cross-path import — including the relative-path spelling a
 * refactor produces automatically.
 *
 * The decay this prevents is specific and predictable: someone needs 80% of the
 * enterprise path for a project invoice, imports it, adds `if (isProject)`, and
 * eighteen months later residential pricing cannot change without regression-
 * testing all four.
 *
 * Shared behaviour lives in billing/shared/, with one test for admission:
 *   IF IT NEEDS A FLAG TO SERVE TWO PATHS, IT IS NOT SHARED BEHAVIOUR.
 */
export type BillingPath = {
  readonly key: "one_time" | "residential_membership" | "enterprise_sla" | "project";
  build(events: readonly BillableEvent[], ctx: PathContext): DraftInvoice;
};

export type PathContext = {
  readonly billToAccountId: string;
  readonly billToTier: Tier;
  /**
   * Resolved from the contract for THIS site. Never a default.
   *
   * Monetary and quantity terms are STRINGS here, not numbers — they arrive
   * from jsonb, and a JSON number is an IEEE754 double. `BigInt(String(x))` is
   * the only conversion; ac/no-float-money fails the build on the alternative.
   */
  readonly resolvedTerms: Readonly<Record<string, unknown>>;
  readonly periodStart?: string;
  readonly periodEnd?: string;
};
