/**
 * ITEM 4 OVER THE WIRE — S3 dispatch and S5 field, through the shell, against
 * a spawned gateway and a live PostgreSQL. The proof claude/19 named as
 * outstanding: "a mechanism is unexecuted until something actually runs it."
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The sentence this suite holds is S3's registry row, made into events on a
 * wire: "the compliance gate is enforced HERE, at assignment, with no override
 * path." Around it, the rest of item 4 as one closed loop: a job opened in S2
 * with its SLA due DERIVED from the site's resolved term; the dispatcher's dry
 * run and the gated door agreeing on the same crew, for the same reason; the
 * assignment satisfying the timer the cascade is timing; the release that is
 * refused by name once the field has moved; a device grant minting a token
 * that dies with the shift; the technician reading only their own board; and
 * the offline log replaying idempotently — device holds intent, server holds
 * truth.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — item 4 (S3/S5) was not verified over the wire";
if (!URL_) test("item 4 over the wire", { skip }, () => {});

const PORT = 22080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP_SOUTH = U(2), USER_DISP_WEST = U(3), USER_TECH = U(4), USER_TECH_B = U(5);
const PASSWORD = "correct horse battery staple";
const RUN = `d4-${Date.now().toString(36)}`;
const HARDWARE = `tablet-${RUN}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-item4-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d4@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.south.d4@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true),
           ($6,$2,$7,'internal','disp.west.d4@ac.test','West Dispatcher','["dispatcher"]','region',$7,$4,true),
           ($8,$2,$3,'internal','tech.d4@ac.test','Technician','["technician"]','region',$3,$4,true),
           ($9,$2,$3,'internal','tech.b.d4@ac.test','Other Technician','["technician"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true, crew_id = NULL`,
    [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP_SOUTH, USER_DISP_WEST, REGION_WEST, USER_TECH, USER_TECH_B]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  gateway.stdout!.on("data", (d) => { log += String(d); });
  gateway.stderr!.on("data", (d) => { log += String(d); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${PORT}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(async () => {
  gateway?.kill("SIGTERM");
  await pool?.end();
});

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d4@ac.test", password: PASSWORD } });
const southDispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.south.d4@ac.test", password: PASSWORD } });
const westDispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.west.d4@ac.test", password: PASSWORD } });
const technician = (hardwareId = HARDWARE, email = "tech.d4@ac.test") =>
  connectShell({ surfaceId: "S5", baseUrl: BASE, fetch, credentials: { hardwareId, email, password: PASSWORD } });
const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };
/** The refusal's code, where its kind carries one (admission, token); null otherwise. */
const code = (s: ConnectedShell, e: unknown): string | null => { const r = refusal(s, e); return "code" in r ? r.code : null; };

// A service window well inside the crew's credentials and the shift grant below: tomorrow, 09:00–13:00 UTC.
const tomorrow = new Date(Date.now() + 24 * 3600_000);
const WINDOW_START = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 9)).toISOString();
const WINDOW_END = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 13)).toISOString();

// Shared across the tests below, in order. node:test runs them serially.
let s2: ConnectedShell, s3: ConnectedShell;
let orgId = "", southNode = "", location = "", site = "", msa = "";
let crewCleared = "", crewLapsed = "", jobId = "", assignmentId = "", deviceId = "", shiftId = "";

