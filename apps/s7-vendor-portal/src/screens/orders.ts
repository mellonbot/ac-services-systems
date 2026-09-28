import { html, statStrip, pageHead, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { PurchaseOrderWire, PoLineWire, VendorInvoiceWire, RmaWire, PurchaseOrderDetailOutput } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import {
  whenReady, act, outcomeSignal, outcomeView, submitAction, formValues, linkTo, poPill, qty, toMilli, money, toMinor, plain, today, TIER_WORD,
  type Screen, type ScreenContext,
} from "./common.ts";

/**
 * ORDERS — what Rankine has asked this vendor for. The rows are the ones 0011
 * lets a vendor read: its own orders, once issued. Nothing names a customer,
 * a site or a job; an order goes to one of Rankine's receiving points.
 */
const REFRESH = ["pos.", "vendorInvoices.list", "rmas.list"];

export const orders: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("pos.list", {}), () => ctx.shell.gateway.listPurchaseOrders({}));
  return html`<section class="s7-orders">
    ${pageHead("Orders", "Purchase orders from Rankine. Acknowledge each with the day it will ship, record shipments as they leave, and invoice what Rankine has received.")}
    ${whenReady(ctx, list.value, (o) => statStrip([
      { n: o.orders.filter((x) => x.state === "issued").length, label: "Need your acknowledgement", ...(o.orders.some((x) => x.state === "issued") ? { tone: "at_risk" as const } : {}) },
      { n: o.orders.filter((x) => x.state === "acknowledged").length, label: "Open", tone: "info" },
      { n: o.orders.filter((x) => x.state === "received").length, label: "Received in full", tone: "ok" },
      { n: o.orders.length, label: "All orders" },
    ], "order-stats"))}
    ${whenReady(ctx, list.value, (o) => html`<div class="s7-scroll">${DataGrid({
      density: ctx.density, caption: "Newest first", rows: o.orders, rowKey: (r: PurchaseOrderWire) => r.id,
      emptyText: "No orders yet. An order appears here when Rankine issues it.",
      columns: [
        { key: "number", header: "Order", cell: (r: PurchaseOrderWire) => linkTo(ctx, "order", { poId: r.id }, r.number) },
        { key: "to", header: "Deliver to", cell: (r: PurchaseOrderWire) => `${r.receivingPointCode ?? "—"}${r.receivingTier ? ` · ${TIER_WORD[r.receivingTier]}` : ""}` },
        { key: "issued", header: "Issued", cell: (r: PurchaseOrderWire) => (r.issuedAt ? r.issuedAt.slice(0, 10) : "—") },
        { key: "ship", header: "Ships by", cell: (r: PurchaseOrderWire) => r.promisedShipOn ?? "—" },
        { key: "total", header: "Total", align: "end", numeric: true, cell: (r: PurchaseOrderWire) => html`<span class="s7-num">${money(r.totalMinor, r.currency)}</span>` },
        { key: "state", header: "State", cell: (r: PurchaseOrderWire) => poPill(ctx, r.state) },
      ],
    })}</div>`)}
  </section>`;
};

const ack = outcomeSignal(), ship = outcomeSignal(), inv = outcomeSignal(), rma = outcomeSignal();
/** An outcome belongs to the order it happened on; opening another order starts clean. */
let shownPo: string | null = null;

const acknowledgeForm = (ctx: ScreenContext, d: PurchaseOrderDetailOutput): VNode => {
  const submit = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, ack, async () => {
      await ctx.shell.gateway.acknowledgePurchaseOrder({ poId: d.order.id, promisedShipOn: v.promisedShipOn ?? "" });
      return `Acknowledged. Rankine has your ship date of ${v.promisedShipOn}.`;
    }, REFRESH);
  };
  return html`<h2 class="s7-h2">Acknowledge this order</h2>
    <form class="s7-form s7-form--row" onSubmit=${submit} id="ack-form">
      <label class="s7-field"><span>It will ship on</span><input class="s7-input" type="date" name="promisedShipOn" min=${today()} required /></label>
      ${submitAction(ctx, ack, "Acknowledge", "acknowledge")}
    </form>`;
};

