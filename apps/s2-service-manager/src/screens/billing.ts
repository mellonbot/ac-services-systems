import { html, pageHead, panel, DataGrid, shortRef, type VNode } from "../../../../packages/ui/src/index.ts";
import type { InvoiceWire, InvoiceStatus, PaymentWire, PaymentState, PaymentMethod, OrganizationWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";
import { formatMoney as money } from "../../../../packages/ui/src/fixed-units.ts";

/**
 * 0030 — BILLING, the office's read of what was paid against each invoice.
 * Two screens: every invoice with where it stands, and one invoice's payment
 * history — every payment in every state, a returned check included — beside
 * what is still owed. The status is derived by the gateway from the payments;
 * nothing here adds them up to decide it.
 *
 * Recording a payment, returning one and voiding an invoice are operations
 * (payments.record, payments.return, invoices.void); their forms are not on
 * this screen yet.
 */

/**
 * Where an invoice stands is FILING state, drawn in the filing marks
 * (styles.ts) like an order's — never the status ramp: "paid" is not health.
 * Paid is `settled`, the plain solid mark, not `ended`: the struck-through
 * ended mark reads as cancelled, which a void invoice is and a paid one is not.
 */
export const INVOICE_STATE: Readonly<Record<InvoiceStatus, { tone: "pending" | "held" | "live" | "settled" | "ended"; word: string }>> = {
  draft: { tone: "pending", word: "Draft" },
  open: { tone: "held", word: "Waiting on payment" },
  partially_paid: { tone: "live", word: "Part paid" },
  paid: { tone: "settled", word: "Paid in full" },
  void: { tone: "ended", word: "Void" },
};
const PAYMENT_WORD: Readonly<Record<PaymentState, string>> = {
  pending: "Pending", succeeded: "Received", failed: "Failed", returned: "Returned", refunded: "Refunded",
};
const METHOD_WORD: Readonly<Record<PaymentMethod, string>> = {
  ach: "ACH", wire: "Wire", check: "Check", card: "Card", cash: "Cash", other: "Other",
};

/** Newest issued first; drafts, with no issue date, last. Sorted here so the caption holds whatever order the read returns. */
const newestIssued = (rows: readonly InvoiceWire[]): readonly InvoiceWire[] =>
  [...rows].sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));
const period = (inv: InvoiceWire) => (inv.periodStart ? `${inv.periodStart} – ${inv.periodEnd ?? "…"}` : "—");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const statePill = (s: InvoiceStatus): VNode => html`<span class="s2-state" data-tone=${INVOICE_STATE[s].tone}>${INVOICE_STATE[s].word}</span>`;
/** What is still owed on an invoice; nothing on a draft or a void one. */
export const owedMinor = (inv: InvoiceWire): string =>
  inv.status === "draft" || inv.status === "void" ? "0" : (BigInt(inv.totalMinor) - BigInt(inv.paidMinor)).toString();

/** A parent-billed invoice names its customer; any other names the tier it bills, because the wire carries the node's id, not its name. */
const billedTo = (inv: InvoiceWire, orgs: readonly OrganizationWire[]): string =>
  inv.billToTier === "parent" ? orgs.find((o) => o.id === inv.billToId)?.name ?? "—" : `${inv.billToTier[0]!.toUpperCase()}${inv.billToTier.slice(1)} ${shortRef(inv.billToId)}`;

// ---------------------------------------------------------------------------
// /billing — every invoice, where it stands.
// ---------------------------------------------------------------------------
export const billing: Screen = (ctx) => {
  const { shell, store } = ctx;
  const invoices = store.read(keyOf("invoices.list", {}), () => shell.gateway.listInvoices({}));
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));
  const names = orgs.value.state === "ready" ? orgs.value.value.organizations : [];

  return html`<section class="s2-billing">
    ${pageHead("Billing", "Every invoice, what was paid against it and what is still owed. Open one for its payment history.")}
    ${panel(whenReady(ctx, invoices.value, (o) => DataGrid({
      density: ctx.density,
      stack: true, caption: "Every invoice, newest issued first",
      rows: newestIssued(o.invoices), rowKey: (r: InvoiceWire) => r.id, emptyText: "No invoices yet. Issuance is not built; invoices appear here once they are issued.",
      columns: [
        { key: "ref", header: "Invoice", cell: (r: InvoiceWire) => linkTo(ctx, "billing.invoice", { invoiceId: r.id }, shortRef(r.id)) },
        { key: "to", header: "Billed to", cell: (r: InvoiceWire) => billedTo(r, names) },
        { key: "issued", header: "Issued", cell: (r: InvoiceWire) => day(r.issuedAt) },
        { key: "due", header: "Due", cell: (r: InvoiceWire) => day(r.dueAt) },
        { key: "total", header: "Total", align: "end", numeric: true, cell: (r: InvoiceWire) => money(r.totalMinor, r.currency) },
        { key: "owed", header: "Still owed", align: "end", numeric: true, cell: (r: InvoiceWire) => money(owedMinor(r), r.currency) },
        { key: "state", header: "Standing", cell: (r: InvoiceWire) => statePill(r.status) },
      ],
    }) ?? html``), "Invoices")}
  </section>`;
};

