/**
 * 0039 OVER THE WIRE — our regions kept in S2, and the CSV importer that loads
 * production data through the gateway, against a spawned gateway and a live
 * PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What this suite holds: only a principal opens, renames or closes a region;
 * a region is closed only when nothing lives in it, and the refusal names
 * what does; Unassigned is listed but never assignable, and every door that
 * takes a region refuses it; DFW is there from the migration. And the
 * importer — run as a separate process, its password on a pipe — loads the
 * sample CSVs (tools/import/templates) as rows S2 could have typed: audited,
 * by the principal, admitted by the gateway; a dry run writes nothing; a
 * second run creates nothing; a bad row is rejected by file and line in the
 * gateway's own words and leaves nothing of itself behind; and what it loaded
 * is enough to open a job and send a crew.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — regions and the importer were not verified over the wire";
if (!URL_) test("production data over the wire", { skip }, () => {});

const PORT = 24080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `5e000000-0000-0000-0000-${String(0x39000 + n).padStart(12, "0")}`;
const USER_PRINCIPAL = U(1), USER_OFFICE = U(2);
const PRINCIPAL_EMAIL = "principal.data@ac.test";
const PASSWORD = "correct horse battery staple";
const RUN = Date.now().toString(36).toUpperCase().slice(-5);
const TEMPLATES = fileURLToPath(new URL("../../tools/import/templates/", import.meta.url));
const MAIN = fileURLToPath(new URL("../../tools/import/main.ts", import.meta.url));
/** Three rows that must never land: a document window that ends before it starts, a region we do not serve, a response time off the register. */
const REJECTS = fileURLToPath(new URL("./fixtures/import-rejects/", import.meta.url));

let pool: Pool;
let gateway: ChildProcess;
let DFW = "";
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-production-data-test");
  DFW = (await admin(`SELECT id FROM regions WHERE code = 'DFW'`))[0]?.id;
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal',$5,'Data Principal','["principal"]','parent',$2,$4,true),
           ($6,$2,$3,'internal','office.data@ac.test','Data Office','["office_manager"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true, roles = EXCLUDED.roles, must_change_password = false`,
    [USER_PRINCIPAL, INTERNAL_ORG_ID, DFW, hash, PRINCIPAL_EMAIL, USER_OFFICE]);

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

const signIn = (surfaceId: "S2" | "S3", email: string, password = PASSWORD, newPassword?: string) =>
  connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email, password, ...(newPassword ? { newPassword } : {}) } });
const refusedWith = async (p: Promise<unknown>, ok: (r: Record<string, unknown>) => boolean, why: string) => {
  try { await p; } catch (e) {
    const r = (e as { refusal?: Record<string, unknown> }).refusal;
    assert.ok(r, `not a refusal: ${String(e)}`);
    assert.ok(ok(r), `${why} — got ${JSON.stringify(r)}`);
    return r;
  }
  assert.fail(`${why} — it was not refused`);
};
const scope = (r: Record<string, unknown>) => r.kind === "scope";
const code = (c: string) => (r: Record<string, unknown>) => r.kind === "admission" && r.code === c;

