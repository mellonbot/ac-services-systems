import { test } from "node:test";
import assert from "node:assert/strict";
import { createResourceStore, keyOf } from "./resource-store.ts";

test("resource store shares reads, tracks answered calls, and invalidates by prefix", async () => {
  let calls = 0;
  let now = 1;
  const store = createResourceStore({ refusalOf: () => null }, () => now);
  let finish!: (value: string) => void;
  const fetcher = (): Promise<string> => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  };

  const first = store.read("accounts.list", fetcher);
  assert.equal(store.read("accounts.list", fetcher), first);
  assert.equal(store.peek<string>("accounts.list")?.state, "loading");
  assert.equal(calls, 1);

  now = 42;
  finish("ready");
  await Promise.resolve();
  assert.deepEqual(first.value, { state: "ready", value: "ready" });
  assert.equal(store.lastOkAt.value, 42);
  assert.equal(store.peek<string>("accounts.list"), first.value);

  store.invalidate("accounts.");
  assert.equal(store.peek("accounts.list"), null);
  assert.equal(store.version.value, 1);
  assert.equal(keyOf("accounts.list", { tier: "site", orgId: "acme" }), "accounts.list?orgId=acme&tier=site");
});

test("transport refusals do not mark the gateway as answered", async () => {
  const store = createResourceStore({ refusalOf: () => null }, () => 42);
  const resource = store.read("coverage.list", async () => { throw new Error("offline"); });
  await Promise.resolve();
  assert.deepEqual(resource.value, {
    state: "refused",
    refusal: { kind: "transport", status: null, message: "Error: offline" },
  });
  assert.equal(store.lastOkAt.value, null);
});
