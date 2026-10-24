import type { BillingPath, DraftInvoice, PathContext, BillableEvent, InvoiceLine } from "../../path.ts";
import { lineFromEvent, totalOf } from "../../shared/lines.ts";
import { requireTerm } from "../../shared/terms.ts";
import { ResolutionError } from "../../../inheritance/resolve.ts";

/**
 * Recurring membership fee plus whatever the plan does not cover. The included-
 * visits logic lives here and only here — it is the reason this is a separate
 * path rather than an `if (isMembership)` inside one_time.
 */
export const residentialMembership: BillingPath = {
  key: "residential_membership",
  build(events: readonly BillableEvent[], ctx: PathContext): DraftInvoice {
    const feeMinor = BigInt(requireTerm(ctx.resolvedTerms, "membership_fee_minor", "residential_membership"));
    const visits = requireTerm(ctx.resolvedTerms, "included_visits", "residential_membership");
    // slice() takes a fraction or a negative as something else entirely; a count of visits is a whole number.
    if (!/^\d+$/.test(visits)) throw new ResolutionError(`[billing:residential_membership] included_visits must be a whole number of visits; got "${visits}".`, "included_visits", "bad_value");
    const included = Number(visits);

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
