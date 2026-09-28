/**
 * ITEM 11 — PROCUREMENT, END TO END, AND WHAT A VENDOR CAN AND CANNOT DO.
 *
 * The office's side runs over the wire through S2. The vendor's side cannot:
 * S7 is Phase 4 and `enabled: false`, so the gateway refuses every S7 request
 * at the phase gate — which is the gate working. Until the partners enable
 * it, the vendor's handlers (apps/gateway/src/handlers/procurement.ts) run
 * here inside a transaction bound AS a vendor, as the gateway role, which is
 * everything the gateway would do but open the unit of work's phase check.
 * RLS, the tenancy triggers and 0011's column rules are the database's and are
 * exercised exactly as they would be.
 *
 * What it holds:
 *   - the loop: vendor → catalogue item → price proposed by the vendor →
 *     accepted by the office → PO raised at that price → issued → acknowledged
 *     → shipped → received in two receipts → invoiced (matched) → a second
 *     invoice held for billing past the receipt → a return requested and
 *     authorized;
 *   - a vendor sees its own rows only, never a draft, never another vendor's,
 *     and reads zero rows on every job and customer table (0011's restrictive
 *     policies);
 *   - what a vendor may change is held at the table: not a PO's total, not a
 *     price's state to accepted, not more shipped than ordered.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import * as proc from "../../apps/gateway/src/handlers/procurement.ts";
import type { UnitOfWork } from "../../apps/gateway/src/unit-of-work.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH, REGION_WEST } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — item 11 (procurement, S7) was not verified against RLS";
if (!URL_) test("item 11 against RLS", { skip }, () => {});

const PORT = 26080 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct horse battery staple";
const RUN = Date.now().toString(36).toUpperCase();
const OWNER = "d7000000-0000-0000-0000-000000000001";
const VENDOR_ACTOR = "d7000000-0000-0000-0000-0000000000a1";

let pool: Pool;
let gateway: ChildProcess;
let s2: ConnectedShell;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const vendorBinding = (vendorId: string, regionId = REGION_SOUTH) => ({
  "ac.namespace": "vendor", "ac.org_id": vendorId, "ac.region_id": regionId, "ac.scope_tier": "parent", "ac.scope_id": vendorId,
  "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": VENDOR_ACTOR, "ac.surface_id": "S7",
});
/** A statement as the gateway role, bound. */
const asBinding = async (b: Record<string, string>, sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries(b)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const r = await c.query(sql, params); await c.query("COMMIT"); return r.rows;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};
/** A vendor handler, run as the gateway would run it — bound as the vendor, as ac_gateway — minus the phase gate. */
const asVendor = async <T>(vendorId: string, fn: (uow: UnitOfWork) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN"); await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries(vendorBinding(vendorId))) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const tx = { query: async (sql: string, params: readonly unknown[] = []) => (await c.query(sql, [...params])).rows, setLocal: async () => {}, insert: async () => {}, commit: async () => {}, rollback: async () => {} };
    const uow = { tx, apply: async (_m: unknown, write: (t: typeof tx) => Promise<void>) => { await write(tx); return randomUUID(); } } as unknown as UnitOfWork;
    const out = await fn(uow);
    await c.query("COMMIT");
    return out;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};
const code = (e: unknown): string | undefined => (e as { code?: string }).code;
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-item11-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d7@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hashPassword(PASSWORD)]);
  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  gateway.stdout!.on("data", (d) => { log += String(d); });
  gateway.stderr!.on("data", (d) => { log += String(d); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${PORT}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  s2 = await connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d7@ac.test", password: PASSWORD } });
});
after(async () => { gateway?.kill("SIGTERM"); await pool?.end(); });

// Shared across the tests below, in order.
let vendorA = "", vendorB = "", hub = "", item = "", itemB = "", poId = "", poNumber = "", lineId = "", draftId = "";