/** The importer as a person runs it: its own process, the password on standard input. */
const runImporter = (args: string[], email = PRINCIPAL_EMAIL): Promise<{ code: number; out: string }> => new Promise((resolve) => {
  const p = spawn(process.execPath, [MAIN, "--gateway", BASE, "--email", email, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  p.stdout!.on("data", (d) => { out += String(d); });
  p.stderr!.on("data", (d) => { out += String(d); });
  p.stdin!.end(`${PASSWORD}\n`);
  p.on("exit", (c) => resolve({ code: c ?? 1, out }));
});

let principal: ConnectedShell, office: ConnectedShell;
let regionId = "";
const CODE = `T${RUN}`;

test("DFW is there from the migration; Unassigned is listed and never assignable", { skip }, async () => {
  principal = await signIn("S2", PRINCIPAL_EMAIL);
  office = await signIn("S2", "office.data@ac.test");
  const { regions } = await principal.gateway.listRegions();
  const dfw = regions.find((r) => r.code === "DFW");
  assert.ok(dfw, "the launch region is seeded");
  assert.equal(dfw.name, "Dallas–Fort Worth");
  assert.equal(dfw.assignable, true);
  const unassigned = regions.find((r) => r.id === UNASSIGNED_REGION_ID)!;
  assert.equal(unassigned.active, true, "Unassigned stays — anonymous principals live in it");
  assert.equal(unassigned.assignable, false, "and no form is offered it");
});

test("only a principal opens, renames or closes a region — every other S2 role is refused at the gateway", { skip }, async () => {
  await refusedWith(office.gateway.createRegion({ code: CODE, name: "Nope" }), scope, "an office manager opens no region");
  await refusedWith(office.gateway.updateRegion({ regionId: DFW, name: "Nope" }), scope, "an office manager renames none");
  await refusedWith(office.gateway.setRegionActive({ regionId: DFW, active: false }), scope, "an office manager closes none");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM regions WHERE code = $1`, [CODE]))[0]!.n, 0);
});

test("a principal opens a region, its code fixed and unique, and renames it", { skip }, async () => {
  await refusedWith(principal.gateway.createRegion({ code: "dallas-1", name: "Bad" }), code("bad_code"), "a code is 2–8 capitals and digits");
  await refusedWith(principal.gateway.createRegion({ code: "DFW", name: "Again" }), code("code_taken"), "a code is unique");
  await refusedWith(principal.gateway.createRegion({ code: CODE, name: "X", timezone: "Mars/Olympus" }), code("bad_timezone"), "a timezone is an IANA zone");
  const made = await principal.gateway.createRegion({ code: CODE.toLowerCase(), name: `Test ${RUN}`, timezone: "America/Chicago" });
  regionId = made.id;
  let r = (await principal.gateway.listRegions()).regions.find((x) => x.id === regionId)!;
  assert.equal(r.code, CODE, "the code is stored in capitals");
  assert.equal(r.assignable, true);
  await principal.gateway.updateRegion({ regionId, name: `Renamed ${RUN}` });
  r = (await principal.gateway.listRegions()).regions.find((x) => x.id === regionId)!;
  assert.equal(r.name, `Renamed ${RUN}`);
  assert.equal(r.code, CODE, "a rename leaves the code");
  await refusedWith(principal.gateway.updateRegion({ regionId, name: `Renamed ${RUN}` }), code("no_change"), "the same name is no change");
  const audit = await admin(`SELECT action, actor_id FROM audit_log WHERE entity = 'region' AND entity_id = $1 ORDER BY occurred_at`, [regionId]);
  assert.deepEqual(audit.map((a) => a.action), ["region.create", "region.rename"]);
  assert.ok(audit.every((a) => a.actor_id === USER_PRINCIPAL), "audited as the principal");
});

test("a region that still holds a crew or a login is not closed, and the refusal names them; an empty one is, and is then offered nowhere", { skip }, async () => {
  const crew = await principal.gateway.createCrew({ label: `Crew ${RUN}`, employmentType: "employed", kind: "install", homeRegionId: regionId });
  const login = await principal.gateway.createStaffLogin({ email: `region.${RUN.toLowerCase()}@ac.test`, displayName: `Rae ${RUN}`, roles: ["dispatcher"], scope: "region", regionId });
  const r = await refusedWith(principal.gateway.setRegionActive({ regionId, active: false }), code("region_in_use"), "a region in use is not closed");
  assert.match(String(r.message), new RegExp(`1 active login \\(Rae ${RUN}\\)`));
  assert.match(String(r.message), new RegExp(`1 active crew \\(Crew ${RUN}\\)`));

  await principal.gateway.updateCrew({ crewId: crew.id, active: false });
  await principal.gateway.setPersonActive({ userId: login.userId, active: false });
  await principal.gateway.setRegionActive({ regionId, active: false });
  const closed = (await principal.gateway.listRegions()).regions.find((x) => x.id === regionId)!;
  assert.deepEqual([closed.active, closed.assignable], [false, false]);
  await refusedWith(principal.gateway.createCrew({ label: `Late ${RUN}`, employmentType: "employed", homeRegionId: regionId }), code("unknown_region"), "nothing new is filed under a closed region");
  await principal.gateway.setRegionActive({ regionId, active: true });
  assert.equal((await principal.gateway.listRegions()).regions.find((x) => x.id === regionId)!.assignable, true, "opened again");
});

test("Unassigned is refused by every door that takes a region, and is never renamed or closed", { skip }, async () => {
  const unassigned = code("unassigned_region");
  await refusedWith(principal.gateway.updateRegion({ regionId: UNASSIGNED_REGION_ID, name: "Pre-account" }), unassigned, "not renamed");
  await refusedWith(principal.gateway.setRegionActive({ regionId: UNASSIGNED_REGION_ID, active: false }), unassigned, "not closed");
  await refusedWith(principal.gateway.createOrganization({ name: `Nowhere ${RUN}`, firstRegionNode: { regionId: UNASSIGNED_REGION_ID, name: "Nowhere" } }), unassigned, "no customer is served from it");
  await refusedWith(principal.gateway.createCrew({ label: `Nowhere ${RUN}`, employmentType: "employed", homeRegionId: UNASSIGNED_REGION_ID }), unassigned, "no crew is dispatched from it");
  await refusedWith(principal.gateway.createFirm({ legalName: `Nowhere ${RUN}`, regionId: UNASSIGNED_REGION_ID, settlementTermsDays: 30, diagnosticDataRightsReserved: true }), unassigned, "no firm");
  await refusedWith(principal.gateway.registerDevice({ hardwareId: `NOWHERE-${RUN}`, kind: "web_fallback", regionId: UNASSIGNED_REGION_ID }), unassigned, "no device");
  await refusedWith(principal.gateway.createStaffLogin({ email: `nowhere.${RUN.toLowerCase()}@ac.test`, displayName: "Nowhere", roles: ["dispatcher"], scope: "region", regionId: UNASSIGNED_REGION_ID }), code("unknown_region"), "no login");
});

// ---- the importer ----
const counts = async () => (await admin(`SELECT
    (SELECT count(*) FROM organizations)::int AS orgs, (SELECT count(*) FROM accounts)::int AS accounts,
    (SELECT count(*) FROM contracts)::int AS contracts, (SELECT count(*) FROM contract_term_overrides)::int AS terms,
    (SELECT count(*) FROM subcontractor_firms)::int AS firms, (SELECT count(*) FROM crews)::int AS crews,
    (SELECT count(*) FROM technicians)::int AS techs, (SELECT count(*) FROM crew_credentials)::int AS creds,
    (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM audit_log)::int AS audits`))[0]!;

test("the importer is a principal's: another S2 role is sent away before anything is read", { skip }, async () => {
  const r = await runImporter([TEMPLATES], "office.data@ac.test");
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /not a principal/);
});

test("a dry run validates every sample row and writes nothing", { skip }, async () => {
  const before = await counts();
  const r = await runImporter(["--dry-run", TEMPLATES]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /DRY RUN/);
  assert.doesNotMatch(r.out, /REJECTED/);
  assert.deepEqual(await counts(), before, "not a row, not an audit entry");
});

test("the sample CSVs land as rows S2 could have typed — audited, by the principal — and a second run creates nothing", { skip }, async () => {
  const since = (await admin(`SELECT now() AS t`))[0]!.t;
  const first = await runImporter(["--verify-credentials", TEMPLATES]);
  assert.equal(first.code, 0, first.out);

  const org = (await admin(`SELECT id, segment FROM organizations WHERE external_ref = 'CUST-1001'`))[0]!;
  assert.equal(org.segment, "commercial");
  const sites = await admin(`SELECT name, external_ref, address->>'city' AS city, region_id FROM accounts WHERE org_id = $1 AND tier = 'site' ORDER BY external_ref`, [org.id]);
  assert.deepEqual(sites.map((s) => [s.external_ref, s.city]), [["ALL-3", "Fort Worth"], ["NPC-A", "Dallas"], ["NPC-B", "Dallas"]]);
  assert.ok(sites.every((s) => s.region_id === DFW), "filed under DFW");
  assert.equal((await admin(`SELECT count(*)::int AS n FROM organizations WHERE external_ref = 'CUST-2001' AND segment = 'residential'`))[0]!.n, 1);
  const msa = (await admin(`SELECT id, state FROM contracts WHERE org_id = $1 AND kind = 'msa' AND scope_tier = 'parent'`, [org.id]));
  assert.equal(msa.length, 1);
  assert.equal(msa[0]!.state, "active");
  const terms = Object.fromEntries((await admin(`SELECT term_key, term_value FROM contract_term_overrides WHERE contract_id = $1`, [msa[0]!.id])).map((t) => [t.term_key, t.term_value]));
  assert.deepEqual(terms, { sla_response: "4_hour", sla_credit_pct: 10, pm_visits_per_year: 2, payment_terms_days: 30, labor_rate_minor: "12500", diagnostic_data_rights_reserved: true });
  assert.equal((await admin(`SELECT status FROM subcontractor_firms WHERE legal_name = 'Trinity Air Contractors LLC'`))[0]!.status, "active");
  const logins = await admin(`SELECT email, must_change_password, crew_id FROM users WHERE email IN ('maria.lopez@example.com', 'dev.patel@example.com') ORDER BY email`);
  assert.equal(logins.length, 2);
  assert.ok(logins.every((l) => l.crew_id), "each technician login comes with its own unit");
  const creds = await admin(`SELECT c.kind, c.verified_at IS NOT NULL AS verified FROM crew_credentials c JOIN crews w ON w.id = c.crew_id WHERE w.label = 'Maria Lopez' AND w.home_region_id = $1`, [DFW]);
  assert.deepEqual(creds.map((c) => c.kind).sort(), ["background_check", "license"]);
  assert.ok(creds.every((c) => c.verified), "--verify-credentials verified them");
  const audited = await admin(`SELECT DISTINCT actor_id, surface_id FROM audit_log WHERE occurred_at >= $1`, [since]);
  assert.ok(audited.every((a) => a.actor_id === USER_PRINCIPAL && a.surface_id === "S2"), `every write this run made is audited as the principal, through S2: ${JSON.stringify(audited)}`);
  const made = await admin(`SELECT a.surface_id, u.roles FROM audit_log a JOIN users u ON u.id = a.actor_id WHERE a.entity_id = $1 AND a.action = 'organization.create'`, [org.id]);
  assert.equal(made.length, 1, "the customer was made once, and audited");
  assert.equal(made[0]!.surface_id, "S2");
  assert.ok((made[0]!.roles as string[]).includes("principal"), "by a principal");

  const before = await counts();
  const second = await runImporter(["--verify-credentials", TEMPLATES]);
  assert.equal(second.code, 0, second.out);
  for (const f of ["firms", "crews", "technicians", "credentials", "customers", "agreements"]) {
    assert.match(second.out, new RegExp(`${f}\\.csv\\s+\\d+ rows\\s+0 created, 0 updated`), `${f}.csv: nothing created or updated on the second run\n${second.out}`);
  }
  assert.deepEqual(await counts(), before, "the second run wrote nothing at all");
});

test("what was loaded is enough to work: a job opens on the agreed response time and an imported technician clears the gate", { skip }, async () => {
  const dispatcher = await principal.gateway.createStaffLogin({ email: `dispatch.${RUN.toLowerCase()}@ac.test`, displayName: `Dispatch ${RUN}`, roles: ["dispatcher"], scope: "region", regionId: DFW });
  const s3 = await signIn("S3", `dispatch.${RUN.toLowerCase()}@ac.test`, dispatcher.temporaryPassword, `${PASSWORD} ${RUN}`);
  const site = (await s3.gateway.listSites()).sites.find((s) => s.name === "Building A — Rooftop")!;
  assert.ok(site, "the imported site is on the DFW dispatcher's list");
  const day = new Date(Date.now() + 2 * 86400_000);
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 15)).toISOString();
  const end = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 19)).toISOString();
  const job = await s3.gateway.createJob({ siteId: site.id, serviceCode: "HVAC-REPAIR", priority: "urgent", serviceWindowStart: start, serviceWindowEnd: end });
  assert.equal(job.responseTerm, "4_hour");
  const unit = (await admin(`SELECT crew_id FROM users WHERE email = 'maria.lopez@example.com'`))[0]!.crew_id as string;
  const out = await s3.gateway.assignCrew({ jobId: job.id, crewId: unit, orgId: site.orgId, regionId: DFW });
  assert.equal(out.ok, true, `the imported, verified documents clear the whole window — got ${JSON.stringify(out)}`);
  await s3.logout();
});

test("a bad row is rejected by file and line in the gateway's words, and leaves nothing of itself behind", { skip }, async () => {
  const before = await counts();
  const r = await runImporter([REJECTS]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /credentials\.csv:3\s+REJECTED\s+license REJECT-0001 is valid from 2027-06-01 to 2027-01-01 — a window that ends before it starts covers no day at all/, "the gateway's own words, by line");
  assert.match(r.out, /customers\.csv:2\s+REJECTED\s+region ZZZ is not one we serve from/);
  assert.match(r.out, /agreements\.csv:2\s+REJECTED\s+.*sla_response/);
  assert.match(r.out, /credentials\.csv\s+2 rows\s+0 created, 0 updated, 1 already there, 1 rejected/);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM crew_credentials WHERE identifier = 'REJECT-0001'`))[0]!.n, 0);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM organizations WHERE external_ref = 'REJECT-0001'`))[0]!.n, 0);
  assert.equal((await admin(`SELECT count(*)::int AS n FROM contracts c JOIN organizations o ON o.id = c.org_id WHERE o.external_ref = 'CUST-1001' AND lower(c.effective) = '2027-01-01'`))[0]!.n, 0, "the agreement was not opened for a term the register refuses");
  assert.deepEqual(await counts(), before, "nothing at all was written");
  await principal.logout();
  await office.logout();
});