const shipForm = (ctx: ScreenContext, d: PurchaseOrderDetailOutput): VNode => {
  const open = d.lines.filter((l) => BigInt(l.shippedMilli) < BigInt(l.quantityMilli));
  if (open.length === 0) return html`<p class="s7-muted">Everything on this order has shipped.</p>`;
  const submit = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, ship, async () => {
      const lines = open.filter((l) => v[`ship:${l.id}`]).map((l) => ({ poLineId: l.id, quantityMilli: toMilli(v[`ship:${l.id}`]!) }));
      if (lines.length === 0) throw new Error("Enter what shipped on at least one line.");
      await ctx.shell.gateway.recordShipment({ poId: d.order.id, shippedOn: v.shippedOn ?? "", carrier: v.carrier ?? "", ...(v.tracking ? { tracking: v.tracking } : {}), lines });
      return "Shipment recorded. Rankine sees it on the order.";
    }, REFRESH);
  };
  return html`<h2 class="s7-h2">Record a shipment</h2>
    <form class="s7-form" onSubmit=${submit} id="ship-form">
      <div class="s7-row">
        <label class="s7-field"><span>Shipped on</span><input class="s7-input" type="date" name="shippedOn" defaultValue=${today()} required /></label>
        <label class="s7-field"><span>Carrier</span><input class="s7-input" name="carrier" required /></label>
        <label class="s7-field"><span>Tracking</span><input class="s7-input" name="tracking" /></label>
      </div>
      ${open.map((l) => html`<label class="s7-field"><span>Line ${l.lineNo} · ${l.vendorSku} — ${qty((BigInt(l.quantityMilli) - BigInt(l.shippedMilli)).toString())} ${l.uom} still to ship</span>
        <input class="s7-input" name=${`ship:${l.id}`} inputmode="decimal" defaultValue=${qty((BigInt(l.quantityMilli) - BigInt(l.shippedMilli)).toString())} /></label>`)}
      ${submitAction(ctx, ship, "Record shipment", "record-shipment")}
    </form>`;
};

const invoiceForm = (ctx: ScreenContext, d: PurchaseOrderDetailOutput): VNode => {
  const billable = d.lines.filter((l) => BigInt(l.receivedMilli) > BigInt(l.invoicedMilli));
  if (billable.length === 0) return html`<p class="s7-muted">Nothing received is waiting to be invoiced. You can invoice once Rankine records a receipt.</p>`;
  const submit = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, inv, async () => {
      const lines = billable.filter((l) => v[`q:${l.id}`]).map((l) => ({ poLineId: l.id, quantityMilli: toMilli(v[`q:${l.id}`]!), unitPriceMinor: toMinor(v[`p:${l.id}`] ?? "") }));
      if (lines.length === 0) throw new Error("Bill at least one line.");
      const out = await ctx.shell.gateway.submitVendorInvoice({ poId: d.order.id, invoiceNumber: v.invoiceNumber ?? "", invoiceDate: v.invoiceDate ?? "", lines });
      return out.matchState === "matched"
        ? `Invoice ${v.invoiceNumber} matched the order and the receipt: ${money(out.totalMinor, d.order.currency)}.`
        : `Invoice ${v.invoiceNumber} is held: ${out.matchNotes.map((n) => n.message).join("; ")}.`;
    }, REFRESH);
  };
  return html`<h2 class="s7-h2">Submit an invoice</h2>
    <form class="s7-form" onSubmit=${submit} id="invoice-form">
      <div class="s7-row">
        <label class="s7-field"><span>Invoice number</span><input class="s7-input" name="invoiceNumber" required /></label>
        <label class="s7-field"><span>Invoice date</span><input class="s7-input" type="date" name="invoiceDate" defaultValue=${today()} required /></label>
      </div>
      ${billable.map((l) => html`<div class="s7-row">
        <label class="s7-field"><span>Line ${l.lineNo} · ${l.vendorSku} — quantity (${qty((BigInt(l.receivedMilli) - BigInt(l.invoicedMilli)).toString())} received, not yet invoiced)</span>
          <input class="s7-input" name=${`q:${l.id}`} inputmode="decimal" defaultValue=${qty((BigInt(l.receivedMilli) - BigInt(l.invoicedMilli)).toString())} /></label>
        <label class="s7-field"><span>Unit price</span><input class="s7-input" name=${`p:${l.id}`} inputmode="decimal" defaultValue=${plain(l.unitPriceMinor)} /></label>
      </div>`)}
      <small class="s7-muted">Rankine matches every invoice to the order's price and to what it received. A difference holds the invoice, with the reason, until the office resolves it.</small>
      ${submitAction(ctx, inv, "Submit invoice", "submit-invoice")}
    </form>`;
};