test("a job opens against a site with its SLA due DERIVED from the resolved term — and a site with no term refuses the job", { skip }, async () => {
  s2 = await owner();
  const org = await s2.gateway.createOrganization({ name: `Amped D4 ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: `Amped D4 / South` } });
  orgId = org.orgId; southNode = org.regionNodeId;
  location = (await s2.gateway.createAccount({ orgId, tier: "location", parentId: southNode, name: `Austin ${RUN}` })).id;
  site = (await s2.gateway.createAccount({ orgId, tier: "site", parentId: location, name: `Austin — Roof ${RUN}` })).id;

  // No agreement yet: sla_response resolves to nothing, and the job is refused with the resolver's own reason.
  await assert.rejects(
    s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && /sla_response|no value/i.test(r.message); },
    "an SLA nobody agreed to is not one the system invents",
  );

  msa = (await s2.gateway.createContract({
    orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "msa", billingPath: "enterprise_sla",
    signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true,
  })).id;
  await s2.gateway.transitionContract({ contractId: msa, to: "active" });
  await s2.gateway.authorTermOverride({
    contractId: msa, scopeTier: "parent", scopeId: orgId, termKey: "sla_response", termValue: "4_hour",
    effectiveFrom: "2026-01-01", orgId, regionId: REGION_SOUTH,
  });

  // A location is not a site: work happens at the tier with no descendants.
  await assert.rejects(
    s2.gateway.createJob({ siteId: location, serviceCode: "HVAC-REPAIR", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END }),
    (e: unknown) => code(s2, e) === "not_a_site",
  );
  await assert.rejects(
    s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", serviceWindowStart: WINDOW_END, serviceWindowEnd: WINDOW_START }),
    (e: unknown) => code(s2, e) === "bad_window",
  );

  const before = Date.now();
  const job = await s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END });
  jobId = job.id;
  assert.equal(job.regionId, REGION_SOUTH, "the job's region is the site's — derived, never typed");
  assert.equal(job.responseTerm, "4_hour");
  const due = Date.parse(job.dueAt);
  assert.ok(due >= before + 4 * 3600_000 - 5_000 && due <= Date.now() + 4 * 3600_000 + 5_000, `due_at is opened_at + 4h, got ${job.dueAt}`);
  const timer = (await admin(`SELECT response_term, satisfied_at, resolution_trace FROM sla_timers WHERE id = $1`, [job.slaTimerId]))[0]!;
  assert.equal(timer.response_term, "4_hour");
  assert.equal(timer.satisfied_at, null, "nothing has responded yet");
  assert.ok(Array.isArray(timer.resolution_trace) && timer.resolution_trace.length > 0, "the timer carries the trace that priced it");
  const topics = (await admin(`SELECT topic FROM outbox WHERE event_id IN ($1, (SELECT event_id FROM audit_log WHERE entity_id = $2 AND action = 'job.sla_timer.open'))`, [job.eventId, jobId])).map((r) => r.topic).sort();
  assert.deepEqual(topics, ["job.created", "sla.timer_opened"]);
});

test("the board: S2 sees the job org-wide, the South dispatcher sees it region-locked, the West dispatcher sees zero rows — not an error", { skip }, async () => {
  s3 = await southDispatcher();
  const west = await westDispatcher();
  const mine = (j: { id: string }) => j.id === jobId;
  assert.ok((await s2.gateway.listJobs({})).jobs.some(mine));
  const south = (await s3.gateway.listJobs({})).jobs.find(mine)!;
  assert.ok(south, "the South dispatcher's board carries the South job");
  assert.equal(south.state, "created");
  assert.equal(south.currentCrewId, null);
  assert.equal(south.currentAssignmentId, null, "no open assignment — the id S3's release names is null exactly when the crew is");
  assert.ok(south.slaDueAt, "the board carries the timer");
  assert.equal((await west.gateway.listJobs({})).jobs.filter(mine).length, 0, "RLS: zero South rows on the West board, no error");
  assert.equal((await s3.gateway.listJobs({ state: "assigned,en_route" })).jobs.filter(mine).length, 0, "a state filter is honoured");
  await west.logout();
});

test("two crews, one with every document verified, one whose insurance lapses inside the window: the dry run and the gated door say the same thing for the same reason", { skip }, async () => {
  crewCleared = (await s2.gateway.createCrew({ label: `Crew Cleared ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
  crewLapsed = (await s2.gateway.createCrew({ label: `Crew Lapsed ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
  const record = async (crewId: string, kind: string, validTo: string) => {
    const c = await s2.gateway.recordCredential({ crewId, kind, identifier: `${kind} ${RUN}`, validFrom: "2026-01-01", validTo });
    await s2.gateway.verifyCredential({ credentialId: c.id });
  };
  await record(crewCleared, "license", "2027-12-31");
  await record(crewCleared, "background_check", "2027-12-31");
  // The lapsed crew's license expires YESTERDAY — the window is tomorrow, so it does not cover it.
  const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
  await record(crewLapsed, "license", yesterday);
  await record(crewLapsed, "background_check", "2027-12-31");

  const dry = await s3.gateway.candidateCrews({ jobId, orgId, regionId: REGION_SOUTH });
  const cleared = dry.candidates.find((c) => c.crewId === crewCleared)!;
  const lapsed = dry.candidates.find((c) => c.crewId === crewLapsed)!;
  assert.ok(cleared && lapsed, "every active crew in the job's region is a candidate");
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.refusal, null);
  assert.equal(lapsed.cleared, false);
  assert.equal(lapsed.refusal!.reason, "expired_in_window");
  assert.equal(lapsed.refusal!.credentialKind, "license");

  // THE ONE GATED DOOR, refused: nothing written, the refusal is an event (C9's only quality signal).
  const refused = await s3.gateway.assignCrew({ jobId, crewId: crewLapsed, orgId, regionId: REGION_SOUTH });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.refusal.reason, "expired_in_window", "the door refuses for the reason the dry run gave");
  assert.equal(refused.refusal.credentialKind, "license");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM assignments WHERE job_id = $1`, [jobId]))[0]!.n, 0, "nothing was written to assignments");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [refused.eventId]))[0]!.topic, "crew.compliance_refused");
  assert.equal((await admin(`SELECT state FROM jobs WHERE id = $1`, [jobId]))[0]!.state, "created");

  // A West dispatcher cannot walk through the South door — the job is not in scope, by RLS, before any gate runs.
  const west = await westDispatcher();
  await assert.rejects(
    west.gateway.assignCrew({ jobId, crewId: crewCleared, orgId, regionId: REGION_SOUTH }),
    (e: unknown) => code(west, e) === "unknown_job",
  );
  await west.logout();
});

