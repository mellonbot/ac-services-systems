import type { UnitOfWork } from "../db/unit-of-work.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import { PAYMENT_METHODS, invoiceStatusOf } from "../../../../packages/contracts/src/operations.ts";
import type {
  ListPaymentsInput, ListPaymentsOutput, PaymentWire, PaymentMethod, PaymentState,
  RecordPaymentInput, ReturnPaymentInput, PaymentOutput, VoidInvoiceInput, VoidInvoiceOutput, PaymentWebhookInput,
} from "../../../../packages/contracts/src/operations.ts";
import { requireUuid } from "./jobs.ts";
import { iso } from "../db/sql.ts";

/**
 * 0030 — WHAT WAS PAID AGAINST AN INVOICE. The office records each payment as
 * it arrives; the invoice's status is derived from the rows (S6 payments spec
 * §2 item 4), so nothing here sets a status. This file decides inputs and
 * names refusals; the table holds the money (ac_payment_fits_its_invoice: the
 * invoice row locked, its currency and tenancy, never more than its total).
 *
 * Who may write is S2's writeRoles — finance and the principals — checked by
 * the unit of work on every write, so it is not restated here.
 */
const PAYMENT_COLUMNS = `id, invoice_id, amount_minor::text, currency, method, reference, state,
  ${iso("received_at")} AS received_at, ${iso("returned_at")} AS returned_at, return_reason`;
type PaymentRow = {
  id: string; invoice_id: string; amount_minor: string; currency: string; method: PaymentMethod; reference: string | null;
  state: PaymentState; received_at: string; returned_at: string | null; return_reason: string | null;
};
const toWire = (r: PaymentRow): PaymentWire => ({
  id: r.id, invoiceId: r.invoice_id, amountMinor: r.amount_minor, currency: r.currency, method: r.method, reference: r.reference,
  state: r.state, receivedAt: r.received_at, returnedAt: r.returned_at, returnReason: r.return_reason,
});

type InvoiceRow = { id: string; org_id: string; region_id: string; total_minor: string; currency: string; issued_at: string | null; voided_at: string | null };
/** The invoice, locked: a payment and a void racing each other settle one way. */
const lockedInvoice = async (uow: UnitOfWork, invoiceId: unknown): Promise<InvoiceRow> => {
  const id = requireUuid(invoiceId, "invoiceId");
  const row = (await uow.tx.query<InvoiceRow>(
    `SELECT id, org_id, region_id, total_minor::text, currency, ${iso("issued_at")} AS issued_at, ${iso("voided_at")} AS voided_at
       FROM invoices WHERE id = $1 FOR UPDATE`, [id],
  ))[0];
  if (!row) throw new InputRefused(`no invoice ${id} in this scope`, "unknown_invoice");
  if (!row.issued_at) throw new InputRefused(`invoice ${id} has not been issued — there is nothing to pay or void yet`, "invoice_not_issued");
  if (row.voided_at) throw new InputRefused(`invoice ${id} was voided on ${row.voided_at.slice(0, 10)}; a void invoice is final`, "invoice_void");
  return row;
};
const paidOn = async (uow: UnitOfWork, invoiceId: string): Promise<bigint> =>
  BigInt((await uow.tx.query<{ paid: string }>(
    `SELECT COALESCE(sum(amount_minor), 0)::text AS paid FROM payments WHERE invoice_id = $1 AND state = 'succeeded'`, [invoiceId],
  ))[0]!.paid);
const reason = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${what} needs its reason`);
  if (v.trim().length > 500) throw new BadInput("reason must be at most 500 characters");
  return v.trim();
};

export const listPayments = async (uow: UnitOfWork, input: ListPaymentsInput): Promise<ListPaymentsOutput> => {
  const id = requireUuid(input.invoiceId, "invoiceId");
  const rows = await uow.tx.query<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE invoice_id = $1 ORDER BY received_at, created_at`, [id]);
  return { payments: rows.map(toWire) };
};

