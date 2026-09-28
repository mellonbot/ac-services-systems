import { html, signal, DataGrid, StatusPill, type VNode, type Status } from "../../../../packages/ui/src/index.ts";
import type {
  Refusal, VendorWire, ReceivingPointWire, CatalogItemWire, PurchaseOrderWire, PoLineWire, PoState, VendorInvoiceWire, RmaWire, RegionWire,
} from "../../../../packages/contracts/src/index.ts";
import type { Store } from "../state.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * ITEM 11 — PURCHASING, the office's side of procurement. Three screens over
 * the same records S7 shows a vendor: vendors and receiving points; one
 * vendor's catalogue (deciding its proposed prices, raising an order at the
 * accepted ones); one purchase order (issue, cancel, receive, return, and the
 * invoices the vendor submitted, matched or held with the reasons).
 * Nothing here computes a price or a match: the gateway does, and the screen
 * shows what came back.
 */
const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

export const refreshProcurement = (store: Store): void => {
  for (const k of ["vendors.list", "receivingPoints.list", "catalog.list", "pos.", "vendorInvoices.list", "rmas.list"]) store.invalidate(k);
};

/** Thousandths → a quantity as people write it: "10", "2.5". */
export const qty = (milli: string): string => {
  const n = BigInt(milli), whole = n / 1000n, frac = n % 1000n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(3, "0").replace(/0+$/, "")}`;
};
/** A quantity as typed ("2.5") → thousandths ("2500"). Refuses more than three decimals rather than rounding someone's order. */
export const toMilli = (typed: string): string => {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(typed.trim());
  if (!m) throw new Error(`"${typed}" is not a quantity`);
  return (BigInt(m[1]!) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0") || "0")).toString();
};
/** Minor units → "425.00 USD". */
export const money = (minor: string, currency = "USD"): string => {
  const n = BigInt(minor), whole = n / 100n, cents = (n % 100n).toString().padStart(2, "0");
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents} ${currency}`;
};
/** "42.50" → "4250". Two decimals at most; money is never a float. */
export const toMinor = (typed: string): string => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!m) throw new Error(`"${typed}" is not an amount`);
  return (BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0")).toString();
};

export const PO_STATE: Readonly<Record<PoState, { status: Status; word: string }>> = {
  draft: { status: "blocked", word: "Draft" },
  issued: { status: "at_risk", word: "Waiting on vendor" },
  acknowledged: { status: "ok", word: "Acknowledged" },
  received: { status: "ok", word: "Received" },
  cancelled: { status: "blocked", word: "Cancelled" },
};
const TIER_WORD = { location_stock: "Location stock", regional_hub: "Regional hub", national: "National" } as const;

const act = async (ctx: ScreenContext, fn: () => Promise<string>): Promise<boolean> => {
  if (ctx.degraded || outcome.value.busy) return false;
  outcome.value = { refusal: null, busy: true };
  try {
    const msg = await fn();
    refreshProcurement(ctx.store);
    ctx.store.notice.value = [msg];
    outcome.value = { refusal: null, busy: false };
    return true;
  } catch (err) {
    outcome.value = { refusal: ctx.shell.refusalOf(err) ?? { kind: "bad_request", message: err instanceof Error ? err.message : String(err) }, busy: false };
    return false;
  }
};
const refusal = (ctx: ScreenContext): VNode | null =>
  outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: false }; } }]) : null;
const pill = (ctx: ScreenContext, s: PoState): VNode => StatusPill({ density: ctx.density, status: PO_STATE[s].status, label: PO_STATE[s].word }) ?? html``;

