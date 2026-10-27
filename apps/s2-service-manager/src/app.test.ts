import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, gatewayOrigin, SCREEN_VIEWS } from "./app.ts";
import { S2_CSS } from "./styles.ts";
import { UI_CSS } from "../../../packages/ui/src/styles.ts";
import { SCREENS } from "./screens.ts";
import { confirmPanel } from "./screens/common.ts";
import { orderTree, treeGuides, showSegment, showCustomerCard } from "./screens/accounts-tree.ts";
import { serviceHistoryOf, panMap, recentreMap, forgetLocating } from "./screens/home-card.ts";
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
  { id: N_SOUTH, tier: "region", name: "Amped / South", parentId: null, regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: null, path: [N_SOUTH] },
  { id: N_WEST, tier: "region", name: "Amped / West", parentId: null, regionId: WEST, customerGroup: null, externalRef: null, timezone: null, active: true, address: null, path: [N_WEST] },
  { id: ROOF, tier: "site", name: "Rooftop units", parentId: AUSTIN, regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: null, path: [N_SOUTH, AUSTIN, ROOF] },
  { id: AUSTIN, tier: "location", name: "Amped Austin", parentId: N_SOUTH, regionId: SOUTH, customerGroup: "Texas", externalRef: null, timezone: null, active: true, address: null, path: [N_SOUTH, AUSTIN] },
];

