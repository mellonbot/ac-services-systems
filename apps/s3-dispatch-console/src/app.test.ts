import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { slaStatus, isReleasable, isDispatchable } from "./screens/board.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, JobWire, HierarchyContext, CandidateCrewWire } from "../../../packages/contracts/src/index.ts";
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
  id: JOB_CREATED, siteId: SITE, siteName: "Austin — Roof", contractId: null, projectId: null, serviceCode: "hvac_repair", priority: "urgent", state: "created",
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T17:00:00.000Z", version: 1, openedAt: "2026-09-17T12:00:00.000Z",
  regionId: SOUTH, orgId: ORG, currentCrewId: null, currentCrewLabel: null, currentAssignmentId: null,
  slaDueAt: "2026-09-17T16:00:00.000Z", slaEscalationStage: 1, slaSatisfiedAt: null,
};
const jobAssigned: JobWire = {
  ...jobCreated, id: JOB_ASSIGNED, state: "assigned", currentCrewId: CREW_A, currentCrewLabel: "Crew A1", currentAssignmentId: ASSIGNMENT,
  slaEscalationStage: 0, slaSatisfiedAt: "2026-09-17T13:00:00.000Z",
};
const CANDIDATES: CandidateCrewWire[] = [
  { crewId: CREW_A, label: "Crew A1", employmentType: "employed", cleared: true, refusal: null },
  { crewId: CREW_B, label: "Crew B1", employmentType: "subcontracted", cleared: false, refusal: { reason: "expired_in_window", credentialKind: "insurance", detail: "insurance covers through 2026-06-01, before the service window ends" } },
];

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
    if (path === OPERATIONS["dispatch.candidates"].path) return reply(200, { jobId: JOB_CREATED, candidates: CANDIDATES });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const ready = async (overrides?: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>>) => {
  const g = fakeGateway(overrides);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000 });
  await app.login("dispatcher@ac.test", "pw");
  return { app, gateway: g };
};

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
  const out = render(app.view());
  assert.match(out, /hvac_repair/);
  assert.match(out, /Unassigned/);
  assert.match(out, /Crew A1/);
  assert.match(out, new RegExp(`href="/dispatch/${JOB_CREATED}"`));
  assert.match(out, new RegExp(`id="release-${JOB_ASSIGNED}"`));
  assert.doesNotMatch(out, new RegExp(`id="release-${JOB_CREATED}"`), "an unassigned job offers no release");
  assert.doesNotMatch(out, new RegExp(`href="/dispatch/${JOB_ASSIGNED}"`), "an already-assigned job offers no dispatch link");
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
  assert.match(out, new RegExp(`id="assign-${CREW_A}"`));
  assert.doesNotMatch(out, new RegExp(`id="assign-${CREW_B}"`), "an uncleared crew has no Assign button — there is no override path here or at the gateway");
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
  assert.match(out, /Gateway unreachable — Board freezes/);
  assert.match(out, /Crew A1/, "the last server state is still on screen");
});
