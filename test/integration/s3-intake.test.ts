/**
 * THE OFFICE ANSWERS A REQUEST, OVER THE WIRE — S3's Intake against a spawned
 * gateway and a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What serviceRequests.openJob and 0018 make true, each a test below:
 *   - the region's dispatcher opens a job at the REQUEST's site, with the SLA
 *     timer derived from the site's agreed term, and the request is linked in
 *     the same unit of work — the customer's work order moves on its own;
 *   - a request is answered once; a second press is told which job answered it;
 *   - another region's dispatcher cannot see the request to answer it, and a
 *     customer cannot call the operation at all;
 *   - with the handler bypassed, a customer cannot update its request, and
 *     nobody can re-point an answered one or answer it with another site's job.
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
import { stateMsaTerms } from "../../packages/domain/src/inheritance/fixtures/msa-terms.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — opening a job from a request was not verified over the wire";
if (!URL_) test("intake over the wire", { skip }, () => {});

const PORT = 26080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d3100000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP_SOUTH = U(2), USER_DISP_WEST = U(3), USER_FM_AUSTIN = U(4);
const PASSWORD = "correct horse battery staple";
const RUN = `d31-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
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

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-intake-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d31@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.south.d31@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true),
           ($6,$2,$7,'internal','disp.west.d31@ac.test','West Dispatcher','["dispatcher"]','region',$7,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
    [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP_SOUTH, USER_DISP_WEST, REGION_WEST]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" },
    stdio: ["ignore", "pipe", "pipe"],
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

const shell = (surfaceId: "S2" | "S3" | "S6", email: string) => connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
/** A code for a 422 the handler named; `scope` for a 403 (surface, role or tenancy). */
const refusedWith = async (s: ConnectedShell, p: Promise<unknown>, expected: string) => {
  try { await p; } catch (e) {
    const r = s.refusalOf(e);
    assert.ok(r, `not a refusal: ${String(e)}`);
    assert.equal(expected === "scope" ? r!.kind : "code" in r! ? r!.code : null, expected, r!.message);
    return;
  }
  assert.fail(`expected a refusal ${expected}, and it was admitted`);
};
const window_ = (days: number) => ({
  serviceWindowStart: new Date(Date.now() + days * 86_400_000).toISOString(),
  serviceWindowEnd: new Date(Date.now() + days * 86_400_000 + 4 * 3_600_000).toISOString(),
});

let amped = "", austin = "", austinRoof = "", renoRoof = "";
let disp: ConnectedShell, dispWest: ConnectedShell, fm: ConnectedShell;
let request = "", job = "";

