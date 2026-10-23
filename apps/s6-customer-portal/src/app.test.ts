import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { treeOf } from "./screens/common.ts";
import { countsUnder } from "./screens/sites.ts";
import { STATE_WORD, isOpen, ordersOf, pillOf } from "./screens/work.ts";
import { plannedVisits } from "./screens/home.ts";
import { valueWord, wonWhere } from "./screens/terms.ts";
import { resetRequestForm, describe, refOf, photoProblem, toBase64 } from "./screens/request.ts";
import { money, tons, addressLines, ledgerOf } from "./screens/site.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, JobWire, HierarchyContext, AccountWire, ContractWire, ServiceRequestWire, ResolutionWire, EquipmentWire, ContactWire, InvoiceWire, SiteImageryOutput } from "../../../packages/contracts/src/index.ts";
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
const PHOTO = U(40);
const SOUTH = U(1), WEST = U(2), ORG = U(3), SOUTH_NODE = U(4), WEST_NODE = U(5), AUSTIN = U(6), AUSTIN_ROOF = U(7), AUSTIN_AHU = U(8), RENO = U(9), RENO_ROOF = U(10), JOB = U(11), CONTACT = U(12), MSA = U(13), REQ = U(14);

const facility: Principal = {
  namespace: "customer", subjectId: CONTACT, orgId: ORG, regionId: SOUTH, scopeTier: "location", scopeId: AUSTIN,
  roles: ["payer", "requester"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-6",
};
const executive: Principal = { ...facility, subjectId: U(15), scopeTier: "parent", scopeId: ORG };

const node = (id: string, tier: AccountWire["tier"], name: string, parentId: string | null, regionId: string, path: string[]): AccountWire =>
  ({ id, tier, name, parentId, regionId, customerGroup: tier === "location" ? "Southwest" : null, externalRef: null, timezone: null, active: true, address: null, path });
const southNode = node(SOUTH_NODE, "region", "Amped / South", null, SOUTH, [SOUTH_NODE]);
const westNode = node(WEST_NODE, "region", "Amped / West", null, WEST, [WEST_NODE]);
const austin = node(AUSTIN, "location", "Austin", SOUTH_NODE, SOUTH, [SOUTH_NODE, AUSTIN]);
const austinRoof: AccountWire = { ...node(AUSTIN_ROOF, "site", "Austin — Roof", AUSTIN, SOUTH, [SOUTH_NODE, AUSTIN, AUSTIN_ROOF]), externalRef: "ATX-01", timezone: "America/Chicago",
  address: { line1: "4500 Burnet Rd", city: "Austin", state: "TX", postal: "78756", lat: 30.3145, lng: -97.7392 } };
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
  id: JOB, siteId: AUSTIN_ROOF, siteName: "Austin — Roof", siteAddress: null, contractId: null, projectId: null, serviceCode: "HVAC-REPAIR", priority: "urgent", state: "en_route",
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T13:00:00.000Z", version: 3, openedAt: "2026-09-17T12:00:00.000Z", stateChangedAt: "2026-09-18T09:00:00.000Z",
  regionId: SOUTH, orgId: ORG, customerSegment: "commercial", currentCrewId: null, currentCrewLabel: null, currentAssignmentId: null,
  slaDueAt: "2026-09-17T16:00:00.000Z", slaEscalationStage: 0, slaSatisfiedAt: "2026-09-17T13:00:00.000Z",
  returnTrip: false, latestNote: null,
};
const msa: ContractWire = {
  id: MSA, scopeTier: "parent", scopeId: ORG, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: SOUTH,
  signedAt: "2026-01-05", effectiveFrom: "2026-01-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state: "active",
};
const request: ServiceRequestWire = {
  id: REQ, siteId: AUSTIN_ROOF, siteName: "Austin — Roof", priority: "urgent", description: "Short-cycling.", requestedBy: CONTACT,
  createdAt: "2026-09-17T12:30:00.000Z", jobId: null, jobState: null, orgId: ORG, regionId: SOUTH, customerSegment: "commercial", photos: [],
};
const resolved: Record<string, ResolutionWire> = {
  sla_response: { termKey: "sla_response", value: "4_hour", wonAt: { tier: "parent", id: ORG }, policy: TERMS.sla_response!, trace: [], asOf: "2026-09-17" },
  payment_terms_days: { termKey: "payment_terms_days", value: 45, wonAt: { tier: "parent", id: ORG }, policy: TERMS.payment_terms_days!, trace: [], asOf: "2026-09-17" },
  pm_visits_per_year: { termKey: "pm_visits_per_year", value: 4, wonAt: { tier: "location", id: AUSTIN }, policy: TERMS.pm_visits_per_year!, trace: [], asOf: "2026-09-17" },
};

