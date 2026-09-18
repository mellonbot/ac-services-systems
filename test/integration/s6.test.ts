/**
 * ITEM 6 OVER THE WIRE — S6, the Customer Portal, through the shell, against
 * a spawned gateway and a live PostgreSQL. 00 §2.8 build order item 6: "tier
 * scoping is the acceptance test." This file is that test.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * Three customer principals, one bundle, no client-side filter anywhere:
 *
 *   fmAustin   a facility manager at Austin (Amped / South)
 *   fmReno     a facility manager at Reno  (Amped / West)
 *   exec       Amped's executive — parent tier, token bound to South
 *   other      a facility manager at a DIFFERENT customer's site in South
 *
 * What each may see is 0006's policies and nothing else: the subtree and the
 * breadcrumb on `accounts`; work at a visible site on `jobs`, `sla_timers`,
 * `service_requests`; the own org's rows on `contracts` and the overrides;
 * NOTHING on `crews`, `crew_credentials`, `compliance_clearances`,
 * `assignments`. Before 0006 a customer bound to South saw every South job of
 * every customer and could resolve any org's terms by typing its id; and a
 * facility manager could not see the region node above them, so a term
 * authored at the region tier silently did not apply. Each of those is a test
 * below, asserted the way it now holds.
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
const skip = URL_ ? false : "DATABASE_URL not set — item 6 (S6) was not verified over the wire";
if (!URL_) test("item 6 over the wire", { skip }, () => {});

const PORT = 23080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d6000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP_SOUTH = U(2), USER_FM_AUSTIN = U(3), USER_FM_RENO = U(4), USER_EXEC = U(5), USER_OTHER = U(6);
const PASSWORD = "correct horse battery staple";
const RUN = `d6-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
/** A statement inside one scope-bound transaction, as the gateway role — the database's own view of a principal. */
const asBinding = async (binding: Record<string, string>, sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries(binding)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};
const customerBinding = (orgId: string, regionId: string, scopeTier: string, scopeId: string, actor: string) => ({
  "ac.namespace": "customer", "ac.org_id": orgId, "ac.region_id": regionId, "ac.scope_tier": scopeTier, "ac.scope_id": scopeId,
  "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": actor, "ac.surface_id": "S6",
});

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-item6-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d6@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.south.d6@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP_SOUTH]);

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

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d6@ac.test", password: PASSWORD } });
const dispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.south.d6@ac.test", password: PASSWORD } });
const customer = (email: string) => connectShell({ surfaceId: "S6", baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };
const code = (s: ConnectedShell, e: unknown): string | null => { const r = refusal(s, e); return "code" in r ? r.code : null; };
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id).sort();

const tomorrow = new Date(Date.now() + 24 * 3600_000);
const WINDOW_START = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 9)).toISOString();
const WINDOW_END = new Date(Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), 13)).toISOString();

// Shared across the tests below, in order. node:test runs them serially.
let s2: ConnectedShell, s3: ConnectedShell;
let amped = "", southNode = "", westNode = "", austin = "", austinRoof = "", austinAhu = "", reno = "", renoRoof = "", msa = "";
let other = "", otherNode = "", otherLoc = "", otherSite = "", otherMsa = "";
let jobAustin = "", jobReno = "", jobOther = "", crew = "";

