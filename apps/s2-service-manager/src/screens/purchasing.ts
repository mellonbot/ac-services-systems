import { html, pageHead, panel, signal, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type {
  Refusal, VendorWire, ReceivingPointWire, CatalogItemWire, PurchaseOrderWire, PoLineWire, PoState, VendorInvoiceWire, RmaWire, RegionWire,
} from "../../../../packages/contracts/src/index.ts";
import type { Store } from "../state.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, noChoice, noActiveRegion, formValues, linkTo, confirmPanel, type Screen, type ScreenContext } from "./common.ts";
import {
  formatQuantity as qty,
  parseQuantity as toMilli,
  formatMoney as money,
  parseMoney,
} from "../../../../packages/ui/src/fixed-units.ts";
export { qty, toMilli, money };

/**
 * ITEM 11 — PURCHASING, the office's side of procurement. Three screens over
 * the same records S7 shows a vendor: vendors and receiving points; one
 * vendor's catalogue (deciding its proposed prices, raising an order at the
 * accepted ones); one purchase order (issue, cancel, receive, return, and the
 * invoices the vendor submitted, matched or held with the reasons).
 * Nothing here computes a price or a match: the gateway does, and the screen
 * shows what came back.
 */
type PendingConfirmation =
  | { readonly kind: "price"; readonly owner: string; readonly priceId: string; readonly sku: string; readonly amount: string; readonly currency: string; readonly effectiveFrom: string; readonly decision: "accepted" | "rejected"; readonly replacesCurrent: boolean }
  | { readonly kind: "order"; readonly owner: string; readonly action: "issue" | "cancel"; readonly number: string }
  | { readonly kind: "return"; readonly owner: string; readonly lineId: string; readonly lineNo: number; readonly sku: string; readonly quantity: string; readonly quantityMilli: string; readonly reason: string };

const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean; readonly pending: PendingConfirmation | null }>({ refusal: null, busy: false, pending: null });

export const refreshProcurement = (store: Store): void => {
  for (const k of ["vendors.list", "receivingPoints.list", "catalog.list", "pos.", "vendorInvoices.list", "rmas.list"]) store.invalidate(k);
};

/** "42.50" → "4250". Two decimals at most; money is never a float. */
export const toMinor = (typed: string): string => parseMoney(typed);

/** An order's place in its lifecycle is FILING state, drawn in the filing marks (styles.ts), never the status ramp — "received" is not health. */
export const PO_STATE: Readonly<Record<PoState, { tone: "pending" | "held" | "live" | "ended"; word: string }>> = {
  draft: { tone: "pending", word: "Draft" },
  issued: { tone: "held", word: "Waiting on vendor" },
  acknowledged: { tone: "live", word: "Acknowledged" },
  received: { tone: "live", word: "Received" },
  cancelled: { tone: "ended", word: "Cancelled" },
};
const TIER_WORD = { location_stock: "Location stock", regional_hub: "Regional hub", national: "National" } as const;

const act = async (ctx: ScreenContext, fn: () => Promise<string>): Promise<boolean> => {
  if (ctx.degraded || outcome.value.busy) return false;
  outcome.value = { ...outcome.value, refusal: null, busy: true };
  try {
    const msg = await fn();
    refreshProcurement(ctx.store);
    ctx.store.notice.value = [msg];
    outcome.value = { refusal: null, busy: false, pending: null };
    return true;
  } catch (err) {
    outcome.value = { refusal: ctx.shell.refusalOf(err) ?? { kind: "bad_request", message: err instanceof Error ? err.message : String(err) }, busy: false, pending: null };
    return false;
  }
};
const refusal = (ctx: ScreenContext): VNode | null =>
  outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: false, pending: null }; } }]) : null;