// ---- item 9: the site card's rows, as 0009 hands them to the facility manager ----
const UNIT_1 = U(20), UNIT_2 = U(21), UNIT_3 = U(22), INVOICE = U(23);
const units: EquipmentWire[] = [
  { id: UNIT_1, siteId: AUSTIN_ROOF, kind: "rtu", label: "RTU-1", manufacturer: "Carrier", model: "48TC-D08", serial: "4819U12345", installedOn: "2019-05-14", tonnageMilli: "7500", active: true, lastServicedAt: "2026-06-12T20:00:00.000Z", lastServicedJobId: U(30), lastServicedServiceCode: "PM-Q2", jobCount: 3 },
  { id: UNIT_2, siteId: AUSTIN_ROOF, kind: "rtu", label: "RTU-2", manufacturer: "Carrier", model: "48TC-D08", serial: "4819U12346", installedOn: "2019-05-14", tonnageMilli: "7500", active: true, lastServicedAt: null, lastServicedJobId: null, lastServicedServiceCode: null, jobCount: 1 },
  { id: UNIT_3, siteId: AUSTIN_ROOF, kind: "exhaust", label: "EF-1", manufacturer: null, model: "Greenheck G-120", serial: null, installedOn: null, tonnageMilli: null, active: true, lastServicedAt: null, lastServicedJobId: null, lastServicedServiceCode: null, jobCount: 0 },
];
const contacts: ContactWire[] = [
  { id: U(24), accountId: AUSTIN_ROOF, accountName: "Austin — Roof", accountTier: "site", role: "site_manager", name: "Dana Ortiz", phone: "(512) 555-0100", email: "dana.ortiz@amped.test", note: "On site 6a–3p", isPrimary: true, active: true },
  { id: U(25), accountId: AUSTIN, accountName: "Austin", accountTier: "location", role: "security", name: "Front desk", phone: "(512) 555-0199", email: null, note: null, isPrimary: false, active: true },
];
const invoice: InvoiceWire = {
  id: INVOICE, billToTier: "parent", billToId: ORG, contractId: MSA, billingPath: "enterprise_sla", periodStart: "2026-06-01", periodEnd: "2026-06-30",
  totalMinor: "1284500", currency: "USD", issuedAt: "2026-07-03T15:00:00.000Z", dueAt: "2026-08-17T00:00:00.000Z",
  lines: [{ id: U(26), locationId: AUSTIN, jobId: U(30), description: "Quarterly PM — RTU-1", quantityMilli: "1000", unitPriceMinor: "42500", amountMinor: "42500" }],
  subtotalMinor: "42500",
};
const imageryOff: SiteImageryOutput = { siteId: AUSTIN_ROOF, lat: 30.3145, lng: -97.7392, image: null, attribution: null, unavailable: "not_configured" };
const imageryOn: SiteImageryOutput = { ...imageryOff, image: "data:image/png;base64,iVBORw0KGgo=", attribution: "© Provider", unavailable: null };

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
    if (path === OPERATIONS["media.get"].path) return reply(200, { id: PHOTO, contentType: "image/png", image: "data:image/png;base64,iVBORw0KGgo=" });
    if (path === OPERATIONS["contracts.list"].path) return reply(200, { contracts: [msa] });
    if (path === OPERATIONS["terms.register"].path) return reply(200, { terms: Object.values(TERMS) });
    if (path === OPERATIONS["terms.resolved"].path) return reply(200, { resolved, refused: {} });
    if (path === OPERATIONS["serviceRequests.create"].path) return reply(200, { id: U(99), orgId: ORG, regionId: SOUTH, eventId: U(98) });
    if (path === OPERATIONS["equipment.list"].path) return reply(200, { equipment: units });
    if (path === OPERATIONS["contacts.list"].path) return reply(200, { contacts });
    if (path === OPERATIONS["invoices.list"].path) return reply(200, { invoices: [invoice] });
    if (path === OPERATIONS["sites.imagery"].path) return reply(200, imageryOff);
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
  assert.match(out, /Please sign in again/);
  assert.match(out, /invalid credentials/);
  assert.doesNotMatch(out, /ac-refusal/, "RefusalCard is console-only; the customer sees the words");
});

