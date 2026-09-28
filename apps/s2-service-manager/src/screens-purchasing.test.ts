import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp } from "./app.ts";
import { qty, toMilli, money, toMinor } from "./screens/purchasing.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { HierarchyContext, Principal, PurchaseOrderDetailOutput, CatalogItemWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * Item 11 — S2's purchasing screens against a scripted gateway, through the
 * real shell and client. What this holds: the office sees the vendor's
 * proposal and decides it; an order is raised only for items with an
 * accepted price; the order screen shows ordered, shipped, received and
 * invoiced per line and a held invoice's reasons in the gateway's words.
 * Whether those numbers are right is the gateway's and 0011's, held in
 * test/integration/s7.test.ts.
 */
const U = (n: number) => `e2110000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INTERNAL = "00000000-0000-0000-0000-000000000003", SOUTH = U(1), VENDOR = U(2), HUB = U(3), ITEM = U(4), ITEM_NP = U(5), PO = U(6), LINE = U(7);
const owner: Principal = { namespace: "internal", subjectId: U(9), orgId: INTERNAL, regionId: SOUTH, scopeTier: "parent", scopeId: INTERNAL, roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "s" };
const context: HierarchyContext = { principal: owner, path: [], parent: { tier: "parent", id: INTERNAL, name: "Rankine Operating Company", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH };
const price = { id: U(20), itemId: ITEM, vendorId: VENDOR, priceMinor: "4250", currency: "USD", effectiveFrom: "2026-09-01", effectiveTo: null, state: "accepted" as const, proposedAt: "2026-08-30T00:00:00.000Z", decidedAt: "2026-08-31T00:00:00.000Z", decisionNote: null };
const items: CatalogItemWire[] = [
  { id: ITEM, vendorId: VENDOR, vendorSku: "CAP-45-5", description: "Run capacitor 45/5", uom: "each", active: true, current: price, proposals: [{ ...price, id: U(21), priceMinor: "4600", effectiveFrom: "2026-10-01", state: "proposed" }] },
  { id: ITEM_NP, vendorId: VENDOR, vendorSku: "FLT-20", description: "Filter 20x25", uom: "each", active: true, current: null, proposals: [] },
];
const detail: PurchaseOrderDetailOutput = {
  order: { id: PO, number: "PO-20260927-ABC123", vendorId: VENDOR, vendorName: "Coolair Supply", receivingPointId: HUB, receivingPointCode: "SOUTH-HUB", receivingTier: "regional_hub", regionId: SOUTH, state: "acknowledged", currency: "USD", totalMinor: "42500", issuedAt: "2026-09-27T10:00:00.000Z", acknowledgedAt: "2026-09-27T11:00:00.000Z", promisedShipOn: "2026-09-29", createdAt: "2026-09-27T09:00:00.000Z" },
  receivingPoint: { id: HUB, code: "SOUTH-HUB", tier: "regional_hub", regionId: SOUTH, address: { line1: "100 Dock Rd", city: "Austin", state: "TX" }, active: true },
  lines: [{ id: LINE, lineNo: 1, itemId: ITEM, vendorSku: "CAP-45-5", description: "Run capacitor 45/5", uom: "each", quantityMilli: "10000", shippedMilli: "10000", receivedMilli: "6000", invoicedMilli: "3000", returnedMilli: "0", unitPriceMinor: "4250", amountMinor: "42500" }],
  shipments: [{ id: U(30), shippedOn: "2026-09-28", carrier: "UPS", tracking: "1Z999", lines: [{ poLineId: LINE, quantityMilli: "10000" }] }],
  receipts: [{ id: U(31), poLineId: LINE, quantityMilli: "6000", receivedAt: "2026-09-29T15:00:00.000Z" }],
  invoices: [{ id: U(32), poId: PO, poNumber: "PO-20260927-ABC123", vendorId: VENDOR, invoiceNumber: "INV-9", invoiceDate: "2026-09-29", totalMinor: "12900", currency: "USD", matchState: "held", matchNotes: [{ poLineId: LINE, code: "price", message: "line 1: billed at 43.00, ordered at 42.50" }], createdAt: "2026-09-29T16:00:00.000Z", lines: [] }],
  returns: [],
};

const gateway = () => {
  const calls: { path: string; body: string | undefined }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: init.body });
    if (path === OPERATIONS["auth.login"].path) return reply(200, { token: "t", expiresAt: "2026-09-28T00:00:00Z", context: {} });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["vendors.list"].path) return reply(200, { vendors: [{ id: VENDOR, legalName: "Coolair Supply", status: "active", regionId: SOUTH, paymentTermsDays: 30, contactEmail: null }] });
    if (path === OPERATIONS["catalog.list"].path) return reply(200, { items });
    if (path === OPERATIONS["receivingPoints.list"].path) return reply(200, { receivingPoints: [detail.receivingPoint] });
    if (path === OPERATIONS["pos.list"].path) return reply(200, { orders: [detail.order] });
    if (path === OPERATIONS["pos.detail"].path) return reply(200, detail);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 3, active: true }] });
    if (path === OPERATIONS["prices.decide"].path) return reply(200, { id: U(21), state: "accepted", closedId: U(20), eventId: U(99) });
    if (path === OPERATIONS["receipts.record"].path) return reply(200, { ids: [U(40)], state: "received", eventId: U(98) });
    if (path === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [] });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: path });
  };
  return { fetch, calls };
};
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
const ready = async () => {
  const g = gateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch });
  await app.login("owner@ac.test", "pw");
  render(app.view()); await settle();
  return { app, g };
};

test("quantities and money are converted as people type them, and nothing is rounded silently", () => {
  assert.equal(qty("10000"), "10"); assert.equal(qty("2500"), "2.5");
  assert.equal(toMilli("2.5"), "2500"); assert.throws(() => toMilli("1.2345"));
  assert.equal(money("123456"), "1,234.56 USD");
  assert.equal(toMinor("42.5"), "4250"); assert.throws(() => toMinor("42.505"));
});

test("PURCHASING: orders with their state in words, vendors, and receiving points by code", async () => {
  const { app } = await ready();
  app.router.navigate("purchasing", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /PO-20260927-ABC123/);
  assert.match(out, /SOUTH-HUB · Regional hub/);
  assert.match(out, /425\.00 USD/);
  assert.match(out, /Acknowledged/);
  assert.match(out, /Coolair Supply/);
  assert.match(out, /id="vendor-form"/);
});

test("VENDOR: the proposal waits on the office; only items with an accepted price can be ordered", async () => {
  const { app, g } = await ready();
  app.router.navigate("purchasing.vendor", { vendorId: VENDOR });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /46\.00 USD from 2026-10-01/);
  assert.match(out, />Accept</);
  assert.match(out, /CAP-45-5 — Run capacitor 45\/5 at 42\.50 USD/);
  assert.doesNotMatch(out, /FLT-20 — Filter 20x25 at/, "an item with no accepted price is not orderable");
  assert.ok(g.calls.every((c) => c.path !== OPERATIONS["prices.decide"].path), "nothing decided until the office presses Accept");
});

test("ORDER: per-line ordered, shipped, received, invoiced; a receipt form for what is outstanding; a held invoice's reason", async () => {
  const { app } = await ready();
  app.router.navigate("purchasing.po", { poId: PO });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /PO-20260927-ABC123/);
  assert.match(out, /100 Dock Rd, Austin/);
  assert.match(out, /ships by 2026-09-29/);
  assert.match(out, /id="receive-form"/);
  assert.match(out, /Line 1: 4 outstanding/);
  assert.match(out, /Held/);
  assert.match(out, /line 1: billed at 43\.00, ordered at 42\.50/);
  assert.match(out, /UPS 1Z999/);
  assert.match(out, /id="return-form"/, "received goods can be returned");
  assert.doesNotMatch(out, /id="issue-po"/, "an acknowledged order is not issued again");
});
