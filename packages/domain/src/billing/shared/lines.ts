import type { BillableEvent, InvoiceLine } from "../path.ts";

/**
 * Admitted to shared/ because it serves all four paths identically and needs no
 * flag to do so. It turns an event into a line. That is all it does, and that is
 * the test it had to pass.
 */
export const lineFromEvent = (e: BillableEvent, description: string): InvoiceLine =>
  Object.freeze({
    accountId: e.accountId,
    jobId: e.jobId,
    description,
    quantityMilli: e.quantityMilli,
    unitPriceMinor: e.unitPriceMinor,
    amountMinor: (e.quantityMilli * e.unitPriceMinor) / 1000n,
  });

export const totalOf = (lines: readonly InvoiceLine[]): bigint =>
  lines.reduce((a, l) => a + l.amountMinor, 0n);