test("SITES, facility manager: the region node is the breadcrumb root, the location hangs from it, its two sites below — and nothing the gateway did not return", async () => {
  const { app } = await ready();
  app.router.navigate("sites", {});
  render(app.view()); await settle();
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
  assert.deepEqual(countsUnder(tree, SOUTH_NODE), { location: 1, site: 2 }, "a region counts what is in view under it, not what the gateway withheld");
  assert.match(out, /class="s6-node__count"><span class="s6-num">1<\/span> location · <span class="s6-num">2<\/span> sites/);
});

test("SITES, executive: the SAME screen over more rows — every region, every location", async () => {
  const { app } = await ready(executive, EXEC_NODES);
  app.router.navigate("sites", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Every region, location and site under this agreement\./);
  assert.match(out, /Amped \/ West/);
  assert.match(out, /Reno — Roof/);
  assert.match(out, /Austin — Roof/);
});

test("HEADER: the request-service button is on every signed-in screen and goes to the form", async () => {
  const { app } = await ready();
  const out = render(app.view());
  assert.match(out, /id="nav-request"[^>]*>Request service</, "a button, in the masthead, not a link buried in a screen");
  app.router.navigate("work", {});
  assert.match(render(app.view()), /id="nav-request"/);
});

test("SITE CARD: where, who, what runs there, and one ledger — every row the gateway returned and nothing it withheld", async () => {
  const { app, gateway } = await ready();
  app.router.navigate("site", { siteId: AUSTIN_ROOF });
  render(app.view()); await settle();
  const out = render(app.view());
  // the head: the site, its breadcrumb, its codes, and the button
  assert.match(out, /id="site-name"[^>]*>Austin — Roof</);
  assert.match(out, /id="site-crumbs".*Amped \/ South.*Austin/s);
  assert.match(out, /ATX-01/, "the customer's own site code");
  assert.match(out, /id="site-request"[^>]*>Request service here</);
  // where: the address as recorded, the maps handoff by geo: (no third-party host), imagery honestly unavailable
  assert.match(out, /4500 Burnet Rd/); assert.match(out, /Austin, TX 78756/);
  assert.match(out, /href="geo:30\.3145,-97\.7392"/);
  assert.match(out, /data-unavailable="not_configured"/);
  assert.match(out, /Overhead imagery is not enabled for this portal\./);
  assert.doesNotMatch(out, /<img/, "no picture is drawn when the gateway has none");
  // who: the site's own manager first, the location's desk marked as inherited
  assert.match(out, /Dana Ortiz/); assert.match(out, /href="tel:\+?5125550100"/); assert.match(out, /mailto:dana\.ortiz@amped\.test/);
  assert.match(out, /data-inherited="true"[^>]*data-primary="false".*Security desk.*Location: Austin/s);
  // what runs there: the count line and the grid with derived last-serviced
  assert.match(out, /id="site-units-count".*2<\/span> RTU.*1<\/span> Exhaust/s);
  assert.match(out, /RTU-1/); assert.match(out, /4819U12345/); assert.match(out, /Carrier 48TC-D08/); assert.match(out, /PM-Q2/);
  assert.match(out, /Work open, none complete/, "a unit with an open job and no completed one says so");
  assert.match(out, /Not yet serviced by us/);
  assert.match(out, /<td[^>]*>7\.5</, "tons from integer thousandths");
  // the ledger: request, job and invoice in one list, newest first, money from minor units
  const ledger = /id="site-history"(.*)<\/ol>/s.exec(out)![1]!;
  const order = [...ledger.matchAll(/data-kind="(request|job|invoice)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["job", "request", "invoice"], "the 09-18 visit, the 09-17 request, the 07-03 invoice — newest first, a job on the day of its visit");
  assert.match(ledger, /Service requested — urgent/); assert.match(ledger, /Waiting for the office/);
  assert.match(ledger, /HVAC-REPAIR — Crew en route/); assert.match(ledger, /Responded/);
  assert.match(ledger, /Invoice issued — 2026-06-01 to 2026-06-30/); assert.match(ledger, /Quarterly PM — RTU-1/); assert.match(ledger, /\$425\.00/);
  assert.doesNotMatch(out, /1284500|12,845/, "the consolidated header total is not what this site was billed");
  // right now
  const facts = /id="site-facts"(.*?)<\/div><\/div>/s.exec(out)![1]!;
  assert.match(facts, /ac-stat__n">1<\/span><span class="ac-stat__l">Open jobs</); assert.match(facts, /ac-stat__n">3<\/span><span class="ac-stat__l">Units on record</); assert.match(out, /America\/Chicago/);
  // and no filter was sent: the reads name the site, the gateway decided the rows
  const paths = gateway.calls.map((c) => c.path);
  for (const op of ["equipment.list", "contacts.list", "invoices.list", "sites.imagery"] as const) assert.ok(paths.includes(OPERATIONS[op].path), `${op} was read`);
});

test("SITE CARD with imagery: the gateway's picture is drawn with its credit; a site not in view is said so, not guessed at", async () => {
  const { app } = await ready(facility, FACILITY_NODES, { [OPERATIONS["sites.imagery"].path]: { status: 200, body: imageryOn } });
  app.router.navigate("site", { siteId: AUSTIN_ROOF });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /<img[^>]*src="data:image\/png;base64,iVBORw0KGgo="[^>]*alt="Overhead view of Austin — Roof"/);
  assert.match(out, /© Provider/);
  app.router.navigate("site", { siteId: RENO_ROOF });
  const missing = render(app.view());
  assert.match(missing, /id="site-missing"/, "Reno is not in the facility manager's rows, so there is no card to draw");
});

test("site card helpers: money is bigint string arithmetic, an address renders as written, the ledger sorts newest first", () => {
  assert.equal(tons("7500"), "7.5"); assert.equal(tons("20000"), "20"); assert.equal(tons("12250"), "12.25"); assert.equal(tons(null), "—");
  assert.equal(money("42500"), "$425.00"); assert.equal(money("1284500"), "$12,845.00"); assert.equal(money("-5"), "−$0.05"); assert.equal(money("7", "EUR"), "EUR 0.07");
  assert.deepEqual(addressLines({ line1: "1 Main", city: "Reno", state: "NV" }), ["1 Main", "Reno, NV"]);
  assert.deepEqual(addressLines(null), []);
  const entries = ledgerOf([job], [request], [invoice], Date.parse("2026-09-18T00:00:00Z"), "comfort");
  assert.deepEqual(entries.map((e) => e.kind), ["job", "request", "invoice"]);
  assert.equal(entries[2]!.amount, "$425.00");
});

test("WORK ORDERS: the home — the account, the counts, the form beside every request and every job, in the customer's words and with NO crew", async () => {
  const { app } = await ready();
  const out = render(app.view());
  assert.match(out, /Work orders/, "sign-in lands on the work orders");
  assert.match(out, /id="account".*Amped Fitness/s);
  assert.match(out, /Enterprise SLA/, "the plan comes from the active agreement's billing path");
  assert.match(out, /id="account-request"[^>]*>New work order</);
  assert.match(out, /id="work-stats"/);
  assert.match(out, /id="request-form"/, "the form is on the home, not a screen away");
  // the request with no job yet: Requested, with the office
  assert.match(out, /Short-cycling\./);
  assert.match(out, /It is with the office/);
  assert.match(out, /data-state="current" aria-current="step"><span class="s6-step__dot" aria-hidden="true"><\/span><span class="s6-step__label">Requested/);
  // the job no request stands behind is still the customer's work: Scheduled, with its window
  assert.match(out, /HVAC-REPAIR/);
  assert.match(out, /Technician booked for/);
  assert.doesNotMatch(out, /en_route|Crew<\/th>|Unassigned|currentCrew/, "no enum, no crew, by construction");
  assert.equal(STATE_WORD.awaiting_parts, "Awaiting parts");
  assert.equal(isOpen({ state: "complete" }), false);
  assert.equal(isOpen({ state: "created" }), true);
});

test("WORK ORDERS: a request joins the job opened against it; holds, overdue response and cancellation each say so in the pill", () => {
  const asked: ServiceRequestWire = { ...request, jobId: JOB, jobState: "en_route" };
  const orders = ordersOf([asked], [job]);
  assert.equal(orders.length, 1, "the job behind a request is not listed twice");
  assert.equal(orders[0]!.jobState, "en_route");
  assert.equal(orders[0]!.ref, refOf(REQ));
  const at = (state: JobWire["state"], extra: Partial<JobWire> = {}) => pillOf(ordersOf([], [{ ...job, state, ...extra }])[0]!, Date.parse("2026-09-20T00:00:00Z"));
  assert.deepEqual(at("en_route"), { status: "ok", label: "Scheduled" });
  assert.deepEqual(at("awaiting_parts"), { status: "at_risk", label: "Ordering a part" });
  assert.deepEqual(at("invoiced"), { status: "ok", label: "Invoiced" });
  assert.deepEqual(at("cancelled"), { status: "blocked", label: "Cancelled" });
  assert.deepEqual(at("assigned", { slaSatisfiedAt: null }), { status: "breached", label: "Response overdue" });
  assert.equal(describe("No cooling", " Server closet unit. ", "2026-09-18"), "No cooling — Server closet unit.\nPreferred date: 2026-09-18.");
  assert.equal(describe("Other", "Odd smell.", ""), "Odd smell.");
});

test("PHOTOS: the form takes them, the card shows them — each read through the gateway, never from a bucket URL", async () => {
  const { app, gateway } = await ready(facility, FACILITY_NODES, {
    [OPERATIONS["serviceRequests.list"].path]: { status: 200, body: { requests: [{ ...request, photos: [{ id: PHOTO, contentType: "image/png", bytes: 8 }] }] } },
  });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /id="request-photos"[^>]*accept="image\/jpeg,image\/png,image\/heic,image\/heif"|accept="image\/jpeg,image\/png,image\/heic,image\/heif"[^>]*id="request-photos"/, "a picker that asks for photos");
  assert.match(out, /Drag photos here, or tap to choose/);
  assert.match(out, /Up to 6 — JPEG, PNG or HEIC, 10\.0 MB each/);
  assert.match(out, /<img class="s6-photo__img" src="data:image\/png;base64,iVBORw0KGgo="[^>]*alt="Photo 1 of 1"/);
  assert.ok(gateway.calls.some((c) => c.path === OPERATIONS["media.get"].path), "read with media.get");
  // the checks the form makes before anything is sent — the gateway makes them again
  assert.equal(photoProblem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null);
  assert.equal(photoProblem(new TextEncoder().encode("%PDF-1.7")), "not a JPEG, PNG or HEIC photo");
  assert.match(photoProblem(new Uint8Array(10 * 1024 * 1024 + 1))!, /^10\.0 MB — a photo is at most 10\.0 MB$/);
  const bytes = new Uint8Array(70_000).map((_, i) => i % 251);
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString("base64"), "sliced, so a large photo does not overflow the argument list");
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
  assert.match(out, /new requests are paused until the connection returns/);
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
  assert.match(out, /2026-01-01<br\/>→ open/);
});