test("the office records two customers, their trees, their agreements and their work — the fixture the portal will be measured against", { skip }, async () => {
  s2 = await owner();
  const a = await s2.gateway.createOrganization({ name: `Amped S6 ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
  amped = a.orgId; southNode = a.regionNodeId;
  westNode = (await s2.gateway.createAccount({ orgId: amped, tier: "region", regionId: REGION_WEST, name: "Amped / West" })).id;
  austin = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: southNode, name: "Austin", customerGroup: "Southwest" })).id;
  austinRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: "Austin — Roof" })).id;
  austinAhu = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: "Austin — Basement AHU" })).id;
  reno = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: westNode, name: "Reno" })).id;
  renoRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: reno, name: "Reno — Roof" })).id;

  msa = (await s2.gateway.createContract({ orgId: amped, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: amped, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
  await s2.gateway.transitionContract({ contractId: msa, to: "active" });
  await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "parent", scopeId: amped, termKey: "sla_response", termValue: "4_hour", effectiveFrom: "2026-01-01", orgId: amped, regionId: REGION_SOUTH });
  await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "parent", scopeId: amped, termKey: "pm_visits_per_year", termValue: 2, effectiveFrom: "2026-01-01", orgId: amped, regionId: REGION_SOUTH });
  // A REGION-tier override — the tier a location-scoped customer could not see before 0006.
  await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "region", scopeId: westNode, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2026-01-01", orgId: amped, regionId: REGION_WEST });
  // And a LOCATION-tier one at Austin.
  await s2.gateway.authorTermOverride({ contractId: msa, scopeTier: "location", scopeId: austin, termKey: "pm_visits_per_year", termValue: 4, effectiveFrom: "2026-01-01", orgId: amped, regionId: REGION_SOUTH });

  const o = await s2.gateway.createOrganization({ name: `Other Co ${RUN}`, externalRef: `${RUN}-other`, firstRegionNode: { regionId: REGION_SOUTH, name: "Other / South" } });
  other = o.orgId; otherNode = o.regionNodeId;
  otherLoc = (await s2.gateway.createAccount({ orgId: other, tier: "location", parentId: otherNode, name: "Other — Dallas" })).id;
  otherSite = (await s2.gateway.createAccount({ orgId: other, tier: "site", parentId: otherLoc, name: "Other — Dallas Roof" })).id;
  otherMsa = (await s2.gateway.createContract({ orgId: other, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: other, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-02-01", effectiveFrom: "2026-02-01", diagnosticDataRightsReserved: false })).id;
  await s2.gateway.transitionContract({ contractId: otherMsa, to: "active" });
  await s2.gateway.authorTermOverride({ contractId: otherMsa, scopeTier: "parent", scopeId: other, termKey: "sla_response", termValue: "48_hour", effectiveFrom: "2026-02-01", orgId: other, regionId: REGION_SOUTH });

  jobAustin = (await s2.gateway.createJob({ siteId: austinRoof, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  jobReno = (await s2.gateway.createJob({ siteId: renoRoof, serviceCode: "PM-VISIT", priority: "pm", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;
  jobOther = (await s2.gateway.createJob({ siteId: otherSite, serviceCode: "HVAC-REPAIR", priority: "routine", serviceWindowStart: WINDOW_START, serviceWindowEnd: WINDOW_END })).id;

  // A cleared crew, assigned to the Austin job through S3's gated door — so the customer's row HAS an assignment it must not see.
  crew = (await s2.gateway.createCrew({ label: `Crew S6 ${RUN}`, employmentType: "employed", homeRegionId: REGION_SOUTH })).id;
  for (const kind of ["license", "background_check"] as const) {
    const c = await s2.gateway.recordCredential({ crewId: crew, kind, identifier: `${kind} ${RUN}`, validFrom: "2026-01-01", validTo: "2027-12-31" });
    await s2.gateway.verifyCredential({ credentialId: c.id });
  }
  s3 = await dispatcher();
  const assigned = await s3.gateway.assignCrew({ jobId: jobAustin, crewId: crew, orgId: amped, regionId: REGION_SOUTH });
  assert.equal(assigned.ok, true);

  // The customer principals. Provisioning is SQL here — there is no operation for it yet (see the item-6 doc).
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'customer',$4,'Austin FM','[]','location',$5,$6,true),
           ($7,$2,$8,'customer',$9,'Reno FM','[]','location',$10,$6,true),
           ($11,$2,$3,'customer',$12,'Amped Exec','[]','parent',$2,$6,true),
           ($13,$14,$3,'customer',$15,'Other FM','[]','location',$16,$6,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, region_id = EXCLUDED.region_id, scope_id = EXCLUDED.scope_id, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_FM_AUSTIN, amped, REGION_SOUTH, `fm.austin.${RUN}@amped.test`, austin, hash,
     USER_FM_RENO, REGION_WEST, `fm.reno.${RUN}@amped.test`, reno,
     USER_EXEC, `exec.${RUN}@amped.test`,
     USER_OTHER, other, `fm.${RUN}@other.test`, otherLoc]);
});

let fmAustin: ConnectedShell, fmReno: ConnectedShell, exec: ConnectedShell, otherFm: ConnectedShell;

test("a facility manager signs in to S6 and the gateway resolves their context under their own scope: Amped › Amped / South › Austin", { skip }, async () => {
  fmAustin = await customer(`fm.austin.${RUN}@amped.test`);
  assert.equal(fmAustin.principal.namespace, "customer");
  assert.equal(fmAustin.principal.scopeTier, "location");
  assert.deepEqual(fmAustin.context!.path.map((n) => n.name), [`Amped S6 ${RUN}`, "Amped / South", "Austin"], "the walk up from the scope node reaches the region node — 0006's breadcrumb");
  assert.equal(fmAustin.context!.regions.length, 1);
  assert.equal(fmAustin.context!.regions[0]!.id, southNode);
  fmReno = await customer(`fm.reno.${RUN}@amped.test`);
  exec = await customer(`exec.${RUN}@amped.test`);
  assert.equal(exec.principal.scopeTier, "parent");
  assert.deepEqual(exec.context!.regions.map((r) => r.id).sort(), [southNode, westNode].sort(), "the executive's context carries every region node");
  otherFm = await customer(`fm.${RUN}@other.test`);

  // The walls between namespaces, at the door.
  await assert.rejects(connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: `exec.${RUN}@amped.test`, password: PASSWORD } }), /serves the internal namespace/);
  await assert.rejects(connectShell({ surfaceId: "S6", baseUrl: BASE, fetch, credentials: { email: "owner.d6@ac.test", password: PASSWORD } }), /serves the customer namespace/);
});

test("TIER SCOPING — accounts: the facility manager sees the location, its sites and its breadcrumb; the executive sees the whole tree; nobody sees another customer's", { skip }, async () => {
  const seen = (await fmAustin.gateway.listAccounts({ orgId: amped })).nodes;
  assert.deepEqual(ids(seen), [southNode, austin, austinRoof, austinAhu].sort(), "Austin, its two sites, and the region node above — not Reno, not West, not Other Co");
  assert.equal(seen.find((n) => n.id === austin)!.customerGroup, "Southwest", "the customer's own grouping travels as an attribute");
  assert.deepEqual(ids((await fmReno.gateway.listAccounts({ orgId: amped })).nodes), [westNode, reno, renoRoof].sort());
  assert.deepEqual(ids((await exec.gateway.listAccounts({ orgId: amped })).nodes), [southNode, westNode, austin, austinRoof, austinAhu, reno, renoRoof].sort());
  assert.deepEqual(ids((await otherFm.gateway.listAccounts({ orgId: other })).nodes), [otherNode, otherLoc, otherSite].sort());
  // The orgId input is inert for a customer: another org's id yields the customer's own rows, not theirs.
  assert.deepEqual(ids((await fmAustin.gateway.listAccounts({ orgId: other })).nodes), [southNode, austin, austinRoof, austinAhu].sort());
});

test("TIER SCOPING — work: a job is visible exactly when its site is; the executive sees across OUR regions; the assignment on the customer's job is invisible to the customer", { skip }, async () => {
  const austinJobs = (await fmAustin.gateway.listJobs({})).jobs;
  assert.deepEqual(ids(austinJobs), [jobAustin], "the Austin manager sees Austin's job — not Reno's, not Other Co's South job");
  const j = austinJobs[0]!;
  assert.equal(j.state, "assigned", "the state is the customer's to know");
  assert.equal(j.currentCrewId, null, "the crew is not — RLS on assignments returns no row to join");
  assert.equal(j.currentCrewLabel, null);
  assert.equal(j.currentAssignmentId, null);
  assert.ok(j.slaDueAt, "the response commitment is the customer's to know");
  assert.ok(j.slaSatisfiedAt, "and whether it was met");
  assert.deepEqual(ids((await fmReno.gateway.listJobs({})).jobs), [jobReno]);
  assert.deepEqual(ids((await exec.gateway.listJobs({})).jobs), [jobAustin, jobReno].sort(), "parent tier: both regions, though the token is bound to South");
  assert.deepEqual(ids((await otherFm.gateway.listJobs({})).jobs), [jobOther]);
  // And the office still sees what it saw: the South dispatcher's board carries both South jobs, of both customers.
  const board = ids((await s3.gateway.listJobs({})).jobs);
  assert.ok(board.includes(jobAustin) && board.includes(jobOther) && !board.includes(jobReno));
});

test("AT THE TABLE: a customer principal reads zero crews, credentials, clearances and assignments — the leak 0006 closed, as the database sees it", { skip }, async () => {
  const b = customerBinding(amped, REGION_SOUTH, "location", austin, USER_FM_AUSTIN);
  for (const t of ["crews", "crew_credentials", "compliance_clearances", "assignments"]) {
    assert.equal((await asBinding(b, `SELECT count(*)::int AS n FROM ${t}`))[0]!.n, 0, `${t}: zero rows for a customer, not an error`);
  }
  // The same binding sees its own job and timer, and only those.
  assert.deepEqual((await asBinding(b, `SELECT id FROM jobs ORDER BY id`)).map((r) => r.id), [jobAustin]);
  assert.equal((await asBinding(b, `SELECT count(*)::int AS n FROM sla_timers`))[0]!.n, 1);
  // Before 0006 this binding, bound to South, saw Other Co's South job and Other Co's agreement. Now:
  assert.equal((await asBinding(b, `SELECT count(*)::int AS n FROM jobs WHERE id = $1`, [jobOther]))[0]!.n, 0);
  assert.equal((await asBinding(b, `SELECT count(*)::int AS n FROM contracts WHERE org_id = $1`, [other]))[0]!.n, 0);
  assert.equal((await asBinding(b, `SELECT count(*)::int AS n FROM contract_term_overrides WHERE org_id = $1`, [other]))[0]!.n, 0);
  assert.equal((await asBinding(b, `SELECT count(*)::int AS n FROM contracts WHERE org_id = $1`, [amped]))[0]!.n, 1, "its own agreement is there");
  // A firm principal sees no agreements at all — an MSA with a firm is a column on the firm, not a row here.
  const firm = { ...b, "ac.namespace": "subcontractor", "ac.firm_id": U(77), "ac.org_id": U(77) };
  assert.equal((await asBinding(firm, `SELECT count(*)::int AS n FROM contracts`))[0]!.n, 0);
});

test("TIER SCOPING — terms: a REGION-tier override applies to a location-scoped manager (the truncated path 0006 mended); another org's terms are unreachable by any orgId", { skip }, async () => {
  // Austin: parent 4_hour, location pm 4 — and the region node in the trace, walked.
  const at = await fmAustin.gateway.resolvedTerms({ tier: "site", nodeId: austinRoof, termKeys: "sla_response,pm_visits_per_year" });
  assert.equal(at.resolved.sla_response!.value, "4_hour");
  assert.deepEqual(at.resolved.sla_response!.wonAt, { tier: "parent", id: amped });
  assert.equal(at.resolved.pm_visits_per_year!.value, 4);
  assert.deepEqual(at.resolved.pm_visits_per_year!.wonAt, { tier: "location", id: austin });
  assert.ok(at.resolved.sla_response!.trace.some((s) => s.tier === "region" && s.id === southNode), "the walk includes the region node the manager can now see");

  // Reno: the WEST region node tightened the response to 2_hour. Before 0006 the Reno manager's path stopped at Reno and this answered 4_hour — wrong.
  const rt = await fmReno.gateway.resolvedTerms({ tier: "site", nodeId: renoRoof, termKeys: "sla_response" });
  assert.equal(rt.resolved.sla_response!.value, "2_hour", "THE REGION-TIER OVERRIDE APPLIES to a location-scoped customer");
  assert.deepEqual(rt.resolved.sla_response!.wonAt, { tier: "region", id: westNode });
  // The executive gets the same answer for the same node — one resolver, one truth.
  assert.equal((await exec.gateway.resolvedTerms({ tier: "site", nodeId: renoRoof, termKeys: "sla_response" })).resolved.sla_response!.value, "2_hour");

  // Out of scope is absent, not forbidden: Reno's site does not exist from Austin.
  await assert.rejects(fmAustin.gateway.resolvedTerms({ tier: "site", nodeId: renoRoof }), (e: unknown) => code(fmAustin, e) === "unknown_scope");
  // Another org by id: the customer's own org answers regardless, and the other's node is unknown.
  await assert.rejects(fmAustin.gateway.resolvedTerms({ orgId: other, tier: "site", nodeId: otherSite }), (e: unknown) => code(fmAustin, e) === "unknown_scope");
  const own = await fmAustin.gateway.resolvedTerms({ orgId: other, tier: "site", nodeId: austinRoof, termKeys: "sla_response" });
  assert.equal(own.resolved.sla_response!.value, "4_hour", "orgId is inert for a customer — the token names the org");
  // Other Co's own manager, meanwhile, reads Other Co's terms.
  assert.equal((await otherFm.gateway.resolvedTerms({ tier: "site", nodeId: otherSite, termKeys: "sla_response" })).resolved.sla_response!.value, "48_hour");

  // The register is served to S6 as it is to S2.
  assert.ok((await fmAustin.gateway.termRegister()).terms.some((t) => t.key === "sla_response"));
});

test("TIER SCOPING — agreements: the customer's own, whatever orgId says; the office's list is unchanged", { skip }, async () => {
  assert.deepEqual(ids((await fmAustin.gateway.listContracts({ orgId: amped })).contracts), [msa]);
  assert.deepEqual(ids((await fmAustin.gateway.listContracts({ orgId: other })).contracts), [msa], "another org's id yields the customer's own agreements");
  assert.deepEqual(ids((await otherFm.gateway.listContracts({ orgId: other })).contracts), [otherMsa]);
  const mine = (await exec.gateway.listContracts({ orgId: amped })).contracts[0]!;
  assert.equal(mine.diagnosticDataRightsReserved, true);
  assert.equal(mine.state, "active");
  assert.deepEqual(ids((await s2.gateway.listContracts({ orgId: other })).contracts), [otherMsa], "S2 asks for an org and gets it");
});

test("THE ONE WRITE — a service request at a visible site lands in the SITE's tenancy; an invisible site is unknown, a location is not a site; the office reads it by region", { skip }, async () => {
  const out = await fmAustin.gateway.createServiceRequest({ siteId: austinAhu, priority: "urgent", description: "Water pooling under the basement AHU since this morning." });
  assert.equal(out.orgId, amped);
  assert.equal(out.regionId, REGION_SOUTH);
  const row = (await admin(`SELECT requested_by, priority, job_id FROM service_requests WHERE id = $1`, [out.id]))[0]!;
  assert.equal(row.requested_by, USER_FM_AUSTIN);
  assert.equal(row.priority, "urgent");
  assert.equal(row.job_id, null);
  const audit = (await admin(`SELECT entity, surface_id, actor_id FROM audit_log WHERE event_id = $1`, [out.eventId]))[0]!;
  assert.equal(audit.entity, "service_request");
  assert.equal(audit.surface_id, "S6");
  assert.equal(audit.actor_id, USER_FM_AUSTIN);
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "service_request.created");

  await assert.rejects(fmAustin.gateway.createServiceRequest({ siteId: renoRoof, description: "x" }), (e: unknown) => code(fmAustin, e) === "unknown_site", "Reno is not there from Austin");
  await assert.rejects(fmAustin.gateway.createServiceRequest({ siteId: otherSite, description: "x" }), (e: unknown) => code(fmAustin, e) === "unknown_site", "nor is another customer's site");
  await assert.rejects(fmAustin.gateway.createServiceRequest({ siteId: austin, description: "x" }), (e: unknown) => code(fmAustin, e) === "not_a_site");
  await assert.rejects(fmAustin.gateway.createServiceRequest({ siteId: austinRoof, description: "   " }), (e: unknown) => code(fmAustin, e) === "empty_description");
  await assert.rejects(fmAustin.gateway.createServiceRequest({ siteId: austinRoof, priority: "pm", description: "x" } as never), (e: unknown) => refusal(fmAustin, e).kind === "bad_request");

  // The executive, bound to South, asks for work in WEST: the row's region is the site's.
  const west = await exec.gateway.createServiceRequest({ siteId: renoRoof, priority: "routine", description: "Schedule the spring PM visit." });
  assert.equal(west.regionId, REGION_WEST);

  assert.deepEqual((await fmAustin.gateway.listServiceRequests({})).requests.map((r) => r.id), [out.id], "Austin sees its own request");
  assert.deepEqual((await fmReno.gateway.listServiceRequests({})).requests.map((r) => r.id), [west.id], "Reno sees the executive's request at Reno — the site's, not the requester's");
  assert.deepEqual((await exec.gateway.listServiceRequests({})).requests.map((r) => r.id).sort(), [out.id, west.id].sort());
  assert.equal((await otherFm.gateway.listServiceRequests({})).requests.length, 0);
  const southDesk = (await s3.gateway.listServiceRequests({})).requests.map((r) => r.id);
  assert.ok(southDesk.includes(out.id) && !southDesk.includes(west.id), "the South dispatcher reads South's intake, not West's");
  assert.equal((await fmAustin.gateway.listServiceRequests({})).requests[0]!.siteName, "Austin — Basement AHU");
});

test("WHAT A CUSTOMER CANNOT DO: author a node, an agreement, a term or a job; assign; verify — each refused by scope before any handler runs", { skip }, async () => {
  await assert.rejects(exec.gateway.createAccount({ orgId: amped, tier: "location", parentId: southNode, name: "x" } as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.createContract({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.authorTermOverride({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.createJob({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.assignCrew({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.verifyCredential({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.listCrews({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  await assert.rejects(exec.gateway.candidateCrews({} as never), (e: unknown) => refusal(exec, e).kind === "scope");
  // And below the door, the unit of work: S6 may not write a contract even if a handler tried.
  await assert.rejects(
    asBinding(customerBinding(amped, REGION_SOUTH, "parent", amped, USER_EXEC), `INSERT INTO contracts (org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved) VALUES ($1,$2,'parent',$1,'msa','enterprise_sla','2026-01-01',daterange('2026-01-01',NULL,'[)'),true)`, [amped, REGION_SOUTH]),
    /row-level security|permission denied|violates/i,
    "a raw insert as a customer principal is refused at the table",
  );
});

test("sign out: the session is revoked and the copied token is dead", { skip }, async () => {
  const held = fmAustin.token()!;
  await fmAustin.logout();
  await assert.rejects(
    connectShell({ surfaceId: "S6", baseUrl: BASE, fetch, credentials: { token: held } }),
    (e: unknown) => { const r = (e as { refusal?: { kind: string; code?: string } }).refusal; return r?.kind === "token" && r.code === "revoked"; },
  );
  await Promise.all([fmReno.logout(), exec.logout(), otherFm.logout(), s3.logout(), s2.logout()]);
});
