/**
 * ITEM 8 OVER THE WIRE — S1 Marketing / Lead-Gen: the anonymous namespace
 * (0008) as a stranger sees it, and S1's two writes through the real gateway.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What the render tests cannot say: that the ROWS are right. S1 is the first
 * surface whose principal is nobody, so the sentence under test is narrower
 * than any before it and easier to get wrong in one direction:
 *
 *   AN ANONYMOUS PRINCIPAL WRITES TWICE AND READS NOTHING.
 *
 * The first table-level test states what its binding reads now. Before 0008
 * it read every lead ever captured — name, email, phone and the free-text
 * note — every call record, and `regions`, which carries `min_crew_density`:
 * the D14 supply rule, readable from the marketing surface's own binding.
 * None of it through a screen, which 0006 and 0007 each already rejected as
 * a mechanism.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, openAnonymousShell, type AnonymousShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { ANONYMOUS_PRINCIPAL_IDS } from "../../packages/contracts/src/scope.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — item 8 (S1) was not verified over the wire";
if (!URL_) test("item 8 over the wire", { skip }, () => {});

const PORT = 25080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1);
const PASSWORD = "correct horse battery staple";
const RUN = `d1-${Date.now().toString(36)}`;
/** A region that exists, is active, and is not UNASSIGNED — what `ac_public_coverage()` should name. */
const REGION_COVER = U(9);

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
/** Exactly what the gateway binds for S1 — apps/gateway/src/context.ts scopeBinding(ANONYMOUS_PRINCIPAL, "S1"). */
const anonBinding = {
  "ac.namespace": "anonymous", "ac.org_id": PROSPECT_ORG_ID, "ac.region_id": UNASSIGNED_REGION_ID,
  "ac.scope_tier": "parent", "ac.scope_id": PROSPECT_ORG_ID,
  "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": ANONYMOUS_PRINCIPAL_IDS.actor, "ac.surface_id": "S1",
};
const customerBinding = {
  "ac.namespace": "customer", "ac.org_id": U(50), "ac.region_id": REGION_SOUTH,
  "ac.scope_tier": "parent", "ac.scope_id": U(50),
  "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": U(51), "ac.surface_id": "S6",
};
const count = async (b: Record<string, string>, table: string, where = "", params: unknown[] = []) =>
  (await asBinding(b, `SELECT count(*)::int AS n FROM ${table} ${where}`, params))[0]!.n as number;

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-item8-test");
  await admin(`INSERT INTO regions (id, code, name, active) VALUES ($1,'SOUTH','South',true), ($2,'COVER','Covered Metro',true) ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH, REGION_COVER]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d1@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash]);
  // A lead already in the table, so "reads nothing" is a claim about rows that exist.
  await admin(`INSERT INTO leads (id, org_id, region_id, source, contact, requested_metro, submission_id)
    VALUES ($1,$2,$3,'referral',$4::jsonb,'Houston',$5) ON CONFLICT DO NOTHING`,
    [U(20), PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, JSON.stringify({ name: `Existing ${RUN}`, email: "someone@example.com", phone: "555 9999" }), randomUUID()]);
  await admin(`INSERT INTO call_records (id, org_id, region_id, lead_id, direction, occurred_at)
    VALUES ($1,$2,$3,$4,'outbound', now()) ON CONFLICT DO NOTHING`, [U(21), PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, U(20)]);

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

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.d1@ac.test", password: PASSWORD } });
const visitor = (): AnonymousShell => openAnonymousShell({ surfaceId: "S1", baseUrl: BASE, fetch, session: "bearer", page: null });
const code = (s: { refusalOf(e: unknown): unknown }, e: unknown): string | null => {
  const r = s.refusalOf(e) as { code?: string } | null;
  return r && "code" in r ? r.code ?? null : null;
};
const lead = (submissionId: string) => ({
  submissionId, source: "web_form" as const,
  contact: { name: `Visitor ${RUN}`, phone: "555 0101", note: "Roof unit short-cycling." },
  requestedMetro: "Covered Metro",
});

// ---------------------------------------------------------------------------
// 1. What the anonymous binding reads. This is the migration, stated as rows.
// ---------------------------------------------------------------------------

test("AT THE BINDING: an anonymous principal reads zero rows on every table that holds anything", { skip }, async () => {
  // Leads and call records exist — the seed put them there — and this
  // principal cannot see them. Before 0008 both tables had no policy at all.
  assert.equal(await count(anonBinding, "leads"), 0, "not even its own: a form that can read its submissions is an enumeration endpoint");
  assert.equal(await count(anonBinding, "call_records"), 0);
  // `regions` carries min_crew_density — D14, the supply rule. It had no policy.
  assert.equal(await count(anonBinding, "regions"), 0, "our shard boundary and the D14 rule are not a marketing page's to read");

  // A zero is only worth asserting against a table that HAS rows. This test
  // passed vacuously on a fresh database until the full suite ran it after
  // everything else and `sessions` — 65 rows, no policy — failed it. So the
  // rows are counted as us first, and a table that is empty in this run is
  // named rather than silently counted as proof.
  const ADMIN = `SELECT count(*)::int AS n FROM `;
  const populated: string[] = [];
  const empty: string[] = [];
  const TABLES = ["accounts", "jobs", "assignments", "crews", "crew_credentials", "compliance_clearances",
                  "contracts", "contract_term_overrides", "service_requests", "settlements", "settlement_lines",
                  "working_capital_positions", "users", "audit_log", "outbox", "sla_timers", "invoices",
                  "sessions", "devices", "device_grants", "checklist_items", "time_entries"];
  for (const t of TABLES) {
    assert.equal(await count(anonBinding, t), 0, `${t} answers a stranger with nothing`);
    ((Number((await admin(ADMIN + t))[0]!.n) > 0) ? populated : empty).push(t);
  }
  assert.ok(populated.includes("sessions"), "sessions must have rows here, or the zero above proves nothing");
  assert.ok(populated.includes("users"), "users must have rows here, or the zero above proves nothing");
  if (empty.length) console.log(`      (empty in this run, so their zero proves nothing: ${empty.join(", ")})`);
});

test("the ONE row an anonymous principal may see is the PROSPECT root it writes into, and that is on purpose", { skip }, async () => {
  const orgs = await asBinding(anonBinding, `SELECT id, name FROM organizations`);
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0]!.id, PROSPECT_ORG_ID);
});

test("the same closure holds for the OTHER external namespaces — a customer could read every lead too", { skip }, async () => {
  assert.equal(await count(customerBinding, "leads"), 0, "a customer on S6 has no business reading our intake");
  assert.equal(await count(customerBinding, "call_records"), 0);
  assert.equal(await count(customerBinding, "regions"), 0, "nor the D14 rule");
});

test("AT THE TABLE: a stranger cannot write outside PROSPECT/UNASSIGNED, cannot pre-convert a lead, and cannot edit one after", { skip }, async () => {
  const id = randomUUID();
  const contact = JSON.stringify({ name: "Forger", phone: "555" });
  await assert.rejects(() => asBinding(anonBinding,
    `INSERT INTO leads (id, org_id, region_id, source, contact, submission_id) VALUES ($1,$2,$3,'web_form',$4::jsonb,$5)`,
    [id, INTERNAL_ORG_ID, REGION_SOUTH, contact, randomUUID()]), /row-level security|policy/i,
    "the INSERT policy pins the tenancy");

  await assert.rejects(() => asBinding(anonBinding,
    `INSERT INTO leads (id, org_id, region_id, source, contact, submission_id, converted_account_id) VALUES ($1,$2,$3,'web_form',$4::jsonb,$5,$6)`,
    [id, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, contact, randomUUID(), U(60)]), /unconverted|conversion is S2/i,
    "conversion is S2's, on the day someone signs");

  await assert.rejects(() => asBinding(anonBinding,
    `INSERT INTO leads (id, org_id, region_id, source, contact, submission_id) VALUES ($1,$2,$3,'web_form',$4::jsonb,$5)`,
    [id, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, JSON.stringify({ name: "No Way To Answer" }), randomUUID()]), /email or a phone number/i);

  await assert.rejects(() => asBinding(anonBinding,
    `INSERT INTO leads (id, org_id, region_id, source, contact, submission_id) VALUES ($1,$2,$3,'billboard',$4::jsonb,$5)`,
    [id, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, contact, randomUUID()]), /not one S1 may declare/i);

  await assert.rejects(() => asBinding(anonBinding,
    `INSERT INTO leads (id, org_id, region_id, source, contact) VALUES ($1,$2,$3,'web_form',$4::jsonb)`,
    [id, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, contact]), /submission id/i,
    "a queued lead carries the id it will be replayed under");

  // An UPDATE it cannot even see the row for: zero rows, and the trigger behind that.
  const updated = await asBinding(anonBinding, `UPDATE leads SET requested_metro = 'Elsewhere' WHERE id = $1 RETURNING id`, [U(20)]);
  assert.equal(updated.length, 0, "a lead is ours once it is made");
});

test("AT THE TABLE: an anonymous call record is inbound — 'we called them' is not a stranger's to assert", { skip }, async () => {
  await assert.rejects(() => asBinding(anonBinding,
    `INSERT INTO call_records (id, org_id, region_id, direction, occurred_at) VALUES ($1,$2,$3,'outbound', now())`,
    [randomUUID(), PROSPECT_ORG_ID, UNASSIGNED_REGION_ID]), /row-level security|policy/i);
  await assert.doesNotReject(() => asBinding(anonBinding,
    `INSERT INTO call_records (id, org_id, region_id, direction, occurred_at) VALUES ($1,$2,$3,'inbound', now())`,
    [randomUUID(), PROSPECT_ORG_ID, UNASSIGNED_REGION_ID]));
});

// ---------------------------------------------------------------------------
// 2. Over the wire, as the surface actually runs.
// ---------------------------------------------------------------------------

test("the coverage read answers with metro names and NOTHING else — no density, no id, no timezone", { skip }, async () => {
  const s = visitor();
  const out = await s.gateway.coverage();
  assert.ok(out.metros.length >= 1);
  for (const m of out.metros) {
    assert.deepEqual(Object.keys(m).sort(), ["code", "name"], "two columns; widening the claim is a diff on a migration");
  }
  assert.ok(out.metros.some((m) => m.code === "COVER"), "an active region is named");
  assert.equal(out.metros.some((m) => m.code === "UNASSIGNED"), false, "UNASSIGNED is a home for orphans, not a metro");
  assert.equal(JSON.stringify(out).includes("min_crew_density"), false);
});

test("the coverage read needs no session — it is the page a stranger loads before anyone is anybody", { skip }, async () => {
  const s = visitor();
  const before = Number((await admin(`SELECT count(*)::int AS n FROM sessions WHERE surface_id = 'S1'`))[0]!.n);
  await s.gateway.coverage();
  const after = Number((await admin(`SELECT count(*)::int AS n FROM sessions WHERE surface_id = 'S1'`))[0]!.n);
  assert.equal(after, before, "no session row per page view");
  assert.equal(s.token(), null);
});

test("a lead submitted through the shell lands in PROSPECT/UNASSIGNED, with a real session and a real audit row", { skip }, async () => {
  const s = visitor();
  const submissionId = randomUUID();
  await s.ensureSession();
  assert.ok(s.token(), "the session is minted at the first write, not at boot");
  const out = await s.gateway.submitLead(lead(submissionId));

  const rows = await admin(`SELECT org_id, region_id, source, contact, requested_metro, submission_id, converted_account_id FROM leads WHERE id = $1`, [out.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.org_id, PROSPECT_ORG_ID);
  assert.equal(rows[0]!.region_id, UNASSIGNED_REGION_ID);
  assert.equal(rows[0]!.submission_id, submissionId);
  assert.equal(rows[0]!.converted_account_id, null);
  assert.equal((rows[0]!.contact as { name: string }).name, `Visitor ${RUN}`);

  const audit = await admin(`SELECT actor_id, surface_id, session_id, action, entity FROM audit_log WHERE entity_id = $1`, [out.id]);
  assert.equal(audit.length, 1, "the audit row landed in the same transaction");
  assert.equal(audit[0]!.surface_id, "S1");
  assert.equal(audit[0]!.actor_id, ANONYMOUS_PRINCIPAL_IDS.actor, "a named nobody, not an invented user");
  assert.ok(audit[0]!.session_id, "and a real session, so two submissions from one visitor are distinguishable");

  const sess = await admin(`SELECT principal_kind, org_id, region_id, surface_id FROM sessions WHERE id = $1`, [audit[0]!.session_id]);
  assert.equal(sess[0]!.principal_kind, "anonymous");
  assert.equal(sess[0]!.surface_id, "S1");

  const out_ = await admin(`SELECT topic, payload FROM outbox WHERE entity_id = $1`, [out.id]);
  assert.equal(out_[0]!.topic, "lead.captured");
  assert.equal(JSON.stringify(out_[0]!.payload).includes("555 0101"), false, "the envelope carries no contact details");
});

test("THE REPLAY: the same submission id twice is one lead and a named refusal, not two phone calls", { skip }, async () => {
  const s = visitor();
  const submissionId = randomUUID();
  await s.ensureSession();
  const first = await s.gateway.submitLead(lead(submissionId));
  let refusedCode: string | null = null;
  try {
    await s.gateway.submitLead(lead(submissionId));
    assert.fail("a replay of a landed lead must be refused");
  } catch (e) {
    refusedCode = code(s, e);
  }
  assert.equal(refusedCode, "leads_submission_id_key", "the constraint name is what the buffer reads as 'already landed'");
  const n = await admin(`SELECT count(*)::int AS n FROM leads WHERE submission_id = $1`, [submissionId]);
  assert.equal(n[0]!.n, 1);
  assert.ok(first.id);
});

test("a lead we cannot answer is refused over the wire, by the handler, before the table sees it", { skip }, async () => {
  const s = visitor();
  await s.ensureSession();
  try {
    await s.gateway.submitLead({ submissionId: randomUUID(), source: "web_form", contact: { name: "No Way To Answer" } });
    assert.fail("expected a refusal");
  } catch (e) {
    assert.equal(code(s, e), "no_way_to_answer");
  }
});

test("a call record from the surface is inbound and needs no lead", { skip }, async () => {
  const s = visitor();
  await s.ensureSession();
  const out = await s.gateway.recordCall({ direction: "inbound", occurredAt: new Date().toISOString() });
  const rows = await admin(`SELECT lead_id, direction, org_id, region_id FROM call_records WHERE id = $1`, [out.id]);
  assert.equal(rows[0]!.lead_id, null);
  assert.equal(rows[0]!.direction, "inbound");
  assert.equal(rows[0]!.org_id, PROSPECT_ORG_ID);
});

test("an anonymous token is refused every operation the catalogue does not serve to S1", { skip }, async () => {
  const s = visitor();
  await s.ensureSession();
  const token = s.token()!;
  for (const [path, method] of [["/me", "GET"], ["/regions", "GET"], ["/s2/organizations", "GET"], ["/s6/service-requests", "POST"]] as const) {
    const r = await fetch(`${BASE}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, "x-ac-surface": "S1", "content-type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.ok(r.status === 403 || r.status === 404, `${method} ${path} → ${r.status}; an anonymous token opens nothing else`);
  }
});

