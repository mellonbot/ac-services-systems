import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS, gatewayOrigin } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { slaStatus, isReleasable, isDispatchable, boardModel, boardTone } from "./screens/board.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, JobWire, HierarchyContext, CandidateCrewWire, ServiceRequestWire, CrewWire, TechnicianWire } from "../../../packages/contracts/src/index.ts";
import { intakeRows, age, defaultWindow } from "./screens/intake.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * S3 against a scripted gateway, through the REAL shell and the REAL
 * generated client — only `fetch` is faked. What this holds: boot resumes
 * the cookie session and lands on the board; the board reads jobs.list and
 * turns due-date-plus-escalation-stage into the same SLA glyph everywhere
 * else in the system; the dispatch screen is a dry run rendered as
 * ComplianceBadge, never a checkbox, and Assign is offered only where the
 * dry run cleared; release is offered only from the one state releaseAssignment
 * itself accepts. The wire — the real trigger, the real gate, RLS — is held
 * in test/integration/s3-s5.test.ts.
 */
const U = (n: number) => `e3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(1), ORG = U(2), SITE = U(3), JOB_CREATED = U(4), JOB_ASSIGNED = U(5), ASSIGNMENT = U(6), CREW_A = U(7), CREW_B = U(8);

const dispatcher: Principal = {
  namespace: "internal", subjectId: "u-disp", orgId: "org-internal", regionId: SOUTH, scopeTier: "region", scopeId: SOUTH,
  roles: ["dispatcher"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const context: HierarchyContext = {
  principal: dispatcher, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
  parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
};

const jobCreated: JobWire = {
  id: JOB_CREATED, siteId: SITE, siteName: "Austin — Roof", siteAddress: null, contractId: null, projectId: null, serviceCode: "HVAC-REPAIR", priority: "urgent", state: "created", workClass: "service",
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T17:00:00.000Z", version: 1, openedAt: "2026-09-17T12:00:00.000Z", stateChangedAt: "2026-09-17T12:00:00.000Z",
  regionId: SOUTH, orgId: ORG, customerSegment: "commercial", currentCrewId: null, currentCrewLabel: null, currentAssignmentId: null,
  slaDueAt: "2026-09-17T16:00:00.000Z", slaEscalationStage: 1, slaSatisfiedAt: null,
  returnTrip: false, latestNote: null,
};
const jobAssigned: JobWire = {
  ...jobCreated, id: JOB_ASSIGNED, state: "assigned", currentCrewId: CREW_A, currentCrewLabel: "Crew A1", currentAssignmentId: ASSIGNMENT,
  slaEscalationStage: 0, slaSatisfiedAt: "2026-09-17T13:00:00.000Z",
};
const CANDIDATES: CandidateCrewWire[] = [
  { crewId: CREW_A, label: "Crew A1", employmentType: "employed", cleared: true, refusal: null },
  { crewId: CREW_B, label: "Crew B1", employmentType: "subcontracted", cleared: false, refusal: { reason: "expired_in_window", credentialKind: "insurance", detail: "insurance covers through 2026-06-01, before the service window ends" } },
];

const NO_DOCS = { required: [], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null };
const CREWS: CrewWire[] = [
  { id: CREW_A, label: "Crew A1", employmentType: "employed", kind: "install", firmId: null, homeRegionId: SOUTH, active: true, documents: NO_DOCS },
  { id: CREW_B, label: "Unit B1", employmentType: "subcontracted", kind: "service", firmId: ORG, homeRegionId: SOUTH, active: true, documents: NO_DOCS },
];
const tech = (n: number, name: string, crewId: string | null, active = true): TechnicianWire => ({
  id: U(100 + n), firmId: null, crewId, name, phone: null, homeAddress: null, addressRestricted: true,
  role: crewId === CREW_A ? "installer" : "technician", specialties: [], homeRegionId: SOUTH, active,
});
const TECHNICIANS: TechnicianWire[] = [tech(1, "Ana Ruiz", CREW_A), tech(2, "Ben Cole", CREW_B), tech(3, "Cy Park", null), tech(4, "Dee Gone", null, false)];

type Reply = { status: number; body: unknown };
const fakeGateway = (overrides: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>> = {}) => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "never-held", expiresAt: "2026-09-17T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    const o = overrides[path];
    if (o) return typeof o === "function" ? reply(o(init).status, o(init).body) : reply(o.status, o.body);
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["jobs.list"].path) return reply(200, { jobs: [jobCreated, jobAssigned] });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews: CREWS });
    if (path === OPERATIONS["technicians.list"].path) return reply(200, { technicians: TECHNICIANS });
    if (path === OPERATIONS["dispatch.candidates"].path) return reply(200, { jobId: JOB_CREATED, candidates: CANDIDATES });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
type TestNode = { type?: unknown; props?: Record<string, unknown> };
const nodesIn = (node: unknown): TestNode[] => {
  if (Array.isArray(node)) return node.flatMap(nodesIn);
  if (!node || typeof node !== "object") return [];
  const current = node as TestNode;
  return [current, ...nodesIn(current.props?.children)];
};

const ready = async (overrides?: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>>) => {
  const g = fakeGateway(overrides);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000 });
  await app.login("dispatcher@ac.test", "pw");
  return { app, gateway: g };
};

test("gatewayOrigin falls back to the local preview gateway on localhost hosts", () => {
  const doc = {
    querySelector: () => null,
    location: { protocol: "http:", host: "127.0.0.1:8000", hostname: "127.0.0.1" },
  };
  assert.equal(gatewayOrigin(doc), "http://127.0.0.1:8080");
});

test("SCREENS and SCREEN_VIEWS agree: every screen but login has a view", () => {
  const ids = Object.keys(SCREENS).filter((k) => k !== "login").sort();
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), ids);
});

test("every S3 screen names only operations S3 may call", () => {
  for (const [id, spec] of Object.entries(SCREENS)) {
    for (const op of spec.uses) assert.ok(OPERATIONS[op].surfaces.includes("S3"), `${id} uses ${op}, which S3 may not call`);
  }
});

test("slaStatus: satisfied or timerless is on track, an escalated open timer is at risk, a due date in the past is breached", () => {
  assert.equal(slaStatus({ slaDueAt: null, slaEscalationStage: null, slaSatisfiedAt: null }, 1000), "ok");
  assert.equal(slaStatus({ slaDueAt: "2026-01-01T00:00:00Z", slaEscalationStage: 2, slaSatisfiedAt: "2026-01-01T00:00:00Z" }, Date.parse("2026-06-01")), "ok", "satisfied wins over a stale due date");
  assert.equal(slaStatus({ slaDueAt: "2026-06-02T00:00:00Z", slaEscalationStage: 1, slaSatisfiedAt: null }, Date.parse("2026-06-01")), "at_risk");
  assert.equal(slaStatus({ slaDueAt: "2026-06-01T00:00:00Z", slaEscalationStage: 0, slaSatisfiedAt: null }, Date.parse("2026-06-02")), "breached");
});

test("isDispatchable / isReleasable follow the handlers' own admitted states, not a guess", () => {
  assert.equal(isDispatchable(jobCreated), true);
  assert.equal(isDispatchable(jobAssigned), false);
  assert.equal(isReleasable(jobAssigned), true);
  assert.equal(isReleasable(jobCreated), false);
});

test("the board shows every job with its SLA glyph, its crew, and offers Dispatch or Release by state — never both", async () => {
  const { app } = await ready();
  app.router.navigate("board", {});
  render(app.view()); await settle(); await settle();
  const tree = app.view();
  const out = render(tree);
  assert.match(out, /Repair/);
  assert.match(out, /Unassigned/);
  assert.match(out, /Crew A1/);
  assert.match(out, /s3-truck-model/);
  assert.match(out, /Illustrative isometric AC Services dispatch shop, not a geographic location/);
  assert.match(out, /Operational schematic · not geographic/);
  assert.match(out, /Technician location unavailable/);
  assert.match(out, /No routes or vehicle positions are being inferred/);
  assert.match(out, /aria-label="Filter jobs"/);
  assert.equal((out.match(/class="ac-page-head"/g) ?? []).length, 1, "one page head");
  assert.match(out, /<h1 class="ac-page-head__title">Dispatch Board<\/h1>/);
  assert.doesNotMatch(out, />Field App</);
  assert.doesNotMatch(out, />Customer Portal</);
  assert.doesNotMatch(out, /data-latitude|data-longitude|latitude|longitude/i);
  assert.match(out, new RegExp(`href="/job/${JOB_CREATED}"`));
  assert.match(out, new RegExp(`id="release-${JOB_ASSIGNED}"`));
  assert.doesNotMatch(out, new RegExp(`id="release-${JOB_CREATED}"`), "an unassigned job offers no release");
  assert.doesNotMatch(out, new RegExp(`href="/job/${JOB_ASSIGNED}"`), "an already-assigned job offers no dispatch link");
});

test("the board is read off jobs.list: a row per crew holding work, bars in each job's window, and figures from the same rows", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const m = boardModel([jobCreated, jobAssigned], now, 0);
  assert.deepEqual(m.rows.map((r) => r.name), ["Crew A1"], "only crews holding work have a row");
  assert.equal(m.rows[0]!.service, "Austin — Roof — Repair");
  assert.equal(boardTone(jobCreated, now), "warn", "a late SLA is drawn as needs attention");
  assert.equal(boardTone(jobAssigned, now), "scheduled");
  const stats = Object.fromEntries(m.stats.map((t) => [t.label, t.n]));
  assert.deepEqual(stats, { "Jobs today": 2, "Crews out": 1, "Needs attention": 1, "Unscheduled": 1, "Tech available": 0 });
  const tomorrow = boardModel([jobCreated, jobAssigned], now, 1);
  assert.equal(tomorrow.rows[0]!.service, "No jobs today", "a crew with no window on the day is the idle row");
  assert.equal(Object.fromEntries(tomorrow.stats.map((t) => [t.label, t.n]))["Tech available"], 1);
});

test("the board draws every rostered crew and active technician, whether or not they hold work", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const m = boardModel([jobCreated, jobAssigned], now, 0, { crews: CREWS, technicians: TECHNICIANS });
  assert.deepEqual(m.rows.map((r) => r.name), ["Ben Cole", "Cy Park", "Crew A1"], "service technicians first — a unit under its technician's name, the uncrewed technician on their own — then the install crew under its label; the inactive one is gone");
  assert.deepEqual(m.rows.map((r) => r.kind), ["service", "service", "install"]);
  const byName = Object.fromEntries(m.rows.map((r) => [r.name, r]));
  assert.equal(byName["Crew A1"]!.members, "Ana Ruiz");
  assert.equal(byName["Ben Cole"]!.service, "No jobs today");
  assert.equal(byName["Cy Park"]!.dispatchable, false);
  assert.equal(Object.fromEntries(m.stats.map((t) => [t.label, t.n]))["Tech available"], 1, "only a dispatchable idle row counts as available");
});

test("the now-line sits at the current time on today's grid, and nowhere on another day or off the grid", () => {
  const d = new Date(2026, 8, 18, 12, 0, 0, 0).getTime(); // local noon: 5 of the 10 grid hours gone
  assert.equal(boardModel([], d, 0).nowAt, 50);
  assert.equal(boardModel([], d, 1).nowAt, null);
  assert.equal(boardModel([], d, -1).nowAt, null);
  assert.equal(boardModel([], new Date(2026, 8, 18, 20, 0).getTime(), 0).nowAt, null, "after 5 PM the line is off the grid");
});

test("the board steps three days either way from today and no further, and draws the now-line on today only", async () => {
  const { app } = await ready();
  app.router.navigate("board", {});
  render(app.view()); await settle(); await settle();
  const find = (id: string) => nodesIn(app.view()).find((n) => n.props?.id === id)!;
  const click = (id: string) => (find(id).props!.onClick as () => void)();
  assert.equal(find("board-next").props!.disabled, false);
  for (let i = 0; i < 5; i++) click("board-next");
  assert.equal(find("board-next").props!.disabled, true, "three days ahead is the limit");
  assert.equal(find("board-prev").props!.disabled, false);
  for (let i = 0; i < 8; i++) click("board-prev");
  assert.equal(find("board-prev").props!.disabled, true, "three days back is the limit");
  click("board-today");
  assert.equal(find("board-prev").props!.disabled, false);
  assert.equal(find("board-next").props!.disabled, false);
  const page = render(app.view());
  assert.match(page, /Cy Park/, "an idle technician has a row");
  assert.ok(page.indexOf('data-kind="service"') < page.indexOf('data-kind="install"'), "service technicians are banded above install crews");
  assert.equal((page.match(/class="dispatch-board__group"/g) ?? []).length, 2, "one band per half");
});

test("board filters persist across renders and show only the selected assignment state", async () => {
  const { app } = await ready();
  app.router.navigate("board", {});
  render(app.view()); await settle(); await settle();
  const findFilter = (label: string) => nodesIn(app.view()).find((node) =>
    node.type === "button" && node.props?.children === label);

  const unassigned = findFilter("Unassigned");
  assert.equal(typeof unassigned?.props?.onClick, "function");
  (unassigned!.props!.onClick as () => void)();
  // The filters drive the open-work list, which sits after the board itself.
  const list = (out: string) => out.slice(out.indexOf("s3-map-filters"));
  const unassignedView = list(render(app.view()));
  assert.match(unassignedView, /Austin — Roof/);
  assert.match(unassignedView, /data-state="created"/);
  assert.doesNotMatch(unassignedView, /data-state="assigned"/);
  assert.doesNotMatch(unassignedView, /Crew A1/);
  assert.match(unassignedView, /data-current="true"[^>]*aria-pressed="true"/);

  const assigned = findFilter("Assigned");
  assert.equal(typeof assigned?.props?.onClick, "function");
  (assigned!.props!.onClick as () => void)();
  const assignedView = list(render(app.view()));
  assert.match(assignedView, /Crew A1/);
  assert.match(assignedView, /data-state="assigned"/);
  assert.doesNotMatch(assignedView, /data-state="created"/);
});

test("dispatch: the dry run renders as ComplianceBadge with the gate's own reason, and Assign is offered only where it cleared", async () => {
  const { app } = await ready();
  app.router.navigate("dispatch", { jobId: JOB_CREATED });
  render(app.view()); await settle(); await settle();
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /Crew A1/);
  assert.match(out, /Crew B1/);
  assert.match(out, /Cleared/);
  assert.match(out, /Not cleared — expired in window/);
  assert.match(out, /<h1 class="ac-page-head__title">Dispatch — Repair<\/h1>/);
  assert.match(out, /<h2 class="ac-panel__title">Candidate crews<\/h2>/);
  // The site is named, not linked: the site card is S6's, and S6 admits customers only — a dispatcher who followed it was refused at sign-in.
  assert.match(out, /<dt>Site<\/dt><dd>Austin — Roof<\/dd>/);
  assert.doesNotMatch(out, /href="\/customer\//);
  assert.match(out, new RegExp(`id="assign-${CREW_A}"`));
  assert.doesNotMatch(out, new RegExp(`id="assign-${CREW_B}"`), "an uncleared crew has no Assign button — there is no override path here or at the gateway");
});

test("0024: dispatch says what kind of work the job is and that only that kind of crew is offered", async () => {
  const install: JobWire = { ...jobCreated, workClass: "install", serviceCode: "EQUIPMENT-CHANGEOUT" };
  const { app } = await ready({ [OPERATIONS["jobs.list"].path]: { status: 200, body: { jobs: [install, jobAssigned] } } });
  app.router.navigate("dispatch", { jobId: JOB_CREATED });
  render(app.view()); await settle(); await settle();
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /<dt>Work<\/dt><dd>Install<\/dd>/);
  assert.match(out, /Every active install crew in this job's region/);
  assert.match(out, /Install work goes to an install crew\./);
});

test("assigning navigates back to the board with a notice and refetches the board", async () => {
  const { app, gateway } = await ready({
    [OPERATIONS["dispatch.assign"].path]: { status: 200, body: { ok: true, assignmentId: U(50), clearanceId: U(51), eventId: U(52) } },
  });
  app.router.navigate("dispatch", { jobId: JOB_CREATED });
  render(app.view()); await settle(); await settle();
  if (app.phase.value.kind !== "ready") return assert.fail("not ready");
  const before = gateway.calls.filter((c) => c.path === OPERATIONS["jobs.list"].path).length;
  await (app.phase.value.shell.gateway.assignCrew({ jobId: JOB_CREATED, crewId: CREW_A, orgId: ORG, regionId: SOUTH }));
  app.phase.value.store.notice.value = ["Crew A1 assigned to hvac_repair."];
  app.phase.value.store.invalidate("jobs.list");
  app.router.navigate("board", {});
  render(app.view()); await settle();
  assert.equal(gateway.calls.filter((c) => c.path === OPERATIONS["jobs.list"].path).length, before + 1, "the board refetches after a dispatch");
  assert.match(render(app.view()), /Crew A1 assigned to hvac_repair\./);
});

test("a refusal at assignment renders the same reason the dry run showed — a race, not a surprise", async () => {
  const { app } = await ready({
    [OPERATIONS["dispatch.assign"].path]: { status: 200, body: { ok: false, refusal: { reason: "expired_in_window", credentialKind: "insurance", detail: "insurance lapsed between the read and the click" }, eventId: U(60) } },
  });
  app.router.navigate("dispatch", { jobId: JOB_CREATED });
  render(app.view()); await settle(); await settle();
  if (app.phase.value.kind !== "ready") return assert.fail("not ready");
  const out = await app.phase.value.shell.gateway.assignCrew({ jobId: JOB_CREATED, crewId: CREW_A, orgId: ORG, regionId: SOUTH });
  assert.equal(out.ok, false);
});

test("degraded: Assign and Release render disabled with the surface's declared reason, and the board keeps its last value", async () => {
  const { app } = await ready();
  app.router.navigate("board", {});
  render(app.view()); await settle(); await settle();
  app.degraded.value = true;
  const out = render(app.view());
  assert.match(out, /aria-disabled="true"/);
  assert.match(out, /Offline — the board is frozen at its last update/);
  assert.match(out, /Crew A1/, "the last server state is still on screen");
});

test("New customer and New job sit under the dispatch bar: New job opens the New job form, New customer hands off to S2 and says why when the role cannot", async () => {
  const { app } = await ready();
  await settle();
  const page = render(app.view());
  assert.match(page, /<\/header><div class="dispatch-actions">/, "the row sits directly under the bar");
  assert.match(page, /id="new-customer" aria-disabled="true"/, "a dispatcher cannot open S2");
  assert.match(page, /Customers are created in Service Manager/);
  const newJob = nodesIn(app.view()).filter((n) => n.props?.id === "new-job");
  assert.equal(newJob.length, 1);
  (newJob[0]!.props!.onClick as (e: Event) => void)(new Event("click"));
  assert.equal(app.router.current.value?.screen, "new-job");
});

test("New job: the form picks from the region's sites, grouped by customer, and says where a missing customer is signed in", async () => {
  const sites = [
    { id: U(30), name: "Roof North", orgId: ORG, orgName: "Shipman Co", regionId: SOUTH, address: { line1: "1200 S Main St", city: "Crowley" } },
    { id: U(31), name: "Store 12", orgId: U(32), orgName: "FirstKey Homes", regionId: SOUTH, address: null },
  ];
  const { app, gateway } = await ready({ [OPERATIONS["sites.list"].path]: { status: 200, body: { sites } } });
  app.router.navigate("new-job", {});
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.ok(gateway.calls.some((c) => c.path === OPERATIONS["sites.list"].path), "sites.list is read");
  assert.match(out, /id="new-job-form"/);
  assert.match(out, /<optgroup label="Shipman Co"><option value="[^"]+">Roof North — 1200 S Main St — Crowley<\/option><\/optgroup>/);
  assert.match(out, /<optgroup label="FirstKey Homes"><option value="[^"]+">Store 12<\/option>/);
  assert.match(out, /id="new-job-service"[^>]*required/);
  assert.match(out, /derived when the job opens, not chosen here/);

  const empty = await ready({ [OPERATIONS["sites.list"].path]: { status: 200, body: { sites: [] } } });
  empty.app.router.navigate("new-job", {});
  render(empty.app.view()); await settle(); await settle();
  const none = render(empty.app.view());
  assert.doesNotMatch(none, /id="new-job-form"/);
  assert.match(none, /signed in from Service Manager/);
});

test("New job: a site whose agreement has no response time says so in plain words, and Hold for Contracts records the call in Intake instead of losing it", async () => {
  const site = { id: U(30), name: "Roof North", orgId: ORG, orgName: "Shipman Co", regionId: SOUTH, address: null };
  const missingTerm = { termKey: "sla_response", siteId: U(30), siteName: "Roof North", customer: "Shipman Co", asOf: "2026-10-23" };
  let held: Record<string, unknown> | null = null;
  const { app, gateway } = await ready({
    [OPERATIONS["sites.list"].path]: { status: 200, body: { sites: [site] } },
    [OPERATIONS["jobs.create"].path]: { status: 422, body: { error: "InputRefused", code: "no_value", missingTerm,
      message: 'cannot open a job at this site: [inheritance] no value for "sla_response" anywhere on the path as of 2026-10-23, and the register declares no default.' } },
    [OPERATIONS["serviceRequests.hold"].path]: (init) => { held = JSON.parse(String(init?.body)); return { status: 200, body: { id: "5e000009-0000-4000-8000-000000000009", orgId: ORG, regionId: SOUTH, eventId: "e" } }; },
    [OPERATIONS["serviceRequests.list"].path]: { status: 200, body: { requests: [] } },
  });
  app.router.navigate("new-job", {});
  render(app.view()); await settle(); await settle();

  // The form's own FormData needs a DOM; the values are what the dispatcher typed.
  const values: Record<string, string> = { siteId: U(30), serviceCode: "HVAC-REPAIR", priority: "pm", start: "2026-10-24T08:00", end: "2026-10-24T12:00" };
  const RealFormData = globalThis.FormData;
  globalThis.FormData = class { get(k: string) { return values[k] ?? null; } } as unknown as typeof FormData;
  try {
    (nodesIn(app.view()).find((n) => n.type === "form" && n.props?.id === "new-job-form")!.props!.onSubmit as (e: unknown) => void)({ preventDefault() {}, currentTarget: {} });
    await settle(); await settle();
  } finally { globalThis.FormData = RealFormData; }

  const out = render(app.view());
  assert.match(out, /No agreed response time for Shipman Co/, "the heading names the term in plain words and the customer");
  assert.match(out, /A job at Roof North can't be opened until Contracts sets the response time in the agreement with Shipman Co\./);
  assert.doesNotMatch(out, /Refused — incomplete/);
  assert.match(out, /<details class="ac-refusal__detail"><summary>Details<\/summary>\s*<p class="ac-refusal__message">cannot open a job at this site: \[inheritance\]/, "the gateway's words are kept, verbatim, behind Details");

  (nodesIn(app.view()).find((n) => n.type === "button" && (n.props?.children as unknown[] | undefined)?.includes("Hold for Contracts"))!.props!.onClick as () => void)();
  await settle(); await settle();
  assert.deepEqual(held, { siteId: U(30), priority: "routine", description: "Phoned in for Repair.\nPreferred date: 2026-10-24." }, "planned work is a routine request; the date is the line Intake reads its window from");
  assert.ok(gateway.calls.some((c) => c.path === OPERATIONS["serviceRequests.hold"].path));
  assert.match(render(app.view()), /Call held as request 5E000009/);
  assert.equal(defaultWindow(String(held!["description"]), new Date()).start, "2026-10-24T08:00", "opened from Intake, the form starts on the day the caller asked for");
});

test("the dark dispatch bar is the only navigation, and its Sign out ends the session at the gateway", async () => {
  const { app, gateway } = await ready({ [OPERATIONS["auth.logout"].path]: { status: 200, body: { ok: true, sessionId: "sess-1" } } });
  await settle();
  const page = render(app.view());
  assert.equal((page.match(/class="dispatch-header"/g) ?? []).length, 1, "one bar");
  assert.equal(page.includes('class="ac-nav"'), false, "the old nav above it is gone");
  assert.match(page, /<nav class="ac-seg" aria-label="Dispatch navigation"><a class="ac-seg__item" href="[^"]*\/board" data-current="true" aria-current="page"/, "the bar's nav is the segmented control, the board raised");
  assert.match(page, /dispatcher · AC Services/, "who is signed in stays on screen");
  const signOut = nodesIn(app.view()).filter((n) => n.props?.class === "dispatch-header__logout");
  assert.equal(signOut.length, 1, "one Sign out");
  await (signOut[0]!.props!.onClick as () => Promise<void>)();
  await settle();
  assert.ok(gateway.calls.some((c) => c.path === OPERATIONS["auth.logout"].path), "the gateway is told");
  assert.equal(app.phase.value.kind, "login", "and the console is back at its sign-in");
  assert.match(render(app.view()), /id="sign-in"/);
});

test("job dashboard: stalled jobs are needs-action by default, longest in status first; a state filter narrows to its label", async () => {
  const { stalling, daysInState } = await import("./screens/jobs.ts");
  const now = Date.parse("2026-10-21T00:00:00Z");
  const job = (id: string, state: string, days: number) => ({ id, state, openedAt: new Date(now - 400 * 86_400_000).toISOString(), stateChangedAt: new Date(now - days * 86_400_000).toISOString() }) as unknown as import("../../../packages/contracts/src/index.ts").JobWire;
  const jobs = [job("a", "assigned", 50), job("b", "created", 3), job("c", "reopened", 20), job("d", "invoiced", 90), job("e", "reassigned", 9)];
  assert.equal(daysInState(jobs[0]!, now), 50, "measured from the state change, not the open date");
  assert.deepEqual(stalling(jobs, "action", now).map((j) => j.id), ["c", "e", "b"]);
  assert.deepEqual(stalling(jobs, "Unassigned", now).map((j) => j.id), ["e", "b"], "created and reassigned share one label");
  assert.deepEqual(stalling(jobs, "open", now).map((j) => j.id), ["a", "c", "e", "b"], "closed jobs never stall");
});

test("job dashboard: the place line is city, state and postal code, falling back to the street, then to nothing", async () => {
  const { placeLine } = await import("./screens/jobs.ts");
  assert.equal(placeLine({ line1: "1200 S Main St", city: "Crowley", state: "TX", postal: "76036" }), "Crowley, TX 76036");
  assert.equal(placeLine({ city: "Crowley" }), "Crowley");
  assert.equal(placeLine({ line1: "1200 S Main St" }), "1200 S Main St");
  assert.equal(placeLine({}), null);
  assert.equal(placeLine(null), null);
});

test("job dashboard: the waiting-on-customer filter holds the quote and hold states, and 'all open' carries them too", async () => {
  const { stalling } = await import("./screens/jobs.ts");
  const now = Date.parse("2026-10-21T00:00:00Z");
  const job = (id: string, state: string, days: number) => ({ id, state, openedAt: new Date(now - 400 * 86_400_000).toISOString(), stateChangedAt: new Date(now - days * 86_400_000).toISOString() }) as unknown as JobWire;
  const jobs = [job("q", "quote_requested", 4), job("s", "quote_submitted", 11), job("h", "awaiting_customer", 2), job("c", "created", 30), job("i", "invoiced", 90)];
  assert.deepEqual(stalling(jobs, "customer", now).map((j) => j.id), ["s", "q", "h"]);
  assert.deepEqual(stalling(jobs, "open", now).map((j) => j.id), ["c", "s", "q", "h"]);
});

test("job dashboard: the invoice blockers are needs-action, and each has its own filter", async () => {
  const { stalling } = await import("./screens/jobs.ts");
  const now = Date.parse("2026-10-21T00:00:00Z");
  const job = (id: string, state: string, days: number) => ({ id, state, openedAt: new Date(now - 400 * 86_400_000).toISOString(), stateChangedAt: new Date(now - days * 86_400_000).toISOString() }) as unknown as JobWire;
  const jobs = [job("p", "needs_pricing", 22), job("o", "awaiting_po", 24), job("t", "invoice_trouble", 13), job("x", "awaiting_pictures", 5), job("v", "invoiced", 60)];
  assert.deepEqual(stalling(jobs, "action", now).map((j) => j.id), ["o", "p", "t", "x"], "a kicked-back invoice is ours to fix; a clean one is closed");
  assert.deepEqual(stalling(jobs, "Trouble invoicing", now).map((j) => j.id), ["t"]);
  assert.deepEqual(stalling(jobs, "Waiting on a PO", now).map((j) => j.id), ["o"]);
});

test("job dashboard: the return-trip filter holds flagged open jobs only — a flag on closed work is history, not a truck to roll", async () => {
  const { stalling } = await import("./screens/jobs.ts");
  const now = Date.parse("2026-10-21T00:00:00Z");
  const job = (id: string, state: string, returnTrip: boolean, days: number) => ({ id, state, returnTrip, openedAt: new Date(now - 400 * 86_400_000).toISOString(), stateChangedAt: new Date(now - days * 86_400_000).toISOString() }) as unknown as JobWire;
  const jobs = [job("a", "reopened", true, 41), job("b", "awaiting_parts", true, 36), job("c", "assigned", false, 50), job("d", "invoiced", true, 90)];
  assert.deepEqual(stalling(jobs, "returnTrip", now).map((j) => j.id), ["a", "b"]);
});

test("job detail: a visit is the crews on site one day — photos and notes land in the visit under way when they were made, earlier ones are the office's", async () => {
  const { groupVisits } = await import("./screens/detail.ts");
  const v = (id: string, crew: string, start: string, end: string) => ({ id, crewId: crew, crewLabel: crew, assignedAt: start, releasedAt: end, workStart: start, workEnd: end });
  const groups = groupVisits({
    visits: [v("a2", "Brian Martinez", "2026-03-31T14:00:00.000Z", "2026-03-31T19:00:00.000Z"), v("a1", "Johnny Fontez", "2026-03-31T15:00:00.000Z", "2026-03-31T18:00:00.000Z"), v("a3", "Herberto Vega", "2026-04-07T15:00:00.000Z", "2026-04-07T17:00:00.000Z")],
    media: [{ id: "m1", kind: "photo", storageKey: "k/IMG_1.jpg", label: "Coil", capturedAt: "2026-03-31T16:00:00.000Z" }, { id: "m2", kind: "photo", storageKey: "k/IMG_2.jpg", label: null, capturedAt: "2026-04-07T16:00:00.000Z" }],
    notes: [
      { id: "n0", body: "quoted on the phone", kind: "note", at: "2026-03-30T12:00:00.000Z", authorName: "Dana" },
      { id: "n1", body: "filter changed", kind: "note", at: "2026-03-31T18:00:00.000Z", authorName: null },
      { id: "s1", body: "bring the ladder", kind: "standing", at: "2026-04-01T12:00:00.000Z", authorName: "Dana" },
    ],
  });
  assert.deepEqual(groups.map((g) => g.kind), ["office", "visit", "visit"]);
  assert.deepEqual(groups[1]!.crews, ["Brian Martinez", "Johnny Fontez"], "two crews the same day are one visit");
  assert.equal(groups[1]!.end, "2026-03-31T19:00:00.000Z", "spanning both");
  assert.deepEqual(groups[1]!.media.map((m) => m.id), ["m1"]);
  assert.deepEqual(groups[1]!.notes.map((n) => n.id), ["n1"], "a standing note is the header's, not a visit's");
  assert.deepEqual(groups[0]!.notes.map((n) => n.id), ["n0"], "before the first visit is the office's");
  assert.deepEqual(groups[2]!.media.map((m) => m.id), ["m2"]);
});

test("job detail: the next visit is scheduled only while nobody holds the job and the work is still ahead", async () => {
  const { scheduledNext } = await import("./screens/detail.ts");
  const now = Date.parse("2026-10-21T00:00:00Z");
  const job = (state: string, crew: string | null, end: string) => ({ state, currentCrewId: crew, serviceWindowEnd: end }) as unknown as JobWire;
  assert.equal(scheduledNext(job("created", null, "2026-11-01T00:00:00Z"), now), true);
  assert.equal(scheduledNext(job("assigned", "crew-1", "2026-11-01T00:00:00Z"), now), false, "a crew holds it — that is a visit");
  assert.equal(scheduledNext(job("created", null, "2026-10-01T00:00:00Z"), now), false, "the window has passed");
  assert.equal(scheduledNext(job("needs_pricing", null, "2026-11-01T00:00:00Z"), now), false, "the work is done");
});

test("manager dashboard: the team narrows by title and by any part of a name, case-blind", async () => {
  const { teamRows, titleOf } = await import("./screens/manager.ts");
  const person = (name: string, roles: string[]) => ({ userId: name, name, roles, branch: "South", onJob: false, hoursThisWeek: null, credential: null });
  const team = [person("Dylan Lemons", ["principal"]), person("Herberto Vega", ["technician"]), person("Rachel Ortiz", ["dispatcher", "technician"])];
  assert.equal(titleOf(["technician", "dispatcher"]), "Dispatcher", "a title is the most senior role, in ROLES order");
  assert.equal(teamRows(team, "", null).length, 3);
  assert.deepEqual(teamRows(team, "", "Technician").map((p) => p.name), ["Herberto Vega"]);
  assert.deepEqual(teamRows(team, "  VEGA ", null).map((p) => p.name), ["Herberto Vega"]);
  assert.equal(teamRows(team, "vega", "Dispatcher").length, 0);
});

test("manager dashboard: attention lists only what is non-zero, and the goal tiles are states only against their goal", async () => {
  const { attention, figures } = await import("./screens/manager.ts");
  const { previewManagerOverview } = await import("./preview-manager.ts");
  const o = previewManagerOverview();
  assert.deepEqual(attention(o).map((a) => a.word), ["Costing money", "Urgent", "Soon", "Soon"]);
  assert.match(attention(o)[0]!.sub, /^57 need pricing, 20 were kicked back, 5 are ready to send\.$/);
  const quiet = { ...o, unbilled: { complete: 0, needsPricing: 0, awaitingPo: 0, awaitingPictures: 0, invoiceTrouble: 0 }, urgentUnassigned: [], credentials: { expired: 0, expiring: 0 }, nearOvertime: 0 };
  assert.deepEqual(attention(quiet), []);
  const tiles = Object.fromEntries(figures(o).map((t) => [t.label, t]));
  assert.equal(tiles["Request to scheduled"]!.tone, "ok");
  assert.equal(tiles["Finished to invoiced"]!.tone, "breached");
  assert.equal(tiles["Jobs completed"]!.tone, undefined, "a plain count stays ink");
  assert.equal(tiles["Billed this month"]!.n, "$184,200");
  const none = figures({ ...o, waits: o.waits.map((w) => ({ ...w, avgDays: null, jobs: 0 })), completed: { now: 0, prior: 0 } });
  assert.equal(none.find((t) => t.label === "Finished to invoiced")!.n, "—");
  assert.equal(none.find((t) => t.label === "Fixed on first visit")!.n, "—");
});

test("a dispatcher's header carries no Manager tab — the gateway would refuse what it opens", async () => {
  const { app } = await ready();
  app.router.navigate("board", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, />Job Dashboard</);
  assert.doesNotMatch(out, />Manager</);
});

// ---- Intake: what customers asked for in S6, as the region's dispatcher reads it ----
const REQ_ROUTINE = "5e000001-0000-4000-8000-000000000001", REQ_EMERGENCY = "5e000002-0000-4000-8000-000000000002", REQ_OPENED = "5e000003-0000-4000-8000-000000000003";
const PHOTO_A = U(40), PHOTO_B = U(41);
const req = (id: string, priority: ServiceRequestWire["priority"], createdAt: string, extra: Partial<ServiceRequestWire> = {}): ServiceRequestWire => ({
  id, siteId: SITE, siteName: "Austin — Roof", priority, description: `Request ${id.slice(0, 8)}`, requestedBy: "u-cust", createdAt,
  jobId: null, jobState: null, orgId: ORG, regionId: SOUTH, customerSegment: "commercial", photos: [], waitingOnTerm: null, ...extra,
});
const REQUESTS: ServiceRequestWire[] = [
  req(REQ_ROUTINE, "routine", "2026-09-17T11:00:00.000Z", { siteName: "Home", customerSegment: "residential" }),
  req(REQ_OPENED, "emergency", "2026-09-17T12:30:00.000Z", { jobId: JOB_CREATED, jobState: "created" }),
  req(REQ_EMERGENCY, "emergency", "2026-09-17T10:00:00.000Z", { description: "Water through the ceiling under RTU-2.", photos: [{ id: PHOTO_A, contentType: "image/jpeg", bytes: 2048 }, { id: PHOTO_B, contentType: "image/png", bytes: 1024 }] }),
];

test("INTAKE: a request waiting on a missing term says Waiting on Contracts and offers no Open job — the office cannot set the term", async () => {
  const { app } = await ready({
    [OPERATIONS["serviceRequests.list"].path]: { status: 200, body: { requests: [req(REQ_ROUTINE, "routine", "2026-10-22T10:00:00.000Z", { waitingOnTerm: "sla_response" }), REQUESTS[2]] } },
  });
  app.router.navigate("intake", {});
  render(app.view()); await settle(); await settle();
  const out = render(app.view());
  assert.match(out, /Waiting on Contracts/);
  assert.match(out, /No response time on the agreement/);
  assert.doesNotMatch(out, new RegExp(`id="open-${REQ_ROUTINE}"`), "no button that can only be refused");
  assert.match(out, new RegExp(`id="open-${REQ_EMERGENCY}"`), "a request whose agreement is complete still opens");
});

test("intakeRows: waiting before opened, then the customer's declared priority, then newest; 'waiting' drops what already has a job", () => {
  assert.deepEqual(intakeRows(REQUESTS, "all").map((r) => r.id), [REQ_EMERGENCY, REQ_ROUTINE, REQ_OPENED]);
  assert.deepEqual(intakeRows(REQUESTS, "waiting").map((r) => r.id), [REQ_EMERGENCY, REQ_ROUTINE]);
  const now = Date.parse("2026-09-17T12:00:00Z");
  assert.equal(age("2026-09-17T11:48:00Z", now), "12m");
  assert.equal(age("2026-09-17T09:00:00Z", now), "3h");
  assert.equal(age("2026-09-15T11:00:00Z", now), "2d");
});

test("INTAKE: the tab is in the header; requests read from serviceRequests.list, the photos through media.get, under the customer's own reference", async () => {
  const { app, gateway } = await ready({
    [OPERATIONS["serviceRequests.list"].path]: { status: 200, body: { requests: REQUESTS } },
    [OPERATIONS["media.get"].path]: (init) => ({ status: 200, body: { id: "x", contentType: "image/png", image: `data:image/png;base64,${init ? "QQ==" : ""}` } }),
  });
  assert.match(render(app.view()), />Intake<\/a>/, "a tab, beside the board");
  app.router.navigate("intake", {});
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, /id="intake-stats"/);
  assert.match(out, /5E000002/, "the reference the customer was given (shortRef)");
  assert.match(out, /Water through the ceiling under RTU-2\./);
  assert.match(out, /data-status="breached"[^]*?Emergency/, "a declared emergency takes the state ramp");
  assert.match(out, /Waiting — no job yet/);
  assert.match(out, /<strong>Home<\/strong><span class="s3-flag" data-segment="residential">Residential<\/span>/, "a homeowner is marked, so a dispatcher tells a house from a building");
  assert.equal((out.match(/data-segment="residential"/g) ?? []).length, 1, "commercial carries no mark");
  assert.doesNotMatch(out, /5E000003/, "Waiting hides a request a job already answers");
  assert.ok(gateway.calls.filter((c) => c.path === OPERATIONS["media.get"].path).length >= 2, "each thumbnail read through the gateway");
  assert.match(out, /aria-label="Open Photo 1 of 2, request 5E000002"/);

  // All shows the answered one too, linked to its job
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.children === "All")!.props!.onClick as () => void)();
  out = render(app.view());
  assert.match(out, /Job opened · Unassigned/);
  assert.match(out, new RegExp(`href="[^"]*/jobs/${JOB_CREATED}"`));

  // a thumbnail opens the viewer; Close puts it away
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.["aria-label"] === "Open Photo 2 of 2, request 5E000002")!.props!.onClick as () => void)();
  await settle();
  out = render(app.view());
  assert.match(out, /id="intake-viewer"/);
  assert.match(out, /photo <span class="s3-num">2<\/span> of <span class="s3-num">2<\/span>/);
  assert.match(out, /alt="Photo 2 of 2 sent with request 5E000002 at Austin — Roof"/);
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.id === "intake-viewer-close")!.props!.onClick as () => void)();
  assert.doesNotMatch(render(app.view()), /id="intake-viewer"/);
});

