import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, SurfaceWriteDenied, type Tx } from "./unit-of-work.ts";

const fakeTx = (): Tx & { rows: [string, Record<string, unknown>][] } => {
  const rows: [string, Record<string, unknown>][] = [];
  return {
    rows,
    insert: async (t, r) => void rows.push([t, r]),
    update: async () => {},
    commit: async () => {},
    rollback: async () => {},
  };
};

const ctx = (surfaceId: "S2" | "S3" | "S4") =>
  ({ surfaceId, actorId: "u1", regionId: "r1", orgId: "o1" }) as const;

test("S4 cannot write, and the error names the registry rather than this file", async () => {
  const uow = createUnitOfWork(ctx("S4"), fakeTx());
  await assert.rejects(
    () => uow.apply({ entity: "assignment", entityId: "a1", action: "create", before: null, after: {} }, async () => {}),
    (e: Error) => e instanceof SurfaceWriteDenied && /surfaces\.ts/.test(e.message),
  );
});

test("dispatch cannot author a contract, however convenient that would be", async () => {
  const uow = createUnitOfWork(ctx("S3"), fakeTx());
  await assert.rejects(
    () => uow.apply({ entity: "contract", entityId: "c1", action: "create", before: null, after: {} }, async () => {}),
    SurfaceWriteDenied,
  );
});

test("an audited write lands in the same transaction as the change", async () => {
  const tx = fakeTx();
  const uow = createUnitOfWork(ctx("S2"), tx);
  await uow.apply({ entity: "contract", entityId: "c1", action: "create", before: null, after: { id: "c1" } },
    async (t) => t.insert("contracts", { id: "c1" }));
  await uow.commit();
  assert.deepEqual(tx.rows.map((r) => r[0]), ["contracts", "audit_log", "outbox"]);
  assert.equal(tx.rows[1]![1]!["regionId"], "r1");
});

test("nothing is audited for a write that was denied", async () => {
  const tx = fakeTx();
  const uow = createUnitOfWork(ctx("S4"), tx);
  await uow.apply({ entity: "annotation", entityId: "x", action: "create", before: null, after: {} }, async () => {}).catch(() => {});
  await uow.commit();
  assert.equal(tx.rows.length, 0);
});