test("the office records two vendors, a receiving point and a catalogue item — the vendor is its own organization", { skip }, async () => {
  vendorA = (await s2.gateway.createVendor({ legalName: `Coolair Supply ${RUN}`, regionId: REGION_SOUTH, paymentTermsDays: 30 })).id;
  vendorB = (await s2.gateway.createVendor({ legalName: `Other Parts ${RUN}`, regionId: REGION_SOUTH })).id;
  hub = (await s2.gateway.createReceivingPoint({ code: `SOUTH-HUB-${RUN}`, tier: "regional_hub", regionId: REGION_WEST, address: { line1: "100 Dock Rd", city: "Reno", state: "NV" } })).id;
  item = (await s2.gateway.addCatalogItem({ vendorId: vendorA, vendorSku: `CAP-45-5-${RUN}`, description: "Run capacitor 45/5 µF" })).id;
  itemB = (await s2.gateway.addCatalogItem({ vendorId: vendorB, vendorSku: `B-1-${RUN}`, description: "Filter 20x25" })).id;
  const org = await admin("SELECT kind FROM organizations WHERE id = $1", [vendorA]);
  assert.equal(org[0]!.kind, "vendor");
  const row = await admin("SELECT org_id, region_id FROM vendor_catalog_items WHERE id = $1", [item]);
  assert.equal(row[0]!.org_id, vendorA, "tenancy inherited from the vendor");
});

test("a PO needs an accepted price: none yet is refused by name", { skip }, async () => {
  await assert.rejects(s2.gateway.createPurchaseOrder({ vendorId: vendorA, receivingPointId: hub, lines: [{ itemId: item, quantityMilli: "10000" }] }),
    (e: unknown) => s2.refusalOf(e)?.kind === "admission" && (s2.refusalOf(e) as { code: string }).code === "no_accepted_price");
});

test("the vendor proposes; its proposal cannot claim to be accepted; the office accepts", { skip }, async () => {
  await assert.rejects(asBinding(vendorBinding(vendorA), `INSERT INTO vendor_catalog_prices (org_id, region_id, item_id, vendor_id, price_minor, currency, effective, state)
    VALUES ($1,$2,$3,$1,100,'USD', daterange(current_date, NULL), 'accepted')`, [vendorA, REGION_SOUTH, item]), (e) => code(e) === "AC403");
  const p = await asVendor(vendorA, (uow) => proc.proposePrice(uow, { itemId: item, priceMinor: "4250", currency: "USD", effectiveFrom: today() }, randomUUID));
  const cat = await s2.gateway.listCatalog({ vendorId: vendorA });
  assert.equal(cat.items[0]!.proposals.length, 1);
  assert.equal(cat.items[0]!.current, null);
  const d = await s2.gateway.decidePrice({ priceId: p.id, decision: "accepted" });
  assert.equal(d.state, "accepted");
  assert.equal((await s2.gateway.listCatalog({ vendorId: vendorA })).items[0]!.current?.priceMinor, "4250");
});

test("a draft is the office's: raised at the accepted price, invisible to the vendor until issued", { skip }, async () => {
  const po = await s2.gateway.createPurchaseOrder({ vendorId: vendorA, receivingPointId: hub, lines: [{ itemId: item, quantityMilli: "10000" }] });
  poId = po.id; poNumber = po.number;
  assert.equal(po.totalMinor, "42500", "10 × 42.50");
  await assert.rejects(s2.gateway.createPurchaseOrder({ vendorId: vendorA, receivingPointId: hub, lines: [{ itemId: itemB, quantityMilli: "1000" }] }),
    (e: unknown) => (s2.refusalOf(e) as { code?: string }).code === "item_not_vendors");
  draftId = (await s2.gateway.createPurchaseOrder({ vendorId: vendorA, receivingPointId: hub, lines: [{ itemId: item, quantityMilli: "1000" }] })).id;
  assert.equal((await asVendor(vendorA, (uow) => proc.listPurchaseOrders(uow, {}))).orders.length, 0, "drafts are ours");
  await s2.gateway.issuePurchaseOrder({ poId });
  const seen = await asVendor(vendorA, (uow) => proc.listPurchaseOrders(uow, {}));
  assert.deepEqual(seen.orders.map((o) => o.number), [poNumber]);
  assert.equal(seen.orders[0]!.receivingPointCode, `SOUTH-HUB-${RUN}`);
  assert.equal(seen.orders[0]!.regionId, REGION_WEST, "a PO lives where its goods are going");
  const detail = await asVendor(vendorA, (uow) => proc.purchaseOrder(uow, { poId }));
  lineId = detail.lines[0]!.id;
  assert.equal(detail.receivingPoint?.address.city, "Reno");
});

