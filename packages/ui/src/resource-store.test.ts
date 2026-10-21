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

test("a refetch shows the held value, keeps it through a transport failure, and drops it for a real refusal", async () => {
  let mode: "ok" | "offline" | "forbidden" = "ok";
  const forbidden = { kind: "scope", error: "ScopeError", message: "not yours" } as const;
  const store = createResourceStore({ refusalOf: (e) => (e === forbidden ? forbidden : null) }, () => 7);
  const fetcher = async (): Promise<string> => {
    if (mode === "offline") throw new Error("Failed to fetch");
    if (mode === "forbidden") throw forbidden;
    return "jobs";
  };
  store.read("jobs.mine", fetcher);
  await Promise.resolve(); await Promise.resolve();

  mode = "offline";
  store.invalidate("jobs.mine");
  const refetch = store.read("jobs.mine", fetcher);
  assert.deepEqual(refetch.value, { state: "ready", value: "jobs" }, "no loading line while the refetch is in flight");
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(refetch.value, { state: "ready", value: "jobs" }, "a transport failure keeps what the screen had");

  mode = "forbidden";
  store.invalidate("jobs.mine");
  const refused = store.read("jobs.mine", fetcher);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(refused.value.state, "refused", "the gateway's own refusal is new information and replaces it");
  store.invalidate("jobs.mine");
  assert.equal(store.read("jobs.mine", fetcher).value.state, "loading", "and nothing is held after it");
});
