import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { ingestSync, shapeFault } from "./sync.ts";
import { BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import type { Mutation } from "../../../../packages/domain/src/sync/index.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * One bad mutation does not sink the batch, and one device replays one batch
 * at a time. The replay against a live database — duplicates, the lock under
 * two concurrent batches — is test/integration/backbone.test.ts.
 */
const U = (n: number) => `5c000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), JOB = U(3), CREW = U(4), DEVICE = U(5), GRANT = U(6), TECH = U(7);
const tech: Principal = {
  namespace: "device", subjectId: TECH, orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "region", scopeId: REGION,
  roles: ["technician"], firmId: null, deviceId: DEVICE, shiftId: GRANT, tierClaim: null, sessionId: "s",
};
const m = (over: Partial<Mutation> & { mutationId: string; deviceSeq: number }): Mutation => ({
  deviceId: DEVICE, entityTable: "parts_used", entityId: JOB, op: "insert", payload: { part_sku: "F-1", quantity_milli: "1000", source: "truck" },
  clientObservedVersion: null, deviceAt: "2026-09-16T09:00:00Z", ...over,
});

/** A database that refuses the parts_used row whose sku is "BAD", the way a CHECK would. */
const db = () => {
  const statements: string[] = [];
  let rolledBackTo = 0;
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      statements.push(sql);
      if (sql.startsWith("ROLLBACK TO SAVEPOINT")) rolledBackTo++;
      if (sql.includes("FROM jobs j, device_grants g")) return [{ org_id: ORG, region_id: REGION, crew_id: CREW, live: true, state: "on_site", version: 3 }] as never;
      if (sql.includes("INSERT INTO sync_mutations")) return [{ id: U(100 + statements.length) }] as never;
      void params;
      return [];
    },
    async insert(table, row) {
      statements.push(`insert ${table}`);
      if (table === "parts_used" && row.part_sku === "BAD") throw Object.assign(new Error("new row violates check constraint"), { code: "23514", constraint: "parts_used_sku" });
    },
    async commit() {}, async rollback() {},
  };
  return { tx, statements, rolledBack: () => rolledBackTo };
};
const uowFor = (tx: Tx) => createUnitOfWork({ surfaceId: "S5", principal: tech, requestId: "r", now: () => new Date(), newId: () => U(900) }, tx);
const batch = (mutations: readonly unknown[]) => ({ deviceId: DEVICE, grantId: GRANT, orgId: INTERNAL_ORG_ID, regionId: REGION, mutations: mutations as Mutation[] });

test("the batch takes the device's lock before it reads what it has seen", async () => {
  const { tx, statements } = db();
  await ingestSync(await uowFor(tx), TECH, batch([]), new Date());
  assert.match(statements[0]!, /pg_advisory_xact_lock/);
  assert.match(statements[1]!, /FROM sync_mutations WHERE device_id/);
});

test("a mutation the database refuses is rolled back to its own savepoint and recorded as rejected; the rest are applied", async () => {
  const { tx, statements, rolledBack } = db();
  const uow = await uowFor(tx);
  const out = await ingestSync(uow, TECH, batch([
    m({ mutationId: "a", deviceSeq: 1 }),
    m({ mutationId: "b", deviceSeq: 2, payload: { part_sku: "BAD", quantity_milli: "1000", source: "truck" } }),
    m({ mutationId: "c", deviceSeq: 3 }),
  ]), new Date());
  assert.deepEqual(out.map((o) => [o.mutationId, o.outcome]), [["a", "applied"], ["b", "rejected"], ["c", "applied"]]);
  assert.equal(rolledBack(), 1);
  assert.ok(statements.some((s) => s.includes("'rejected'")), "the refusal is recorded, so a replay is a duplicate and not a retry");
  assert.equal(uow.pending().events.length, 2, "the refused mutation left no audit or event behind");
});

test("a malformed mutation is rejected before anything is written; a batch with no list is a 400", async () => {
  const { tx } = db();
  const out = await ingestSync(await uowFor(tx), TECH, batch([
    m({ mutationId: "x", deviceSeq: 1, entityId: "not-a-uuid" }),
    null,
    m({ mutationId: "t", deviceSeq: 2, entityTable: "time_entries", payload: { start: "yesterday-ish", end: "2026-09-16T10:00:00Z", kind: "work" } }),
    m({ mutationId: "q", deviceSeq: 3, payload: { part_sku: "F-1", quantity_milli: "1".repeat(19), source: "truck" } }),
    m({ mutationId: "ok", deviceSeq: 4 }),
  ]), new Date());
  assert.deepEqual(out.map((o) => o.outcome), ["rejected", "rejected", "rejected", "rejected", "applied"]);
  assert.match((out[0] as { note: string }).note, /entityId/);
  await assert.rejects(ingestSync(await uowFor(db().tx), TECH, batch(undefined as never), new Date()), BadInput);
});

test("shapeFault names the field", () => {
  assert.equal(shapeFault(m({ mutationId: "a", deviceSeq: 1 })), null);
  assert.match(shapeFault(m({ mutationId: "a", deviceSeq: 1.5 }))!, /deviceSeq/);
  assert.match(shapeFault(m({ mutationId: "a", deviceSeq: 1, entityTable: "jobs", op: "transition", payload: {} }))!, /state/);
  assert.match(shapeFault(m({ mutationId: "a", deviceSeq: 1, payload: { quantity_milli: "-12" } }))!, /quantity_milli/);
});
