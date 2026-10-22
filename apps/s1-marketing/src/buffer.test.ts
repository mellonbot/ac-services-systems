import { test } from "node:test";
import assert from "node:assert/strict";
import { createLeadBuffer, BUFFER_KEY } from "./buffer.ts";

test("two tabs, one store: a lead queued in one is not overwritten by the other's write", () => {
  const store = new Map<string, string>();
  const shared = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const a = createLeadBuffer({ store: shared, now: () => 0 });
  const b = createLeadBuffer({ store: shared, now: () => 0 }); // loaded before A queued anything
  a.enqueue({ submissionId: "x", source: "web" } as never);
  b.enqueue({ submissionId: "y", source: "web" } as never);
  const ids = JSON.parse(store.get(BUFFER_KEY)!).map((q: { input: { submissionId: string } }) => q.input.submissionId).sort();
  assert.deepEqual(ids, ["x", "y"]);
});
