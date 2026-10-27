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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { sweepQuoteJobs } from "../../apps/worker/src/quotes.ts";
import { workerScope, WORKER_ACTOR } from "../../apps/worker/src/sweeps.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { stateMsaTerms } from "../../packages/domain/src/inheritance/fixtures/msa-terms.ts";

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
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test", AC_STORAGE_DIR: join(tmpdir(), `ac-wrapup-${RUN}`) }, stdio: ["ignore", "pipe", "pipe"],
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
  await stateMsaTerms(s2.gateway, { contractId: msa, orgId, regionId: REGION_SOUTH, effectiveFrom: "2026-01-01" });
  await s2.gateway.transitionContract({ contractId: msa, to: "active" });

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
  assert.equal(south.stateChangedAt, south.openedAt, "no state event yet — a created job has been in its state since it opened");
  const siteRow = (await admin(`SELECT address FROM accounts WHERE id = $1`, [south.siteId]))[0]!;
  assert.deepEqual(south.siteAddress, siteRow.address ?? null, "the board carries the site's address as recorded");
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
  const entered = (await admin(`SELECT occurred_at FROM job_state_events WHERE job_id = $1 AND to_state = 'assigned' ORDER BY occurred_at DESC LIMIT 1`, [jobId]))[0]!;
  assert.equal(board.stateChangedAt, (entered.occurred_at as Date).toISOString(), "time in state starts at the assignment's state event, not at the open");
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

  // Two releases at once: one releases, the other is refused by name — not a
  // second job.reassigned, not a unique-violation 500.
  const raced = await s3.gateway.assignCrew({ jobId, crewId: crewCleared, orgId, regionId: REGION_SOUTH });
  assert.equal(raced.ok, true);
  if (!raced.ok) return;
  // Hold the assignment row so both requests are inside their transactions
  // before either can write; then let them go.
  const holder = await pool.connect();
  await holder.query("BEGIN");
  await holder.query("SELECT 1 FROM assignments WHERE id = $1 FOR UPDATE", [raced.assignmentId]);
  const pending = [
    s3.gateway.releaseAssignment({ assignmentId: raced.assignmentId, orgId, regionId: REGION_SOUTH }),
    s3.gateway.releaseAssignment({ assignmentId: raced.assignmentId, orgId, regionId: REGION_SOUTH }),
  ];
  for (let i = 0; i < 100; i++) {
    const n = (await admin(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`))[0]!.n as number;
    if (n >= 2) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await holder.query("COMMIT");
  holder.release();
  const both = await Promise.allSettled(pending);
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1, "exactly one release lands");
  const lost = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(code(s3, lost.reason), "already_released");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM job_state_events WHERE job_id = $1 AND mutation_id = $2`, [jobId, `release:${raced.assignmentId}`]))[0]!.n, 1);
  assert.equal((await admin(`SELECT state FROM jobs WHERE id = $1`, [jobId]))[0]!.state, "created");

  // Re-dispatch, so the field half below has a job to work.
  const again = await s3.gateway.assignCrew({ jobId, crewId: crewCleared, orgId, regionId: REGION_SOUTH });
  assert.equal(again.ok, true);
  if (again.ok) assignmentId = again.assignmentId;
});