test("the same door, admitted: an assignment citing its clearance, the job assigned, the SLA timer satisfied — the response the cascade was timing", { skip }, async () => {
  const out = await s3.gateway.assignCrew({ jobId, crewId: crewCleared, orgId, regionId: REGION_SOUTH });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assignmentId = out.assignmentId;
  const a = (await admin(`SELECT clearance_id, released_at FROM assignments WHERE id = $1`, [assignmentId]))[0]!;
  assert.equal(a.clearance_id, out.clearanceId, "the assignment cites the clearance that admitted it");
  assert.equal(a.released_at, null);
  const clearance = (await admin(`SELECT credential_ids FROM compliance_clearances WHERE id = $1`, [out.clearanceId]))[0]!;
  assert.equal((clearance.credential_ids as string[]).length, 2, "the clearance names the credentials it read");
  assert.equal((await admin(`SELECT state FROM jobs WHERE id = $1`, [jobId]))[0]!.state, "assigned");
  const timer = (await admin(`SELECT satisfied_at FROM sla_timers WHERE job_id = $1`, [jobId]))[0]!;
  assert.ok(timer.satisfied_at, "assignment satisfied the timer");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "job.assigned");

  const board = (await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!;
  assert.equal(board.state, "assigned");
  assert.equal(board.currentCrewId, crewCleared);
  assert.equal(board.currentAssignmentId, assignmentId, "the board carries the id release will name — the crew id cannot stand in for it");
  assert.ok(board.slaSatisfiedAt);
});

test("release before the field moves: the crew comes off, the job returns for re-dispatch, and a second release is refused by name", { skip }, async () => {
  const out = await s3.gateway.releaseAssignment({ assignmentId, orgId, regionId: REGION_SOUTH, reason: "crew requested elsewhere" });
  assert.equal(out.jobId, jobId);
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "job.reassigned");
  const a = (await admin(`SELECT released_at, release_reason FROM assignments WHERE id = $1`, [assignmentId]))[0]!;
  assert.ok(a.released_at);
  assert.equal(a.release_reason, "crew requested elsewhere");
  const board = (await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!;
  assert.equal(board.state, "created");
  assert.equal(board.currentAssignmentId, null, "released — nothing open to release again");
  await assert.rejects(
    s3.gateway.releaseAssignment({ assignmentId, orgId, regionId: REGION_SOUTH }),
    (e: unknown) => code(s3, e) === "already_released",
  );
  assert.ok((await admin(`SELECT satisfied_at FROM sla_timers WHERE job_id = $1`, [jobId]))[0]!.satisfied_at, "a release does not un-satisfy the response that already happened");

  // Re-dispatch, so the field half below has a job to work.
  const again = await s3.gateway.assignCrew({ jobId, crewId: crewCleared, orgId, regionId: REGION_SOUTH });
  assert.equal(again.ok, true);
  if (again.ok) assignmentId = again.assignmentId;
});

