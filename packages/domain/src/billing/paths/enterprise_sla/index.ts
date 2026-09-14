import type { BillingPath, DraftInvoice, PathContext, BillableEvent, InvoiceLine } from "../../path.ts";
import { lineFromEvent, totalOf } from "../../shared/lines.ts";
import { allocate } from "../../../money/allocate.ts";

/**
 * Non-negotiable #7, in full: ONE invoice to the parent, EVERY line carrying
 * its own location. This is the path the whole enterprise pitch rests on — a
 * facilities director who gets fifty invoices does not renew.
 *
 * The parent-level charges (platform fee, SLA credits) are the interesting part:
 * they are owed at the parent but must be itemized per location or the customer
 * cannot allocate them to their own cost centres. allocate() splits them by
 * volume with an exact sum. Nobody eats a stray cent, and the same three sites
 * do not eat it every month.
 */
export const enterpriseSla: BillingPath = {
  key: "enterprise_sla",
  build(events: readonly BillableEvent[], ctx: PathContext): DraftInvoice {
    if (ctx.billToTier !== "parent" && ctx.billToTier !== "region") {
      throw new Error(
        `[billing:enterprise_sla] bills to parent or region tier; got ${ctx.billToTier}. ` +
        `A per-location enterprise invoice is the failure mode this path exists to prevent.`,
      );
    }

    const work = events.map((e) => lineFromEvent(e, `${e.serviceCode} — job ${e.jobId}`));

    // Money crosses the jsonb boundary as a STRING, never a JSON number. A JSON
    // number is an IEEE754 double: past 2^53 minor units it silently rounds, and
    // an enterprise platform fee is exactly the kind of number that gets there.
    const platformFeeMinor = BigInt(String(ctx.resolvedTerms["platform_fee_minor"] ?? "0"));
    const sites = [...new Set(events.map((e) => e.accountId))];
    const weights = sites.map((s) =>
      events.filter((e) => e.accountId === s).reduce((a, e) => a + e.quantityMilli, 0n),
    );

    const allocated: InvoiceLine[] =
      platformFeeMinor === 0n || sites.length === 0
        ? []
        : allocate(platformFeeMinor, weights).map((amount, i) =>
            Object.freeze({
              accountId: sites[i]!,
              jobId: null,
              description: `Platform fee, allocated by volume (${ctx.periodStart ?? ""}–${ctx.periodEnd ?? ""})`.trim(),
              quantityMilli: 1000n,
              unitPriceMinor: amount,
              amountMinor: amount,
            }),
          );

    const lines = [...work, ...allocated];
    return Object.freeze({
      billToAccountId: ctx.billToAccountId,
      billToTier: ctx.billToTier,
      lines: Object.freeze(lines),
      totalMinor: totalOf(lines),
    });
  },
};