test("waiting on the customer, before dispatch: quote requested, quote submitted, approved back to created — each move logged, and a move the office does not have refused by name", { skip }, async () => {
  const west = await westDispatcher();
  // Its own job: the one above is back on a crew for the field half below.
  // 0024/0025: a quote is a technician's visit before anything is sold — a
  // diagnostic. The install it leads to is opened under the project once sold.
  const quoteJob = (await s2.gateway.createJob({ siteId: site, serviceCode: "DIAGNOSTIC", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  const move = (to: string) => s3.gateway.transitionJob({ jobId: quoteJob, orgId, regionId: REGION_SOUTH, to: to as never });
  await assert.rejects(move("awaiting_customer"), (e: unknown) => code(s3, e) === "illegal_transition", "a hold for the customer is mid-job; this job has no crew yet");
  await assert.rejects(
    west.gateway.transitionJob({ jobId: quoteJob, orgId, regionId: REGION_WEST, to: "quote_requested" }),
    (e: unknown) => code(west, e) === "unknown_job",
    "RLS: the West dispatcher cannot see the South job, so cannot move it",
  );

  for (const to of ["quote_requested", "quote_submitted"] as const) {
    const out = await move(to);
    assert.equal(out.state, to);
    assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "job.transitioned");
    const board = (await s3.gateway.listJobs({})).jobs.find((j) => j.id === quoteJob)!;
    assert.equal(board.state, to);
    const entered = (await admin(`SELECT max(occurred_at) AS at FROM job_state_events WHERE job_id = $1 AND to_state = $2 AND surface_id = 'S3'`, [quoteJob, to]))[0]!;
    assert.equal(board.stateChangedAt, (entered.at as Date).toISOString(), "time in status restarts at the office's move");
  }
  await assert.rejects(move("in_progress"), (e: unknown) => code(s3, e) === "illegal_transition", "a quote is approved back to dispatch, never straight into the work");
  const approved = await move("created");
  assert.equal(approved.state, "created");
  const log = await admin(`SELECT from_state, to_state FROM job_state_events WHERE job_id = $1 AND surface_id = 'S3' AND mutation_id LIKE 'office:%' ORDER BY occurred_at`, [quoteJob]);
  assert.deepEqual(log.map((r) => `${r.from_state}→${r.to_state}`), ["created→quote_requested", "quote_requested→quote_submitted", "quote_submitted→created"]);
  await west.logout();
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
  assert.equal(j.jobNo, (await admin(`SELECT job_no FROM jobs WHERE id = $1`, [jobId]))[0]!.job_no, "the number dispatch reads aloud");
  assert.equal(j.site?.name, `Austin — Roof ${RUN}`, "the site the device reads through 0023's rule, not one it was handed");
  assert.equal(j.site?.contact, null, "no contact on record yet");
  assert.deepEqual(j.checklistDone, []);

  // What a crew needs at the curb, as recorded: the address, the primary active contact over an older and an inactive one, and a checklist item already done.
  const address = { line1: "100 Congress Ave", city: "Austin", state: "TX", postal: "78701" };
  await admin(`UPDATE accounts SET address = $2 WHERE id = $1`, [site, address]);
  await admin(
    `INSERT INTO account_contacts (org_id, region_id, account_id, name, phone, is_primary, active, created_at)
     VALUES ($1, $2, $3, 'Older Contact', '512-555-0100', false, true, now() - interval '1 day'),
            ($1, $2, $3, 'Gone Contact', '512-555-0101', true, false, now() - interval '2 days'),
            ($1, $2, $3, 'Primary Contact', '512-555-0102', true, true, now())`,
    [orgId, REGION_SOUTH, site],
  );
  await admin(
    `INSERT INTO checklist_items (org_id, region_id, job_id, item_key, response, answered_at, answered_by)
     VALUES ($1, $2, $3, 'ppe_donned', '{"done": true}', now(), gen_random_uuid()), ($1, $2, $3, 'not_yet', '{"done": false}', now(), gen_random_uuid())`,
    [orgId, REGION_SOUTH, jobId],
  );
  const curb = (await s5.gateway.myJobs()).jobs[0]!;
  assert.deepEqual(curb.site?.address, address);
  assert.deepEqual(curb.site?.contact, { name: "Primary Contact", phone: "512-555-0102" }, "the primary active contact — never an inactive one, even one marked primary");
  assert.deepEqual(curb.checklistDone, ["ppe_donned"], "only items answered done");
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
  const onBoard = (await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!;
  assert.equal(onBoard.state, "on_site", "the dispatcher's board reads the field's state");
  const onSite = (await admin(`SELECT max(occurred_at) AS at FROM job_state_events WHERE job_id = $1 AND to_state = 'on_site'`, [jobId]))[0]!;
  assert.equal(onBoard.stateChangedAt, (onSite.at as Date).toISOString(), "a field transition restarts the time-in-state clock");
  await s5.logout();
});

test("0033 shift punches: a punch is made on the device's own shift, as the grant's technician and crew, append-only; the timesheet reads the technician's own", { skip }, async () => {
  const s5 = await technician();
  const t0 = Date.now();
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const punch = (n: number, entityId: string, payload: Record<string, unknown>) => ({
    mutationId: `${RUN}-punch${n}`, deviceId, deviceSeq: 1000 + n, entityTable: "shift_punches", entityId, op: "insert" as const, payload, clientObservedVersion: null, deviceAt: at(n),
  });
  const batch = [
    punch(1, shiftId, { kind: "in", at: at(-120) }),
    punch(2, jobId, { kind: "out", at: at(-60) }),          // not this shift's grant
    punch(3, shiftId, { kind: "sideways", at: at(-60) }),  // not a punch
    punch(4, shiftId, { kind: "out", at: at(-30) }),
  ];
  const outcomes = new Map((await s5.gateway.replaySync({ orgId, regionId: REGION_SOUTH, mutations: batch })).outcomes.map((o) => [o.mutationId, o.outcome]));
  assert.equal(outcomes.get(`${RUN}-punch1`), "applied");
  assert.equal(outcomes.get(`${RUN}-punch2`), "rejected", "a punch names this device's own shift and no other");
  assert.equal(outcomes.get(`${RUN}-punch3`), "rejected");
  assert.equal(outcomes.get(`${RUN}-punch4`), "applied");
  const again = await s5.gateway.replaySync({ orgId, regionId: REGION_SOUTH, mutations: [batch[0]!] });
  assert.equal(again.outcomes[0]!.outcome, "duplicate", "a replayed punch is not a second punch");

  const rows = await admin(`SELECT kind, technician_id, crew_id, region_id, punched_at FROM shift_punches WHERE grant_id = $1 ORDER BY punched_at`, [shiftId]);
  assert.deepEqual(rows.map((r) => r.kind), ["in", "out"]);
  assert.equal(rows[0]!.technician_id, USER_TECH, "the grant's technician — the payload names nobody");
  assert.equal(rows[0]!.crew_id, crewCleared);
  assert.equal(rows[0]!.region_id, REGION_SOUTH);
  assert.equal(new Date(rows[0]!.punched_at).toISOString(), at(-120), "the device's time of the tap, not the time it synced");
  const privileges = (await admin(`SELECT has_table_privilege('ac_gateway', 'shift_punches', 'UPDATE') AS u, has_table_privilege('ac_gateway', 'shift_punches', 'DELETE') AS d`))[0]!;
  assert.deepEqual([privileges.u, privileges.d], [false, false], "append-only: the gateway can add a punch, never change or remove one");

  // Someone else's punch on the same shift's record is not this technician's timesheet.
  await admin(
    `INSERT INTO shift_punches (org_id, region_id, grant_id, technician_id, crew_id, kind, punched_at, mutation_id) VALUES ($1,$2,$3,$4,$5,'in',$6,$7)`,
    [orgId, REGION_SOUTH, shiftId, USER_TECH_B, crewCleared, at(-90), `${RUN}-other`],
  );
  // USER_TECH is the same login every run, so a reused database holds earlier runs' punches too: look at this run's instants.
  const mine = (await s5.gateway.myPunches({ from: at(-24 * 60), to: at(60) })).punches.map((p) => `${p.kind}@${p.at}`);
  assert.ok(mine.includes(`in@${at(-120)}`) && mine.includes(`out@${at(-30)}`), "this run's in and out");
  assert.ok(!mine.includes(`in@${at(-90)}`), "another technician's punch is not on this timesheet");
  await assert.rejects(s5.gateway.myPunches({ from: at(0), to: at(-1) }), (e: unknown) => /after from/.test(refusal(s5, e).message));
  await assert.rejects(s5.gateway.myPunches({ from: at(-60 * 24 * 40), to: at(0) }), (e: unknown) => /35 days/.test(refusal(s5, e).message));
  await s5.logout();
});

test("0034 wrap-up: media first, then the wrap-up, each idempotent; every rule is counted from what was stored; Quote needed becomes a QUOTE job the worker opens", { skip }, async () => {
  const inProgress = async () => {
    const id = (await s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
    assert.equal((await s3.gateway.assignCrew({ jobId: id, crewId: crewCleared, orgId, regionId: REGION_SOUTH })).ok, true);
    await admin(`UPDATE jobs SET state = 'in_progress' WHERE id = $1`, [id]);
    return id;
  };
  const done = await inProgress(), quoted = await inProgress();
  const s5 = await technician();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(64).fill(7)]).toString("base64");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(1)]).toString("base64");
  const at = new Date().toISOString();
  const upload = (jobId: string, n: string, kind: "photo" | "signature" = "photo", dataBase64 = kind === "photo" ? jpeg : png) =>
    s5.gateway.attachJobMedia({ jobId, mutationId: `${RUN}-${n}`, kind, dataBase64, capturedAt: at });

  // Media: stored, replay-safe, judged by its own bytes, and only on this crew's work.
  const first = await upload(done, "d1");
  assert.equal(first.duplicate, false);
  assert.deepEqual(await upload(done, "d1"), { ...first, duplicate: true }, "a retried upload answers with the row it wrote");
  await upload(done, "d2");
  await assert.rejects(upload(done, "dsig-bad", "signature", jpeg), (e: unknown) => code(s5, e) === "not_a_photo", "a signature is a PNG");
  await assert.rejects(upload(done, "d-text", "photo", Buffer.from("not a photo").toString("base64")), (e: unknown) => code(s5, e) === "not_a_photo");
  const unassigned = (await s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  await assert.rejects(upload(unassigned, "foreign"), (e: unknown) => code(s5, e) === "not_your_job", "a job nobody sent this crew to");
  await upload(done, "dsig", "signature");
  const media = await admin(`SELECT kind, captured_by, storage_key FROM job_media WHERE job_id = $1 ORDER BY mutation_id`, [done]);
  assert.deepEqual(media.map((m) => m.kind), ["photo", "photo", "signature"]);
  assert.equal(media[0]!.captured_by, USER_TECH);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM storage_objects WHERE storage_key = ANY($1::text[])`, [media.map((m) => m.storage_key)]))[0]!.n, 3);

  // The wrap-up: refused by name on each rule, counted from the stored rows.
  const wrap = (over: Record<string, unknown>) => s5.gateway.wrapUpJob({
    jobId: done, wrapUpId: `${RUN}-wrap-done`, outcome: "complete", submittedAt: at,
    photoMutationIds: [`${RUN}-d1`, `${RUN}-d2`], signatureMutationId: `${RUN}-dsig`, notes: "Replaced the contactor.", ...over,
  } as never);
  await assert.rejects(wrap({ photoMutationIds: [`${RUN}-d1`] }), (e: unknown) => code(s5, e) === "too_few_photos");
  await assert.rejects(wrap({ photoMutationIds: [`${RUN}-d1`, `${RUN}-never-sent`] }), (e: unknown) => code(s5, e) === "media_not_uploaded", "named but not stored is not a photo");
  await assert.rejects(wrap({ signatureMutationId: undefined }), (e: unknown) => refusal(s5, e).kind === "bad_request", "the signature or why there is none");
  await assert.rejects(wrap({ jobId: quoted, wrapUpId: `${RUN}-wrap-wrongjob` }), (e: unknown) => code(s5, e) === "media_not_uploaded", "photos are counted on the job they were sent to");
  const ok = await wrap({});
  assert.deepEqual([ok.state, ok.duplicate], ["complete", false]);
  assert.equal((await wrap({})).duplicate, true, "a replayed submit finds the wrap-up it wrote");
  const row = (await admin(`SELECT outcome, notes, measurements, signature_media_id, customer_absent_reason, crew_id, submitted_by FROM job_wrap_ups WHERE job_id = $1`, [done]))[0]!;
  assert.deepEqual([row.outcome, row.notes, row.measurements, row.customer_absent_reason, row.crew_id, row.submitted_by], ["complete", "Replaced the contactor.", null, null, crewCleared, USER_TECH]);
  assert.ok(row.signature_media_id);
  assert.equal((await admin(`SELECT state FROM jobs WHERE id = $1`, [done]))[0]!.state, "complete");
  const ev = (await admin(`SELECT from_state, to_state, surface_id FROM job_state_events WHERE job_id = $1 AND mutation_id = $2`, [done, `${RUN}-wrap-done`]))[0]!;
  assert.deepEqual([ev.from_state, ev.to_state, ev.surface_id], ["in_progress", "complete", "S5"]);
  await assert.rejects(s5.gateway.wrapUpJob({ jobId: done, wrapUpId: `${RUN}-wrap-again`, outcome: "complete", submittedAt: at, photoMutationIds: [], customerAbsentReason: "gone home" }),
    (e: unknown) => code(s5, e) === "not_in_progress", "a completed job is not wrapped up twice");

  // Quote needed: ten photos and the RTU set, or no submit; then the worker opens the QUOTE job.
  for (let i = 0; i < 10; i++) await upload(quoted, `q${i}`);
  const photos = Array.from({ length: 10 }, (_, i) => `${RUN}-q${i}`);
  const measurements = { tonnage: 7.5, voltage: "460/3", fuel: "gas", unitLengthIn: 88, unitWidthIn: 58, unitHeightIn: 49, curbLengthIn: 80, curbWidthIn: 50, oldModel: "48TCED08", oldSerial: "1209G40112" };
  const quote = (over: Record<string, unknown>) => s5.gateway.wrapUpJob({
    jobId: quoted, wrapUpId: `${RUN}-wrap-quote`, outcome: "quote_needed", submittedAt: at, photoMutationIds: photos,
    customerAbsentReason: "Tenant locked the roof hatch and left", notes: "Coil badly corroded; customer wants pricing.", measurements, ...over,
  } as never);
  await assert.rejects(quote({ photoMutationIds: photos.slice(0, 9) }), (e: unknown) => code(s5, e) === "too_few_photos");
  await assert.rejects(quote({ measurements: { ...measurements, curbWidthIn: undefined } }), (e: unknown) => code(s5, e) === "measurements_incomplete" && /curb width/.test(refusal(s5, e).message));
  await assert.rejects(quote({ customerAbsentReason: "x" }), (e: unknown) => code(s5, e) === "absent_needs_reason");
  await quote({});
  const w = (await admin(`SELECT id, measurements, quote_job_id FROM job_wrap_ups WHERE job_id = $1`, [quoted]))[0]!;
  assert.deepEqual(w.measurements, measurements);
  assert.equal(w.quote_job_id, null, "the device does not open the quote job");

  const tx = await beginTx(pool, "ac_worker");
  await tx.setLocal(workerScope());
  const swept = await sweepQuoteJobs(tx, new Date());
  assert.ok(swept.opened >= 1, `the worker opened the quote job: ${JSON.stringify(swept)}`);
  const qj = (await admin(`SELECT w.quote_job_id, w.quote_error, j.service_code, j.state, j.site_id FROM job_wrap_ups w JOIN jobs j ON j.id = w.quote_job_id WHERE w.id = $1`, [w.id]))[0]!;
  assert.deepEqual([qj.service_code, qj.state, qj.site_id, qj.quote_error], ["QUOTE", "quote_requested", site, null]);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM sla_timers WHERE job_id = $1`, [qj.quote_job_id]))[0]!.n, 1, "the site's SLA, derived the way the office's jobs are");
  const note = (await admin(`SELECT body, kind, author_id FROM job_notes WHERE job_id = $1`, [qj.quote_job_id]))[0]!;
  assert.match(note.body, /Coil badly corroded/);
  assert.deepEqual([note.kind, note.author_id], ["standing", WORKER_ACTOR]);
  const authored = await admin(`SELECT DISTINCT surface_id, actor_id FROM audit_log WHERE entity_id = $1`, [qj.quote_job_id]);
  assert.deepEqual(authored.map((a) => [a.surface_id, a.actor_id]), [["worker", WORKER_ACTOR]], "the worker is the quote job's author, not a surface it is not");

  const again = await beginTx(pool, "ac_worker");
  await again.setLocal(workerScope());
  await sweepQuoteJobs(again, new Date());
  assert.equal((await admin(`SELECT count(*)::int AS n FROM jobs WHERE service_code = 'QUOTE' AND site_id = $1 AND id = $2`, [site, qj.quote_job_id]))[0]!.n, 1);
  assert.equal((await admin(`SELECT quote_job_id FROM job_wrap_ups WHERE id = $1`, [w.id]))[0]!.quote_job_id, qj.quote_job_id, "a second sweep opens nothing more");

  // The office reads both wrap-ups on the job, and the photo and signature through media.get.
  const qd = (await s3.gateway.jobDetail({ jobId: quoted })).wrapUp!;
  assert.deepEqual([qd.outcome, qd.quoteJobId, qd.measurements, qd.customerAbsentReason, qd.signatureMediaId, qd.crewLabel],
    ["quote_needed", qj.quote_job_id, measurements, "Tenant locked the roof hatch and left", null, `Crew Cleared ${RUN}`]);
  assert.equal(qd.quoteJobNo, (await admin(`SELECT job_no FROM jobs WHERE id = $1`, [qj.quote_job_id]))[0]!.job_no);
  const dd = await s3.gateway.jobDetail({ jobId: done });
  assert.deepEqual([dd.wrapUp!.outcome, dd.wrapUp!.notes, dd.wrapUp!.submittedByName], ["complete", "Replaced the contactor.", "Technician"]);
  const sig = await s3.gateway.getMedia({ id: dd.wrapUp!.signatureMediaId! });
  assert.equal(sig.image, `data:image/png;base64,${png}`, "the signature the device sent, read back by the office");
  const photo = dd.media.find((m) => m.kind === "photo")!;
  assert.equal((await s3.gateway.getMedia({ id: photo.id })).contentType, "image/jpeg");
  await s5.logout();
});