test("the office reads what the stranger wrote — the lead is ours, and that is the whole point of it landing somewhere", { skip }, async () => {
  const v = visitor();
  const submissionId = randomUUID();
  await v.ensureSession();
  const out = await v.gateway.submitLead(lead(submissionId));
  const rows = await asBinding({
    "ac.namespace": "internal", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION_SOUTH,
    "ac.scope_tier": "parent", "ac.scope_id": INTERNAL_ORG_ID, "ac.firm_id": "", "ac.device_id": "",
    "ac.actor_id": USER_OWNER, "ac.surface_id": "S2",
  }, `SELECT contact FROM leads WHERE id = $1`, [out.id]);
  assert.equal(rows.length, 1);
  assert.equal((rows[0]!.contact as { phone: string }).phone, "555 0101");
});

test("a device login still resolves its own region — closing `regions` cost no principal its context", { skip }, async () => {
  // The one namespace besides ours that reads `regions` at login is `device`
  // (apps/gateway/src/context.ts). 0008's policy admits its own row and no other.
  const deviceBinding = {
    "ac.namespace": "device", "ac.org_id": INTERNAL_ORG_ID, "ac.region_id": REGION_SOUTH,
    "ac.scope_tier": "region", "ac.scope_id": REGION_SOUTH, "ac.firm_id": "", "ac.device_id": U(70),
    "ac.actor_id": U(71), "ac.surface_id": "S5",
  };
  const own = await asBinding(deviceBinding, `SELECT id FROM regions WHERE id = $1`, [REGION_SOUTH]);
  assert.equal(own.length, 1, "its own region is visible");
  const other = await asBinding(deviceBinding, `SELECT id FROM regions WHERE id = $1`, [REGION_COVER]);
  assert.equal(other.length, 0, "and no other");
});

test("the office can still open a session on every surface that had one — the item changed no existing login", { skip }, async () => {
  const s = await owner();
  assert.equal(s.principal.namespace, "internal");
  assert.ok((await s.gateway.listRegions()).regions.length >= 1, "an internal principal still reads regions");
  await s.logout();
});
