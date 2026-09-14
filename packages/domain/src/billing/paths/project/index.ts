import type { BillingPath, DraftInvoice, PathContext, BillableEvent, InvoiceLine } from "../../path.ts";
import { lineFromEvent, totalOf } from "../../shared/lines.ts";
import { enterpriseSla } from "../enterprise_sla/index.ts";

/**
 * Milestone / percentage-of-completion, with retainage. It shares roughly 80%
 * of its shape with enterprise_sla, which is exactly why it is a separate
 * directory: that 80% is the temptation the structure exists to refuse.
 */
export const project: BillingPath = {
  key: "project",
  build(events: readonly BillableEvent[], ctx: PathContext): DraftInvoice {
    // Projects billed on an SLA schedule are just the enterprise path with a
    // different label. Reuse it rather than keeping two copies of the same
    // milestone rounding in sync.
    if (String(ctx.resolvedTerms["billing_model"] ?? "") === "sla") return enterpriseSla.build(events, ctx);

    const retainageBps = BigInt(String(ctx.resolvedTerms["retainage_bps"] ?? "0"));
    const work = events.map((e) => lineFromEvent(e, `${e.serviceCode} — milestone work`));
    const gross = totalOf(work);
    const held = (gross * retainageBps) / 10000n;

    const retainage: readonly InvoiceLine[] = held === 0n ? [] : [
      Object.freeze({
        accountId: ctx.billToAccountId,
        jobId: null,
        description: `Retainage held (${Number(retainageBps) / 100}%)`,
        quantityMilli: 1000n,
        unitPriceMinor: -held,
        amountMinor: -held,
      }),
    ];

    const lines = [...work, ...retainage];
    return Object.freeze({
      billToAccountId: ctx.billToAccountId,
      billToTier: ctx.billToTier,
      lines: Object.freeze(lines),
      totalMinor: totalOf(lines),
    });
  },
};