test("a refused read renders the plain heading and the message, and offers no retry for an answer that will not change; sign out returns to login", async () => {
  const { app } = await ready(facility, FACILITY_NODES, { [OPERATIONS["jobs.list"].path]: { status: 403, body: { error: "Forbidden", message: "jobs.list is not served to S6 for a customer principal" } } });
  app.router.navigate("work", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /This isn't available to your account/);
  assert.match(out, /jobs.list is not served/);
  assert.doesNotMatch(out, /Try again/);
  await app.logout();
  assert.match(render(app.view()), /id="login-form"/);
});

test("the request stepper: the customer's five steps, from our job states, and a cancelled job stops rather than lying", async () => {
  const { stepOf, STEPS } = await import("./screens/work.ts");
  assert.deepEqual([...STEPS], ["Requested", "Scheduled", "In progress", "Completed", "Invoiced"]);
  assert.equal(stepOf({ jobState: null }), 0);
  assert.equal(stepOf({ jobState: "created" }), 0);
  assert.equal(stepOf({ jobState: "en_route" }), 1);
  assert.equal(stepOf({ jobState: "awaiting_parts" }), 2);
  assert.equal(stepOf({ jobState: "complete" }), 3);
  assert.equal(stepOf({ jobState: "invoiced" }), 4);
  assert.equal(stepOf({ jobState: "cancelled" }), -1);
});

test("JOB: what the office published, newest first, and the thread — the office is 'AC Services', never a staff name; a reply posts only the job and the words", async () => {
  const conversation = {
    jobId: JOB,
    updates: [
      { id: U(40), sourceNoteId: null, body: "Technician found a failed run capacitor. Part ordered.", state: "published", updatedAt: "2026-09-15T19:12:00.000Z", publishedAt: "2026-09-15T19:12:00.000Z", publishedByName: null },
      { id: U(41), sourceNoteId: null, body: "The part has arrived. A technician returns Thursday morning.", state: "published", updatedAt: "2026-09-17T15:00:00.000Z", publishedAt: "2026-09-17T15:00:00.000Z", publishedByName: null },
    ],
    messages: [
      { id: U(42), authorKind: "customer", authorName: "Dana Ortiz", body: "Can we get it done before the Friday inspection?", at: "2026-09-15T20:01:00.000Z" },
      { id: U(43), authorKind: "office", authorName: null, body: "Yes — holding Thursday morning for you.", at: "2026-09-15T20:20:00.000Z" },
    ],
  };
  const { app, gateway } = await ready(facility, FACILITY_NODES, {
    [OPERATIONS["jobs.conversation"].path]: { status: 200, body: conversation },
    [OPERATIONS["jobs.postMessage"].path]: { status: 200, body: { id: U(44), authorKind: "customer", eventId: U(45) } },
  });
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Updates from AC Services/);
  assert.ok(out.indexOf("The part has arrived") < out.indexOf("failed run capacitor"), "newest update first");
  assert.match(out, /data-side="office"[^]*?AC Services/, "the office speaks as the company");
  assert.match(out, /Dana Ortiz/, "a customer is named");
  assert.match(out, /Crew en route/, "the state in the customer's words");
  assert.doesNotMatch(out, /en_route|currentCrew/);
  assert.match(out, /id="reply-form"/);
  assert.match(out, /id="reply-send"/);

  const shellOf = app.phase.value;
  assert.equal(shellOf.kind, "ready");
  if (shellOf.kind !== "ready") return;
  await shellOf.shell.gateway.postJobMessage({ jobId: JOB, body: "Gate code is 4410." });
  const call = gateway.calls.find((c) => c.path === OPERATIONS["jobs.postMessage"].path)!;
  assert.deepEqual(Object.keys(JSON.parse(String(call.init?.body))).sort(), ["body", "jobId"], "which side wrote it is the gateway's to decide, not a field");
});