test("waiting on the customer, mid-job: the office holds an on-site job for the customer and resumes it into the work", { skip }, async () => {
  const move = (to: string) => s3.gateway.transitionJob({ jobId, orgId, regionId: REGION_SOUTH, to: to as never });
  assert.equal((await admin(`SELECT state FROM jobs WHERE id = $1`, [jobId]))[0]!.state, "on_site");
  assert.equal((await move("awaiting_customer")).state, "awaiting_customer");
  assert.equal((await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!.state, "awaiting_customer");
  await assert.rejects(move("created"), (e: unknown) => code(s3, e) === "illegal_transition", "a held job resumes; it does not go back to dispatch from here");
  assert.equal((await move("in_progress")).state, "in_progress");
});

test("closing out: a crew that finished off-device leaves the job dispatched; the office moves it to complete from a field state, logged as S3's", { skip }, async () => {
  const move = (to: string) => s3.gateway.transitionJob({ jobId, orgId, regionId: REGION_SOUTH, to: to as never });
  // A crew that never touched the tablet past "en route" — the paper ticket came back finished.
  await admin(`UPDATE jobs SET state = 'en_route' WHERE id = $1`, [jobId]);
  const out = await move("complete");
  assert.equal(out.state, "complete");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "job.transitioned");
  const logged = (await admin(`SELECT from_state, surface_id, mutation_id FROM job_state_events WHERE job_id = $1 AND to_state = 'complete' ORDER BY recorded_at DESC LIMIT 1`, [jobId]))[0]!;
  assert.deepEqual([logged.from_state, logged.surface_id, logged.mutation_id], ["en_route", "S3", `office:v${out.version}`]);
  assert.equal((await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!.state, "complete", "the board reads it as finished work");
  await assert.rejects(move("in_progress"), (e: unknown) => code(s3, e) === "illegal_transition", "a closed-out job does not reopen through the office's hand");
});

test("what blocks the invoice: a finished job goes to needs pricing, a PO or pictures and back to ready-to-invoice; a kicked-back invoice is fixed and re-sent", { skip }, async () => {
  const move = (to: string) => s3.gateway.transitionJob({ jobId, orgId, regionId: REGION_SOUTH, to: to as never });
  // The field finishing and billing invoicing have their own doors; this test starts on the far side of each.
  await admin(`UPDATE jobs SET state = 'complete' WHERE id = $1`, [jobId]);
  for (const blocker of ["needs_pricing", "awaiting_po", "awaiting_pictures"] as const) {
    assert.equal((await move(blocker)).state, blocker);
    await assert.rejects(move("invoiced"), (e: unknown) => code(s3, e) === "illegal_transition", `${blocker} is cleared back to ready-to-invoice, not invoiced from here`);
    assert.equal((await move("complete")).state, "complete");
  }
  await admin(`UPDATE jobs SET state = 'invoiced' WHERE id = $1`, [jobId]);
  assert.equal((await move("invoice_trouble")).state, "invoice_trouble");
  assert.equal((await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!.state, "invoice_trouble");
  assert.equal((await move("invoiced")).state, "invoiced");
  const log = await admin(`SELECT to_state FROM job_state_events WHERE job_id = $1 AND mutation_id LIKE 'office:%' AND to_state IN ('needs_pricing','awaiting_po','awaiting_pictures','invoice_trouble') ORDER BY occurred_at`, [jobId]);
  assert.deepEqual(log.map((r) => r.to_state), ["needs_pricing", "awaiting_po", "awaiting_pictures", "invoice_trouble"]);
});

test("notes and the return-trip flag (0015): append-only notes with the newest on the board, a flag that does not move the job's version, both refused outside the region", { skip }, async () => {
  const west = await westDispatcher();
  const version = (await admin(`SELECT version FROM jobs WHERE id = $1`, [jobId]))[0]!.version as number;
  const first = await s3.gateway.addJobNote({ jobId, orgId, regionId: REGION_SOUTH, body: "  Freon leak at suction line  " });
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [first.eventId]))[0]!.topic, "job.annotated");
  await s3.gateway.addJobNote({ jobId, orgId, regionId: REGION_SOUTH, body: "Return trip — customer wants a call first" });
  const board = () => s3.gateway.listJobs({}).then((o) => o.jobs.find((j) => j.id === jobId)!);
  assert.equal((await board()).latestNote?.body, "Return trip — customer wants a call first", "the newest note is the one on the board");
  assert.equal((await admin(`SELECT body FROM job_notes WHERE id = $1`, [first.id]))[0]!.body, "Freon leak at suction line", "trimmed, and kept");
  await assert.rejects(s3.gateway.addJobNote({ jobId, orgId, regionId: REGION_SOUTH, body: "   " }), "an empty note is refused");
  await assert.rejects(admin(`UPDATE job_notes SET body = 'rewritten' WHERE id = $1`, [first.id]), "a note is never edited — a correction is a newer note");

  assert.equal((await board()).returnTrip, false);
  const flagged = await s3.gateway.setReturnTrip({ jobId, orgId, regionId: REGION_SOUTH, returnTrip: true });
  assert.equal(flagged.returnTrip, true);
  assert.equal((await board()).returnTrip, true);
  assert.equal((await admin(`SELECT version FROM jobs WHERE id = $1`, [jobId]))[0]!.version, version, "a flag is not a state change: a device's offline log is not superseded by it");
  await s3.gateway.setReturnTrip({ jobId, orgId, regionId: REGION_SOUTH, returnTrip: false });
  assert.equal((await board()).returnTrip, false);

  for (const call of [
    () => west.gateway.addJobNote({ jobId, orgId, regionId: REGION_WEST, body: "not mine" }),
    () => west.gateway.setReturnTrip({ jobId, orgId, regionId: REGION_WEST, returnTrip: true }),
  ]) await assert.rejects(call(), (e: unknown) => code(west, e) === "unknown_job", "RLS: the West dispatcher cannot see the South job");
  assert.equal((await west.gateway.listJobs({})).jobs.filter((j) => j.id === jobId).length, 0);
  await west.logout();
});

