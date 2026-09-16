import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, gatewayOrigin, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { orderTree } from "./screens/accounts-tree.ts";
import { parentCandidates } from "./screens/accounts-move.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, AccountWire, HierarchyContext } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * S2 against a scripted gateway, through the REAL shell and the REAL
 * generated client — only `fetch` is faked. What this holds: boot resumes the
 * cookie session; a missing session shows login, not an error; login posts in
 * cookie mode and the surface never sees a token; the tree renders what the
 * gateway returns; a refusal renders as a decision; an account event refetches.
 * The wire itself is held in test/integration/s2-c1.test.ts.
 */
const U = (n: number) => `a2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), SOUTH = U(2), WEST = U(3), N_SOUTH = U(4), N_WEST = U(5), AUSTIN = U(6), ROOF = U(7);

const owner: Principal = {
  namespace: "internal", subjectId: "u-owner", orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const context: HierarchyContext = {
  principal: owner, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
  parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
};
const NODES: AccountWire[] = [
  { id: N_SOUTH, tier: "region", name: "Amped / South", parentId: null, regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, path: [N_SOUTH] },
  { id: N_WEST, tier: "region", name: "Amped / West", parentId: null, regionId: WEST, customerGroup: null, externalRef: null, timezone: null, active: true, path: [N_WEST] },
  { id: ROOF, tier: "site", name: "Rooftop units", parentId: AUSTIN, regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, path: [N_SOUTH, AUSTIN, ROOF] },
  { id: AUSTIN, tier: "location", name: "Amped Austin", parentId: N_SOUTH, regionId: SOUTH, customerGroup: "Texas", externalRef: null, timezone: null, active: true, path: [N_SOUTH, AUSTIN] },
];

/** A gateway that speaks the catalogue's paths. `session` flips when login succeeds — the cookie the browser would hold. */
const fakeGateway = () => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === OPERATIONS["auth.login"].path) {
      const b = JSON.parse(init.body!) as { email: string; password: string };
      if (b.password !== "pw") return reply(401, { error: "AuthError", code: "bad_claims", message: "invalid credentials" });
      session = true;
      return reply(200, { token: "should-never-be-held", expiresAt: "2026-09-16T00:00:00Z", context: {} });
    }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no bearer token and no session cookie" });
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }, { id: WEST, code: "WEST", name: "West", timezone: "America/Los_Angeles", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [{ id: ORG, name: "Amped Fitness Inc.", kind: "customer", externalRef: null, active: true, regionNodeCount: 2 }] });
    if (path === OPERATIONS["accounts.list"].path) return reply(200, { nodes: NODES });
    if (path === OPERATIONS["accounts.create"].path) {
      const b = JSON.parse(init.body!) as { tier: string; parentId?: string };
      if (b.tier === "site" && b.parentId === N_SOUTH) return reply(422, { error: "TriggerRefused", code: "ac_accounts_derive_region", message: "accounts: a site must hang off a location, not a region" });
      return reply(200, { id: U(99), regionId: SOUTH, eventId: U(98), caveats: ["D14 rule not set for South"] });
    }
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls, cookie: () => session };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

test("SCREENS and SCREEN_VIEWS agree: every screen but login has a view, and every view is a screen", () => {
  const ids = Object.keys(SCREENS).filter((k) => k !== "login").sort();
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), ids);
});

test("gatewayOrigin: the stamped meta wins; otherwise s2.<site> talks to api.<site>", () => {
  const doc = (meta: string | null, host: string) => ({ querySelector: () => (meta === null ? null : { getAttribute: () => meta }), location: { protocol: "https:", host } });
  assert.equal(gatewayOrigin(doc("http://127.0.0.1:19000", "127.0.0.1:8000")), "http://127.0.0.1:19000");
  assert.equal(gatewayOrigin(doc("", "s2.ac.example")), "https://api.ac.example");
  assert.equal(gatewayOrigin(doc(null, "s2.ac.example")), "https://api.ac.example");
});

test("boot with no session shows login, not an error; a bad password is a refusal card; login posts in cookie mode and the surface holds no token", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  // Locals, not `app.phase.value.kind` repeatedly: assert/strict's equal narrows a property path for the rest of the block.
  const booting = app.phase.value;
  assert.equal(booting.kind, "booting");
  assert.match(render(app.view()), /Connecting…/);
  await app.boot();
  const afterBoot = app.phase.value;
  assert.equal(afterBoot.kind, "login");
  assert.deepEqual(gw.calls.map((c) => c.path), ["/me"], "boot tries to resume the cookie session first");
  assert.equal(gw.calls[0]!.init.credentials, "include", "cookie mode from the first request");
  let out = render(app.view());
  assert.match(out, /<form class="s2-form"[^>]*id="login-form"/);
  assert.doesNotMatch(out, /ac-refusal/, "a missing session is the normal first visit");

  await app.login("owner@ac.test", "wrong");
  out = render(app.view());
  assert.match(out, /Session ended/);
  assert.match(out, /invalid credentials/);

  await app.login("owner@ac.test", "pw");
  const ready = app.phase.value;
  assert.equal(ready.kind, "ready");
  if (ready.kind !== "ready") return;
  assert.equal(ready.shell.token(), null, "cookie mode: script never sees the token");
  const login = gw.calls.find((c) => c.path === "/auth/login")!;
  assert.equal(login.init.credentials, "include");
  assert.equal(JSON.parse(login.init.body!).surface, "S2");
});

test("the tree screen: customers on the left, the selected tree ordered region → location → site with OUR region on every row", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: ORG });
  render(app.view()); // first render issues the reads
  await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /Amped Fitness Inc\./);
  assert.match(out, /Amped \/ South/);
  const order = ["Amped / South", "Amped Austin", "Rooftop units", "Amped / West"].map((n) => out.indexOf(n));
  assert.ok(order.every((i) => i >= 0), `all nodes rendered: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "depth-first: the site sits under its location, the location under its region node");
  assert.match(out, /data-depth="2" data-tier="site"/);
  assert.match(out, /Texas/, "the customer's grouping is shown as the attribute it is");
  assert.ok(out.includes(">South<") || /South<\/td>/.test(out), "the row says which of OUR regions dispatches it");
  assert.match(out, /href="\/accounts\/[^"]+\/new\/location\/[^"]+"/, "+ location from a region node");
  assert.match(out, /href="\/accounts\/[^"]+\/move\/[^"]+"/, "move from a location");
  assert.equal(gw.calls.filter((c) => c.path === "/s2/accounts").length, 1, "one read per key — the second render hit the signal");
});

