import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { readiness, money } from "./screens/common.ts";
import { STATE_WORD, isOpen } from "./screens/work.ts";
import { thousandths, resetStatementForm } from "./screens/statements.ts";
import { resetRosterForm } from "./screens/crews.ts";
import { resetDocumentForm } from "./screens/documents.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { Principal, JobWire, HierarchyContext, FirmWire, CrewWire, CredentialWire, SettlementWire, SettlementLineWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * S8 against a scripted gateway, through the REAL shell and the REAL
 * generated client — only `fetch` is faked. What this holds: the portal
 * renders whatever rows the gateway returned and adds no filter of its own;
 * the roster reads the gate's summary in the firm's words; the document
 * form sends no verified field; the work list carries the firm's own crew
 * and the site it was sent to; a statement's two writes post the position
 * and nothing else, and a refusal is the heading and the gateway's words.
 * Whether the gateway returns the right rows is 0005's and 0007's, held in
 * test/integration/s8.test.ts.
 */
const U = (n: number) => `e8000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(1), FIRM = U(2), COORD = U(3), CREW_A = U(4), CREW_B = U(5), CREW_OLD = U(6), SITE = U(7), JOB = U(8), COI = U(9), LIC = U(10), STMT = U(11), STMT_OK = U(12), LINE = U(13), RATE = U(14);

const coordinator: Principal = {
  namespace: "subcontractor", subjectId: COORD, orgId: FIRM, regionId: SOUTH, scopeTier: "parent", scopeId: FIRM,
  roles: [], firmId: FIRM, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-8",
};
const context: HierarchyContext = {
  principal: coordinator,
  path: [{ tier: "parent", id: FIRM, name: "Firm A LLC" }],
  parent: { tier: "parent", id: FIRM, name: "Firm A LLC", regionId: null, customerGroup: null },
  regions: [], activeRegionId: SOUTH,
};
const firm: FirmWire = {
  id: FIRM, legalName: "Firm A LLC", status: "active", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-01-05",
  diagnosticDataRightsReserved: true, w9DocumentKey: "docs/w9.pdf", crewCount: 3, activeCrewCount: 2,
};
const crew = (id: string, label: string, docs: Partial<CrewWire["documents"]>, active = true): CrewWire => ({
  id, label, employmentType: "subcontracted", firmId: FIRM, homeRegionId: SOUTH, active,
  documents: { required: ["insurance", "license", "background_check"], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null, ...docs },
});
const crewReady = crew(CREW_A, "Crew A1", { satisfied: ["insurance", "license", "background_check"], earliestExpiry: "2027-01-01" });
const crewWaiting = crew(CREW_B, "Crew A2", { satisfied: ["insurance", "background_check"], unverified: ["license"] });
const crewRetired = crew(CREW_OLD, "Crew A0", { missing: ["insurance", "license", "background_check"] }, false);
const coi: CredentialWire = { id: COI, crewId: CREW_B, kind: "insurance", identifier: "COI-2026-A2", validFrom: "2026-01-01", validTo: "2026-12-31", documentKey: null, verifiedAt: "2026-02-01T00:00:00.000Z", verifiedBy: U(90) };
const lic: CredentialWire = { id: LIC, crewId: CREW_B, kind: "license", identifier: "TX-LIC-4471", validFrom: "2026-01-01", validTo: "2027-06-30", documentKey: "docs/lic.pdf", verifiedAt: null, verifiedBy: null };
const job: JobWire = {
  id: JOB, siteId: SITE, siteName: "Austin — Roof", contractId: null, projectId: null, serviceCode: "HVAC-REPAIR", priority: "urgent", state: "on_site",
  serviceWindowStart: "2026-09-18T09:00:00.000Z", serviceWindowEnd: "2026-09-18T13:00:00.000Z", version: 4, openedAt: "2026-09-17T12:00:00.000Z",
  regionId: SOUTH, orgId: U(80), currentCrewId: CREW_A, currentCrewLabel: "Crew A1", currentAssignmentId: U(81),
  slaDueAt: "2026-09-17T16:00:00.000Z", slaEscalationStage: 0, slaSatisfiedAt: "2026-09-17T13:00:00.000Z",
};
const stmt: SettlementWire = {
  id: STMT, firmId: FIRM, regionId: SOUTH, periodFrom: "2026-08-01", periodTo: "2026-08-31", totalMinor: "1250000", currency: "USD", state: "issued",
  issuedAt: "2026-09-02T09:00:00.000Z", acknowledgedAt: null, disputedAt: null, disputeReason: null, lineCount: 1,
};
const stmtOk: SettlementWire = { ...stmt, id: STMT_OK, periodFrom: "2026-07-01", periodTo: "2026-07-31", totalMinor: "98000", state: "acknowledged", acknowledgedAt: "2026-08-05T10:00:00.000Z" };
const line: SettlementLineWire = { id: LINE, settlementId: STMT, jobId: JOB, serviceCode: "HVAC-REPAIR", siteName: "Austin — Roof", rateCardId: RATE, rateMinor: "9500", quantityMilli: "4500", amountMinor: "42750" };

type Reply = { status: number; body: unknown };
const fakeGateway = (overrides: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>> = {}) => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    const o = overrides[path];
    if (o) return typeof o === "function" ? reply(o(init).status, o(init).body) : reply(o.status, o.body);
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "never-held", expiresAt: "2026-09-19T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    if (path === OPERATIONS["auth.logout"].path) { session = false; return reply(200, { ok: true, sessionId: "sess-8" }); }
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: [firm] });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews: [crewReady, crewWaiting, crewRetired] });
    if (path === OPERATIONS["credentials.list"].path) return reply(200, { credentials: [coi, lic] });
    if (path === OPERATIONS["jobs.list"].path) return reply(200, { jobs: [job] });
    if (path === OPERATIONS["settlements.list"].path) return reply(200, { settlements: [stmt, stmtOk] });
    if (path === OPERATIONS["settlements.lines"].path) return reply(200, { settlementId: STMT, lines: [line] });
    if (path === OPERATIONS["crews.enroll"].path) return reply(200, { id: U(99), firmId: FIRM, regionId: SOUTH, eventId: U(98) });
    if (path === OPERATIONS["crews.retire"].path) return reply(200, { id: CREW_B, eventId: U(97) });
    if (path === OPERATIONS["credentials.submit"].path) return reply(200, { id: U(96), crewId: CREW_B, eventId: U(95) });
    if (path === OPERATIONS["settlements.acknowledge"].path) return reply(200, { id: STMT, state: "acknowledged", acknowledgedAt: "2026-09-18T15:00:00.000Z", eventId: U(94) });
    if (path === OPERATIONS["settlements.dispute"].path) return reply(200, { id: STMT, state: "disputed", disputedAt: "2026-09-18T15:00:00.000Z", eventId: U(93) });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

const ready = async (overrides?: Partial<Record<string, Reply | ((init: Parameters<FetchLike>[1]) => Reply)>>) => {
  const g = fakeGateway(overrides);
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch, now: () => 1_000 });
  await app.login("coord@firma.test", "pw");
  render(app.view()); await settle();
  return { app, gateway: g };
};
const shellOf = (app: Awaited<ReturnType<typeof ready>>["app"]) => { const p = app.phase.value; assert.equal(p.kind, "ready"); if (p.kind !== "ready") throw new Error("not ready"); return p.shell; };

test("SCREENS and SCREEN_VIEWS agree: every screen but login has a view, and every view is a registered screen", () => {
  const ids = Object.keys(SCREENS).filter((k) => k !== "login").sort();
  assert.deepEqual(Object.keys(SCREEN_VIEWS).sort(), ids);
});

test("boot with no session lands on the login form; a refused login renders the heading and the gateway's words, not the console card", async () => {
  const g = fakeGateway({ [OPERATIONS["auth.login"].path]: { status: 401, body: { error: "AuthError", code: "bad_claims", message: "invalid credentials" } } });
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch });
  await app.boot();
  let out = render(app.view());
  assert.match(out, /id="login-form"/);
  assert.match(out, /Subcontractor Portal/);
  await app.login("coord@firma.test", "wrong");
  out = render(app.view());
  assert.match(out, /invalid credentials/);
  assert.doesNotMatch(out, /ac-refusal/, "RefusalCard is console-only; the firm sees the words");
});

test("YOUR FIRM: the one row the gateway returned, the ladder in words, and the roster counted as the gate would count it", async () => {
  const { app } = await ready();
  const out = render(app.view());
  assert.match(out, /Firm A LLC/);
  assert.match(out, /Active/);
  assert.match(out, /Signed 2026-01-05/);
  assert.match(out, /30 days from statement/);
  assert.match(out, /Rights reserved to Rankine under the MSA/);
  assert.match(out, /<strong>2<\/strong><span>on the roster/, "the retired crew is not on the roster");
  assert.match(out, /1 ready to dispatch,/);
  assert.match(out, /1 awaiting verification,/);
  assert.match(out, /0 missing or expired/);
  assert.match(out, /<strong>1<\/strong><span>open job/);
  assert.match(out, /<strong>1<\/strong><span>statement waiting for your acknowledgement — 12,500\.00 USD/);
  assert.doesNotMatch(out, /Firm B/, "the portal adds no rows the gateway withheld");
});

test("CREWS: readiness in the firm's words from the gateway's summary; Retire only on active crews; the enroll form takes a label and nothing else", async () => {
  const { app, gateway } = await ready();
  resetRosterForm();
  app.router.navigate("crews", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Ready to dispatch/);
  assert.match(out, /Awaiting Rankine/);
  assert.match(out, /licence filed, not yet verified/);
  assert.match(out, /Retired/);
  assert.equal((out.match(/data-retire=/g) ?? []).length, 2, "two active crews, two Retire controls");
  assert.match(out, /id="enroll-form"/);
  assert.match(out, /name="label"/);
  assert.doesNotMatch(out, /name="firmId"|name="employmentType"|name="homeRegionId"/, "firm, type and region are the principal's — not typed here");
  assert.equal(readiness(crewRetired).word, "Retired");
  assert.equal(readiness(crew(U(50), "x", { missing: ["insurance"] })).detail, "No insurance on file");
  assert.equal(readiness(crew(U(51), "x", { expired: ["license"] })).status, "blocked");
  // The write, through the real client: x-ac-surface: S8, a body of one field.
  await shellOf(app).gateway.enrollCrew({ label: "Crew A3" });
  const call = gateway.calls.find((c) => c.path === OPERATIONS["crews.enroll"].path)!;
  assert.deepEqual(JSON.parse(String(call.init?.body)), { label: "Crew A3" });
  assert.equal((call.init?.headers as Record<string, string>)["x-ac-surface"], "S8");
});

test("CREWS: a suspended firm's roster is closed — no enroll form, the reason in words", async () => {
  const { app } = await ready({ [OPERATIONS["firms.list"].path]: { status: 200, body: { firms: [{ ...firm, status: "suspended" }] } } });
  app.router.navigate("crews", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /id="enroll-closed"/);
  assert.match(out, /lifts the suspension/);
  assert.doesNotMatch(out, /id="enroll-form"/);
});

test("DOCUMENTS: the crew's documents, an unverified one AS unverified, the gate's requirement stated; the form sends no verified field", async () => {
  const { app, gateway } = await ready();
  resetDocumentForm();
  app.router.navigate("documents", { crewId: CREW_B });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Crew A2 — documents/);
  assert.match(out, /The gate requires: insurance, licence, background check\./);
  assert.match(out, /COI-2026-A2/);
  assert.match(out, /Verified/);
  assert.match(out, /TX-LIC-4471/);
  assert.match(out, /Awaiting Rankine/);
  assert.match(out, /id="document-form"/);
  assert.doesNotMatch(out, /name="verified/, "there is no verified field to send");
  await shellOf(app).gateway.submitCredential({ crewId: CREW_B, kind: "background_check", identifier: "BG-2026-09", validFrom: "2026-09-01", validTo: "2027-09-01" });
  const call = gateway.calls.find((c) => c.path === OPERATIONS["credentials.submit"].path)!;
  const body = JSON.parse(String(call.init?.body));
  assert.equal(body.kind, "background_check");
  assert.equal("verifiedAt" in body, false);
  assert.equal(call.path, "/s8/network/credentials", "S8's own door, not S2's /s2/network/credentials");
});

test("WORK: the firm's own crew on the row, the site it was sent to, the state in the firm's words, the SLA pill from the dispatcher's numbers", async () => {
  const { app } = await ready();
  app.router.navigate("work", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Austin — Roof/);
  assert.match(out, /Crew A1/);
  assert.match(out, /Your crew on site/);
  assert.doesNotMatch(out, /on_site/);
  assert.match(out, /Responded/);
  assert.equal(STATE_WORD.assigned, "Assigned to you");
  assert.equal(isOpen({ state: "invoiced" }), false);
});

test("STATEMENTS: money as digits formatted, the state from the firm's side, and Open per row", async () => {
  const { app } = await ready();
  app.router.navigate("statements", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /2026-08-01 → 2026-08-31/);
  assert.match(out, /12,500\.00 USD/);
  assert.match(out, /Waiting on you/);
  assert.match(out, /Acknowledged/);
  assert.equal((out.match(/>Open</g) ?? []).length, 2);
  assert.equal(money("5", "USD"), "0.05 USD");
  assert.equal(money("-123456", "USD"), "−1,234.56 USD");
  assert.equal(thousandths("4500"), "4.5");
  assert.equal(thousandths("1000"), "1");
  assert.equal(thousandths("250"), "0.25");
});

test("STATEMENT: the lines with the rate and the quantity; an issued statement offers both positions; an acknowledged one offers dispute alone; the writes post the position and the reason", async () => {
  const { app, gateway } = await ready();
  resetStatementForm();
  app.router.navigate("statement", { settlementId: STMT });
  render(app.view()); await settle();
  let out = render(app.view());
  assert.match(out, /Statement 2026-08-01 → 2026-08-31/);
  assert.match(out, /id="statement-total">12,500\.00 USD/);
  assert.match(out, /95\.00 USD/, "the rate applied");
  assert.match(out, /4\.5/, "the quantity in thousandths, formatted");
  assert.match(out, /427\.50 USD/);
  assert.match(out, /id="acknowledge-form"/);
  assert.match(out, /id="dispute-form"/);
  await shellOf(app).gateway.acknowledgeSettlement({ settlementId: STMT });
  await shellOf(app).gateway.disputeSettlement({ settlementId: STMT, reason: "Line 1 bills 4.5h; the ticket shows 4h." });
  const ack = gateway.calls.find((c) => c.path === OPERATIONS["settlements.acknowledge"].path)!;
  assert.deepEqual(JSON.parse(String(ack.init?.body)), { settlementId: STMT });
  const dis = gateway.calls.find((c) => c.path === OPERATIONS["settlements.dispute"].path)!;
  assert.equal(JSON.parse(String(dis.init?.body)).reason, "Line 1 bills 4.5h; the ticket shows 4h.");

  app.router.navigate("statement", { settlementId: STMT_OK });
  render(app.view()); await settle();
  out = render(app.view());
  assert.doesNotMatch(out, /id="acknowledge-form"/, "already acknowledged");
  assert.match(out, /id="dispute-form"/, "a wrong line can still be disputed");
  assert.match(out, /acknowledged/);
});

test("degraded: every write is refused with the surface's declared reason — there is no queue", async () => {
  const { app } = await ready();
  resetStatementForm();
  app.router.navigate("statement", { settlementId: STMT });
  render(app.view()); await settle();
  app.degraded.value = true;
  const out = render(app.view());
  assert.match(out, /aria-disabled="true"/);
  assert.match(out, /acknowledges on receipt, not on processing/);
});

test("a refused read renders the heading, the message and a retry route; sign out returns to login", async () => {
  const { app } = await ready({ [OPERATIONS["settlements.list"].path]: { status: 403, body: { error: "Forbidden", message: "settlements.list is not served to S8 for this principal" } } });
  app.router.navigate("statements", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Refused — not permitted for this principal/);
  assert.match(out, /settlements.list is not served/);
  assert.match(out, /Try again/);
  await app.logout();
  assert.match(render(app.view()), /id="login-form"/);
});