// ---------------------------------------------------------------------------
// /billing/invoices/:invoiceId — one invoice's payment history.
// ---------------------------------------------------------------------------
export const billingInvoice: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const invoiceId = params.invoiceId!;
  // invoices.list has no by-id read; the office reads every invoice, so the one asked for is in it.
  const invoices = store.read(keyOf("invoices.list", {}), () => shell.gateway.listInvoices({}));
  const payments = store.read(keyOf("payments.list", { invoiceId }), () => shell.gateway.listPayments({ invoiceId }));
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));
  const names = orgs.value.state === "ready" ? orgs.value.value.organizations : [];
  const back = linkTo(ctx, "billing", {}, "Back to billing");

  return html`<section class="s2-billing">
    ${whenReady(ctx, invoices.value, (o) => {
      const inv = o.invoices.find((i) => i.id === invoiceId);
      if (!inv) return html`${pageHead("Invoice not found", "No invoice with this reference is visible to you.", back)}`;
      return html`
        ${pageHead(html`Invoice <span class="ac-num">${shortRef(inv.id)}</span> ${statePill(inv.status)}`, "What was received against this invoice, in every state, and what is still owed.", back)}
        <dl class="ac-facts" id="invoice-facts">
          <div><dt>Billed to</dt><dd>${billedTo(inv, names)}</dd></div>
          <div><dt>Period</dt><dd class="ac-num">${period(inv)}</dd></div>
          <div><dt>Total</dt><dd class="ac-num">${money(inv.totalMinor, inv.currency)}</dd></div>
          <div><dt>Received</dt><dd class="ac-num">${money(inv.paidMinor, inv.currency)}</dd></div>
          <div><dt>Still owed</dt><dd class="ac-num">${money(owedMinor(inv), inv.currency)}</dd></div>
          <div><dt>Issued</dt><dd class="ac-num">${day(inv.issuedAt)}</dd></div>
          <div><dt>Due</dt><dd class="ac-num">${day(inv.dueAt)}</dd></div>
          ${inv.voidedAt ? html`<div><dt>Voided</dt><dd><span class="ac-num">${day(inv.voidedAt)}</span> — ${inv.voidReason}</dd></div>` : null}
        </dl>
        ${panel(whenReady(ctx, payments.value, (p) => DataGrid({
          density: ctx.density,
          stack: true, caption: "Payments against this invoice, oldest first",
          rows: [...p.payments].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)), rowKey: (r: PaymentWire) => r.id, emptyText: "Nothing has been received against this invoice.",
          columns: [
            { key: "received", header: "Received", cell: (r: PaymentWire) => day(r.receivedAt) },
            { key: "amount", header: "Amount", align: "end", numeric: true, cell: (r: PaymentWire) => money(r.amountMinor, r.currency) },
            { key: "method", header: "Method", cell: (r: PaymentWire) => METHOD_WORD[r.method] },
            { key: "reference", header: "Reference", cell: (r: PaymentWire) => r.reference ?? "—" },
            // A payment that came back stays on the record, with when and why; it no longer counts toward Received.
            { key: "state", header: "State", cell: (r: PaymentWire) => r.returnedAt
              ? `${PAYMENT_WORD[r.state]} ${day(r.returnedAt)}${r.returnReason ? ` — ${r.returnReason}` : ""}`
              : PAYMENT_WORD[r.state] },
          ],
        }) ?? html``), "Payment history", undefined, undefined, "payment-history")}`;
    })}
  </section>`;
};

/** Refetch on any payment or invoice event: the envelope carries no payload, so forget and re-read. */
export const refreshBilling = (store: ScreenContext["store"]): void => {
  store.invalidate("invoices.list");
  store.invalidate("payments.list");
};