const pill = (_ctx: ScreenContext, s: PoState): VNode => html`<span class="s2-state" data-tone=${PO_STATE[s].tone}>${PO_STATE[s].word}</span>`;

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
    ${pageHead("Purchasing", "Orders to vendors, the vendors themselves, and where they deliver. A vendor sees an order once it is issued.")}
    ${panel(whenReady(ctx, orders.value, (o) => DataGrid({
      density: ctx.density,
      stack: true, caption: "Every order, newest first",
      rows: o.orders, rowKey: (r: PurchaseOrderWire) => r.id, emptyText: "No purchase orders yet. Open a vendor to raise one.",
      columns: [
        { key: "number", header: "Order", cell: (r: PurchaseOrderWire) => linkTo(ctx, "purchasing.po", { poId: r.id }, r.number) },
        { key: "vendor", header: "Vendor", cell: (r: PurchaseOrderWire) => r.vendorName ?? "—" },
        { key: "to", header: "Receiving point", cell: (r: PurchaseOrderWire) => `${r.receivingPointCode ?? "—"}${r.receivingTier ? ` · ${TIER_WORD[r.receivingTier]}` : ""}` },
        { key: "total", header: "Total", align: "end", numeric: true, cell: (r: PurchaseOrderWire) => money(r.totalMinor, r.currency) },
        { key: "state", header: "State", cell: (r: PurchaseOrderWire) => pill(ctx, r.state) },
      ],
    }) ?? html``), "Purchase orders")}

    ${panel(html`${whenReady(ctx, vendors.value, (v) => DataGrid({
      density: ctx.density,
      stack: true, caption: "Who we buy from",
      rows: v.vendors, rowKey: (r: VendorWire) => r.id, emptyText: "No vendors recorded.",
      columns: [
        { key: "legalName", header: "Vendor", cell: (r: VendorWire) => linkTo(ctx, "purchasing.vendor", { vendorId: r.id }, r.legalName) },
        { key: "terms", header: "Terms", cell: (r: VendorWire) => `${r.paymentTermsDays} days` },
        { key: "status", header: "Status", cell: (r: VendorWire) => r.status },
      ],
    }) ?? html``)}
    <form class="ac-form ac-form--inline" onSubmit=${newVendor} id="vendor-form">
      <label class="ac-field"><span>Legal name</span><input class="ac-input" name="legalName" required /></label>
      ${whenReady(ctx, regions.value, (r) => !r.regions.some((x) => x.active) ? noChoice("Administered from", "No region of ours is active.") : html`<label class="ac-field"><span>Administered from</span><select class="ac-input" name="regionId" required>${regionOptions(r.regions)}</select></label>`, () => store.invalidate("regions.list"))}
      <label class="ac-field"><span>Payment terms (days)</span><input class="ac-input" name="paymentTermsDays" inputmode="numeric" defaultValue="30" /></label>
      <label class="ac-field"><span>Contact email</span><input class="ac-input" name="contactEmail" type="email" /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Add vendor", "add-vendor", noActiveRegion(regions.value))}</div>
    </form>`, "Vendors")}

    ${panel(html`${whenReady(ctx, points.value, (p) => DataGrid({
      density: ctx.density,
      stack: true, caption: "Where vendors deliver — named by code, never by a customer",
      rows: p.receivingPoints, rowKey: (r: ReceivingPointWire) => r.id, emptyText: "No receiving points recorded.",
      columns: [
        { key: "code", header: "Code" },
        { key: "tier", header: "Tier", cell: (r: ReceivingPointWire) => TIER_WORD[r.tier] },
        { key: "address", header: "Address", cell: (r: ReceivingPointWire) => [r.address.line1, r.address.city, r.address.state].filter(Boolean).join(", ") },
      ],
    }) ?? html``)}
    <form class="ac-form ac-form--inline" onSubmit=${newPoint} id="point-form">
      <label class="ac-field"><span>Code</span><input class="ac-input" name="code" required placeholder="SOUTH-HUB" /></label>
      <label class="ac-field"><span>Tier</span><select class="ac-input" name="tier">${Object.entries(TIER_WORD).map(([k, w]) => html`<option value=${k}>${w}</option>`)}</select></label>
      ${whenReady(ctx, regions.value, (r) => !r.regions.some((x) => x.active) ? noChoice("Region", "No region of ours is active.") : html`<label class="ac-field"><span>Region</span><select class="ac-input" name="regionId" required>${regionOptions(r.regions)}</select></label>`, () => store.invalidate("regions.list"))}
      <label class="ac-field"><span>Street</span><input class="ac-input" name="line1" required /></label>
      <label class="ac-field"><span>City</span><input class="ac-input" name="city" required /></label>
      <label class="ac-field"><span>State</span><input class="ac-input" name="state" /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Add receiving point", "add-point", noActiveRegion(regions.value))}</div>
    </form>`, "Receiving points")}
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
    void act(ctx, async () => {
      // Parsed inside act, so "2 boxes" is a refusal on screen rather than an uncaught throw.
      const lines = Object.entries(v).filter(([k, q]) => k.startsWith("qty:") && q).map(([k, q]) => ({ itemId: k.slice(4), quantityMilli: toMilli(q) }));
      if (lines.length === 0) throw new Error("Enter a quantity on at least one item.");
      const out = await shell.gateway.createPurchaseOrder({ vendorId, receivingPointId: v.receivingPointId ?? "", lines });
      ctx.router.navigate("purchasing.po", { poId: out.id });
      return `Draft ${out.number} raised at ${money(out.totalMinor)}. Issue it to send it to the vendor.`;
    });
  };

  return html`<section class="s2-purchasing">
    ${whenReady(ctx, vendors.value, (v) => {
      const vendor = v.vendors.find((x) => x.id === vendorId);
      return pageHead(`${vendor?.legalName ?? "Vendor"} — catalogue`, "This vendor's catalogue: decide the prices it proposes, and raise an order at the accepted ones.", linkTo(ctx, "purchasing", {}, "Back to purchasing"));
    })}
    ${whenReady(ctx, catalog.value, (c) => html`
      ${panel(DataGrid({
        density: ctx.density,
        stack: true, caption: "Items, the price in effect today, and proposals waiting on you",
        rows: c.items, rowKey: (r: CatalogItemWire) => r.id, emptyText: "No items yet.",
        columns: [
          { key: "sku", header: "SKU", cell: (r: CatalogItemWire) => r.vendorSku },
          { key: "description", header: "Item", cell: (r: CatalogItemWire) => `${r.description} (${r.uom})` },
          { key: "current", header: "Price today", align: "end", numeric: true, cell: (r: CatalogItemWire) => r.current ? money(r.current.priceMinor, r.current.currency) : html`<span class="s2-muted">none accepted</span>` },
          { key: "proposals", header: "Proposed", cell: (r: CatalogItemWire) => r.proposals.length === 0 ? html`<span class="s2-muted">—</span>` : html`${r.proposals.map((p) => {
            const pending = outcome.value.pending;
            const isPending = pending?.kind === "price" && pending.owner === vendorId && pending.priceId === p.id;
            const choose = (decision: "accepted" | "rejected") => {
              outcome.value = { ...outcome.value, pending: { kind: "price", owner: vendorId, priceId: p.id, sku: r.vendorSku, amount: p.priceMinor, currency: p.currency, effectiveFrom: p.effectiveFrom, decision, replacesCurrent: r.current !== null } };
            };
            return html`<div class="s2-proposal">
              <div class="s2-row-actions">
                <span>${money(p.priceMinor, p.currency)} from ${p.effectiveFrom}</span>
                <button type="button" class="s2-mutation" aria-label=${`Accept ${money(p.priceMinor, p.currency)} for ${r.vendorSku}`} aria-expanded=${isPending && pending.decision === "accepted"} aria-controls=${isPending ? `confirm-price-${p.id}` : undefined} disabled=${ctx.degraded || outcome.value.busy || Boolean(pending && pending.owner === vendorId)} onClick=${() => choose("accepted")}>Accept</button>
                <button type="button" class="s2-mutation s2-mutation--danger" aria-label=${`Reject ${money(p.priceMinor, p.currency)} for ${r.vendorSku}`} aria-expanded=${isPending && pending.decision === "rejected"} aria-controls=${isPending ? `confirm-price-${p.id}` : undefined} disabled=${ctx.degraded || outcome.value.busy || Boolean(pending && pending.owner === vendorId)} onClick=${() => choose("rejected")}>Reject</button>
              </div>
              ${isPending ? confirmPanel({
                id: `confirm-price-${p.id}`,
                title: pending.decision === "accepted" ? `Accept the proposed price for ${pending.sku}?` : `Reject the proposed price for ${pending.sku}?`,
                detail: pending.decision === "accepted"
                  ? `${money(pending.amount, pending.currency)} from ${pending.effectiveFrom}. ${pending.replacesCurrent ? "The current accepted price will end the day before; new orders use this price from its first day." : "New orders use this price from its first day."}`
                  : `${money(pending.amount, pending.currency)} from ${pending.effectiveFrom}. The vendor will see the rejection.`,
                confirmLabel: pending.decision === "accepted" ? "Accept proposed price" : "Reject proposed price",
                danger: pending.decision === "rejected",
                busy: outcome.value.busy,
                disabled: ctx.degraded,
                onConfirm: () => { void decide(p.id, pending.decision); },
                onCancel: () => { outcome.value = { ...outcome.value, pending: null }; },
              }) : null}
            </div>`;
          })}` },
        ],
      }))}
      ${panel(html`<form class="ac-form" onSubmit=${raise} id="po-form">
        ${whenReady(ctx, points.value, (p) => !p.receivingPoints.some((r) => r.active) ? noChoice("Deliver to", "No receiving point is active to deliver to.", linkTo(ctx, "purchasing", {}, "Add one on Purchasing")) : html`<label class="ac-field"><span>Deliver to</span>
          <select class="ac-input" name="receivingPointId" required>${p.receivingPoints.filter((r) => r.active).map((r) => html`<option value=${r.id}>${r.code} · ${TIER_WORD[r.tier]}</option>`)}</select>
        </label>`, () => store.invalidate("receivingPoints.list"))}
        ${c.items.filter((i) => i.current).map((i) => html`<label class="ac-field"><span>${i.vendorSku} — ${i.description} at ${money(i.current!.priceMinor, i.current!.currency)}</span>
          <input class="ac-input" name=${`qty:${i.id}`} inputmode="decimal" placeholder="Quantity (${i.uom})" /></label>`)}
        ${c.items.some((i) => i.current) ? null : html`<p class="s2-muted">No item has an accepted price yet, so nothing can be ordered.</p>`}
        <div class="s2-form__actions">${submitAction(ctx, "Raise draft", "raise-po", points.value.state === "ready" && !points.value.value.receivingPoints.some((r) => r.active) ? "No receiving point is active to deliver to." : null)}</div>
      </form>`, "Raise a purchase order")}`)}
    ${panel(html`<form class="ac-form ac-form--inline" onSubmit=${addItem} id="item-form">
      <label class="ac-field"><span>Vendor SKU</span><input class="ac-input" name="vendorSku" required /></label>
      <label class="ac-field"><span>Description</span><input class="ac-input" name="description" required /></label>
      <label class="ac-field"><span>Unit</span><input class="ac-input" name="uom" placeholder="each" /></label>
      <div class="s2-form__actions">${submitAction(ctx, "Add item", "add-item")}</div>
    </form>`, "Add an item")}
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
    void act(ctx, async () => {
      const got = lines.filter((l) => v[`rcv:${l.id}`]).map((l) => ({ poLineId: l.id, quantityMilli: toMilli(v[`rcv:${l.id}`]!) }));
      if (got.length === 0) throw new Error("Enter what arrived on at least one line.");
      const out = await shell.gateway.recordReceipt({ poId, lines: got });
      return out.state === "received" ? "Received in full. The order is closed for receiving." : "Receipt recorded. The rest is still to come.";
    });
  };
  const requestReturn = (e: Event, lines: readonly PoLineWire[]) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy || outcome.value.pending) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const line = lines.find((item) => item.id === v.poLineId);
    if (!line) return;
    try {
      const quantityMilli = toMilli(v.quantity ?? "");
      outcome.value = { ...outcome.value, pending: { kind: "return", owner: poId, lineId: line.id, lineNo: line.lineNo, sku: line.vendorSku, quantity: qty(quantityMilli), quantityMilli, reason: v.reason ?? "" } };
    } catch (err) {
      outcome.value = { refusal: { kind: "bad_request", message: err instanceof Error ? err.message : String(err) }, busy: false, pending: null };
    }
  };

  return html`<section class="s2-purchasing">
    ${whenReady(ctx, detail.value, (d) => {
      const o = d.order;
      const open = d.lines.filter((l) => BigInt(l.receivedMilli) < BigInt(l.quantityMilli));
      return html`
        ${pageHead(html`${o.number} ${pill(ctx, o.state)}`, "One purchase order: issue or cancel it, receive the goods, ask for returns, and see the invoices the vendor submitted.", linkTo(ctx, "purchasing", {}, "Back to purchasing"))}
        ${panel(html`<p class="s2-muted">${o.vendorName} → ${d.receivingPoint ? `${d.receivingPoint.code} (${TIER_WORD[d.receivingPoint.tier]}), ${d.receivingPoint.address.line1}, ${d.receivingPoint.address.city}` : "—"}
          · ${money(o.totalMinor, o.currency)}${o.promisedShipOn ? ` · ships by ${o.promisedShipOn}` : ""}</p>
        <div class="s2-form__actions">
          ${o.state === "draft" ? html`<button type="button" class="ac-action" data-kind="primary" data-density=${ctx.density} id="issue-po" aria-expanded=${outcome.value.pending?.kind === "order" && outcome.value.pending.owner === poId && outcome.value.pending.action === "issue"} aria-controls=${outcome.value.pending?.kind === "order" && outcome.value.pending.owner === poId ? `confirm-order-${poId}` : undefined} disabled=${ctx.degraded || outcome.value.busy || outcome.value.pending !== null} onClick=${() => { outcome.value = { ...outcome.value, pending: { kind: "order", owner: poId, action: "issue", number: o.number } }; }}>Issue to vendor</button>` : null}
          ${["draft", "issued", "acknowledged"].includes(o.state) && d.shipments.length === 0 ? html`<button type="button" class="s2-mutation s2-mutation--danger" aria-expanded=${outcome.value.pending?.kind === "order" && outcome.value.pending.owner === poId && outcome.value.pending.action === "cancel"} aria-controls=${outcome.value.pending?.kind === "order" && outcome.value.pending.owner === poId ? `confirm-order-${poId}` : undefined} disabled=${ctx.degraded || outcome.value.busy || outcome.value.pending !== null} onClick=${() => { outcome.value = { ...outcome.value, pending: { kind: "order", owner: poId, action: "cancel", number: o.number } }; }}>Cancel order</button>` : null}
          ${outcome.value.pending?.kind === "order" && outcome.value.pending.owner === poId ? confirmPanel({
            id: `confirm-order-${poId}`,
            title: outcome.value.pending.action === "issue" ? `Issue ${o.number} to the vendor?` : `Cancel ${o.number}?`,
            detail: outcome.value.pending.action === "issue"
              ? "The vendor will be able to see this order."
              : `Current state: ${o.state}. Confirm that this order should no longer proceed.`,
            confirmLabel: outcome.value.pending.action === "issue" ? "Issue order" : "Cancel order",
            danger: outcome.value.pending.action === "cancel",
            busy: outcome.value.busy,
            disabled: ctx.degraded,
            onConfirm: () => {
              const action = outcome.value.pending;
              if (action?.kind !== "order" || action.owner !== poId) return;
              void act(ctx, async () => {
                if (action.action === "issue") {
                  await shell.gateway.issuePurchaseOrder({ poId });
                  return `${o.number} issued. The vendor can see it now.`;
                }
                await shell.gateway.cancelPurchaseOrder({ poId });
                return `${o.number} cancelled.`;
              });
            },
            onCancel: () => { outcome.value = { ...outcome.value, pending: null }; },
          }) : null}
        </div>
        ${DataGrid({
          density: ctx.density,
          stack: true, caption: "Lines", rows: d.lines, rowKey: (l: PoLineWire) => l.id,
          columns: [
            { key: "no", header: "#", numeric: true, cell: (l: PoLineWire) => String(l.lineNo) },
            { key: "item", header: "Item", cell: (l: PoLineWire) => `${l.vendorSku} — ${l.description}` },
            { key: "price", header: "Price", align: "end", numeric: true, cell: (l: PoLineWire) => money(l.unitPriceMinor, o.currency) },
            { key: "ordered", header: "Ordered", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.quantityMilli) },
            { key: "shipped", header: "Shipped", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.shippedMilli) },
            { key: "received", header: "Received", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.receivedMilli) },
            { key: "invoiced", header: "Invoiced", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.invoicedMilli) },
            { key: "returned", header: "Returned", align: "end", numeric: true, cell: (l: PoLineWire) => qty(l.returnedMilli) },
          ],
        })}`)}
        ${o.state === "acknowledged" && open.length ? panel(html`<form class="ac-form ac-form--inline" onSubmit=${(e: Event) => receive(e, open)} id="receive-form">
            ${open.map((l) => html`<label class="ac-field"><span>Line ${l.lineNo}: ${qty((BigInt(l.quantityMilli) - BigInt(l.receivedMilli)).toString())} outstanding</span><input class="ac-input" name=${`rcv:${l.id}`} inputmode="decimal" /></label>`)}
            <div class="s2-form__actions">${submitAction(ctx, "Record receipt", "record-receipt")}</div>
          </form>`, "Receive goods") : null}
        ${d.shipments.length ? panel(html`<ul class="s2-list">${d.shipments.map((s) => html`<li>${s.shippedOn} · ${s.carrier}${s.tracking ? ` ${s.tracking}` : ""} · ${s.lines.map((l) => `line ${d.lines.find((x) => x.id === l.poLineId)?.lineNo}: ${qty(l.quantityMilli)}`).join(", ")}</li>`)}</ul>`, "Shipments") : null}
        ${panel(DataGrid({
          density: ctx.density,
          stack: true, caption: "Matched against the order and the receipt", rows: d.invoices, rowKey: (i: VendorInvoiceWire) => i.id, emptyText: "No invoices submitted.",
          columns: [
            { key: "number", header: "Invoice", cell: (i: VendorInvoiceWire) => `${i.invoiceNumber} · ${i.invoiceDate}` },
            { key: "total", header: "Total", align: "end", numeric: true, cell: (i: VendorInvoiceWire) => money(i.totalMinor, i.currency) },
            { key: "match", header: "Match", cell: (i: VendorInvoiceWire) => html`${StatusPill({ density: ctx.density, status: i.matchState === "matched" ? "ok" : "at_risk", label: i.matchState === "matched" ? "Matched" : "Held" })}${i.matchNotes.map((n) => html`<div class="s2-muted">${n.message}</div>`)}` },
          ],
        }), "Vendor invoices")}
        ${panel(html`${DataGrid({
          density: ctx.density,
          stack: true, caption: "Asked of the vendor", rows: d.returns, rowKey: (r: RmaWire) => r.id, emptyText: "No returns.",
          columns: [
            { key: "line", header: "Line", cell: (r: RmaWire) => String(d.lines.find((l) => l.id === r.poLineId)?.lineNo ?? "—") },
            { key: "qty", header: "Quantity", align: "end", numeric: true, cell: (r: RmaWire) => qty(r.quantityMilli) },
            { key: "reason", header: "Reason" },
            { key: "state", header: "Vendor's answer", cell: (r: RmaWire) => r.state === "authorized" ? `Authorized · ${r.rmaNumber}` : r.state === "rejected" ? `Rejected · ${r.vendorNote ?? ""}` : "Waiting" },
          ],
        })}
        ${d.lines.some((l) => BigInt(l.receivedMilli) > BigInt(l.returnedMilli)) ? html`<form class="ac-form ac-form--inline" onSubmit=${(e: Event) => requestReturn(e, d.lines)} id="return-form">
          <label class="ac-field"><span>Line</span><select class="ac-input" name="poLineId">${d.lines.filter((l) => BigInt(l.receivedMilli) > BigInt(l.returnedMilli)).map((l) => html`<option value=${l.id}>${l.lineNo} — ${l.vendorSku}</option>`)}</select></label>
          <label class="ac-field"><span>Quantity</span><input class="ac-input" name="quantity" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,3})?" required /></label>
          <label class="ac-field"><span>Reason</span><input class="ac-input" name="reason" required /></label>
          <div class="s2-form__actions">${submitAction(ctx, "Request return", "request-return")}</div>
        </form>` : null}
        ${outcome.value.pending?.kind === "return" && outcome.value.pending.owner === poId ? confirmPanel({
          id: `confirm-return-${poId}`,
          title: `Request a return for line ${outcome.value.pending.lineNo}?`,
          detail: `${outcome.value.pending.quantity} ${outcome.value.pending.sku} · ${outcome.value.pending.reason}. The vendor will review this request and respond with an RMA number or a reason.`,
          confirmLabel: "Send return request",
          busy: outcome.value.busy,
          disabled: ctx.degraded,
          onConfirm: () => {
            const request = outcome.value.pending;
            if (request?.kind !== "return" || request.owner !== poId) return;
            void act(ctx, async () => {
              await shell.gateway.requestReturn({ poId, poLineId: request.lineId, quantityMilli: request.quantityMilli, reason: request.reason });
              return "Return requested. The vendor answers with an RMA number or a reason.";
            });
          },
          onCancel: () => { outcome.value = { ...outcome.value, pending: null }; },
        }) : null}`, "Returns")}`;
    })}
    ${refusal(ctx)}
  </section>`;
};