test("job detail (0016): the job's visits are its assignments with the crew's logged span, its standing note is the newest standing one, and the board's note ignores it", { skip }, async () => {
  await s3.gateway.addJobNote({ jobId, orgId, regionId: REGION_SOUTH, body: "Roof access through the mechanical room. Bring the 24 ft ladder.", kind: "standing" });
  const d = await s3.gateway.jobDetail({ jobId });
  assert.equal(d.job.id, jobId);
  const assigned = await admin(`SELECT id FROM assignments WHERE job_id = $1 ORDER BY assigned_at, id`, [jobId]);
  assert.deepEqual(d.visits.map((v) => v.id), assigned.map((a) => a.id), "a visit is an assignment, in order");
  assert.ok(d.visits.every((v) => v.crewLabel), "each with its crew");
  assert.ok(d.visits.some((v) => v.workStart !== null && v.workEnd !== null), "the field's time entry sets the span of the visit it was logged in");
  assert.equal(d.notes.at(-1)!.kind, "standing");
  assert.notEqual((await s3.gateway.listJobs({})).jobs.find((j) => j.id === jobId)!.latestNote?.body, "Roof access through the mechanical room. Bring the 24 ft ladder.", "a standing note is not the board's latest note");
  await assert.rejects(s3.gateway.jobDetail({ jobId: "00000000-0000-0000-0000-00000000dead" }), (e: unknown) => code(s3, e) === "unknown_job");
  const west = await westDispatcher();
  await assert.rejects(west.gateway.jobDetail({ jobId }), (e: unknown) => code(west, e) === "unknown_job", "RLS: West cannot read the South job's detail");
  await west.logout();
});