test("fixture: Amped under an agreement with a 4-hour response, a site in South and one in West, and the people who will act", { skip }, async () => {
  const s2 = await shell("S2", "owner.d31@ac.test");
  const a = await s2.gateway.createOrganization({ name: `Amped Intake ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
  amped = a.orgId;
  const westNode = (await s2.gateway.createAccount({ orgId: amped, tier: "region", regionId: REGION_WEST, name: "Amped / West" })).id;
  austin = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: a.regionNodeId, name: "Austin" })).id;
  austinRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: "Austin — Roof" })).id;
  const reno = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: westNode, name: "Reno" })).id;
  renoRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: reno, name: "Reno — Roof" })).id;
  const msa = (await s2.gateway.createContract({ orgId: amped, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: amped, kind: "msa", billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true })).id;
  await stateMsaTerms(s2.gateway, { contractId: msa, orgId: amped, regionId: REGION_SOUTH, effectiveFrom: "2026-01-01" });
  await s2.gateway.transitionContract({ contractId: msa, to: "active" });

  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'customer',$4,'Austin FM','["payer","requester"]','location',$5,$6,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, scope_id = EXCLUDED.scope_id, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_FM_AUSTIN, amped, REGION_SOUTH, `fm.austin.${RUN}@amped.test`, austin, hashPassword(PASSWORD)]);
  fm = await shell("S6", `fm.austin.${RUN}@amped.test`);
  disp = await shell("S3", "disp.south.d31@ac.test");
  dispWest = await shell("S3", "disp.west.d31@ac.test");
  request = (await fm.gateway.createServiceRequest({ siteId: austinRoof, priority: "urgent", description: "No cooling — server closet unit." })).id;
});

test("the South dispatcher answers the request: a job at the request's site, the SLA derived from the agreement, the request linked — and the customer sees it move", { skip }, async () => {
  const before = Date.now();
  const out = await disp.gateway.openServiceRequestJob({ requestId: request, serviceCode: "repairs", ...window_(1) });
  job = out.id;
  assert.equal(out.requestId, request);
  assert.equal(out.responseTerm, "4_hour", "derived from the site's agreed term, not chosen");
  const due = Date.parse(out.dueAt);
  assert.ok(due >= before + 4 * 3_600_000 - 60_000 && due <= Date.now() + 4 * 3_600_000 + 60_000, "four hours from opening");
  const row = (await admin(`SELECT site_id, priority, state FROM jobs WHERE id = $1`, [job]))[0]!;
  assert.deepEqual(row, { site_id: austinRoof, priority: "urgent", state: "created" }, "the request's site, the customer's declared priority");
  assert.equal((await admin(`SELECT job_id FROM service_requests WHERE id = $1`, [request]))[0]!.job_id, job);
  const audit = await admin(`SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at`, [request]);
  assert.ok(audit.some((a) => a.action === "service_request.open_job"));
  const mine = (await fm.gateway.listServiceRequests({})).requests.find((r) => r.id === request)!;
  assert.equal(mine.jobId, job);
  assert.equal(mine.jobState, "created");
});

test("answered once: a second press is told which job answered it, and nothing new is opened", { skip }, async () => {
  const jobsBefore = (await admin(`SELECT count(*)::int AS n FROM jobs WHERE site_id = $1`, [austinRoof]))[0]!.n;
  try { await disp.gateway.openServiceRequestJob({ requestId: request, serviceCode: "repairs", ...window_(2) }); assert.fail("admitted twice"); }
  catch (e) { const r = disp.refusalOf(e)!; assert.equal("code" in r ? r.code : null, "already_opened"); assert.match(r.message, new RegExp(job)); }
  assert.equal((await admin(`SELECT count(*)::int AS n FROM jobs WHERE site_id = $1`, [austinRoof]))[0]!.n, jobsBefore);
});

test("another region's dispatcher cannot see a request to answer it; a customer cannot call the operation at all", { skip }, async () => {
  const second = (await fm.gateway.createServiceRequest({ siteId: austinRoof, description: "Noise from RTU-2." })).id;
  await refusedWith(dispWest, dispWest.gateway.openServiceRequestJob({ requestId: second, serviceCode: "repairs", ...window_(1) }), "unknown_request");
  await refusedWith(fm, fm.gateway.openServiceRequestJob({ requestId: second, serviceCode: "repairs", ...window_(1) }), "scope");
  assert.equal((await admin(`SELECT job_id FROM service_requests WHERE id = $1`, [second]))[0]!.job_id, null);
});

test("with the handler bypassed: a customer cannot update its request, an answer is final, and an answer must be at the request's site", { skip }, async () => {
  const third = (await fm.gateway.createServiceRequest({ siteId: austinRoof, description: "Thermostat dark." })).id;
  const customer = { "ac.namespace": "customer", "ac.org_id": amped, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "location", "ac.scope_id": austin, "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": USER_FM_AUSTIN, "ac.surface_id": "S6" };
  const touched = await asBinding(customer, `UPDATE service_requests SET description = 'rewritten', job_id = $2 WHERE id = $1 RETURNING id`, [third, job]);
  assert.equal(touched.length, 0, "0018's restrictive policy: the customer's own row, and still no update");
  assert.equal((await admin(`SELECT description FROM service_requests WHERE id = $1`, [third]))[0]!.description, "Thermostat dark.");

  await assert.rejects(admin(`UPDATE service_requests SET job_id = NULL WHERE id = $1`, [request]), (e: { code?: string; message: string }) => e.code === "AC422" && /the link is final/.test(e.message));
  const renoJob = (await admin(`INSERT INTO jobs (org_id, region_id, site_id, service_code, priority, state, service_window)
    VALUES ($1, $2, $3, 'repairs', 'routine', 'created', tstzrange(now(), now() + interval '4 hours')) RETURNING id`, [amped, REGION_WEST, renoRoof]))[0]!.id as string;
  await assert.rejects(admin(`UPDATE service_requests SET job_id = $1 WHERE id = $2`, [renoJob, third]), (e: { code?: string; message: string }) => e.code === "AC422" && /is not at the site/.test(e.message));
});

test("New job, no request behind it: the South dispatcher picks from South's sites only, opens a job there with the SLA derived, and is refused at a West site", { skip }, async () => {
  const south = (await disp.gateway.listSites()).sites.filter((s) => s.orgId === amped);
  assert.deepEqual(south.map((s) => s.id), [austinRoof], "South's site, and not Reno's");
  assert.equal(south[0]!.orgName, `Amped Intake ${RUN}`);
  const west = (await dispWest.gateway.listSites()).sites.filter((s) => s.orgId === amped);
  assert.deepEqual(west.map((s) => s.id), [renoRoof]);

  const out = await disp.gateway.createJob({ siteId: austinRoof, serviceCode: "phone_call", priority: "routine", ...window_(2) });
  assert.equal(out.responseTerm, "4_hour", "derived from the site's agreed term, not chosen");
  const row = (await admin(`SELECT site_id, region_id, state FROM jobs WHERE id = $1`, [out.id]))[0]!;
  assert.deepEqual(row, { site_id: austinRoof, region_id: REGION_SOUTH, state: "created" });

  await refusedWith(disp, disp.gateway.createJob({ siteId: renoRoof, serviceCode: "phone_call", ...window_(2) }), "scope");
});
