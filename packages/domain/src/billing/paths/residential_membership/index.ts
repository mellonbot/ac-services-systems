import type { BillingPath, DraftInvoice, PathContext, BillableEvent, InvoiceLine } from "../../path.ts";
import { lineFromEvent, totalOf } from "../../shared/lines.ts";

/**
 * Recurring membership fee plus whatever the plan does not cover. The included-
 * visits logic lives here and only here — it is the reason this is a separate
 * path rather than an `if (isMembership)` inside one_time.
 */
export const residentialMembership: BillingPath = {
  key: "residential_membership",
  build(events: readonly BillableEvent[], ctx: PathContext): DraftInvoice {
    const feeMinor = BigInt(String(ctx.resolvedTerms["membership_fee_minor"] ?? "0"));
    const included = Number(ctx.resolvedTerms["included_visits"] ?? 0);

    const fee: InvoiceLine = Object.freeze({
      accountId: ctx.billToAccountId,
      jobId: null,
      description: `Membership ${ctx.periodStart ?? ""}–${ctx.periodEnd ?? ""}`.trim(),
      quantityMilli: 1000n,
      unitPriceMinor: feeMinor,
      amountMinor: feeMinor,
    });

    const overage = events
      .slice(included)
      .map((e) => lineFromEvent(e, `${e.serviceCode} — beyond ${included} included visits`));

    const lines = [fee, ...overage];
    return Object.freeze({
      billToAccountId: ctx.billToAccountId,
      billToTier: ctx.billToTier,
      lines: Object.freeze(lines),
      totalMinor: totalOf(lines),
    });
  },
};