test("JOB: a job not in view says so, and an empty conversation says what will appear", async () => {
  const { app } = await ready(facility, FACILITY_NODES, {
    [OPERATIONS["jobs.conversation"].path]: { status: 200, body: { jobId: JOB, updates: [], messages: [] } },
  });
  app.router.navigate("job", { jobId: U(90) });
  render(app.view()); await settle();
  assert.match(render(app.view()), /Job not found/);
  app.router.navigate("job", { jobId: JOB });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /No updates yet/);
  assert.match(out, /No messages yet/);
});

test("JOB helpers: only published updates with a date are shown, newest first; authors in the customer's words", async () => {
  const { publishedNewestFirst, authorWord } = await import("./screens/job.ts");
  const u = (id: string, state: "draft" | "published", publishedAt: string | null) => ({ id, sourceNoteId: null, body: id, state, updatedAt: "2026-09-01T00:00:00Z", publishedAt, publishedByName: null });
  assert.deepEqual(publishedNewestFirst([u("a", "published", "2026-09-01T00:00:00Z"), u("d", "draft", null), u("b", "published", "2026-09-03T00:00:00Z")]).map((x) => x.id), ["b", "a"]);
  assert.equal(authorWord({ id: "m", authorKind: "office", authorName: "Dana", body: "", at: "" }), "AC Services");
  assert.equal(authorWord({ id: "m", authorKind: "customer", authorName: null, body: "", at: "" }), "You");
});