// ---------------------------------------------------------------------------
// /purchasing — vendors, receiving points, orders.
// ---------------------------------------------------------------------------
export const purchasing: Screen = (ctx) => {
  const { shell, store } = ctx;
  const vendors = store.read(keyOf("vendors.list"), () => shell.gateway.listVendors());
  const points = store.read(keyOf("receivingPoints.list"), () => shell.gateway.listReceivingPoints());
  const orders = store.read(keyOf("pos.list", {}), () => shell.gateway.listPurchaseOrders({}));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());

  const newVendor = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const v = formValues(form);
    void act(ctx, async () => {
      await shell.gateway.createVendor({ legalName: v.legalName ?? "", regionId: v.regionId ?? "", paymentTermsDays: Number(v.paymentTermsDays || "30"), ...(v.contactEmail ? { contactEmail: v.contactEmail } : {}) });
      return `Vendor ${v.legalName} recorded. Add its catalogue next; a vendor sees its orders once they are issued.`;
    });
  };
  const newPoint = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, async () => {
      await shell.gateway.createReceivingPoint({ code: v.code ?? "", tier: (v.tier ?? "regional_hub") as ReceivingPointWire["tier"], regionId: v.regionId ?? "", address: { line1: v.line1 ?? "", city: v.city ?? "", state: v.state ?? "", postal: v.postal ?? "" } });
      return `Receiving point ${v.code?.toUpperCase()} recorded.`;
    });
  };
  const regionOptions = (rs: readonly RegionWire[]) => rs.filter((r) => r.active).map((r) => html`<option value=${r.id}>${r.name}</option>`);

  return html`<section class="s2-purchasing">
    <h1 class="s2-h1">Purchasing</h1>
    <h2 class="s2-h2">Purchase orders</h2>
    ${whenReady(ctx, orders.value, (o) => DataGrid({
      density: ctx.density, caption: "Every order, newest first",
      rows: o.orders, rowKey: (r: PurchaseOrderWire) => r.id, emptyText: "No purchase orders yet. Open a vendor to raise one.",
      columns: [
        { key: "number", header: "Order", cell: (r: PurchaseOrderWire) => linkTo(ctx, "purchasing.po", { poId: r.id }, r.number) },
        { key: "vendor", header: "Vendor", cell: (r: PurchaseOrderWire) => r.vendorName ?? "—" },
        { key: "to", header: "Receiving point", cell: (r: PurchaseOrderWire) => `${r.receivingPointCode ?? "—"}${r.receivingTier ? ` · ${TIER_WORD[r.receivingTier]}` : ""}` },
        { key: "total", header: "Total", align: "end", numeric: true, cell: (r: PurchaseOrderWire) => money(r.totalMinor, r.currency) },
        { key: "state", header: "State", cell: (r: PurchaseOrderWire) => pill(ctx, r.state) },
      ],
    }) ?? html``)}

    <h2 class="s2-h2">Vendors</h2>
    ${whenReady(ctx, vendors.value, (v) => DataGrid({
      density: ctx.density, caption: "Who we buy from",
      rows: v.vendors, rowKey: (r: VendorWire) => r.id, emptyText: "No vendors recorded.",
      columns: [
        { key: "legalName", header: "Vendor", cell: (r: VendorWire) => linkTo(ctx, "purchasing.vendor", { vendorId: r.id }, r.legalName) },
        { key: "terms", header: "Terms", cell: (r: VendorWire) => `${r.paymentTermsDays} days` },
        { key: "status", header: "Status", cell: (r: VendorWire) => r.status },
      ],
    }) ?? html``)}
    <form class="s2-form s2-form--inline" onSubmit=${newVendor} id="vendor-form">
      <label class="s2-field"><span>Legal name</span><input class="s2-input" name="legalName" required /></label>
      <label class="s2-field"><span>Administered from</span><select class="s2-input" name="regionId" required>${whenReady(ctx, regions.value, (r) => html`${regionOptions(r.regions)}`)}</select></label>
      <label class="s2-field"><span>Payment terms (days)</span><input class="s2-input" name="paymentTermsDays" inputmode="numeric" defaultValue="30" /></label>
      <label class="s2-field"><span>Contact email</span><input class="s2-input" name="contactEmail" type="email" /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Add vendor", "add-vendor")}</div>
    </form>

    <h2 class="s2-h2">Receiving points</h2>
    ${whenReady(ctx, points.value, (p) => DataGrid({
      density: ctx.density, caption: "Where vendors deliver — named by code, never by a customer",
      rows: p.receivingPoints, rowKey: (r: ReceivingPointWire) => r.id, emptyText: "No receiving points recorded.",
      columns: [
        { key: "code", header: "Code" },
        { key: "tier", header: "Tier", cell: (r: ReceivingPointWire) => TIER_WORD[r.tier] },
        { key: "address", header: "Address", cell: (r: ReceivingPointWire) => [r.address.line1, r.address.city, r.address.state].filter(Boolean).join(", ") },
      ],
    }) ?? html``)}
    <form class="s2-form s2-form--inline" onSubmit=${newPoint} id="point-form">
      <label class="s2-field"><span>Code</span><input class="s2-input" name="code" required placeholder="SOUTH-HUB" /></label>
      <label class="s2-field"><span>Tier</span><select class="s2-input" name="tier">${Object.entries(TIER_WORD).map(([k, w]) => html`<option value=${k}>${w}</option>`)}</select></label>
      <label class="s2-field"><span>Region</span><select class="s2-input" name="regionId" required>${whenReady(ctx, regions.value, (r) => html`${regionOptions(r.regions)}`)}</select></label>
      <label class="s2-field"><span>Street</span><input class="s2-input" name="line1" required /></label>
      <label class="s2-field"><span>City</span><input class="s2-input" name="city" required /></label>
      <label class="s2-field"><span>State</span><input class="s2-input" name="state" /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Add receiving point", "add-point")}</div>
    </form>
    ${refusal(ctx)}
  </section>`;
};