test("sync.replay after a release: a crew taken off a job cannot drive it — the job may be another crew's, so every intent goes to a person", { skip }, async () => {
  const other = (await s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  const out = await s3.gateway.assignCrew({ jobId: other, crewId: crewCleared, orgId, regionId: REGION_SOUTH });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  await s3.gateway.releaseAssignment({ assignmentId: out.assignmentId, orgId, regionId: REGION_SOUTH, reason: "sent elsewhere" });
  // Another crew holds it now. Its state is all the device's policy could see.
  await admin(`UPDATE jobs SET state = 'assigned' WHERE id = $1`, [other]);
  const version = (await admin(`SELECT version FROM jobs WHERE id = $1`, [other]))[0]!.version as number;

  const s5 = await technician();
  const at = new Date().toISOString();
  const res = await s5.gateway.replaySync({ orgId, regionId: REGION_SOUTH, mutations: [
    { mutationId: `${RUN}-r1`, deviceId, deviceSeq: 101, entityTable: "jobs", entityId: other, op: "transition", payload: { state: "en_route" }, clientObservedVersion: version, deviceAt: at },
    { mutationId: `${RUN}-r2`, deviceId, deviceSeq: 102, entityTable: "time_entries", entityId: other, op: "insert", payload: { crew_id: crewCleared, start: at, end: at, kind: "labor" }, clientObservedVersion: null, deviceAt: at },
  ] });
  assert.deepEqual(res.outcomes.map((o) => o.outcome), ["queued_for_human", "queued_for_human"]);
  const job = (await admin(`SELECT state, version FROM jobs WHERE id = $1`, [other]))[0]!;
  assert.equal(job.state, "assigned", "the released crew's transition did not land");
  assert.equal(job.version, version);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM time_entries WHERE job_id = $1`, [other]))[0]!.n, 0);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM sync_conflicts WHERE entity_id = $1`, [other]))[0]!.n, 2, "both are a person's to judge");
  await s5.logout();
});