test("D-2a: a device, a grant for this crew and this technician over this window — and a technician not on the crew is refused", { skip }, async () => {
  await admin(`UPDATE users SET crew_id = $2 WHERE id = $1`, [USER_TECH, crewCleared]);
  await admin(`UPDATE users SET crew_id = $2 WHERE id = $1`, [USER_TECH_B, crewLapsed]);
  deviceId = (await s2.gateway.registerDevice({ hardwareId: HARDWARE, kind: "android_pilot", publicKey: Buffer.from("not-yet-checked").toString("base64"), regionId: REGION_SOUTH })).id;
  const listed = await s2.gateway.listDevices({});
  assert.ok(listed.devices.some((d) => d.id === deviceId && d.orgId === INTERNAL_ORG_ID && d.firmId === null), "ours — no firm");

  const shiftStart = new Date(Date.now() - 3600_000).toISOString();
  const shiftEnd = new Date(Date.now() + 36 * 3600_000).toISOString();
  await assert.rejects(
    s2.gateway.grantDeviceShift({ deviceId, crewId: crewCleared, technicianId: USER_TECH_B, windowStart: shiftStart, windowEnd: shiftEnd }),
    (e: unknown) => code(s2, e) === "not_crew_member",
    "a grant is a claim about who is holding the hardware — checked, not trusted",
  );
  shiftId = (await s2.gateway.grantDeviceShift({ deviceId, crewId: crewCleared, technicianId: USER_TECH, windowStart: shiftStart, windowEnd: shiftEnd })).id;
  await assert.rejects(
    s2.gateway.grantDeviceShift({ deviceId, crewId: crewCleared, technicianId: USER_TECH, windowStart: shiftStart, windowEnd: shiftEnd }),
    (e: unknown) => code(s2, e) === "grant_overlap",
    "one device, one live grant per window",
  );
  // The grant is S2's alone.
  await assert.rejects(
    s3.gateway.grantDeviceShift({ deviceId, crewId: crewCleared, technicianId: USER_TECH, windowStart: shiftStart, windowEnd: shiftEnd } as never),
    (e: unknown) => refusal(s3, e).kind === "scope",
  );
});

test("auth.deviceLogin: the token is the SHIFT's — it expires with the grant, carries no crew claim, and the crew travels on the login response instead", { skip }, async () => {
  // Unknown hardware, or a technician without a live grant on it, is one refusal: invalid credentials.
  await assert.rejects(technician(`nope-${RUN}`), (e: unknown) => (e as { refusal?: { kind: string } }).refusal?.kind === "token" || /invalid credentials/i.test(String(e)));
  await assert.rejects(technician(HARDWARE, "tech.b.d4@ac.test"), (e: unknown) => (e as { refusal?: { kind: string } }).refusal?.kind === "token" || /invalid credentials/i.test(String(e)));

  const s5 = await technician();
  assert.equal(s5.principal.namespace, "device");
  assert.equal(s5.principal.deviceId, deviceId);
  assert.equal(s5.principal.shiftId, shiftId);
  assert.equal(s5.principal.regionId, REGION_SOUTH, "the grant's region");
  assert.equal("crewId" in s5.principal, false, "no crew claim on the token — it would be wrong the moment the grant is revoked");
  assert.deepEqual(s5.deviceCrew, { id: crewCleared, label: `Crew Cleared ${RUN}` }, "the crew comes from the login response, once, at connect");
  const session = (await admin(`SELECT principal_kind, principal_id, surface_id, expires_at FROM sessions WHERE id = $1`, [s5.principal.sessionId]))[0]!;
  assert.equal(session.principal_kind, "device_grant");
  assert.equal(session.principal_id, shiftId);
  assert.equal(session.surface_id, "S5");
  const grantEnd = (await admin(`SELECT upper(service_window) AS e FROM device_grants WHERE id = $1`, [shiftId]))[0]!.e as Date;
  assert.ok(new Date(session.expires_at).getTime() <= new Date(grantEnd).getTime() + 1000, "the token does not outlive the shift");
  await s5.logout();
});

test("jobs.mine: the technician sees the job assigned to their crew and nothing else's; the board is S3's and refused to a device by scope", { skip }, async () => {
  const s5 = await technician();
  const mine = await s5.gateway.myJobs();
  assert.equal(mine.jobs.length, 1, "one job on this crew");
  const j = mine.jobs[0]!;
  assert.equal(j.id, jobId);
  assert.equal(j.state, "assigned");
  assert.equal(j.siteId, site);
  assert.equal("currentCrewId" in j, false, "the field shape carries no other crew's board, no employment shape, no compliance detail");
  await assert.rejects(s5.gateway.listJobs({}), (e: unknown) => refusal(s5, e).kind === "scope");
  await assert.rejects(s5.gateway.candidateCrews({ jobId, orgId, regionId: REGION_SOUTH }), (e: unknown) => refusal(s5, e).kind === "scope");
  // The other crew's technician holds no grant on this device — and their crew has no job. Nothing to see, correctly.
  await s5.logout();
});