// ---- 0019: a residential customer's portal — one home, not a sites tree ----
const HOUSE = U(50), HOUSE_NODE = U(51), HOUSEHOLD = U(52), HOME = U(53);
const homeNodes: AccountWire[] = [
  node(HOUSE_NODE, "region", "Turner residence", null, SOUTH, [HOUSE_NODE]),
  node(HOUSEHOLD, "location", "905 Hidden Creek Pkwy", HOUSE_NODE, SOUTH, [HOUSE_NODE, HOUSEHOLD]),
  { ...node(HOME, "site", "Home", HOUSEHOLD, SOUTH, [HOUSE_NODE, HOUSEHOLD, HOME]), address: { line1: "905 Hidden Creek Pkwy", city: "Burleson", state: "TX", postal: "76028" } },
];
const homeowner: Principal = { ...facility, orgId: HOUSE, scopeTier: "parent", scopeId: HOUSE };
const residentialMe = (p: Principal): HierarchyContext => ({
  principal: p, path: [{ tier: "parent", id: HOUSE, name: "Turner residence" }],
  parent: { tier: "parent", id: HOUSE, name: "Turner residence", regionId: null, customerGroup: null },
  regions: [{ tier: "region", id: HOUSE_NODE, name: "Turner residence", regionId: SOUTH, customerGroup: null }], activeRegionId: SOUTH, segment: "residential",
});
const membership: ContractWire = { ...msa, id: U(54), scopeId: HOUSE, kind: "residential_membership" as ContractWire["kind"], billingPath: "residential_membership", effectiveFrom: "2026-03-01" };
const pmJob = (id: string, state: JobWire["state"], start: string): JobWire =>
  ({ ...job, id, siteId: HOME, siteName: "Home", priority: "pm", serviceCode: "PM-SPRING", state, serviceWindowStart: start, serviceWindowEnd: start.replace("T09", "T13"), stateChangedAt: start, orgId: HOUSE });
