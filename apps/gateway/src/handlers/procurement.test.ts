import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createPurchaseOrder } from "./procurement.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

const U = (n: number) => `c4110000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REGION = U(2);
const VENDOR = U(10);
const ITEM_A = U(20);
const ITEM_B = U(21);

const ops: Principal = {
  namespace: "internal", subjectId: U(1), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["ops_leadership"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};

test("purchase order item and price reads and line inserts are batched", async () => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM vendors")) return [{ id: VENDOR, legal_name: "Vendor A", status: "active", region_id: REGION, payment_terms_days: 30, contact_email: null }] as never;
      if (sql.includes("FROM receiving_points")) return [{ id: U(30), code: "HUB", tier: "regional_hub", region_id: REGION, address: {}, active: true }] as never;
      if (sql.includes("FROM vendor_catalog_items")) return [
        { id: ITEM_A, vendor_id: VENDOR, vendor_sku: "A", description: "Item A", uom: "each", active: true, org_id: VENDOR, region_id: REGION },
        { id: ITEM_B, vendor_id: VENDOR, vendor_sku: "B", description: "Item B", uom: "each", active: true, org_id: VENDOR, region_id: REGION },
      ] as never;
      if (sql.includes("FROM vendor_catalog_prices")) return [
        { id: U(40), item_id: ITEM_A, price_minor: "2500", currency: "USD" },
        { id: U(41), item_id: ITEM_B, price_minor: "4000", currency: "USD" },
      ] as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  let sequence = 100;
  const newId = () => U(++sequence);
  const uow = await createUnitOfWork({
    surfaceId: "S2", principal: ops, requestId: "r", now: () => new Date("2026-10-01T12:00:00Z"), newId,
  }, tx);

  const result = await createPurchaseOrder(uow, {
    vendorId: VENDOR,
    receivingPointId: U(30),
    lines: [
      { itemId: ITEM_B.toUpperCase(), quantityMilli: "2000" },
      { itemId: ITEM_A, quantityMilli: "1000" },
    ],
  }, U(1), newId, new Date("2026-10-01T12:00:00Z"));

  assert.equal(result.totalMinor, "10500");
  const itemReads = queries.filter((q) => q.sql.includes("FROM vendor_catalog_items"));
  assert.equal(itemReads.length, 1);
  assert.deepEqual(itemReads[0]!.params[0], [ITEM_B, ITEM_A], "UUID casing does not affect the batched lookup");
  assert.equal(queries.filter((q) => q.sql.includes("FROM vendor_catalog_prices")).length, 1);
  const lineInserts = queries.filter((q) => q.sql.includes("INSERT INTO purchase_order_lines"));
  assert.equal(lineInserts.length, 1);
  assert.match(lineInserts[0]!.sql, /WITH ORDINALITY/);
  assert.deepEqual(lineInserts[0]!.params[4], [U(41), U(40)], "price references keep input line order");
  assert.deepEqual(lineInserts[0]!.params[5], ["2000", "1000"]);
  assert.deepEqual(lineInserts[0]!.params[6], ["4000", "2500"]);
});
