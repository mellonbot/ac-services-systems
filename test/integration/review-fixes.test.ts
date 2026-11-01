/**
 * THE 2026-10-22 REVIEW, PROVEN — the findings that were a door, each asserted
 * the way it now holds, against a live PostgreSQL and a spawned gateway.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 *   - a request refused at the unit of work released its connection (it did
 *     not: ten of them hung the gateway);
 *   - an unbound transaction reads nothing (0021: it read every tenant);
 *   - tables that had no row security now have it;
 *   - a customer binding cannot write the jobs it can see;
 *   - projects are absent outside the office and the field.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/pg-tx.ts";
import { hashPassword } from "../../services/gateway/src/auth.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the review fixes were not verified against a database";
if (!URL_) test("review fixes", { skip }, () => {});

const PORT = 24080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `e2100000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_FINANCE = U(1);
const PASSWORD = "correct horse battery staple";

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
    await c.query("ROLLBACK");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};
const customer = (org: string) => ({ "ac.namespace": "customer", "ac.org_id": org, "ac.region_id": REGION_SOUTH, "ac.scope_tier": "parent", "ac.scope_id": org });

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-review-fixes-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','finance.r21@ac.test','Finance','["finance"]','parent',$2,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_FINANCE, INTERNAL_ORG_ID, REGION_SOUTH, hashPassword(PASSWORD)]);
  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../services/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_ }, stdio: ["ignore", "pipe", "pipe"],
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

test("a refusal at the unit of work releases its connection: twenty role-refused requests, and the gateway still answers", { skip }, async () => {
  const login = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "finance.r21@ac.test", password: PASSWORD, surface: "S2" }) });
  assert.equal(login.status, 200);
  const { token } = await login.json() as { token: string };
  const me = (surface: string) => fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${token}`, "x-ac-surface": surface }, signal: AbortSignal.timeout(5_000) });
  // Finance is not admitted to S3 — a refusal the unit of work makes after a connection is held. Twice the pool.
  for (let i = 0; i < 20; i++) assert.equal((await me("S3")).status, 403);
  assert.equal((await me("S2")).status, 200);
});

test("an unbound transaction reads nothing; the gateway acting as itself reads what it needs", { skip }, async () => {
  assert.equal((await asBinding({}, `SELECT 1 FROM users`)).rowCount, 0);
  assert.equal((await asBinding({}, `SELECT 1 FROM sessions`)).rowCount, 0);
  assert.equal((await asBinding({}, `SELECT 1 FROM audit_log`)).rowCount, 0);
  assert.ok((await asBinding({ "ac.namespace": "system" }, `SELECT 1 FROM users WHERE id = $1`, [USER_FINANCE])).rowCount === 1);
});

test("the warehouse cannot read a password hash", { skip }, async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_readonly");
    await assert.rejects(c.query("SELECT password_hash FROM users"), /permission denied/);
  } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
});

test("sync_conflicts, subscriptions and brand_themes are behind row security: a customer reads none of another tenant's, and writes no theme", { skip }, async () => {
  const forced = await admin(`SELECT relname FROM pg_class WHERE relname = ANY($1) AND relrowsecurity AND relforcerowsecurity`, [["sync_conflicts", "subscriptions", "brand_themes"]]);
  assert.equal(forced.length, 3);
  const someone = U(50);
  assert.equal((await asBinding(customer(someone), `SELECT 1 FROM sync_conflicts`)).rowCount, 0);
  assert.equal((await asBinding(customer(someone), `SELECT 1 FROM subscriptions`)).rowCount, 0);
  assert.equal((await asBinding(customer(someone), `SELECT 1 FROM brand_themes WHERE org_id <> $1`, [someone])).rowCount, 0);
  assert.equal((await asBinding(customer(someone), `UPDATE brand_themes SET accent = accent`)).rowCount, 0);
});

test("a customer binding writes no job, even one it can see", { skip }, async () => {
  const job = (await admin(`SELECT id, org_id FROM jobs LIMIT 1`))[0] as { id: string; org_id: string } | undefined;
  if (!job) return;
  // Bound as the job's own customer at parent scope, so the read policy alone would admit it.
  assert.equal((await asBinding(customer(job.org_id), `UPDATE jobs SET priority = priority WHERE id = $1`, [job.id])).rowCount, 0);
  assert.equal((await asBinding({ "ac.namespace": "internal", "ac.scope_tier": "parent" }, `UPDATE jobs SET priority = priority WHERE id = $1`, [job.id])).rowCount, 1);
});

test("projects are absent outside the office and the field", { skip }, async () => {
  for (const ns of ["customer", "subcontractor", "anonymous"]) {
    assert.equal((await asBinding({ "ac.namespace": ns, "ac.region_id": REGION_SOUTH }, `SELECT 1 FROM projects`)).rowCount, 0);
  }
});

test("ten wrong passwords and the email is shut for the window from that address — even to the right one; the response is 429, not a token refusal", { skip }, async () => {
  const attempt = (password: string) => fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "finance.r21@ac.test", password, surface: "S2" }) });
  for (let i = 0; i < 10; i++) assert.equal((await attempt("wrong")).status, 401);
  assert.equal((await attempt(PASSWORD)).status, 429);
});

test("the relay parks a row it cannot publish: it is not read again, so it cannot starve the rows behind it", { skip }, async () => {
  const { beginTx } = await import("../../services/gateway/src/pg-tx.ts");
  const { relayOnce, PARKED } = await import("../../services/worker/src/relay.ts");
  const eventId = crypto.randomUUID();
  await admin(`INSERT INTO outbox (event_id, topic, entity, entity_id, payload, actor_id, surface_id, region_id, org_id, attempts)
    VALUES ($1,'job.created','job',gen_random_uuid(),'{}',$2,'test',$3,$4,$5)`, [eventId, USER_FINANCE, REGION_SOUTH, INTERNAL_ORG_ID, PARKED]);
  const seen: string[] = [];
  for (;;) {
    const tx = await beginTx(pool);
    if ((await relayOnce(tx, { async publish(events) { for (const e of events) seen.push(e.eventId); } })).published === 0) break;
  }
  assert.equal(seen.includes(eventId), false);
  assert.equal((await admin(`SELECT published_at FROM outbox WHERE event_id = $1`, [eventId]))[0]!.published_at, null);
});