// ---------------------------------------------------------------------------
// /purchasing/vendors/:vendorId — the catalogue, price decisions, raising an order.
// ---------------------------------------------------------------------------
export const purchasingVendor: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const vendorId = params.vendorId!;
  const vendors = store.read(keyOf("vendors.list"), () => shell.gateway.listVendors());
  const catalog = store.read(keyOf("catalog.list", { vendorId }), () => shell.gateway.listCatalog({ vendorId }));
  const points = store.read(keyOf("receivingPoints.list"), () => shell.gateway.listReceivingPoints());

  const decide = (priceId: string, decision: "accepted" | "rejected") => void act(ctx, async () => {
    const out = await shell.gateway.decidePrice({ priceId, decision });
    return decision === "accepted" ? `Price accepted${out.closedId ? "; the price it replaces now ends the day before" : ""}. New orders take it from its first day.` : "Price rejected. The vendor sees the decision.";
  });
  const addItem = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, async () => {
      await shell.gateway.addCatalogItem({ vendorId, vendorSku: v.vendorSku ?? "", description: v.description ?? "", ...(v.uom ? { uom: v.uom } : {}) });
      return `${v.vendorSku} added. It has no price until the vendor proposes one and you accept it.`;
    });
  };
  const raise = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const v = formValues(form);
    const lines = Object.entries(v).filter(([k, q]) => k.startsWith("qty:") && q).map(([k, q]) => ({ itemId: k.slice(4), quantityMilli: toMilli(q) }));
    void act(ctx, async () => {
      if (lines.length === 0) throw new Error("Enter a quantity on at least one item.");
      const out = await shell.gateway.createPurchaseOrder({ vendorId, receivingPointId: v.receivingPointId ?? "", lines });
      ctx.router.navigate("purchasing.po", { poId: out.id });
      return `Draft ${out.number} raised at ${money(out.totalMinor)}. Issue it to send it to the vendor.`;
    });
  };

  return html`<section class="s2-purchasing">
    ${whenReady(ctx, vendors.value, (v) => {
      const vendor = v.vendors.find((x) => x.id === vendorId);
      return html`<header class="s2-tree__head"><h1 class="s2-h1">${vendor?.legalName ?? "Vendor"} — catalogue</h1>${linkTo(ctx, "purchasing", {}, "Back to purchasing")}</header>`;
    })}
    ${whenReady(ctx, catalog.value, (c) => html`
      ${DataGrid({
        density: ctx.density, caption: "Items, the price in effect today, and proposals waiting on you",
        rows: c.items, rowKey: (r: CatalogItemWire) => r.id, emptyText: "No items yet.",
        columns: [
          { key: "sku", header: "SKU", cell: (r: CatalogItemWire) => r.vendorSku },
          { key: "description", header: "Item", cell: (r: CatalogItemWire) => `${r.description} (${r.uom})` },
          { key: "current", header: "Price today", align: "end", numeric: true, cell: (r: CatalogItemWire) => r.current ? money(r.current.priceMinor, r.current.currency) : html`<span class="s2-muted">none accepted</span>` },
          { key: "proposals", header: "Proposed", cell: (r: CatalogItemWire) => r.proposals.length === 0 ? html`<span class="s2-muted">—</span>` : html`${r.proposals.map((p) => html`<div class="s2-row-actions">
              <span>${money(p.priceMinor, p.currency)} from ${p.effectiveFrom}</span>
              <button type="button" class="s2-link s2-link--button" onClick=${() => decide(p.id, "accepted")}>Accept</button>
              <button type="button" class="s2-link s2-link--button" onClick=${() => decide(p.id, "rejected")}>Reject</button>
            </div>`)}` },
        ],
      })}
      <h2 class="s2-h2">Raise a purchase order</h2>
      <form class="s2-form" onSubmit=${raise} id="po-form">
        <label class="s2-field"><span>Deliver to</span>
          <select class="s2-input" name="receivingPointId" required>${whenReady(ctx, points.value, (p) => html`${p.receivingPoints.filter((r) => r.active).map((r) => html`<option value=${r.id}>${r.code} · ${TIER_WORD[r.tier]}</option>`)}`)}</select>
        </label>
        ${c.items.filter((i) => i.current).map((i) => html`<label class="s2-field"><span>${i.vendorSku} — ${i.description} at ${money(i.current!.priceMinor, i.current!.currency)}</span>
          <input class="s2-input" name=${`qty:${i.id}`} inputmode="decimal" placeholder="Quantity (${i.uom})" /></label>`)}
        ${c.items.some((i) => i.current) ? null : html`<p class="s2-muted">No item has an accepted price yet, so nothing can be ordered.</p>`}
        <div class="s2-form__actions">${submitAction(ctx, "Raise draft", "raise-po")}</div>
      </form>`)}
    <h2 class="s2-h2">Add an item</h2>
    <form class="s2-form s2-form--inline" onSubmit=${addItem} id="item-form">
      <label class="s2-field"><span>Vendor SKU</span><input class="s2-input" name="vendorSku" required /></label>
      <label class="s2-field"><span>Description</span><input class="s2-input" name="description" required /></label>
      <label class="s2-field"><span>Unit</span><input class="s2-input" name="uom" placeholder="each" /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Add item", "add-item")}</div>
    </form>
    ${refusal(ctx)}
  </section>`;
};

