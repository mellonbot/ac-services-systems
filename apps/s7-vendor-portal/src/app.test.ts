import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createRouter } from "../../../packages/ui/src/index.ts";
import { SCREEN_VIEWS, createApp } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { createStore } from "./state.ts";
import { toMilli, toMinor, money, plain } from "./screens/common.ts";
import type { ScreenContext } from "./screens/common.ts";
import { OPERATIONS, SURFACES, type PurchaseOrderDetailOutput, type CatalogItemWire, type VendorInvoiceWire } from "../../../packages/contracts/src/index.ts";

/**
 * S7's screens against a scripted gateway. S7 is Phase 4 and disabled, so the
 * real shell refuses to boot it — asserted first, because that IS the gate —
 * and the screens are rendered here with the store, the router and a gateway
 * double, which is all a screen reads. What this holds: a vendor sees its
 * orders by receiving point code, never a customer; each form appears only in
 * the state that allows it (acknowledge when issued, ship when acknowledged,
 * invoice once something is received); a held invoice shows its reasons;
 * every call a screen makes is one of S7's operations.
 */
const U = (n: number) => `e7110000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const PO = U(1), LINE = U(2), HUB = U(3), ITEM = U(4);
const base: PurchaseOrderDetailOutput = {
  order: { id: PO, number: "PO-20260927-ABC123", vendorId: U(9), vendorName: "Coolair Supply", receivingPointId: HUB, receivingPointCode: "SOUTH-HUB", receivingTier: "regional_hub", regionId: U(8), state: "issued", currency: "USD", totalMinor: "42500", issuedAt: "2026-09-27T10:00:00.000Z", acknowledgedAt: null, promisedShipOn: null, createdAt: "2026-09-27T09:00:00.000Z" },
  receivingPoint: { id: HUB, code: "SOUTH-HUB", tier: "regional_hub", regionId: U(8), address: { line1: "100 Dock Rd", city: "Austin", state: "TX" }, active: true },
  lines: [{ id: LINE, lineNo: 1, itemId: ITEM, vendorSku: "CAP-45-5", description: "Run capacitor 45/5", uom: "each", quantityMilli: "10000", shippedMilli: "0", receivedMilli: "0", invoicedMilli: "0", returnedMilli: "0", unitPriceMinor: "4250", amountMinor: "42500" }],
  shipments: [], receipts: [], invoices: [], returns: [],
};
const held: VendorInvoiceWire = { id: U(5), poId: PO, poNumber: "PO-20260927-ABC123", vendorId: U(9), invoiceNumber: "INV-9", invoiceDate: "2026-09-29", totalMinor: "12900", currency: "USD", matchState: "held", matchNotes: [{ poLineId: LINE, code: "over_received", message: "line 1: 7 billed in all, 6 received" }], createdAt: "2026-09-29T16:00:00.000Z", lines: [] };
const items: CatalogItemWire[] = [{ id: ITEM, vendorId: U(9), vendorSku: "CAP-45-5", description: "Run capacitor 45/5", uom: "each", active: true, current: null, proposals: [{ id: U(6), itemId: ITEM, vendorId: U(9), priceMinor: "4600", currency: "USD", effectiveFrom: "2026-10-01", effectiveTo: null, state: "proposed", proposedAt: "2026-09-27T00:00:00.000Z", decidedAt: null, decisionNote: null }] }];

const ctxWith = (detail: PurchaseOrderDetailOutput) => {
  const called: string[] = [];
  const answer = <T>(op: string, v: T) => async () => { called.push(op); return v; };
  const gateway = {
    listPurchaseOrders: answer("pos.list", { orders: [detail.order] }),
    purchaseOrder: answer("pos.detail", detail),
    listCatalog: answer("catalog.list", { items }),
    listVendorInvoices: answer("vendorInvoices.list", { invoices: [held] }),
    listReturns: answer("rmas.list", { returns: [] }),
  };
  const shell = { gateway, refusalOf: () => null, degradedMode: SURFACES.S7.degraded } as unknown as ScreenContext["shell"];
  const router = createRouter(SCREENS, { path: () => "/", push: () => {}, onPop: () => () => {} });
  const ctx: ScreenContext = { shell, store: createStore(shell, () => 0), router, density: "comfort", degraded: false };
  return { ctx, called };
};
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
const draw = async (screen: keyof typeof SCREEN_VIEWS, detail = base, params: Record<string, string> = { poId: PO }) => {
  const { ctx, called } = ctxWith(detail);
  render(SCREEN_VIEWS[screen](ctx, params)); await settle();
  return { out: render(SCREEN_VIEWS[screen](ctx, params)), called };
};

test("the phase gate holds: S7 is disabled and its shell will not boot", async () => {
  assert.equal(SURFACES.S7.enabled, false);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: async () => ({ status: 200, ok: true, json: async () => ({}), text: async () => "", body: null }) });
  await app.login("v@vendor.test", "pw");
  assert.equal(app.phase.value.kind, "login", "no ready phase for a disabled surface");
});

test("SCREENS and SCREEN_VIEWS agree, and every screen names only operations the catalogue serves S7", () => {
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), Object.keys(SCREENS).filter((k) => k !== "login").sort());
  for (const [id, s] of Object.entries(SCREENS)) for (const op of s.uses) assert.ok((OPERATIONS[op].surfaces as readonly string[]).includes("S7"), `${id} uses ${op}`);
});

test("ORDERS: the order by number and receiving point code, the state in the vendor's words, no customer anywhere", async () => {
  const { out } = await draw("orders");
  assert.match(out, /PO-20260927-ABC123/);
  assert.match(out, /SOUTH-HUB · Regional hub/);
  assert.match(out, /Needs your acknowledgement/);
  assert.match(out, /425\.00 USD/);
});

test("ORDER, issued: the acknowledge form and nothing else to do", async () => {
  const { out } = await draw("order");
  assert.match(out, /id="ack-form"/);
  assert.match(out, /100 Dock Rd, Austin, TX/);
  assert.doesNotMatch(out, /id="ship-form"/);
  assert.doesNotMatch(out, /id="invoice-form"/);
});

test("ORDER, acknowledged and part received: ship what is left, invoice what arrived at the order's price", async () => {
  const d: PurchaseOrderDetailOutput = { ...base, order: { ...base.order, state: "acknowledged", promisedShipOn: "2026-09-29" }, lines: [{ ...base.lines[0]!, shippedMilli: "6000", receivedMilli: "6000" }], invoices: [held] };
  const { out } = await draw("order", d);
  assert.doesNotMatch(out, /id="ack-form"/);
  assert.match(out, /id="ship-form"/);
  assert.match(out, /4 each still to ship/);
  assert.match(out, /id="invoice-form"/);
  assert.match(out, /6 received, not yet invoiced/);
  assert.match(out, /value="42\.50"/, "the price field starts at the order's price");
  assert.match(out, /line 1: 7 billed in all, 6 received/);
});

test("CATALOGUE: a proposal is waiting on Rankine, withdrawable; INVOICES: held, with the reason", async () => {
  let r = await draw("catalogue");
  assert.match(r.out, /Waiting on Rankine/);
  assert.match(r.out, /46\.00 USD/);
  assert.match(r.out, />Withdraw</);
  assert.match(r.out, /id="propose-form"/);
  r = await draw("invoices");
  assert.match(r.out, /Held/);
  assert.match(r.out, /7 billed in all, 6 received/);
  assert.deepEqual(r.called, ["vendorInvoices.list"]);
});

test("typed amounts: quantities to thousandths and prices to cents, never rounded", () => {
  assert.equal(toMilli("4"), "4000"); assert.equal(toMinor("42.50"), "4250"); assert.equal(plain("4250"), "42.50"); assert.equal(money("4250"), "42.50 USD");
  assert.throws(() => toMinor("42.501"));
});
