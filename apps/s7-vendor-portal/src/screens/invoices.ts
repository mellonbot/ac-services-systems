import { html, DataGrid } from "../../../../packages/ui/src/index.ts";
import type { RmaWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, qty, type Screen } from "./common.ts";
import { invoiceList } from "./orders.ts";

/** INVOICES — every invoice this vendor has submitted, with Rankine's match verdict and the reasons for a hold. */
export const invoices: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("vendorInvoices.list", {}), () => ctx.shell.gateway.listVendorInvoices({}));
  return html`<section class="s7-invoices">
    <h1 class="s7-h1">Invoices</h1>
    <p class="s7-lede">A matched invoice agrees with the order's price and with what Rankine received, and is ready to pay on your terms. A held invoice says why.</p>
    ${whenReady(ctx, list.value, (i) => invoiceList(ctx, i.invoices))}
  </section>`;
};

/** RETURNS — what Rankine has asked to send back, across every order. Answered on the order itself. */
export const returns: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("rmas.list", {}), () => ctx.shell.gateway.listReturns({}));
  return html`<section class="s7-returns">
    <h1 class="s7-h1">Returns</h1>
    ${whenReady(ctx, list.value, (r) => html`<div class="s7-scroll">${DataGrid({
      density: ctx.density, caption: "Requested by Rankine", rows: r.returns, rowKey: (x: RmaWire) => x.id, emptyText: "No returns requested.",
      columns: [
        { key: "po", header: "Order", cell: (x: RmaWire) => (x.poNumber ? linkTo(ctx, "order", { poId: x.poId }, x.poNumber) : "—") },
        { key: "qty", header: "Quantity", align: "end", numeric: true, cell: (x: RmaWire) => qty(x.quantityMilli) },
        { key: "reason", header: "Reason" },
        { key: "state", header: "Your answer", cell: (x: RmaWire) => (x.state === "requested" ? "Waiting on you — answer on the order" : x.state === "authorized" ? `Authorized · ${x.rmaNumber}` : `Rejected · ${x.vendorNote ?? ""}`) },
      ],
    })}</div>`)}
  </section>`;
};