test("after dispatch: a cancelled job releases its crew and leaves the crew's list; a closed-out job leaves the list too, but its crew's late time still lands", { skip }, async () => {
  const dispatched = async (state: string) => {
    const id = (await s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
    const out = await s3.gateway.assignCrew({ jobId: id, crewId: crewCleared, orgId, regionId: REGION_SOUTH });
    assert.equal(out.ok, true);
    await admin(`UPDATE jobs SET state = $2 WHERE id = $1`, [id, state]);
    return id;
  };
  const cancelled = await dispatched("en_route"), closed = await dispatched("on_site");
  const s5 = await technician();
  const mine = async () => (await s5.gateway.myJobs()).jobs.map((j) => j.id);
  assert.ok((await mine()).includes(cancelled) && (await mine()).includes(closed));

  await assert.rejects(
    s3.gateway.transitionJob({ jobId: closed, orgId, regionId: REGION_SOUTH, to: "cancelled" }),
    (e: unknown) => code(s3, e) === "illegal_transition", "the crew is on site: stopping now is an abort, not a cancellation",
  );
  const out = await s3.gateway.transitionJob({ jobId: cancelled, orgId, regionId: REGION_SOUTH, to: "cancelled" });
  assert.equal(out.state, "cancelled");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "job.cancelled", "the field's topic, so the device drops it");
  const a = (await admin(`SELECT released_at, release_reason FROM assignments WHERE job_id = $1`, [cancelled]))[0]!;
  assert.ok(a.released_at);
  assert.equal(a.release_reason, "cancelled");
  assert.equal((await s3.gateway.listJobs({})).jobs.find((j) => j.id === cancelled)!.currentCrewId, null, "the board shows no crew on it");

  await s3.gateway.transitionJob({ jobId: closed, orgId, regionId: REGION_SOUTH, to: "complete" });
  assert.deepEqual((await mine()).filter((id) => id === cancelled || id === closed), [], "neither is on the crew's list");

  const at = new Date().toISOString();
  const res = await s5.gateway.replaySync({ orgId, regionId: REGION_SOUTH, mutations: [
    { mutationId: `${RUN}-late1`, deviceId, deviceSeq: 201, entityTable: "time_entries", entityId: closed, op: "insert", payload: { crew_id: crewCleared, start: at, end: at, kind: "labor" }, clientObservedVersion: null, deviceAt: at },
  ] });
  assert.deepEqual(res.outcomes.map((o) => o.outcome), ["applied"], "a closed-out job keeps its crew, so the crew's late time is not a conflict");
  await s5.logout();
});

