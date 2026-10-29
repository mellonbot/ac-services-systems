import { html, pageHead, panel, signal, DataGrid, shortRef, localDay, type VNode } from "../../../../packages/ui/src/index.ts";
import type { InvoiceWire, InvoiceStatus, PaymentWire, PaymentState, PaymentMethod, OrganizationWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { PAYMENT_METHODS, SURFACES } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, refusalView, submitAction, formValues, confirmPanel, type Screen, type ScreenContext } from "./common.ts";
import { formatMoney as money, parseMoney } from "../../../../packages/ui/src/fixed-units.ts";

/**
 * 0030 — BILLING, the office's read of what was paid against each invoice.
 * Two screens: every invoice with where it stands, and one invoice's payment
 * history — every payment in every state, a returned check included — beside
 * what is still owed. The status is derived by the gateway from the payments;
 * nothing here adds them up to decide it.
 *
 * The invoice screen also carries the office's three writes — record a
 * payment, mark one returned, void the invoice — each confirmed before it is
 * sent, and shown only to the roles S2's writeRoles admit (finance and the
 * principals). The gateway and 0030 refuse anything else whoever sends it;
 * hiding the forms only spares everyone else a refusal.
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
    ${pageHead("Invoicing", "Every invoice, what was paid against it and what is still owed. Open one for its payment history.")}
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
// /invoicing/invoices/:invoiceId — one invoice's payment history.
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
        }) ?? html``), "Payment history", undefined, undefined, "payment-history")}
        ${payments.value.state === "ready" ? writes(ctx, inv, payments.value.value.payments) : null}`;
    })}
  </section>`;
};

/** Who may write money on S2: the registry's own list, not a copy of it. */
export const maySettle = (roles: readonly string[]): boolean =>
  (SURFACES.S2.writeRoles?.payment ?? []).some((r) => roles.includes(r));

/**
 * The day a payment arrived, as the gateway takes it. Today is sent as no date
 * at all — "now" at the gateway — so a payment recorded the day an invoice is
 * issued is never earlier than the issue. Any other day is that day at local
 * noon, so a time-zone edge never moves it to the day before.
 */
export const receivedAtFor = (typed: string, today: string): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) throw new Error("Give the day the payment arrived.");
  if (typed > today) throw new Error("A payment is recorded once it has arrived, not before.");
  return typed === today ? undefined : new Date(`${typed}T12:00:00`).toISOString();
};

type Pending =
  | { readonly kind: "record"; readonly amountMinor: string; readonly method: PaymentMethod; readonly reference: string; readonly day: string; readonly receivedAt: string | undefined }
  | { readonly kind: "return"; readonly payment: PaymentWire; readonly reason: string }
  | { readonly kind: "void"; readonly reason: string };
const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean; readonly pending: Pending | null; readonly owner: string | null }>({ refusal: null, busy: false, pending: null, owner: null });
/** A typed value the form itself turns down, said under the field it is about rather than below every form. */
type FieldId = "amount" | "return-reason" | "void-reason";
const fieldError = signal<{ readonly owner: string; readonly field: FieldId; readonly message: string } | null>(null);
const clear = () => { outcome.value = { refusal: null, busy: false, pending: null, owner: null }; fieldError.value = null; };
const failed = (err: unknown): Refusal => ({ kind: "bad_request", message: err instanceof Error ? err.message : String(err) });

const send = async (ctx: ScreenContext, fn: () => Promise<string>): Promise<void> => {
  if (ctx.degraded || outcome.value.busy) return;
  outcome.value = { ...outcome.value, refusal: null, busy: true };
  try {
    const msg = await fn();
    refreshBilling(ctx.store);
    ctx.store.notice.value = [msg];
    clear();
  } catch (err) {
    outcome.value = { refusal: ctx.shell.refusalOf(err) ?? failed(err), busy: false, pending: null, owner: null };
  }
};