/** OPEN-PAYMENTS scaffold: a processor webhook that lands a succeeded payment.
 * Signature verification is the caller's; this refuses unless AC_PAYMENT_WEBHOOK_SECRET is set.
 * The office path (recordPayment) remains the source of truth until Y1–Y5 decide the processor. */
export const paymentWebhook = async (uow: UnitOfWork, input: PaymentWebhookInput, newId: () => string, now: Date): Promise<PaymentOutput> => {
  if (!process.env.AC_PAYMENT_WEBHOOK_SECRET?.trim()) {
    throw new InputRefused("payment webhook is not configured (AC_PAYMENT_WEBHOOK_SECRET unset)", "webhook_not_configured");
  }
  // Reuse the office path with a system actor so the row is written the same way.
  return recordPayment(uow, "00000000-0000-0000-0000-000000000000", input, newId, now);
};

export const recordPayment = async (uow: UnitOfWork, actorId: string, input: RecordPaymentInput, newId: () => string, now: Date): Promise<PaymentOutput> => {
  const inv = await lockedInvoice(uow, input.invoiceId);
  if (typeof input.amountMinor !== "string" || !/^[1-9][0-9]{0,17}$/.test(input.amountMinor)) {
    throw new BadInput("amountMinor must be a positive whole number of minor units, as a string");
  }
  const amount = BigInt(input.amountMinor);
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) throw new BadInput(`method must be one of ${PAYMENT_METHODS.join(", ")}`);
  let ref: string | null = null;
  if (input.reference !== undefined && input.reference !== null) {
    if (typeof input.reference !== "string" || input.reference.trim().length > 120) throw new BadInput("reference must be text of at most 120 characters");
    ref = input.reference.trim() || null;
  }
  let receivedAt = now;
  if (input.receivedAt !== undefined) {
    receivedAt = new Date(typeof input.receivedAt === "string" ? input.receivedAt : NaN);
    if (Number.isNaN(receivedAt.getTime())) throw new BadInput("receivedAt must be an ISO timestamp");
  }
  if (receivedAt.getTime() > now.getTime()) throw new InputRefused("a payment is recorded once it has arrived, not before", "received_in_future");
  if (receivedAt.getTime() < Date.parse(inv.issued_at!)) {
    throw new InputRefused(`invoice ${inv.id} was issued ${inv.issued_at!.slice(0, 10)}; nothing was paid against it before that`, "received_before_issue");
  }
  const before = await paidOn(uow, inv.id);
  const total = BigInt(inv.total_minor);
  if (before + amount > total) {
    throw new InputRefused(`invoice ${inv.id} totals ${total} and ${before} is paid; ${amount} more would overpay it by ${before + amount - total}`, "overpayment");
  }
  const after = before + amount;
  const status = invoiceStatusOf({ issuedAt: inv.issued_at, voidedAt: null, totalMinor: inv.total_minor, paidMinor: after.toString() });
  const id = newId();
  const at = receivedAt.toISOString();
  const eventId = await uow.apply(
    {
      entity: "payment", entityId: id, action: "payment.record",
      // The payment that settles the invoice is the invoice paid; any other is a part payment.
      topic: status === "paid" ? "invoice.paid" : "payment.recorded",
      before: { paidMinor: before.toString() }, after: { paidMinor: after.toString(), status, amountMinor: input.amountMinor, method: input.method, reference: ref, receivedAt: at },
      orgId: inv.org_id, regionId: inv.region_id,
      payload: { invoiceId: inv.id, paymentId: id },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO payments (id, org_id, region_id, invoice_id, amount_minor, currency, method, reference, state, received_at, recorded_by)
         VALUES ($1, $2, $3, $4, $5::bigint, $6, $7, $8, 'succeeded', $9, $10)`,
        [id, inv.org_id, inv.region_id, inv.id, input.amountMinor, inv.currency, input.method, ref, at, actorId],
      );
    },
  );
  const payment: PaymentWire = { id, invoiceId: inv.id, amountMinor: input.amountMinor, currency: inv.currency, method: input.method, reference: ref, state: "succeeded", receivedAt: at, returnedAt: null, returnReason: null };
  return { payment, invoiceStatus: status, paidMinor: after.toString(), eventId };
};

export const returnPayment = async (uow: UnitOfWork, input: ReturnPaymentInput, now: Date): Promise<PaymentOutput> => {
  const paymentId = requireUuid(input.paymentId, "paymentId");
  const why = reason(input.reason, "a returned payment");
  const as = input.as ?? "returned";
  if (as !== "returned" && as !== "refunded") throw new BadInput("as must be returned or refunded");
  const found = (await uow.tx.query<{ invoice_id: string }>(`SELECT invoice_id FROM payments WHERE id = $1`, [paymentId]))[0];
  if (!found) throw new InputRefused(`no payment ${paymentId} in this scope`, "unknown_payment");
  // Invoice first, then the payment — the order recordPayment and the table's trigger take them in.
  const inv = (await uow.tx.query<InvoiceRow>(
    `SELECT id, org_id, region_id, total_minor::text, currency, ${iso("issued_at")} AS issued_at, ${iso("voided_at")} AS voided_at
       FROM invoices WHERE id = $1 FOR UPDATE`, [found.invoice_id],
  ))[0]!;
  const p = (await uow.tx.query<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]))[0]!;
  if (p.state !== "succeeded") throw new InputRefused(`payment ${paymentId} is ${p.state}; only a payment that landed can come back`, "payment_not_succeeded");
  const before = await paidOn(uow, inv.id);
  const after = before - BigInt(p.amount_minor);
  const status = invoiceStatusOf({ issuedAt: inv.issued_at, voidedAt: inv.voided_at, totalMinor: inv.total_minor, paidMinor: after.toString() });
  const at = now.toISOString();
  const eventId = await uow.apply(
    {
      entity: "payment", entityId: paymentId, action: `payment.${as}`, topic: "payment.returned",
      before: { state: "succeeded", paidMinor: before.toString() }, after: { state: as, paidMinor: after.toString(), status, reason: why },
      orgId: inv.org_id, regionId: inv.region_id,
      payload: { invoiceId: inv.id, paymentId },
    },
    async (tx) => {
      await tx.query(`UPDATE payments SET state = $2, returned_at = $3, return_reason = $4 WHERE id = $1 AND state = 'succeeded'`, [paymentId, as, at, why]);
    },
  );
  return { payment: toWire({ ...p, state: as, returned_at: at, return_reason: why }), invoiceStatus: status, paidMinor: after.toString(), eventId };
};

export const voidInvoice = async (uow: UnitOfWork, input: VoidInvoiceInput, now: Date): Promise<VoidInvoiceOutput> => {
  const inv = await lockedInvoice(uow, input.invoiceId);
  const why = reason(input.reason, "a void");
  const standing = (await uow.tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payments WHERE invoice_id = $1 AND state IN ('pending','succeeded')`, [inv.id],
  ))[0]!.n;
  if (standing > 0) {
    throw new InputRefused(`invoice ${inv.id} has ${standing} payment(s) standing against it — return or refund them before voiding it`, "invoice_has_payments");
  }
  const at = now.toISOString();
  const eventId = await uow.apply(
    {
      entity: "invoice", entityId: inv.id, action: "invoice.void", topic: "invoice.voided",
      before: { status: "open" }, after: { status: "void", voidedAt: at, reason: why },
      orgId: inv.org_id, regionId: inv.region_id,
      payload: { invoiceId: inv.id },
    },
    async (tx) => { await tx.query(`UPDATE invoices SET voided_at = $2, void_reason = $3 WHERE id = $1`, [inv.id, at, why]); },
  );
  return { invoiceId: inv.id, voidedAt: at, eventId };
};
