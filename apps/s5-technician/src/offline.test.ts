import { test } from "node:test";
import assert from "node:assert/strict";
import { createOfflineQueue, queueKey, type QueueStore } from "./offline.ts";

const memory = (): QueueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
};
let n = 0;
const ids = () => `m-${++n}`;

test("a queued intent survives the tab: a new queue on the same device reads it back, and device order continues after it", () => {
  const store = memory();
  const a = createOfflineQueue({ deviceId: "dev-1", newId: ids, now: () => 0, store });
  a.enqueue("jobs", "job-1", "transition", { state: "en_route" }, 1);
  a.enqueue("checklist_items", "job-1", "insert", { item_key: "filters" }, null);
  const b = createOfflineQueue({ deviceId: "dev-1", newId: ids, now: () => 0, store });
  assert.equal(b.pending.value.length, 2);
  assert.equal(b.enqueue("jobs", "job-1", "transition", { state: "on_site" }, 2).deviceSeq, 3);
  // Another device on the same browser does not inherit it.
  assert.equal(createOfflineQueue({ deviceId: "dev-2", newId: ids, now: () => 0, store }).pending.value.length, 0);
});

test("an answered flush is written back, so a reload does not replay what landed; a dead network leaves it and says why", async () => {
  const store = memory();
  const q = createOfflineQueue({ deviceId: "dev-3", newId: ids, now: () => 0, store });
  q.enqueue("jobs", "job-1", "transition", { state: "en_route" }, 1);
  assert.equal(await q.flush(async () => { throw new Error("offline"); }), false);
  assert.match(String((q.failure.value as Error).message), /offline/);
  assert.equal(JSON.parse(store.map.get(queueKey("dev-3"))!).length, 1);
  assert.equal(await q.flush(async (ms) => ({ outcomes: ms.map((m) => ({ outcome: "applied" as const, mutationId: m.mutationId, newVersion: 2 })) })), true);
  assert.equal(q.failure.value, null);
  assert.deepEqual(JSON.parse(store.map.get(queueKey("dev-3"))!), []);
});

test("storage that throws degrades to memory; the queue still works", () => {
  const q = createOfflineQueue({ deviceId: "dev-4", newId: ids, now: () => 0, store: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
  q.enqueue("jobs", "job-1", "transition", { state: "en_route" }, 1);
  assert.equal(q.pending.value.length, 1);
});
