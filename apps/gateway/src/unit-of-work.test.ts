import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, SurfaceWriteDenied, TenancyMismatch, SurfaceDisabled, type Tx } from "./unit-of-work.ts";
import type { Principal, ScopeBinding } from "../../../packages/contracts/src/scope.ts";

const fakeTx = () => {
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  let binding: ScopeBinding | null = null;
  const log: string[] = [];
  const tx: Tx = {
    async setLocal(b) { binding = b; log.push("setLocal"); },
    async query() { log.push("query"); return []; },
    async insert(table, row) { inserted.push({ table, row }); log.push(`insert:${table}`); },
    async commit() { log.push("commit"); },
    async rollback() { log.push("rollback"); },
  };
  return { tx, inserted, log, binding: () => binding };
};

const dispatcher: Principal = {
  namespace: "internal", subjectId: "u-disp", orgId: "org-internal", regionId: "reg-south", scopeTier: "region", scopeId: "acct-south",
  roles: ["dispatcher"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const ctx = (surfaceId: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8", p: Principal = dispatcher) => ({
  surfaceId, principal: p, requestId: "req-1", now: () => new Date("2026-09-14T15:00:00Z"), newId: (() => { let i = 0; return () => `evt-${++i}`; })(),
});

test("the scope binding is SET LOCAL before anything else — RLS has its inputs from the first statement", async () => {
  const f = fakeTx();
  await createUnitOfWork(ctx("S3"), f.tx);
  assert.equal(f.log[0], "setLocal");
  assert.equal(f.binding()!["ac.region_id"], "reg-south");
  assert.equal(f.binding()!["ac.namespace"], "internal");
  assert.equal(f.binding()!["ac.surface_id"], "S3");
});

test("audit row and outbox row land in the same transaction, share one event_id, and precede COMMIT", async () => {
  const f = fakeTx();
  const uow = await createUnitOfWork(ctx("S3"), f.tx);
  const id = await uow.apply(
    { entity: "assignment", entityId: "job-1", action: "assign", topic: "job.assigned", before: null, after: { crew: "c1" }, orgId: "org-amped", regionId: "reg-south" },
    async (tx) => { await tx.query("INSERT ..."); },
  );
  const { eventIds } = await uow.commit();
  assert.deepEqual(eventIds, [id]);
  assert.deepEqual(f.log, ["setLocal", "query", "insert:audit_log", "insert:outbox", "commit"]);
  assert.equal(f.inserted[0]!.row.event_id, id);
  assert.equal(f.inserted[1]!.row.event_id, id);
  assert.equal(f.inserted[0]!.row.region_id, "reg-south");
  assert.equal(f.inserted[1]!.row.region_id, "reg-south");
});

test("S4 cannot write anything — the empty allowlist enforces itself", async () => {
  const hq: Principal = { ...dispatcher, scopeTier: "parent", scopeId: "org-internal", roles: ["ops_leadership"] };
  const f = fakeTx();
  // S4 is Phase 2 and disabled; the first refusal is the phase gate.
  await assert.rejects(createUnitOfWork(ctx("S4", hq), f.tx), SurfaceDisabled);
});

test("a surface writing outside its allowlist is refused with the registry named", async () => {
  const f = fakeTx();
  const uow = await createUnitOfWork(ctx("S3"), f.tx);
  await assert.rejects(
    uow.apply({ entity: "contract", entityId: "c-1", action: "amend", topic: "contract.amended", before: null, after: {}, orgId: "org-amped", regionId: "reg-south" }, async () => {}),
    (e: unknown) => e instanceof SurfaceWriteDenied && /surfaces\.ts/.test(e.message),
  );
});

test("a region-scoped dispatcher cannot write a row into another region, whatever the payload says", async () => {
  const f = fakeTx();
  const uow = await createUnitOfWork(ctx("S3"), f.tx);
  await assert.rejects(
    uow.apply({ entity: "assignment", entityId: "j", action: "assign", topic: "job.assigned", before: null, after: {}, orgId: "org-amped", regionId: "reg-west" }, async () => {}),
    TenancyMismatch,
  );
});

test("an org-scoped internal principal may write across regions; a customer principal may not write across orgs", async () => {
  const ops: Principal = { ...dispatcher, scopeTier: "parent", scopeId: "org-internal", roles: ["ops_leadership"] };
  const f = fakeTx();
  const uow = await createUnitOfWork({ ...ctx("S3", ops) }, f.tx);
  await uow.apply({ entity: "assignment", entityId: "j", action: "assign", topic: "job.assigned", before: null, after: {}, orgId: "org-amped", regionId: "reg-west" }, async () => {});

  const cust: Principal = { ...dispatcher, namespace: "customer", orgId: "org-amped", scopeTier: "location", scopeId: "acct-boulder", regionId: "reg-mountain" };
  const g = fakeTx();
  const u2 = await createUnitOfWork(ctx("S6", cust), g.tx);
  await assert.rejects(
    u2.apply({ entity: "service_request", entityId: "sr", action: "open", topic: "job.created", before: null, after: {}, orgId: "org-other", regionId: "reg-mountain" }, async () => {}),
    TenancyMismatch,
  );
});

test("a surface serves one namespace: a customer token cannot open the dispatch console's unit of work", async () => {
  const cust: Principal = { ...dispatcher, namespace: "customer", orgId: "org-amped" };
  await assert.rejects(createUnitOfWork(ctx("S3", cust), fakeTx().tx), TenancyMismatch);
});

test("an event with a topic outside the catalogue is refused at emit time", async () => {
  const f = fakeTx();
  const uow = await createUnitOfWork(ctx("S3"), f.tx);
  await assert.rejects(
    uow.apply({ entity: "assignment", entityId: "j", action: "x", topic: "job.teleported" as never, before: null, after: {}, orgId: "org-amped", regionId: "reg-south" }, async () => {}),
    /not in the event catalogue/,
  );
});

test("a dispatcher's token cannot open the Service Manager's unit of work — roles are registry data", async () => {
  await assert.rejects(createUnitOfWork(ctx("S2"), fakeTx().tx), /S2 admits/);
  const om: Principal = { ...dispatcher, roles: ["office_manager"], scopeTier: "parent", scopeId: "org-internal" };
  await assert.doesNotReject(createUnitOfWork(ctx("S2", om), fakeTx().tx));
});

test("the interface has no skipAudit, no force, no unscoped write", async () => {
  const f = fakeTx();
  const uow = await createUnitOfWork(ctx("S3"), f.tx);
  assert.deepEqual(Object.keys(uow).sort(), ["apply", "commit", "pending", "rollback", "tx"]);
});