// ---------------------------------------------------------------------------
// /purchasing/pos/:poId — one order.
// ---------------------------------------------------------------------------
export const purchasingPo: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const poId = params.poId!;
  const detail = store.read(keyOf("pos.detail", { poId }), () => shell.gateway.purchaseOrder({ poId }));

  const receive = (e: Event, lines: readonly PoLineWire[]) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    const got = lines.filter((l) => v[`rcv:${l.id}`]).map((l) => ({ poLineId: l.id, quantityMilli: toMilli(v[`rcv:${l.id}`]!) }));
    void act(ctx, async () => {
      if (got.length === 0) throw new Error("Enter what arrived on at least one line.");
      const out = await shell.gateway.recordReceipt({ poId, lines: got });
      return out.state === "received" ? "Received in full. The order is closed for receiving." : "Receipt recorded. The rest is still to come.";
    });
  };
  const requestReturn = (e: Event) => {
    e.preventDefault();
    const v = formValues(e.currentTarget as HTMLFormElement);
    void act(ctx, async () => {
      await shell.gateway.requestReturn({ poId, poLineId: v.poLineId ?? "", quantityMilli: toMilli(v.quantity ?? ""), reason: v.reason ?? "" });
      return "Return requested. The vendor answers with an RMA number or a reason.";
    });
  };

  return html`<section class="s2-purchasing">
    ${whenReady(ctx, detail.value, (d) => {
      const o = d.order;
      const open = d.lines.filter((l) => BigInt(l.receivedMilli) < BigInt(l.quantityMilli));
      return html`
        <header class="s2-tree__head"><h1 class="s2-h1">${o.number} ${pill(ctx, o.state)}</h1>${linkTo(ctx, "purchasing", {}, "Back to purchasing")}</header>
        <p class="s2-muted">${o.vendorName} → ${d.receivingPoint ? `${d.receivingPoint.code} (${TIER_WORD[d.receivingPoint.tier]}), ${d.receivingPoint.address.line1}, ${d.receivingPoint.address.city}` : "—"}
          · ${money(o.totalMinor, o.currency)}${o.promisedShipOn ? ` · ships by ${o.promisedShipOn}` : ""}</p>
        <div class="s2-form__actions">
          ${o.state === "draft" ? html`<button type="button" class="ac-action" data-kind="primary" data-density=${ctx.density} id="issue-po" onClick=${() => void act(ctx, async () => { await shell.gateway.issuePurchaseOrder({ poId }); return `${o.number} issued. The vendor can see it now.`; })}>Issue to vendor</button>` : null}
          ${["draft", "issued", "acknowledged"].includes(o.state) && d.shipments.length === 0 ? html`<button type="button" class="ac-action" data-kind="quiet" data-density=${ctx.density} onClick=${() => void act(ctx, async () => { await shell.gateway.cancelPurchaseOrder({ poId }); return `${o.number} cancelled.`; })}>Cancel order</button>` : null}
        </div>
        ${DataGrid({
          density: ctx.density, caption: "Lines", rows: d.lines, rowKey: (l: PoLineWire) => l.id,
          columns: [
            { key: "no", header: "#", cell: (l: PoLineWire) => String(l.lineNo) },
            { key: "item", header: "Item", cell: (l: PoLineWire) => `${l.vendorSku} — ${l.description}` },
            { key: "price", header: "Price", align: "end", numeric: true, cell: (l: PoLineWire) => money(l.unitPriceMinor, o.currency) },
            { key: "ordered", header: "Ordered", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.quantityMilli) },
            { key: "shipped", header: "Shipped", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.shippedMilli) },
            { key: "received", header: "Received", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.receivedMilli) },
            { key: "invoiced", header: "Invoiced", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.invoicedMilli) },
            { key: "returned", header: "Returned", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.returnedMilli) },
          ],
        })}
        ${o.state === "acknowledged" && open.length ? html`<h2 class="s2-h2">Receive goods</h2>
          <form class="s2-form s2-form--inline" onSubmit=${(e: Event) => receive(e, open)} id="receive-form">
            ${open.map((l) => html`<label class="s2-field"><span>Line ${l.lineNo}: ${qty((BigInt(l.quantityMilli) - BigInt(l.receivedMilli)).toString())} outstanding</span><input class="s2-input" name=${`rcv:${l.id}`} inputmode="decimal" /></label>`)}
            <div class="s2-form__actions">${submitAction(ctx, "Record receipt", "record-receipt")}</div>
          </form>` : null}
        ${d.shipments.length ? html`<h2 class="s2-h2">Shipments</h2><ul class="s2-list">${d.shipments.map((s) => html`<li>${s.shippedOn} · ${s.carrier}${s.tracking ? ` ${s.tracking}` : ""} · ${s.lines.map((l) => `line ${d.lines.find((x) => x.id === l.poLineId)?.lineNo}: ${qty(l.quantityMilli)}`).join(", ")}</li>`)}</ul>` : null}
        <h2 class="s2-h2">Vendor invoices</h2>
        ${DataGrid({
          density: ctx.density, caption: "Matched against the order and the receipt", rows: d.invoices, rowKey: (i: VendorInvoiceWire) => i.id, emptyText: "No invoices submitted.",
          columns: [
            { key: "number", header: "Invoice", cell: (i: VendorInvoiceWire) => `${i.invoiceNumber} · ${i.invoiceDate}` },
            { key: "total", header: "Total", align: "end", numeric: true, cell: (i: VendorInvoiceWire) => money(i.totalMinor, i.currency) },
            { key: "match", header: "Match", cell: (i: VendorInvoiceWire) => html`${StatusPill({ density: ctx.density, status: i.matchState === "matched" ? "ok" : "at_risk", label: i.matchState === "matched" ? "Matched" : "Held" })}${i.matchNotes.map((n) => html`<div class="s2-muted">${n.message}</div>`)}` },
          ],
        })}
        <h2 class="s2-h2">Returns</h2>
        ${DataGrid({
          density: ctx.density, caption: "Asked of the vendor", rows: d.returns, rowKey: (r: RmaWire) => r.id, emptyText: "No returns.",
          columns: [
            { key: "line", header: "Line", cell: (r: RmaWire) => String(d.lines.find((l) => l.id === r.poLineId)?.lineNo ?? "—") },
            { key: "qty", header: "Quantity", align: "end", numeric: true, cell: (r: RmaWire) => qty(r.quantityMilli) },
            { key: "reason", header: "Reason" },
            { key: "state", header: "Vendor's answer", cell: (r: RmaWire) => r.state === "authorized" ? `Authorized · ${r.rmaNumber}` : r.state === "rejected" ? `Rejected · ${r.vendorNote ?? ""}` : "Waiting" },
          ],
        })}
        ${d.lines.some((l) => BigInt(l.receivedMilli) > BigInt(l.returnedMilli)) ? html`<form class="s2-form s2-form--inline" onSubmit=${requestReturn} id="return-form">
          <label class="s2-field"><span>Line</span><select class="s2-input" name="poLineId">${d.lines.filter((l) => BigInt(l.receivedMilli) > BigInt(l.returnedMilli)).map((l) => html`<option value=${l.id}>${l.lineNo} — ${l.vendorSku}</option>`)}</select></label>
          <label class="s2-field"><span>Quantity</span><input class="s2-input" name="quantity" inputmode="decimal" required /></label>
          <label class="s2-field"><span>Reason</span><input class="s2-input" name="reason" required /></label>
          <div class="s2-form__actions">${submitAction(ctx, "Request return", "request-return")}</div>
        </form>` : null}`;
    })}
    ${refusal(ctx)}
  </section>`;
};