test("defaultWindow: the morning of the date the customer asked for, else the next whole hour — four hours", () => {
  const now = new Date(2026, 9, 21, 14, 35);
  assert.deepEqual(defaultWindow("No cooling — closet.\nPreferred date: 2026-10-23.", now), { start: "2026-10-23T08:00", end: "2026-10-23T12:00" });
  assert.deepEqual(defaultWindow("No date given.", now), { start: "2026-10-21T15:00", end: "2026-10-21T19:00" });
});

test("INTAKE: Open job on a waiting request opens the form beside the list, priority as the customer declared; an answered request offers no button", async () => {
  const { app } = await ready({
    [OPERATIONS["serviceRequests.list"].path]: { status: 200, body: { requests: [...REQUESTS.slice(0, 2), { ...REQUESTS[2]!, description: "Water through the ceiling.\nPreferred date: 2026-10-23." }] } },
    [OPERATIONS["media.get"].path]: { status: 200, body: { id: "x", contentType: "image/png", image: "data:image/png;base64,QQ==" } },
  });
  app.router.navigate("intake", {});
  render(app.view()); await settle(); await settle();
  let out = render(app.view());
  assert.match(out, new RegExp(`id="open-${REQ_EMERGENCY}"[^>]*>Open job<`));
  assert.doesNotMatch(out, new RegExp(`id="open-${REQ_OPENED}"`), "a request already answered is not answered twice");
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.id === `open-${REQ_EMERGENCY}`)!.props!.onClick as () => void)();
  out = render(app.view());
  assert.match(out, /id="intake-open-form"/);
  assert.match(out, /Open a job — 5E000002/);
  assert.match(out, /<option value="emergency" selected[^>]*>Emergency — as the customer declared</);
  assert.match(out, /id="intake-start"[^>]*value="2026-10-23T08:00"|value="2026-10-23T08:00"[^>]*id="intake-start"/, "the window starts on the day they asked for");
  assert.match(out, /derived when the job opens, not chosen here/);
  (nodesIn(app.view()).find((n) => n.type === "button" && n.props?.id === "intake-open-cancel")!.props!.onClick as () => void)();
  assert.doesNotMatch(render(app.view()), /id="intake-open-form"/);
});