const returnsBlock = (ctx: ScreenContext, d: PurchaseOrderDetailOutput): VNode => {
  if (d.returns.length === 0) return html`<p class="s7-muted">No returns requested.</p>`;
  const answer = (r: RmaWire, e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    const decision = (e as SubmitEvent).submitter?.getAttribute("value") === "rejected" ? "rejected" : "authorized";
    void act(ctx, rma, async () => {
      await ctx.shell.gateway.respondToReturn({ rmaId: r.id, decision, ...(v.rmaNumber ? { rmaNumber: v.rmaNumber } : {}), ...(v.note ? { note: v.note } : {}) });
      return decision === "authorized" ? `Return authorized as ${v.rmaNumber}.` : "Return rejected. Rankine sees your reason.";
    }, REFRESH);
  };
  return html`${d.returns.map((r) => {
    const line = d.lines.find((l) => l.id === r.poLineId);
    return html`<div class="s7-form">
      <p><b>Line ${line?.lineNo ?? "—"} · ${line?.vendorSku ?? ""}</b> — ${qty(r.quantityMilli)} to return. ${r.reason}</p>
      ${r.state === "requested" ? html`<form class="s7-row s7-row--end" onSubmit=${(e: Event) => answer(r, e)} id=${`rma-${r.id}`}>
          <label class="s7-field"><span>Your RMA number (to authorize)</span><input class="s7-input" name="rmaNumber" /></label>
          <label class="s7-field"><span>Note (required to reject)</span><input class="s7-input" name="note" /></label>
          <button type="submit" class="ac-action" data-kind="primary" data-density=${ctx.density} value="authorized">Authorize</button>
          <button type="submit" class="ac-action" data-kind="quiet" data-density=${ctx.density} value="rejected">Reject</button>
        </form>`
        : html`<p class="s7-muted">${r.state === "authorized" ? `Authorized · ${r.rmaNumber}` : `Rejected · ${r.vendorNote ?? ""}`}</p>`}
    </div>`;
  })}`;
};