test("sync.replay: the device log replays in device order, a duplicate replay is a no-op, and an intent to assign is rejected — device holds intent, server holds truth", { skip }, async () => {
  const s5 = await technician();
  const at = (s: number) => new Date(Date.now() + s * 1000).toISOString();
  const mut = (seq: number, table: string, entityId: string, op: "insert" | "update" | "transition", payload: Record<string, unknown>, observed: number | null) => ({
    mutationId: `${RUN}-m${seq}`, deviceId, deviceSeq: seq, entityTable: table, entityId, op, payload, clientObservedVersion: observed, deviceAt: at(seq),
  });
  const version = (await admin(`SELECT version FROM jobs WHERE id = $1`, [jobId]))[0]!.version as number;
  const batch = [
    mut(3, "jobs", jobId, "transition", { state: "on_site" }, version + 1),
    mut(1, "jobs", jobId, "transition", { state: "en_route" }, version),
    mut(2, "checklist_items", jobId, "insert", { item_key: "filters_checked", response: { ok: true } }, null),
    mut(4, "time_entries", jobId, "insert", { crew_id: crewCleared, start: at(0), end: at(600), kind: "labor" }, null),
    // The office's move, attempted from the field: refused by policy, recorded as an intent.
    mut(5, "jobs", jobId, "transition", { state: "assigned" }, version + 2),
  ];
  const first = await s5.gateway.replaySync({ orgId, regionId: REGION_SOUTH, mutations: batch });
  const byId = new Map(first.outcomes.map((o) => [o.mutationId, o]));
  assert.equal(byId.get(`${RUN}-m1`)!.outcome, "applied", "en_route first, in device order, not arrival order");
  assert.equal(byId.get(`${RUN}-m2`)!.outcome, "applied");
  assert.equal(byId.get(`${RUN}-m3`)!.outcome, "applied", "on_site after en_route");
  assert.equal(byId.get(`${RUN}-m4`)!.outcome, "applied");
  assert.equal(byId.get(`${RUN}-m5`)!.outcome, "rejected", "assignment is the office's; a device cannot route around the gate");
  const job = (await admin(`SELECT state, version FROM jobs WHERE id = $1`, [jobId]))[0]!;
  assert.equal(job.state, "on_site");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM checklist_items WHERE job_id = $1 AND item_key = 'filters_checked'`, [jobId]))[0]!.n, 1);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM time_entries WHERE job_id = $1 AND crew_id = $2`, [jobId, crewCleared]))[0]!.n, 1);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM sync_mutations WHERE device_id = $1 AND mutation_id LIKE $2`, [deviceId, `${RUN}-m%`]))[0]!.n, 5, "every intent is recorded, whatever happened to it");
  const events = await admin(`SELECT to_state, surface_id FROM job_state_events WHERE job_id = $1 AND surface_id = 'S5' ORDER BY occurred_at`, [jobId]);
  assert.deepEqual(events.map((e) => e.to_state), ["en_route", "on_site"]);

  // The dropped-response case: the same batch again. Nothing moves, nothing is written twice.
  const second = await s5.gateway.replaySync({ orgId, regionId: REGION_SOUTH, mutations: batch });
  assert.ok(second.outcomes.every((o) => o.outcome === "duplicate"), JSON.stringify(second.outcomes));
  assert.equal((await admin(`SELECT version FROM jobs WHERE id = $1`, [jobId]))[0]!.version, job.version, "a replayed log does not bump the version");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM time_entries WHERE job_id = $1`, [jobId]))[0]!.n, 1);

  // The field has moved: S3's release is now the wrong door, and says so by name.
  await assert.rejects(
    s3.gateway.releaseAssignment({ assignmentId, orgId, regionId: REGION_SOUTH }),
    (e: unknown) => code(s3, e) === "job_in_progress",
  );
  assert.equal((await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!.state, "on_site", "the dispatcher's board reads the field's state");
  await s5.logout();
});

test("a revoked grant is a dead token: logout ends the session, and the next call is refused as revoked", { skip }, async () => {
  const s5 = await technician();
  const held = s5.token()!;
  await s5.logout();
  // The shell forgets its token on logout; the interesting case is the token that was copied somewhere else.
  await assert.rejects(
    connectShell({ surfaceId: "S5", baseUrl: BASE, fetch, credentials: { token: held } }),
    (e: unknown) => { const r = (e as { refusal?: { kind: string; code?: string } }).refusal; return r?.kind === "token" && r.code === "revoked"; },
  );
  await assert.rejects(s5.gateway.myJobs(), (e: unknown) => refusal(s5, e).kind === "token", "and the shell itself holds nothing to send");
  await s3.logout();
  await s2.logout();
});