/** The three writes, for one invoice. Nothing is sent until its confirmation is. */
const writes = (ctx: ScreenContext, inv: InvoiceWire, payments: readonly PaymentWire[]): VNode => {
  const { shell } = ctx;
  if (!maySettle(ctx.shell.principal.roles)) {
    return html`<p class="s2-muted" id="billing-writes-note">Recording a payment, marking one returned and voiding an invoice are finance's, or a principal's.</p>`;
  }
  const mine = outcome.value.owner === inv.id ? outcome.value.pending : null;
  const blocked = ctx.degraded || outcome.value.busy || outcome.value.pending !== null;
  const ask = (pending: Pending) => { fieldError.value = null; outcome.value = { refusal: null, busy: false, pending, owner: inv.id }; };
  const turnDown = (field: FieldId, err: unknown) => { clear(); fieldError.value = { owner: inv.id, field, message: err instanceof Error ? err.message : String(err) }; };
  const errorOf = (field: FieldId): string | null => fieldError.value?.owner === inv.id && fieldError.value.field === field ? fieldError.value.message : null;
  const fieldErrorLine = (field: FieldId): VNode | null => errorOf(field) ? html`<small class="s2-field-error" id=${`${field}-error-${inv.id}`}>${errorOf(field)}</small>` : null;
  const invalid = (field: FieldId) => errorOf(field) ? { "aria-invalid": "true", "aria-describedby": `${field}-error-${inv.id}` } : {};
  const owed = owedMinor(inv);
  const standing = payments.filter((p) => p.state === "succeeded" || p.state === "pending");

  const askRecord = (e: Event) => {
    e.preventDefault();
    if (blocked) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    try {
      const amountMinor = parseMoney(v.amount ?? "", `"${v.amount ?? ""}" is not an amount — whole units and up to two decimals`);
      if (BigInt(amountMinor) <= 0n) throw new Error("A payment is more than nothing.");
      if (BigInt(amountMinor) > BigInt(owed)) throw new Error(`Only ${money(owed, inv.currency)} is still owed on this invoice.`);
      const today = localDay();
      const typedDay = v.receivedOn || today;
      ask({ kind: "record", amountMinor, method: (v.method ?? "check") as PaymentMethod, reference: (v.reference ?? "").trim(), day: typedDay, receivedAt: receivedAtFor(typedDay, today) });
    } catch (err) { turnDown("amount", err); }
  };
  const askVoid = (e: Event) => {
    e.preventDefault();
    if (blocked) return;
    const reason = (formValues(e.currentTarget as HTMLFormElement).reason ?? "").trim();
    if (!reason) { turnDown("void-reason", "Say why the invoice is void."); return; }
    ask({ kind: "void", reason });
  };
  const askReturn = (e: Event) => {
    e.preventDefault();
    if (blocked) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const payment = standing.find((p) => p.id === v.paymentId);
    const reason = (v.reason ?? "").trim();
    if (!payment) return;
    if (!reason) { turnDown("return-reason", "Say why it came back — the bank's return code, or what happened."); return; }
    ask({ kind: "return", payment, reason });
  };

  const confirm = (): VNode | null => {
    if (!mine) return null;
    const p = mine;
    if (p.kind === "record") return confirmPanel({
      id: `confirm-record-${inv.id}`,
      title: `Record ${money(p.amountMinor, inv.currency)} received by ${METHOD_WORD[p.method]}?`,
      detail: `Received ${p.day === localDay() ? "today" : day(`${p.day}T12:00:00`)}${p.reference ? `, reference ${p.reference}` : ""}. ${BigInt(p.amountMinor) === BigInt(owed) ? "This settles the invoice in full." : `${money((BigInt(owed) - BigInt(p.amountMinor)).toString(), inv.currency)} will still be owed.`} A recorded payment is not edited; one that comes back is marked returned.`,
      confirmLabel: "Record payment", busy: outcome.value.busy, onCancel: clear,
      onConfirm: () => void send(ctx, async () => {
        const out = await shell.gateway.recordPayment({ invoiceId: inv.id, amountMinor: p.amountMinor, method: p.method, ...(p.reference ? { reference: p.reference } : {}), ...(p.receivedAt ? { receivedAt: p.receivedAt } : {}) });
        return out.invoiceStatus === "paid" ? "Payment recorded. The invoice is paid in full." : `Payment recorded. ${money((BigInt(inv.totalMinor) - BigInt(out.paidMinor)).toString(), inv.currency)} is still owed.`;
      }),
    });
    if (p.kind === "return") return confirmPanel({
      id: `confirm-return-${inv.id}`,
      title: `Mark the ${money(p.payment.amountMinor, p.payment.currency)} ${METHOD_WORD[p.payment.method]} payment returned?`,
      detail: `Reason: ${p.reason}. The payment stays on the record as returned and no longer counts toward what was received.`,
      confirmLabel: "Mark returned", danger: true, busy: outcome.value.busy, onCancel: clear,
      onConfirm: () => void send(ctx, async () => {
        await shell.gateway.returnPayment({ paymentId: p.payment.id, reason: p.reason });
        return "Payment marked returned. It no longer counts toward what was received.";
      }),
    });
    return confirmPanel({
      id: `confirm-void-${inv.id}`,
      title: `Void invoice ${shortRef(inv.id)}?`,
      detail: `Reason: ${p.reason}. A void invoice is never owed or paid and does not change again — a correction is a new invoice.`,
      confirmLabel: "Void invoice", danger: true, busy: outcome.value.busy, onCancel: clear,
      onConfirm: () => void send(ctx, async () => {
        await shell.gateway.voidInvoice({ invoiceId: inv.id, reason: p.reason });
        return "Invoice voided.";
      }),
    });
  };

  const canPay = inv.status === "open" || inv.status === "partially_paid";
  return html`
    ${canPay ? panel(html`<form class="ac-form ac-form--inline" onSubmit=${askRecord} id="record-payment-form">
      <label class="ac-field"><span>Amount (${inv.currency})</span><input class="ac-input" name="amount" inputmode="decimal" required placeholder=${money(owed)} ...${invalid("amount")} />${fieldErrorLine("amount")}</label>
      <label class="ac-field"><span>Method</span><select class="ac-input" name="method">${PAYMENT_METHODS.map((m) => html`<option value=${m}>${METHOD_WORD[m]}</option>`)}</select></label>
      <label class="ac-field"><span>Reference</span><input class="ac-input" name="reference" maxlength="120" placeholder="Check number or bank trace" /></label>
      <label class="ac-field"><span>Received on</span><input class="ac-input" name="receivedOn" type="date" max=${localDay()} defaultValue=${localDay()} /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Record payment", "record-payment")}</div>
    </form>`, "Record a payment", `What arrived against this invoice. ${money(owed, inv.currency)} is still owed.`, undefined, "record-payment") : null}
    ${standing.length > 0 ? panel(html`<form class="ac-form ac-form--inline" onSubmit=${askReturn} id="return-payment-form">
      <label class="ac-field"><span>Payment</span><select class="ac-input" name="paymentId">${standing.map((p) => html`<option value=${p.id}>${day(p.receivedAt)} · ${money(p.amountMinor, p.currency)} · ${METHOD_WORD[p.method]}${p.reference ? ` · ${p.reference}` : ""}</option>`)}</select></label>
      <label class="ac-field"><span>Why it came back</span><input class="ac-input" name="reason" maxlength="500" required placeholder="R01 insufficient funds" ...${invalid("return-reason")} />${fieldErrorLine("return-reason")}</label>
      <div class="s2-form__actions">${submitAction(ctx, "Mark returned", "return-payment")}</div>
    </form>`, "A payment came back", "A bounced check or an ACH return. The payment stays on the record, marked returned.", undefined, "return-payment") : null}
    ${inv.status === "open" && standing.length === 0 ? panel(html`<form class="ac-form ac-form--inline" onSubmit=${askVoid} id="void-invoice-form">
      <label class="ac-field"><span>Why it is void</span><input class="ac-input" name="reason" maxlength="500" required placeholder="Billed twice" ...${invalid("void-reason")} />${fieldErrorLine("void-reason")}</label>
      <div class="s2-form__actions">${submitAction(ctx, "Void invoice", "void-invoice")}</div>
    </form>`, "Void this invoice", "Only an invoice nothing has been paid against. Final.", undefined, "void-invoice") : null}
    ${confirm()}
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: clear }]) : null}`;
};

/** Refetch on any payment or invoice event: the envelope carries no payload, so forget and re-read. */
export const refreshBilling = (store: ScreenContext["store"]): void => {
  store.invalidate("invoices.list");
  store.invalidate("payments.list");
};