const homeReady = (p: Principal, contracts: readonly ContractWire[] = [membership]) => ready(p, homeNodes, {
  [OPERATIONS["session.me"].path]: { status: 200, body: residentialMe(p) },
  [OPERATIONS["contracts.list"].path]: { status: 200, body: { contracts } },
  [OPERATIONS["serviceRequests.list"].path]: { status: 200, body: { requests: [{ ...request, siteId: HOME, siteName: "Home", orgId: HOUSE }] } },
  [OPERATIONS["equipment.list"].path]: { status: 200, body: { equipment: [{ ...units[0]!, siteId: HOME, label: null, kind: "split", manufacturer: "Trane", model: "XR16" }] } },
});

test("YOUR HOME: a residential login lands on its home — the address, the unit there, the membership, the form — with no sites tree, site chips or account card", async () => {
  const { app } = await homeReady(homeowner);
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /<h1[^>]*>Your home</);
  assert.match(out, /Your home<\/a>/, "the nav names the home");
  assert.doesNotMatch(out, />Sites<\/a>/, "one home has no sites tree to browse");
  assert.doesNotMatch(out, /id="account"|Filter by site|Enterprise SLA/);
  assert.match(out, /id="home-card".*905 Hidden Creek Pkwy.*Burleson, TX 76028/s);
  assert.match(out, /id="home-units".*Split system|id="home-units".*Trane XR16/s);
  assert.match(out, /id="membership".*Member since/s);
  assert.match(out, /of 4 a year/, "PM visits a year from the resolved term, where one is set");
  assert.match(out, /id="membership-card__title">Premium Cool Club</, "the plan by its name, as it was sold");
  assert.match(out, /\$200\.00 a year plus tax · 2 preventive maintenance visits · Filter replacements included the first year\./);
  assert.match(out, /id="request-form"/);
  assert.match(out, /<input type="hidden" name="siteId" value="e6000000-0000-0000-0000-000000000053"/, "one home: no site to choose");
  assert.match(out, /id="nav-request"/);
});

