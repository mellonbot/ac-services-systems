/**
 * COMPANY MESSAGES OVER THE WIRE (0035) — a spawned gateway, a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... node --test --test-concurrency=1 test/integration/messages.test.ts
 *
 * Claims: an employee can message one other employee, or every employee.
 * A customer, a vendor, and a person on a firm's crew are not in the
 * directory and get no copy. The sender gets no copy of their own. Dismissing
 * removes it from the corner. A second everyone-send inside the gap is refused.
 *
 * The migrate suite shares one database, so the directory is every employee
 * already in it — seed logins and rows earlier tests left — not only the
 * people this file inserts.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { GatewayRefusal, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — company messages were not verified over the wire";
if (!URL_) test("company messages over the wire", { skip }, () => {});

const PORT = 27080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "first password, long enough";
const RUN = `msg-${Date.now().toString(36)}`;
const DEE = `dee-${RUN}@ac.test`;
const HQ = `hq-${RUN}@ac.test`;
const RILEY = `riley-${RUN}@ac.test`;
const PAT = `pat-${RUN}@ac.test`;
const VERA = `vera-${RUN}@ac.test`;
const SAM = `sam-${RUN}@ac.test`;
const deeId = randomUUID(), hqId = randomUUID(), rileyId = randomUUID();
const patId = randomUUID(), veraId = randomUUID(), samId = randomUUID();
const firmOrgId = randomUUID(), firmId = randomUUID(), crewId = randomUUID();

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows as Record<string, unknown>[]; } finally { c.release(); }
};
const as = (email: string, surfaceId: SurfaceId): Promise<ConnectedShell> =>
  connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email, password: PASSWORD } });
const refusedWith = (code: string) => (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "admission" && e.refusal.code === code;
const ids = (people: readonly { userId: string }[]) => people.map((p) => p.userId).sort();
/** The handler's employee rule, so the directory can be checked against whoever this database already holds. */
const EMPLOYEE = `u.namespace = 'internal' AND u.active AND u.firm_id IS NULL AND (u.crew_id IS NULL OR EXISTS (SELECT 1 FROM crews c WHERE c.id = u.crew_id AND c.firm_id IS NULL))`;
const employeesExcept = async (userId: string): Promise<string[]> =>
  (await admin(`SELECT u.id FROM users u WHERE ${EMPLOYEE} AND u.id <> $1 ORDER BY u.id`, [userId])).map((r) => String(r.id));

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-messages-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'subcontractor')`, [firmOrgId, `Firm ${RUN}`]);
  await admin(
    `INSERT INTO subcontractor_firms (id, org_id, region_id, legal_name, status, settlement_terms_days, diagnostic_data_rights_reserved)
     VALUES ($1, $2, $3, $4, 'active', 30, true)`,
    [firmId, firmOrgId, REGION_SOUTH, `Firm ${RUN}`],
  );
  await admin(
    `INSERT INTO crews (id, org_id, region_id, label, employment_type, firm_id, home_region_id)
     VALUES ($1, $2, $3, $4, 'subcontracted', $5, $3)`,
    [crewId, firmOrgId, REGION_SOUTH, `Crew ${RUN}`, firmId],
  );
  await admin(
    `INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, crew_id, firm_id)
     VALUES
       ($1,$8,$9,'internal',$10,'Dee Dispatcher','["dispatcher"]','region',$9,$7,NULL,NULL),
       ($2,$8,$9,'internal',$11,'Harper HQ','["ops_leadership"]','parent',$8,$7,NULL,NULL),
       ($3,$8,$9,'internal',$12,'Riley Office','["office_manager"]','parent',$8,$7,NULL,NULL),
       ($4,$8,$9,'customer',$13,'Pat Customer','["requester"]','parent',$8,$7,NULL,NULL),
       ($5,$8,$9,'vendor',$14,'Vera Vendor','[]','parent',$8,$7,NULL,NULL),
       ($6,$15,$9,'internal',$16,'Sam On a firm crew','["technician"]','region',$9,$7,$17,NULL)`,
    [deeId, hqId, rileyId, patId, veraId, samId, hash, INTERNAL_ORG_ID, REGION_SOUTH, DEE, HQ, RILEY, PAT, VERA, firmOrgId, SAM, crewId],
  );

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

test("an employee messages one colleague, or everyone employed here, and outsiders get nothing", { skip }, async () => {
  const dee = await as(DEE, "S3");
  const people = (await dee.gateway.listColleagues()).people;
  assert.deepEqual(ids(people), (await employeesExcept(deeId)).sort());
  for (const outsider of [deeId, patId, veraId, samId]) assert.equal(people.some((p) => p.userId === outsider), false, outsider);
  assert.equal(people.find((p) => p.userId === hqId)?.displayName, "Harper HQ");
  assert.equal(people.find((p) => p.userId === rileyId)?.displayName, "Riley Office");

  const sent = await dee.gateway.sendMessage({ body: "  Call me when you are free. ", toUserId: hqId });
  assert.equal(sent.recipients, 1);
  const copies = (await admin(`SELECT user_id FROM staff_message_receipts WHERE message_id = $1`, [sent.messageId])).map((r) => r.user_id);
  assert.deepEqual(copies, [hqId]);

  const harper = await as(HQ, "S4");
  const popped = (await harper.gateway.pendingMessages()).messages.find((m) => m.messageId === sent.messageId);
  assert.ok(popped);
  assert.equal(popped.body, "Call me when you are free.");
  assert.equal(popped.senderName, "Dee Dispatcher");
  assert.equal(popped.audience, "direct");
  assert.equal((await dee.gateway.pendingMessages()).messages.some((m) => m.messageId === sent.messageId), false, "the sender has no pop-up of their own");

  const colleagues = await employeesExcept(hqId);
  const all = await harper.gateway.sendMessage({ body: "Stand down.", everyone: true });
  assert.equal(all.recipients, colleagues.length);
  const heard = (await admin(`SELECT user_id FROM staff_message_receipts WHERE message_id = $1 ORDER BY user_id`, [all.messageId])).map((r) => String(r.user_id));
  assert.deepEqual([...heard].sort(), [...colleagues].sort());
  for (const outsider of [hqId, patId, veraId, samId]) assert.equal(heard.includes(outsider), false, outsider);

  const riley = await as(RILEY, "S2");
  const rileyPending = await riley.gateway.pendingMessages();
  const heardByRiley = rileyPending.messages.find((m) => m.messageId === all.messageId);
  assert.ok(heardByRiley);
  assert.equal(heardByRiley.body, "Stand down.");
  assert.equal(heardByRiley.audience, "everyone");
  await riley.gateway.dismissMessage({ messageId: all.messageId });
  assert.equal((await riley.gateway.pendingMessages()).messages.some((m) => m.messageId === all.messageId), false);
  const recent = await riley.gateway.recentMessages();
  assert.equal(recent.messages.find((m) => m.messageId === all.messageId)?.dismissed, true);

  await assert.rejects(harper.gateway.sendMessage({ body: "Again.", everyone: true }), refusedWith("everyone_too_soon"));
  await assert.rejects(dee.gateway.sendMessage({ body: "hi", toUserId: deeId }), refusedWith("not_yourself"));
  await assert.rejects(dee.gateway.sendMessage({ body: "hi", toUserId: patId }), refusedWith("not_a_colleague"));
  await assert.rejects(dee.gateway.sendMessage({ body: "hi", toUserId: samId }), refusedWith("not_a_colleague"));
  await assert.rejects(dee.gateway.sendMessage({ body: "   " }), (e: unknown) => e instanceof GatewayRefusal && (e.refusal.kind === "bad_request" || (e.refusal.kind === "admission" && e.refusal.code === "blank_message")));

  await dee.logout();
  await harper.logout();
  await riley.logout();
});