test("the other vendor sees none of it; a vendor reads zero rows on every job and customer table", { skip }, async () => {
  assert.equal((await asVendor(vendorB, (uow) => proc.listPurchaseOrders(uow, {}))).orders.length, 0);
  assert.equal((await asVendor(vendorB, (uow) => proc.listCatalog(uow, {}))).items.every((i) => i.vendorId === vendorB), true);
  await assert.rejects(asVendor(vendorB, (uow) => proc.purchaseOrder(uow, { poId })), (e) => code(e) === "unknown_po");
  for (const t of ["jobs", "accounts", "assignments", "crews", "crew_credentials", "sla_timers", "service_requests", "contracts", "invoices", "settlements", "hq_metrics"]) {
    const n = Number((await asBinding(vendorBinding(vendorA), `SELECT count(*)::int AS n FROM ${t}`))[0]!.n);
    assert.equal(n, 0, `${t} answers a vendor with nothing`);
  }
});

test("the vendor acknowledges with a ship date — and can change nothing else on the order", { skip }, async () => {
  await assert.rejects(asBinding(vendorBinding(vendorA), "UPDATE purchase_orders SET total_minor = 1 WHERE id = $1", [poId]), (e) => code(e) === "AC403");
  const ack = await asVendor(vendorA, (uow) => proc.acknowledgePurchaseOrder(uow, { poId, promisedShipOn: inDays(2) }, new Date()));
  assert.equal(ack.state, "acknowledged");
  await assert.rejects(asVendor(vendorA, (uow) => proc.acknowledgePurchaseOrder(uow, { poId, promisedShipOn: inDays(2) }, new Date())), (e) => code(e) === "not_issued");
});

test("the vendor ships, never more than ordered; the office receives in two parts and the order closes", { skip }, async () => {
  await assert.rejects(asVendor(vendorA, (uow) => proc.recordShipment(uow, { poId, shippedOn: today(), carrier: "UPS", lines: [{ poLineId: lineId, quantityMilli: "11000" }] }, randomUUID)), (e) => code(e) === "AC422");
  await asVendor(vendorA, (uow) => proc.recordShipment(uow, { poId, shippedOn: today(), carrier: "UPS", tracking: "1Z999", lines: [{ poLineId: lineId, quantityMilli: "10000" }] }, randomUUID));
  const r1 = await s2.gateway.recordReceipt({ poId, lines: [{ poLineId: lineId, quantityMilli: "6000" }] });
  assert.equal(r1.state, "acknowledged");
  const r2 = await s2.gateway.recordReceipt({ poId, lines: [{ poLineId: lineId, quantityMilli: "4000" }] });
  assert.equal(r2.state, "received");
  const d = await s2.gateway.purchaseOrder({ poId });
  assert.equal(d.lines[0]!.receivedMilli, "10000");
  assert.equal(d.lines[0]!.shippedMilli, "10000");
});