const TURNER = "0e000000-0000-4000-8000-000000000099", HOME = U(40);
const HOME_NODES: AccountWire[] = [
  { id: U(41), tier: "region", name: "Turner / South", parentId: null, regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: null, path: [U(41)] },
  { id: U(42), tier: "location", name: "Turner household", parentId: U(41), regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: null, path: [U(41), U(42)] },
  { id: HOME, tier: "site", name: "4012 Ridgeview Dr", parentId: U(42), regionId: SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true,
    address: { line1: "4012 Ridgeview Dr", city: "Fort Worth", state: "TX", postal: "76109", lat: 32.7101, lng: -97.3812 }, path: [U(41), U(42), HOME] },
];
const job = (n: number, state: string, end: string, siteId = HOME) => ({
  id: U(n), siteId, siteName: "4012 Ridgeview Dr", siteAddress: null, contractId: null, projectId: null, serviceCode: "PM-VISIT", priority: "routine", state,
  serviceWindowStart: end, serviceWindowEnd: end, version: 1, openedAt: end, stateChangedAt: end, regionId: SOUTH, orgId: TURNER, customerSegment: "residential",
  currentCrewId: null, currentCrewLabel: null, currentAssignmentId: null, slaDueAt: null, slaEscalationStage: null, slaSatisfiedAt: null, returnTrip: false, latestNote: null,
});
const HOME_JOBS = [
  { ...job(31, "invoiced", "2026-05-02T18:00:00.000Z"), serviceCode: "HVAC-REPAIR", latestNote: { body: "Replaced the compressor under warranty", at: "2026-05-02T18:00:00.000Z" } },
  job(32, "invoiced", "2025-04-11T18:00:00.000Z"),
  job(33, "in_progress", "2026-10-22T18:00:00.000Z"),
  job(34, "complete", "2025-10-03T18:00:00.000Z"),
  job(35, "invoiced", "2025-01-01T18:00:00.000Z", ROOF),
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
    if (path === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [{ id: ORG, name: "Amped Fitness Inc.", kind: "customer", segment: "commercial", externalRef: null, active: true, regionNodeCount: 2 },
      { id: "0e000000-0000-4000-8000-000000000099", name: "Turner residence", kind: "customer", segment: "residential", externalRef: null, active: true, regionNodeCount: 1 }] });
    if (path === OPERATIONS["accounts.list"].path) return reply(200, { nodes: new URL(url).searchParams.get("orgId") === TURNER ? HOME_NODES : NODES });
    if (path === OPERATIONS["jobs.list"].path) return reply(200, { jobs: HOME_JOBS });
    if (path === OPERATIONS["sites.mapTile"].path) {
      const q = new URL(url).searchParams;
      return reply(200, { z: Number(q.get("z")), x: Number(q.get("x")), y: Number(q.get("y")), image: null, attribution: null, unavailable: "not_configured" });
    }
    if (path === OPERATIONS["contracts.list"].path) {
      const residential = new URL(url).searchParams.get("orgId") !== ORG;
      return reply(200, { contracts: [{ id: U(70), scopeTier: "parent", scopeId: ORG, kind: "msa", parentContractId: null, billingPath: residential ? "residential_membership" : "enterprise_sla", regionId: SOUTH, signedAt: "2025-07-09", effectiveFrom: "2025-07-09", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state: "active" }] });
    }
    if (path === OPERATIONS["equipment.list"].path) return reply(200, { equipment: [
      { id: U(80), siteId: ROOF, kind: "heat_pump", label: null, manufacturer: "Trane", model: "XR15", serial: null, installedOn: null, tonnageMilli: "3000", active: true, lastServicedAt: null, lastServicedJobId: null, lastServicedServiceCode: null, jobCount: 0 },
    ] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [
      { id: U(60), legalName: "Cool Air Partners LLC", status: "active", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-09-01", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 2, activeCrewCount: 2 },
      { id: U(61), legalName: "North Texas Mechanical", status: "onboarding", regionId: SOUTH, settlementTermsDays: 45, msaSignedAt: null, diagnosticDataRightsReserved: false, w9DocumentKey: null, crewCount: 0, activeCrewCount: 0 },
      { id: U(62), legalName: "Gone Heating Co", status: "terminated", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2025-01-01", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 0, activeCrewCount: 0 },
    ] });
    if (path === OPERATIONS["leads.list"].path) return reply(200, { leads: [
      { id: U(50), source: "web_form", contact: { name: "Pat Turner", phone: "(817) 555-0142", note: "AC blowing warm upstairs" }, requestedMetro: "DFW", createdAt: "2026-10-21T12:00:00.000Z", convertedAccountId: null },
      { id: U(51), source: "web_form", contact: { name: "Sam Lee", email: "sam@example.test" }, requestedMetro: null, createdAt: "2026-10-20T09:00:00.000Z", convertedAccountId: U(52) },
    ] });
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

test("confirmation cannot commit while degraded but keeps its safe cancel action available", () => {
  const out = render(confirmPanel({
    id: "confirm-transition",
    title: "Terminate this agreement?",
    detail: "Current state: active.",
    confirmLabel: "Terminate agreement",
    disabled: true,
    onConfirm: () => {},
    onCancel: () => {},
  }));
  assert.match(out, /<button[^>]*disabled[^>]*>Terminate agreement<\/button>/);
  assert.match(out, />Keep as is<\/button>/);
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
  assert.match(out, /<form class="ac-form"[^>]*id="login-form"/);
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
  const chrome = render(app.view());
  assert.match(chrome, /aria-label="Customer records"/);
  assert.match(chrome, /aria-label="Technician Network"/);
  assert.match(chrome, /aria-label="Purchasing"/);
  assert.match(chrome, /aria-label="Billing"/);
  assert.match(chrome, /data-current="true" aria-current="page" href="\/accounts"/);
  // Each domain is its own track, never one shared strip; the open one is marked on the group.
  assert.equal(chrome.match(/<div class="ac-seg">/g)?.length, 4, "customer records, the technician network, purchasing and billing each get a track");
  assert.match(chrome, /class="ac-nav ac-nav--grouped"/, "the plain ac-nav is one shared track and would merge the domains again");
  assert.match(chrome, /aria-label="Customer records" data-current="true"/);
  assert.match(chrome, /aria-label="Technician Network" data-current="false"/);
  assert.match(chrome, /Signed-in scope/);
  assert.match(chrome, /AC Services/);
  const login = gw.calls.find((c) => c.path === "/auth/login")!;
  assert.equal(login.init.credentials, "include");
  assert.equal(JSON.parse(login.init.body!).surface, "S2");
});

test("Technician Network: AC Services DFW is a tab, and every firm that can still field crews for us is one picker beside it", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("network", { firmId: U(60) });
  render(app.view());
  await settle();
  const nav = render(app.view()).split('<nav class="s2-trail"')[0]!;
  const group = nav.split('aria-label="Technician Network"')[1]!.split('aria-label="Purchasing"')[0]!;
  const tabs = [...group.matchAll(/<a class="ac-seg__item"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ["AC Services DFW"], "a firm is a choice in the picker, never a tab of its own");
  const options = [...group.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(options, ["Subcontractor firms (2)", "Cool Air Partners LLC", "North Texas Mechanical"], "a terminated firm fields no crews, so the picker does not offer it");
  assert.match(group, /<span class="ac-seg__pick" data-current="true"><select aria-label="Subcontractor firm"/);
  assert.match(group, /<option value="a2000000-0000-0000-0000-000000000060" selected>Cool Air Partners LLC/);
  assert.match(group, /data-current="false" href="\/network">AC Services DFW/);

  assert.match(render(app.view()), /<li>Technician Network<\/li><li aria-current="location">Cool Air Partners LLC<\/li>/, "the breadcrumb names the firm, not a second 'Network'");

  app.router.navigate("network", {});
  const own = render(app.view());
  assert.match(own, /data-current="true" aria-current="page" href="\/network">AC Services DFW/);
  assert.match(own, /<span class="ac-seg__pick" data-current="false">/);
  assert.match(own, /<option value disabled selected>Subcontractor firms \(2\)<\/option>/, "on our own crews the picker names what it holds, and no firm reads as chosen");
  assert.match(own, /<h1 class="ac-page-head__title">Technician Network<\/h1>/);
  assert.match(own, /<li>Technician Network<\/li><li aria-current="location">AC Services DFW<\/li>/);
});

test("hovering a customer shows S6's card for it: a commercial account's sites and plan, a homeowner's home, units and membership", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  const cardOf = async (orgId: string) => {
    showCustomerCard(orgId);
    for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
    const out = render(app.view());
    return out.includes('role="tooltip"') ? out.split('role="tooltip"')[1]!.split("</article>")[0]! : "";
  };
  render(app.view()); await settle();

  const commercial = await cardOf(ORG);
  assert.match(commercial, /Amped Fitness Inc\./);
  assert.match(commercial, /Commercial/);
  assert.match(commercial, /<span class="ac-num">1<\/span> site across <span class="ac-num">1<\/span> location/);
  assert.match(commercial, /Enterprise SLA/);

  const home = await cardOf("0e000000-0000-4000-8000-000000000099");
  assert.match(home, /Turner residence/);
  assert.match(home, /Residential/);
  assert.match(home, /Heat pump/);
  assert.match(home, /Trane XR15/);
  assert.match(home, /Premium Cool Club<\/strong> · member since/);

  showCustomerCard(null);
  assert.doesNotMatch(render(app.view()), /role="tooltip"/);
  // The name carries the hover AND the focus handlers — keyboard users get the card too.
  assert.match(render(app.view()), /<a class="ac-link" href="\/accounts\/a2000000-0000-0000-0000-000000000001"/);
});

test("the Customers list: one heading (the panel's), and a selectable row that can grow to a stacked row's height", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /class="s2-two-col s2-two-col--wide-side"/);
  const customers = out.split('id="customers"')[1]!.split("</section>")[0]!;
  assert.doesNotMatch(customers, /<caption/, "the panel title already names the table");
  assert.match(S2_CSS, /\.s2-two-col--wide-side\{grid-template-columns:minmax\(min-content,2fr\)/, "the side column is never narrower than the table it holds");
  assert.match(UI_CSS, /\.ac-grid\[data-stack="narrow"\] \.ac-grid__row\{height:auto/, "a stacked selectable row is not held to one console row");
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
  assert.match(out, /Current location/);
  assert.match(out, /aria-current="location">Amped Fitness Inc\.<\/li>/);
  assert.match(out, /data-current="true" aria-current="page" href="\/accounts"/, "child routes retain their domain as the active nav target");
  assert.match(out, /Amped \/ South/);
  const order = ["Amped / South", "Amped Austin", "Rooftop units", "Amped / West"].map((n) => out.indexOf(n));
  assert.ok(order.every((i) => i >= 0), `all nodes rendered: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "depth-first: the site sits under its location, the location under its region node");
  assert.match(out, /data-depth="2" data-tier="site"/);
  const tree = out.split('id="account-tree"')[1]!;
  assert.equal(tree.match(/data-group="head"/g)?.length, 2, "each region node heads its band, and nothing below it does");
  assert.match(out, /Texas/, "the customer's grouping is shown as the attribute it is");
  assert.ok(out.includes(">South<") || /South<\/td>/.test(out), "the row says which of OUR regions dispatches it");
  assert.match(out, /href="\/accounts\/[^"]+\/new\/location\/[^"]+"/, "+ location from a region node");
  assert.match(out, /href="\/accounts\/[^"]+\/move\/[^"]+"/, "move from a location");
  assert.equal(gw.calls.filter((c) => c.path === "/s2/accounts").length, 1, "one read per key — the second render hit the signal");
  const ready = app.phase.value;
  assert.equal(ready.kind, "ready");
  if (ready.kind === "ready") {
    assert.equal(ready.store.peek<{ readonly organizations: readonly { readonly id: string }[] }>("organizations.list?kind=customer")?.state, "ready");
    assert.equal(gw.calls.filter((c) => c.path === "/s2/organizations").length, 1, "peek uses the already-loaded cache without fetching");
  }
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

test("the tree draws a file-tree guide per level: a tee before a sibling, an elbow on the last child, a rail only where an ancestor has siblings to come", () => {
  const SITE2 = U(90), LOC2 = U(91);
  const more: AccountWire[] = [...NODES,
    { ...NODES[2]!, id: SITE2, name: "Warehouse", path: [N_SOUTH, AUSTIN, SITE2] },
    { ...NODES[3]!, id: LOC2, name: "Amped Dallas", path: [N_SOUTH, LOC2] }];
  const g = treeGuides(orderTree(more));
  assert.deepEqual(g.get(N_SOUTH), [], "a region node is a root");
  assert.deepEqual(g.get(AUSTIN), ["tee"], "Dallas follows Austin under South");
  assert.deepEqual(g.get(ROOF), ["rail", "tee"], "the rail carries South's line past Austin's sites to Dallas");
  assert.deepEqual(g.get(SITE2), ["rail", "elbow"]);
  assert.deepEqual(g.get(LOC2), ["elbow"]);
  assert.deepEqual(treeGuides(orderTree(NODES)).get(ROOF), ["blank", "elbow"], "no rail below a last child");
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
  assert.match(out, /Offline — showing the records as last saved/);
  assert.match(out, /South \(SOUTH\)/, "the last server state is still on screen");
});

type TestNode = { type?: unknown; props?: Record<string, unknown> };
const nodesIn = (node: unknown): TestNode[] => {
  if (Array.isArray(node)) return node.flatMap(nodesIn);
  if (!node || typeof node !== "object") return [];
  const current = node as TestNode;
  return [current, ...nodesIn(current.props?.children)];
};

test("NEW CUSTOMER: commercial by default, as before; Residential asks for the home's address and the homeowner, and says the choice is fixed", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("organizations.new", {});
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /Commercial — a business with one or more sites/);
  assert.match(out, /name="nodeName"/, "the commercial form is unchanged: a parent and its first region node");
  assert.doesNotMatch(out, /name="line1"/);
  (nodesIn(app.view()).find((n) => n.type === "input" && n.props?.value === "residential")!.props!.onChange as () => void)();
  out = render(app.view());
  assert.match(out, /Household name/);
  assert.match(out, /name="line1"[^>]*required/);
  assert.match(out, /name="postal"/);
  assert.match(out, /Homeowner \(optional\)/);
  assert.match(out, /Fixed once created/);
  assert.match(out, />Create home</);
  assert.doesNotMatch(out, /name="nodeName"/, "a home's region node is named for it — nothing to type");
  (nodesIn(app.view()).find((n) => n.type === "input" && n.props?.value === "commercial")!.props!.onChange as () => void)();
});

test("LEADS: a tab under Customer records; waiting leads with a way to reach them; Convert opens the home form, named for them", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  assert.match(render(app.view()), />Leads<\/a>/);
  app.router.navigate("leads", {});
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /Pat Turner/);
  assert.match(out, /href="tel:\(817\) 555-0142"/);
  assert.match(out, /AC blowing warm upstairs/);
  assert.match(out, new RegExp(`id="convert-${U(50)}"`));
  assert.doesNotMatch(out, new RegExp(`id="convert-${U(51)}"`), "a converted lead is not converted twice");
  assert.match(out, /Converted/);
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.id === `convert-${U(50)}`)!.props!.onClick as () => void)();
  render(app.view()); await settle();
  out = render(app.view());
  assert.match(out, /id="lead-convert-form"/);
  assert.match(out, /value="Pat Turner residence"/);
  assert.match(out, /Their phone and email become the household's primary contact/);
  assert.match(out, /South \(SOUTH\)/);
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.id === "lead-convert-cancel")!.props!.onClick as () => void)();
  assert.doesNotMatch(render(app.view()), /id="lead-convert-form"/);
});

test("ACCOUNTS: each customer says residential or commercial, and the type chips choose which the list shows (0019)", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", {});
  render(app.view()); await settle();
  let out = render(app.view());
  assert.match(out, /Amped Fitness Inc\..*Commercial/s);
  assert.match(out, /Turner residence.*Residential/s);
  assert.match(out, /id="customer-type".*>All<.*>Residential<.*>Commercial</s);
  showSegment("residential"); // what the Residential chip's click runs
  out = render(app.view());
  assert.match(out, /Turner residence/);
  assert.doesNotMatch(out, /Amped Fitness Inc\./, "commercial customers are filtered out, not fetched again");
  showSegment("all");
});

test("ACCOUNTS: a residential customer, selected, gets its card with the home pinned on a map and every finished visit there, oldest first", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: TURNER });
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  const out = render(app.view());
  assert.match(out, /id="home-card"/);
  assert.match(out, /id="home-customer-card"/);
  assert.match(out, /4012 Ridgeview Dr/);
  assert.match(out, /id="home-map"[^>]*data-basemap="grid"/, "no provider configured → the pin on the bare grid");
  assert.match(out, /class="s2-map__pin"/);
  assert.match(out, /32\.71010, -97\.38120/);
  assert.match(out, /No basemap provider is configured/);
  // One probe tile, not a screenful, when the gateway says there is no provider.
  assert.equal(gw.calls.filter((c) => c.path === OPERATIONS["sites.mapTile"].path).length, 1);
  // History: finished jobs at this home only, in the order they happened.
  const rows = [...out.matchAll(/Preventive maintenance|Repair/g)].map((m) => m[0]);
  assert.deepEqual(rows, ["Preventive maintenance", "Preventive maintenance", "Repair"]);
  assert.match(out, /Replaced the compressor under warranty/);
  assert.match(out, />Complete</);
  assert.deepEqual(serviceHistoryOf(HOME_JOBS as never, HOME).map((j) => j.id), [U(32), U(34), U(31)]);
  // A drag past the edge of what the gateway will serve stops at the edge.
  const before = render(app.view()).match(/s2-map__pin[^>]*left:calc\(50% \+ (-?\d+)px\)/)![1];
  panMap(HOME_NODES[2]!, 32.7101, -97.3812, 1e6, 0);
  const after = Number(render(app.view()).match(/s2-map__pin[^>]*left:calc\(50% \+ (-?\d+)px\)/)![1]);
  assert.equal(before, "0");
  assert.ok(after < 0 && after >= -(4 + 1) * 256, `clamped to the reach box, got ${after}`);
  recentreMap();
});

test("ACCOUNTS: a commercial customer, selected, gets its tree and no home card", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: ORG });
  for (let i = 0; i < 3; i++) { render(app.view()); await settle(); }
  const out = render(app.view());
  assert.match(out, /Amped \/ South/);
  assert.doesNotMatch(out, /id="home-card"/);
  assert.equal(gw.calls.filter((c) => c.path === OPERATIONS["jobs.list"].path).length, 0);
});

test("ACCOUNTS: with a basemap provider, the home's map is the gateway's tiles around the pin, with the provider's credit", async () => {
  const gw = fakeGateway();
  const tiles: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.pathname !== OPERATIONS["sites.mapTile"].path) return gw.fetch(url, init);
    tiles.push(`${u.searchParams.get("z")}/${u.searchParams.get("x")}/${u.searchParams.get("y")}`);
    const body = { z: 17, x: 0, y: 0, image: "data:image/png;base64,AAAA", attribution: "© Tiles Co", unavailable: null };
    return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body), body: null };
  };
  const app = createApp({ baseUrl: "https://api.ac.test", fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: TURNER });
  for (let i = 0; i < 5; i++) { render(app.view()); await settle(); }
  const out = render(app.view());
  assert.match(out, /data-basemap="tiles"/);
  assert.match(out, /© Tiles Co/);
  assert.ok(tiles.length > 4 && tiles.every((t) => t.startsWith("17/")), `a screenful of zoom-17 tiles, got ${tiles.length}`);
  assert.ok((out.match(/<img src="data:image\/png;base64,AAAA"/g) ?? []).length >= 4);
});

test("ACCOUNTS: a home typed without coordinates is placed by the gateway on first view, and the pin follows the refetch", async () => {
  const gw = fakeGateway();
  let placed = false, located = 0;
  const words = { line1: "4012 Ridgeview Dr", city: "Fort Worth", state: "TX", postal: "76109" };
  const reply = (body: unknown) => ({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === OPERATIONS["sites.locate"].path) { located++; placed = true; return reply({ siteId: HOME, lat: 32.7101, lng: -97.3812, outcome: "located", eventId: U(97) }); }
    if (u.pathname === OPERATIONS["accounts.list"].path && u.searchParams.get("orgId") === TURNER)
      return reply({ nodes: HOME_NODES.map((n) => n.id === HOME ? { ...n, address: placed ? { ...words, lat: 32.7101, lng: -97.3812 } : words } : n) });
    return gw.fetch(url, init);
  };
  const app = createApp({ baseUrl: "https://api.ac.test", fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: TURNER });
  for (let i = 0; i < 6; i++) { render(app.view()); await settle(); }
  const out = render(app.view());
  assert.equal(located, 1, "asked once, not per render");
  assert.match(out, /class="s2-map__pin"/);
  assert.match(out, /32\.71010, -97\.38120/);
  forgetLocating(); recentreMap();
});

test("ACCOUNTS: an address the geocoder cannot find says so, and is not asked about again on every render", async () => {
  const gw = fakeGateway();
  let located = 0;
  const words = { line1: "1 Nowhere Ln", city: "Fort Worth", state: "TX" };
  const reply = (body: unknown) => ({ status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.pathname === OPERATIONS["sites.locate"].path) { located++; return reply({ siteId: HOME, lat: null, lng: null, outcome: "not_found", eventId: null }); }
    if (u.pathname === OPERATIONS["accounts.list"].path && u.searchParams.get("orgId") === TURNER)
      return reply({ nodes: HOME_NODES.map((n) => n.id === HOME ? { ...n, address: words } : n) });
    return gw.fetch(url, init);
  };
  const app = createApp({ baseUrl: "https://api.ac.test", fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: TURNER });
  for (let i = 0; i < 6; i++) { render(app.view()); await settle(); }
  assert.match(render(app.view()), /could not find this exact address/);
  assert.equal(located, 1);
  forgetLocating();
});

test("a required choice with nothing to choose says so where the select would be, and the submit says why it cannot go", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  // The Turner home is the only site under the only location: there is nowhere to move it.
  app.router.navigate("accounts.move", { orgId: TURNER, id: HOME });
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  const out = render(app.view());
  assert.doesNotMatch(out, /name="newParentId"/, "no required select that can only be empty");
  assert.match(out, /There is no other location in this tree to move under\./);
  assert.match(out, /id="move" aria-disabled="true"/);
  assert.match(out, /class="ac-action__reason" role="note">There is no other location to move under\./);
});

test("a row's actions are named for the row, so a screen reader's list of them is not 'Move, Move, Move'", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  app.router.navigate("accounts.tree", { orgId: ORG });
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  const out = render(app.view());
  assert.match(out, /aria-label="Move Rooftop units"/);
  assert.match(out, /aria-label="Add a site under Amped Austin"/);
});

test("the map lets plain scroll through to the page; Ctrl + scroll zooms, a level per mouse notch however the travel arrives", async () => {
  const gw = fakeGateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: gw.fetch, now: () => 1_000 });
  await app.login("owner@ac.test", "pw");
  recentreMap();
  app.router.navigate("accounts.tree", { orgId: TURNER });
  for (let i = 0; i < 4; i++) { render(app.view()); await settle(); }
  const zoom = () => /zoom <span class="s2-num">(\d+)<\/span>/.exec(render(app.view()))![1];
  const wheel = (deltaY: number, ctrlKey: boolean) => {
    let prevented = false;
    (nodesIn(app.view()).find((n) => n.props?.role === "application")!.props!.onWheel as (e: unknown) => void)({ deltaY, ctrlKey, metaKey: false, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  const start = zoom();
  assert.equal(wheel(-100, false), false, "plain scroll is the page's");
  assert.equal(zoom(), start);
  assert.equal(wheel(-40, true), true);
  assert.equal(zoom(), start, "a pinch's small step does not jump a level");
  wheel(-60, true);
  assert.equal(Number(zoom()), Number(start) + 1);
  recentreMap();
});