export const order: Screen = (ctx, params) => {
  const poId = params.poId!;
  if (shownPo !== poId) {
    shownPo = poId;
    for (const o of [ack, ship, inv, rma]) if (o.peek().refusal || o.peek().sent) o.value = { refusal: null, sent: null, busy: false };
  }
  const detail = ctx.store.read(keyOf("pos.detail", { poId }), () => ctx.shell.gateway.purchaseOrder({ poId }));
  return html`<section class="s7-order">
    <p>${linkTo(ctx, "orders", {}, "‹ All orders")}</p>
    ${whenReady(ctx, detail.value, (d) => {
      const o = d.order, rp = d.receivingPoint;
      return html`
        <h1 class="s7-h1">${o.number} ${poPill(ctx, o.state)}</h1>
        <dl class="s7-facts">
          <div><dt>Deliver to</dt><dd>${rp ? html`${rp.code} · ${TIER_WORD[rp.tier]}<br /><span class="s7-muted">${[rp.address.line1, rp.address.city, rp.address.state, rp.address.postal].filter(Boolean).join(", ")}</span>` : "—"}</dd></div>
          <div><dt>Total</dt><dd class="s7-num">${money(o.totalMinor, o.currency)}</dd></div>
          <div><dt>Issued</dt><dd>${o.issuedAt ? o.issuedAt.slice(0, 10) : "—"}</dd></div>
          <div><dt>Ships by</dt><dd>${o.promisedShipOn ?? "Not yet promised"}</dd></div>
        </dl>
        <div class="s7-scroll">${DataGrid({
          density: ctx.density, caption: "Lines", rows: d.lines, rowKey: (l: PoLineWire) => l.id,
          columns: [
            { key: "no", header: "#", cell: (l: PoLineWire) => String(l.lineNo) },
            { key: "sku", header: "Your SKU", cell: (l: PoLineWire) => l.vendorSku },
            { key: "item", header: "Item", cell: (l: PoLineWire) => l.description },
            { key: "price", header: "Price", align: "end", numeric: true, cell: (l: PoLineWire) => money(l.unitPriceMinor, o.currency) },
            { key: "ordered", header: "Ordered", align: "end", numeric: true, cell: (l: PoLineWire) => `${qty(l.quantityMilli)} ${l.uom}` },
            { key: "shipped", header: "Shipped", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.shippedMilli) },
            { key: "received", header: "Received", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.receivedMilli) },
            { key: "invoiced", header: "Invoiced", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.invoicedMilli) },
          ],
        })}</div>
        ${o.state === "issued" ? acknowledgeForm(ctx, d) : null}
        ${outcomeView(ack, "ack-outcome")}
        ${o.state === "acknowledged" ? shipForm(ctx, d) : null}
        ${outcomeView(ship, "ship-outcome")}
        ${d.shipments.length ? html`<h2 class="s7-h2">Shipments</h2><ul>${d.shipments.map((s) => html`<li>${s.shippedOn} · ${s.carrier}${s.tracking ? ` · ${s.tracking}` : ""}</li>`)}</ul>` : null}
        ${["acknowledged", "received"].includes(o.state) ? invoiceForm(ctx, d) : null}
        ${outcomeView(inv, "invoice-outcome")}
        ${d.invoices.length ? html`<h2 class="s7-h2">Invoices on this order</h2>${invoiceList(ctx, d.invoices)}` : null}
        <h2 class="s7-h2">Returns</h2>
        ${returnsBlock(ctx, d)}
        ${outcomeView(rma, "rma-outcome")}`;
    })}
  </section>`;
};

export const invoiceList = (ctx: ScreenContext, list: readonly VendorInvoiceWire[]): VNode => html`<div class="s7-scroll">${DataGrid({
  density: ctx.density, caption: "Matched against the order's price and what Rankine received", rows: list, rowKey: (i: VendorInvoiceWire) => i.id,
  emptyText: "No invoices submitted.",
  columns: [
    { key: "number", header: "Invoice", cell: (i: VendorInvoiceWire) => `${i.invoiceNumber} · ${i.invoiceDate}` },
    { key: "po", header: "Order", cell: (i: VendorInvoiceWire) => (i.poNumber ? linkTo(ctx, "order", { poId: i.poId }, i.poNumber) : "—") },
    { key: "total", header: "Total", align: "end", numeric: true, cell: (i: VendorInvoiceWire) => html`<span class="s7-num">${money(i.totalMinor, i.currency)}</span>` },
    { key: "match", header: "Match", cell: (i: VendorInvoiceWire) => html`${StatusPill({ density: ctx.density, status: i.matchState === "matched" ? "ok" : "at_risk", label: i.matchState === "matched" ? "Matched" : "Held" })}
      ${i.matchNotes.length ? html`<ul class="s7-notes">${i.matchNotes.map((n) => html`<li>${n.message}</li>`)}</ul>` : null}` },
  ],
})}</div>`;