test("an invoice at the order's price for what was received matches; one past the receipt is held, in words", { skip }, async () => {
  const ok = await asVendor(vendorA, (uow) => proc.submitVendorInvoice(uow, { poId, invoiceNumber: `INV-${RUN}-1`, invoiceDate: today(), lines: [{ poLineId: lineId, quantityMilli: "8000", unitPriceMinor: "4250" }] }, randomUUID));
  assert.equal(ok.matchState, "matched");
  assert.equal(ok.totalMinor, "34000");
  const held = await asVendor(vendorA, (uow) => proc.submitVendorInvoice(uow, { poId, invoiceNumber: `INV-${RUN}-2`, invoiceDate: today(), lines: [{ poLineId: lineId, quantityMilli: "3000", unitPriceMinor: "4300" }] }, randomUUID));
  assert.equal(held.matchState, "held");
  assert.deepEqual(held.matchNotes.map((n) => n.code).sort(), ["over_received", "price"]);
  await assert.rejects(asVendor(vendorA, (uow) => proc.submitVendorInvoice(uow, { poId, invoiceNumber: `INV-${RUN}-1`, invoiceDate: today(), lines: [{ poLineId: lineId, quantityMilli: "1000", unitPriceMinor: "4250" }] }, randomUUID)),
    (e) => code(e) === "23505", "an invoice number is the vendor's once");
  // The held invoice does not use up the receipt: a corrected invoice for the 2 left to bill matches.
  const fixed = await asVendor(vendorA, (uow) => proc.submitVendorInvoice(uow, { poId, invoiceNumber: `INV-${RUN}-3`, invoiceDate: today(), lines: [{ poLineId: lineId, quantityMilli: "2000", unitPriceMinor: "4250" }] }, randomUUID));
  assert.equal(fixed.matchState, "matched");
  assert.equal((await s2.gateway.purchaseOrder({ poId })).lines[0]!.invoicedMilli, "10000", "matched invoices only");
  const office = await s2.gateway.listVendorInvoices({ poId });
  assert.deepEqual(office.invoices.map((i) => i.matchState).sort(), ["held", "matched", "matched"]);
});

test("a return: the office asks within what was received, the vendor authorizes with its number, once", { skip }, async () => {
  await assert.rejects(s2.gateway.requestReturn({ poId, poLineId: lineId, quantityMilli: "11000", reason: "too many" }));
  const r = await s2.gateway.requestReturn({ poId, poLineId: lineId, quantityMilli: "2000", reason: "Two arrived with bulged casings" });
  await assert.rejects(asVendor(vendorA, (uow) => proc.respondToReturn(uow, { rmaId: r.id, decision: "authorized" }, new Date())));
  const ans = await asVendor(vendorA, (uow) => proc.respondToReturn(uow, { rmaId: r.id, decision: "authorized", rmaNumber: `RMA-${RUN}` }, new Date()));
  assert.equal(ans.state, "authorized");
  await assert.rejects(asVendor(vendorA, (uow) => proc.respondToReturn(uow, { rmaId: r.id, decision: "rejected", note: "changed mind" }, new Date())), (e) => code(e) === "already_answered");
  assert.equal((await s2.gateway.listReturns({ poId })).returns[0]!.rmaNumber, `RMA-${RUN}`);
});

test("a price change: accepting a later proposal closes the old price at its first day; the open order keeps its price", { skip }, async () => {
  const p = await asVendor(vendorA, (uow) => proc.proposePrice(uow, { itemId: item, priceMinor: "4600", currency: "USD", effectiveFrom: inDays(5) }, randomUUID));
  const d = await s2.gateway.decidePrice({ priceId: p.id, decision: "accepted" });
  assert.ok(d.closedId);
  const closed = await admin("SELECT upper(effective)::text AS upto FROM vendor_catalog_prices WHERE id = $1", [d.closedId]);
  assert.equal(closed[0]!.upto, inDays(5));
  assert.equal((await s2.gateway.purchaseOrder({ poId })).lines[0]!.unitPriceMinor, "4250");
  await s2.gateway.cancelPurchaseOrder({ poId: draftId });
});

test("S7 itself stays behind its phase gate: a vendor principal is refused at the door", { skip }, async () => {
  const r = await fetch(`${BASE}${"/procurement/pos"}`, { headers: { "x-ac-surface": "S7" } });
  assert.ok(r.status === 401 || r.status === 404, `S7 is disabled or unauthenticated, got ${r.status}`);
});