test("YOUR HOME, payer only: the form is not drawn and the request button is gone — the screen says who asks instead", async () => {
  const { app } = await homeReady({ ...homeowner, roles: ["payer"] });
  const out = render(app.view());
  assert.doesNotMatch(out, /id="request-form"|id="nav-request"/);
  assert.match(out, /id="request-not-yours"/);
  assert.match(out, /Short-cycling\./, "a payer still reads the household's work");
});

test("YOUR HOME, no membership: said plainly, nothing invented", async () => {
  const { app } = await homeReady(homeowner, []);
  const out = render(app.view());
  assert.match(out, /No membership — each visit is billed on its own/);
  assert.match(out, /Premium Cool Club: \$200\.00 a year plus tax/, "the one plan there is, offered");
});

test("plannedVisits: PM jobs completed this year, and the earliest booked one still ahead", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const jobs = [
    pmJob(U(60), "complete", "2026-04-02T09:00:00.000Z"),
    pmJob(U(61), "invoiced", "2025-10-02T09:00:00.000Z"),
    pmJob(U(62), "assigned", "2026-11-20T09:00:00.000Z"),
    pmJob(U(63), "assigned", "2026-11-05T09:00:00.000Z"),
    { ...pmJob(U(64), "complete", "2026-05-02T09:00:00.000Z"), priority: "urgent" as const },
  ];
  const v = plannedVisits(jobs, now);
  assert.equal(v.done, 1, "last year's visit and a repair are not this year's planned visits");
  assert.equal(v.next?.id, U(63));
});