test("0029: a certificate's days are the region's — an evening job on its last day clears, in the dry run and at the table; a window ending at local midnight needs no next day", { skip }, async () => {
  // South is America/Chicago. The license's last day is D; 20:00–22:00 there
  // on D is already D+1 in UTC, and 22:00–midnight ends on the [) bound.
  const D = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const at = async (day: string, time: string) =>
    ((await admin(`SELECT (($1::date + $2::time) AT TIME ZONE r.timezone) AS t FROM regions r WHERE r.id = $3`, [day, time, REGION_SOUTH]))[0]!.t as Date).toISOString();
  const crew = (await s2.gateway.createCrew({ label: `Crew Evening ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
  for (const kind of ["license", "background_check"]) {
    const c = await s2.gateway.recordCredential({ crewId: crew, kind, identifier: `${kind} eve ${RUN}`, validFrom: "2026-01-01", validTo: D });
    await s2.gateway.verifyCredential({ credentialId: c.id });
  }
  const windows: [string, string, boolean][] = [
    [await at(D, "20:00"), await at(D, "22:00"), true],
    [await at(D, "22:00"), await at(new Date(Date.parse(D) + 86_400_000).toISOString().slice(0, 10), "00:00"), true],
    [await at(D, "23:00"), await at(new Date(Date.parse(D) + 86_400_000).toISOString().slice(0, 10), "00:30"), false],
  ];
  for (const [start, end, clears] of windows) {
    const evening = (await s2.gateway.createJob({ siteId: site, serviceCode: "HVAC-REPAIR", serviceWindowStart: start, serviceWindowEnd: end })).id;
    const dry = (await s3.gateway.candidateCrews({ jobId: evening, orgId, regionId: REGION_SOUTH })).candidates.find((c) => c.crewId === crew)!;
    assert.equal(dry.cleared, clears, `dry run for ${start}..${end}`);
    // The door agrees, and so does the table it writes through (a 500 here is the trigger disagreeing).
    const out = await s3.gateway.assignCrew({ jobId: evening, crewId: crew, orgId, regionId: REGION_SOUTH });
    assert.equal(out.ok, clears, `the door for ${start}..${end}`);
    if (!clears && !out.ok) assert.match(out.refusal.detail, new RegExp(`expires ${D}`), "the refusal names the day on the certificate");
  }
  // And the table on its own, past the gateway: the evening window is earned; one minute into D+1 is not.
  const license = (await admin(`SELECT id FROM crew_credentials WHERE crew_id = $1 AND kind = 'license'`, [crew]))[0]!.id as string;
  const clearance = (start: string, end: string) => admin(`INSERT INTO compliance_clearances (org_id, region_id, crew_id, service_window, credential_ids, evaluated_at, evaluated_by)
    VALUES ($1,$2,$3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), $6::jsonb, now(), $7)`, [orgId, REGION_SOUTH, crew, start, end, JSON.stringify([license]), USER_DISP_SOUTH]);
  await clearance(windows[0]![0], windows[0]![1]);
  await clearance(windows[1]![0], windows[1]![1]);
  await assert.rejects(clearance(windows[2]![0], windows[2]![1]), (e: unknown) => (e as { code?: string }).code === "AC422");
});

test("a grant the office revokes ends the shift's token at once, not when the shift ends", { skip }, async () => {
  const s5 = await technician();
  await s5.gateway.myJobs();
  await admin(`UPDATE device_grants SET revoked_at = now() WHERE id = $1`, [shiftId]);
  try {
    await assert.rejects(s5.gateway.myJobs(), (e: unknown) => { const r = refusal(s5, e); return r.kind === "token" && "code" in r && r.code === "revoked"; });
  } finally {
    await admin(`UPDATE device_grants SET revoked_at = NULL WHERE id = $1`, [shiftId]);
  }
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