test("an account event invalidates the tree and the next render refetches; nothing is patched from the envelope", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: ORG });
  render(app.view()); await settle();
  const before = gw.calls.filter((c) => c.path === "/s2/accounts").length;
  if (app.phase.value.kind !== "ready") return assert.fail("not ready");
  app.phase.value.store.invalidate(`accounts.list?orgId=${ORG}`);
  render(app.view()); await settle();
  assert.equal(gw.calls.filter((c) => c.path === "/s2/accounts").length, before + 1);
});

test("the new-node screen: a location under a region node offers no region field; a region node offers OUR regions and no parent", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.new", { orgId: ORG, tier: "location", parentId: N_SOUTH });
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /New location/);
  assert.match(out, /Under <strong>Amped \/ South<\/strong> \(region\) — dispatched from <strong>South<\/strong>/);
  assert.doesNotMatch(out, /name="regionId"/, "region is not an input below the region tier — the form does not offer the refusal");
  assert.match(out, /name="customerGroup"/);

  app.router.navigate("accounts.new", { orgId: ORG, tier: "region" });
  out = render(app.view());
  assert.match(out, /New region/);
  assert.match(out, /<select name="regionId" required/);
  assert.match(out, /South \(SOUTH\)/);
  assert.doesNotMatch(out, /customerGroup/);
});

test("the move screen offers only parents of the right tier, never the current one and never a descendant", () => {
  const austin = NODES.find((n) => n.id === AUSTIN)!;
  assert.deepEqual(parentCandidates(NODES, austin).map((n) => n.id), [N_WEST], "a location moves under another region node");
  const roof = NODES.find((n) => n.id === ROOF)!;
  assert.deepEqual(parentCandidates(NODES, roof).map((n) => n.id), [], "the only location is its current parent");
  assert.deepEqual(parentCandidates(NODES, NODES[0]!), [], "a region node is not moved");
  assert.deepEqual(orderTree(NODES).map((n) => n.name), ["Amped / South", "Amped Austin", "Rooftop units", "Amped / West"]);
});

test("degraded: every submit renders disabled with the surface's declared reason, and the screens keep their last value", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.new", { orgId: ORG, tier: "region" });
  render(app.view()); await settle();
  app.degraded.value = true; // what tick() would read from the transport; a surface never writes the shell's flag, only this mirror of it
  const out = render(app.view());
  assert.match(out, /aria-disabled="true"/);
  assert.match(out, /Gateway unreachable — Read-only from last server state/);
  assert.match(out, /South \(SOUTH\)/, "the last server state is still on screen");
});
