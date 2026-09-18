import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { treeOf } from "./screens/common.ts";
import { STATE_WORD, isOpen } from "./screens/work.ts";
import { valueWord, wonWhere } from "./screens/terms.ts";
import { resetRequestForm } from "./screens/request.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, JobWire, HierarchyContext, AccountWire, ContractWire, ServiceRequestWire, ResolutionWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS, TERMS } from "../../../packages/contracts/src/index.ts";

/**
 * S6 against a scripted gateway, through the REAL shell and the REAL
 * generated client — only `fetch` is faked. What this holds: the portal
 * renders whatever rows the gateway returned and adds no filter of its own
 * (the facility manager's tree and the executive's tree are the same code
 * over different rows); the work screen draws no crew; the request form
 * offers only sites, posts the customer's declaration, and reports the
 * outcome; a refusal is the heading and the gateway's words, not the console
 * card; degraded refuses the one write with the reason. Whether the gateway
 * returns the right rows is 0006's, held in test/integration/s6.test.ts.
 */
const U = (n: number) => `e6000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(1), WEST = U(2), ORG = U(3), SOUTH_NODE = U(4), WEST_NODE = U(5), AUSTIN = U(6), AUSTIN_ROOF = U(7), AUSTIN_AHU = U(8), RENO = U(9), RENO_ROOF = U(10), JOB = U(11), CONTACT = U(12), MSA = U(13), REQ = U(14);

const facility: Principal = {
  namespace: "customer", subjectId: CONTACT, orgId: ORG, regionId: SOUTH, scopeTier: "location", scopeId: AUSTIN,
  roles: [], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-6",
};
const executive: Principal = { ...facility, subjectId: U(15), scopeTier: "parent", scopeId: ORG };

const node = (id: string, tier: AccountWire["tier"], name: string, parentId: string | null, regionId: string, path: string[]): AccountWire =>
  ({ id, tier, name, parentId, regionId, customerGroup: tier === "location" ? "Southwest" : null, externalRef: null, timezone: null, active: true, path });
const southNode = node(SOUTH_NODE, "region", "Amped / South", null, SOUTH, [SOUTH_NODE]);
const westNode = node(WEST_NODE, "region", "Amped / West", null, WEST, [WEST_NODE]);
const austin = node(AUSTIN, "location", "Austin", SOUTH_NODE, SOUTH, [SOUTH_NODE, AUSTIN]);
const austinRoof = node(AUSTIN_ROOF, "site", "Austin — Roof", AUSTIN, SOUTH, [SOUTH_NODE, AUSTIN, AUSTIN_ROOF]);
const austinAhu = node(AUSTIN_AHU, "site", "Austin — Basement AHU", AUSTIN, SOUTH, [SOUTH_NODE, AUSTIN, AUSTIN_AHU]);
const reno = node(RENO, "location", "Reno", WEST_NODE, WEST, [WEST_NODE, RENO]);
const renoRoof = node(RENO_ROOF, "site", "Reno — Roof", RENO, WEST, [WEST_NODE, RENO, RENO_ROOF]);
/** What 0006 returns to the facility manager: the breadcrumb above, the subtree below. */
const FACILITY_NODES = [southNode, austin, austinRoof, austinAhu];
/** What it returns to the executive: everything. */
const EXEC_NODES = [southNode, westNode, austin, austinRoof, austinAhu, reno, renoRoof];

const contextFor = (p: Principal): HierarchyContext => ({
  principal: p,
  path: p.scopeTier === "parent" ? [{ tier: "parent", id: ORG, name: "Amped Fitness" }] : [{ tier: "parent", id: ORG, name: "Amped Fitness" }, { tier: "region", id: SOUTH_NODE, name: "Amped / South" }, { tier: "location", id: AUSTIN, name: "Austin" }],
  parent: { tier: "parent", id: ORG, name: "Amped Fitness", regionId: null, customerGroup: null },
  regions: [{ tier: "region", id: SOUTH_NODE, name: "Amped / South", regionId: SOUTH, customerGroup: null }],
  activeRegionId: SOUTH,
});

/** A customer's job row as RLS hands it back: the assignment join found nothing, so the crew fields are null. */
const job: JobWire = {
  id: JOB, siteId: AUSTIN_ROOF, contractId: null, projectId: null, serviceCode: "HVAC-REPAIR", priority: "urgent", state: "en_route",
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T13:00:00.000Z", version: 3, openedAt: "2026-09-17T12:00:00.000Z",
  regionId: SOUTH, orgId: ORG, currentCrewId: null, currentCrewLabel: null, currentAssignmentId: null,
  slaDueAt: "2026-09-17T16:00:00.000Z", slaEscalationStage: 0, slaSatisfiedAt: "2026-09-17T13:00:00.000Z",
};
const msa: ContractWire = {
  id: MSA, scopeTier: "parent", scopeId: ORG, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: SOUTH,
  signedAt: "2026-01-05", effectiveFrom: "2026-01-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state: "active",
};
const request: ServiceRequestWire = {
  id: REQ, siteId: AUSTIN_ROOF, siteName: "Austin — Roof", priority: "urgent", description: "Short-cycling.", requestedBy: CONTACT,
  createdAt: "2026-09-17T12:30:00.000Z", jobId: null, jobState: null, orgId: ORG, regionId: SOUTH,
};
const resolved: Record<string, ResolutionWire> = {
  sla_response: { termKey: "sla_response", value: "4_hour", wonAt: { tier: "parent", id: ORG }, policy: TERMS.sla_response!, trace: [], asOf: "2026-09-17" },
  payment_terms_days: { termKey: "payment_terms_days", value: 45, wonAt: { tier: "parent", id: ORG }, policy: TERMS.payment_terms_days!, trace: [], asOf: "2026-09-17" },
  pm_visits_per_year: { termKey: "pm_visits_per_year", value: 4, wonAt: { tier: "location", id: AUSTIN }, policy: TERMS.pm_visits_per_year!, trace: [], asOf: "2026-09-17" },
};

type Reply = { status: number; body: unknown };
const fakeGateway = (p: Principal, nodes: readonly AccountWire[], overrides: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>> = {}) => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const o = overrides[path];
    if (o) return typeof o === "function" ? reply(o(init).status, o(init).body) : reply(o.status, o.body);
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "never-held", expiresAt: "2026-09-17T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["auth.logout"].path) { session = false; return reply(200, { ok: true, sessionId: "sess-6" }); }
    if (path === OPERATIONS["session.me"].path) return reply(200, contextFor(p));
    if (path === OPERATIONS["accounts.list"].path) return reply(200, { nodes });
    if (path === OPERATIONS["jobs.list"].path) return reply(200, { jobs: [job] });
    if (path === OPERATIONS["serviceRequests.list"].path) return reply(200, { requests: [request] });
    if (path === OPERATIONS["contracts.list"].path) return reply(200, { contracts: [msa] });
    if (path === OPERATIONS["terms.register"].path) return reply(200, { terms: Object.values(TERMS) });
    if (path === OPERATIONS["terms.resolved"].path) return reply(200, { resolved, refused: {} });
    if (path === OPERATIONS["serviceRequests.create"].path) return reply(200, { id: U(99), orgId: ORG, regionId: SOUTH, eventId: U(98) });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

const ready = async (p: Principal = facility, nodes: readonly AccountWire[] = FACILITY_NODES, overrides?: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>>) => {
  const g = fakeGateway(p, nodes, overrides);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000 });
  await app.login("fm@amped.test", "pw");
  render(app.view()); await settle();
  return { app, gateway: g };
};

test("SCREENS and SCREEN_VIEWS agree: every screen but login has a view, and every view is a registered screen", () => {
  const ids = Object.keys(SCREENS).filter((k) => k !== "login").sort();
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), ids);
});

test("boot with no session lands on the login form; a refused login renders the heading and the gateway's words, not the console card", async () => {
  const g = fakeGateway(facility, FACILITY_NODES, { [OPERATIONS["auth.login"].path]: { status: 401, body: { error: "AuthError", code: "bad_claims", message: "invalid credentials" } } });
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch });
  await app.boot();
  let out = render(app.view());
  assert.match(out, /id="login-form"/);
  assert.doesNotMatch(out, /Session ended/, "a missing cookie is not an error to show");
  await app.login("fm@amped.test", "wrong");
  out = render(app.view());
  assert.match(out, /Session ended/);
  assert.match(out, /invalid credentials/);
  assert.doesNotMatch(out, /ac-refusal/, "RefusalCard is console-only; the customer sees the words");
});

test("SITES, facility manager: the region node is the breadcrumb root, the location hangs from it, its two sites below — and nothing the gateway did not return", async () => {
  const { app } = await ready();
  const out = render(app.view());
  assert.match(out, /Amped Fitness/);
  assert.match(out, /Location: Austin\. You see this location and what is under it\./);
  assert.match(out, /Amped \/ South/);
  assert.match(out, /Austin — Roof/);
  assert.match(out, /Austin — Basement AHU/);
  assert.doesNotMatch(out, /Reno/, "the portal adds no rows the gateway withheld");
  assert.match(out, /1 open job/, "the site carries its live work");
  assert.match(out, /1 request waiting/);
  assert.match(out, /Southwest/, "the customer's own grouping is shown as an attribute");
  assert.match(out, /Request service/);
  const tree = treeOf(FACILITY_NODES);
  assert.deepEqual(tree.children(null).map((n) => n.id), [SOUTH_NODE], "the visible ancestor is the root");
  assert.deepEqual(tree.crumbs(AUSTIN_ROOF), ["Amped / South", "Austin", "Austin — Roof"]);
});

test("SITES, executive: the SAME screen over more rows — every region, every location", async () => {
  const { app } = await ready(executive, EXEC_NODES);
  const out = render(app.view());
  assert.match(out, /Every region, location and site under this agreement\./);
  assert.match(out, /Amped \/ West/);
  assert.match(out, /Reno — Roof/);
  assert.match(out, /Austin — Roof/);
});

test("WORK: jobs in the customer's words, the SLA pill from the same numbers the dispatcher reads, and NO crew column", async () => {
  const { app } = await ready();
  app.router.navigate("work", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Crew en route/, "the state is a word, not an enum");
  assert.doesNotMatch(out, /en_route/);
  assert.match(out, /Responded/, "a satisfied timer reads as responded");
  assert.doesNotMatch(out, /Crew<\/th>|Unassigned|currentCrew/, "no crew, by construction");
  assert.match(out, /Short-cycling\./);
  assert.match(out, /Waiting for the office/);
  assert.equal(STATE_WORD.awaiting_parts, "Awaiting parts");
  assert.equal(isOpen({ state: "complete" }), false);
  assert.equal(isOpen({ state: "created" }), true);
});

test("REQUEST: the form offers only sites (never a location), posts the declaration, and reports receipt", async () => {
  const { app, gateway } = await ready();
  resetRequestForm();
  app.router.navigate("request", { siteId: AUSTIN_AHU });
  render(app.view()); await settle();
  let out = render(app.view());
  assert.match(out, /id="request-form"/);
  assert.match(out, new RegExp(`value="${AUSTIN_ROOF}"`));
  assert.match(out, new RegExp(`value="${AUSTIN_AHU}"[^>]*selected`), "the site the link named is preselected");
  assert.doesNotMatch(out, new RegExp(`value="${AUSTIN}"`), "a location is not offered — service is requested at a site");
  assert.match(out, /Emergency — no heating or cooling/);
  assert.match(out, /id="request-send"/);
  // The write itself, through the real client — the shell posts x-ac-surface: S6.
  const shellOf = app.phase.value;
  assert.equal(shellOf.kind, "ready");
  if (shellOf.kind !== "ready") return;
  await shellOf.shell.gateway.createServiceRequest({ siteId: AUSTIN_AHU, priority: "urgent", description: "Water on the floor under the AHU." });
  const call = gateway.calls.find((c) => c.path === OPERATIONS["serviceRequests.create"].path)!;
  assert.ok(call);
  assert.equal(JSON.parse(String(call.init?.body)).siteId, AUSTIN_AHU);
  assert.equal((call.init?.headers as Record<string, string>)["x-ac-surface"], "S6");
  out = render(app.view());
  assert.doesNotMatch(out, /Gateway unreachable/, "not degraded: the button is live");
});

test("REQUEST while degraded: the one write is refused with the surface's declared reason — there is no queue", async () => {
  const { app } = await ready();
  resetRequestForm();
  app.router.navigate("request", {});
  render(app.view()); await settle();
  app.degraded.value = true;
  const out = render(app.view());
  assert.match(out, /aria-disabled="true"/);
  assert.match(out, /Requests are not taken while the gateway is unreachable/);
});

test("TERMS: values in plain words, and where each came from is the resolver's answer", async () => {
  const { app } = await ready();
  app.router.navigate("terms", { tier: "site", nodeId: AUSTIN_ROOF });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Terms at Austin — Roof/);
  assert.match(out, /Amped Fitness › Amped \/ South › Austin › Austin — Roof/, "the breadcrumb is the customer's own path");
  assert.match(out, /Response commitment/);
  assert.match(out, /4 hour/);
  assert.match(out, /Set in the master agreement/);
  assert.match(out, /Set at Location: Austin/);
  assert.match(out, /id="as-of"/);
  assert.equal(valueWord({ ...resolved.payment_terms_days!, value: "12500" }, TERMS.labor_rate_minor), "$125.00");
  assert.equal(wonWhere({ ...resolved.sla_response!, wonAt: "fallback" }, () => undefined), "Standard term — nothing in your agreements sets it");
});

test("AGREEMENTS: the customer's paper, with the position it took on its own diagnostic data", async () => {
  const { app } = await ready(executive, EXEC_NODES);
  app.router.navigate("agreements", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Master agreement/);
  assert.match(out, /In force/);
  assert.match(out, /Rights reserved to Rankine/);
  assert.match(out, /Terms at this scope/);
  assert.match(out, /2026-01-01 → open/);
});

test("a refused read renders the heading, the message and a retry route; sign out returns to login", async () => {
  const { app } = await ready(facility, FACILITY_NODES, { [OPERATIONS["jobs.list"].path]: { status: 403, body: { error: "Forbidden", message: "jobs.list is not served to S6 for a customer principal" } } });
  app.router.navigate("work", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Refused — not permitted for this principal/);
  assert.match(out, /jobs.list is not served/);
  assert.match(out, /Try again/);
  await app.logout();
  assert.match(render(app.view()), /id="login-form"/);
});
