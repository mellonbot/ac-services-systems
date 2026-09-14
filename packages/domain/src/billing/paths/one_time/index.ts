import type { BillingPath, DraftInvoice, PathContext, BillableEvent } from "../../path.ts";
import { lineFromEvent, totalOf } from "../../shared/lines.ts";

/** Single job, billed to the account that requested it. No period, no rollup. */
export const oneTime: BillingPath = {
  key: "one_time",
  build(events: readonly BillableEvent[], ctx: PathContext): DraftInvoice {
    const lines = events.map((e) => lineFromEvent(e, `${e.serviceCode} — job ${e.jobId}`));
    return Object.freeze({
      billToAccountId: ctx.billToAccountId,
      billToTier: ctx.billToTier,
      lines: Object.freeze(lines),
      totalMinor: totalOf(lines),
    });
  },
};
