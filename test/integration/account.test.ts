/**
 * THE ACCOUNT BUTTON OVER THE WIRE (0032) — a spawned gateway, a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... node --test --test-concurrency=1 test/integration/account.test.ts
 *
 * Claims: a person reads and sets only their own row — name, status, picture —
 * from any signed-in surface, including the read-only S4; a picture is judged
 * by its bytes and its size; a password change needs the current password,
 * ends every other session the person holds and keeps this one, and the old
 * password stops signing in; each change leaves an audit row naming no secret.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../services/gateway/src/pg-tx.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { GatewayRefusal, type SurfaceId } from "../../packages/contracts/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { hashPassword } from "../../services/gateway/src/auth.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — the account operations were not verified over the wire";
if (!URL_) test("account operations over the wire", { skip }, () => {});

const PORT = 26080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "first password, long enough";
const NEXT = "second password, also long";
const RUN = `acct-${Date.now().toString(36)}`;
const DEE = `dee-${RUN}@ac.test`;
const HQ = `hq-${RUN}@ac.test`;
const deeId = randomUUID(), hqId = randomUUID();
// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
const as = (email: string, surfaceId: SurfaceId, password = PASSWORD): Promise<ConnectedShell> =>
  connectShell({ surfaceId, baseUrl: BASE, fetch, credentials: { email, password } });
const refusedWith = (code: string) => (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "admission" && e.refusal.code === code;

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-account-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash)
    VALUES ($1,$3,$4,'internal',$5,'Dee Dispatcher','["dispatcher"]','region',$4,$7),
           ($2,$3,$4,'internal',$6,'Harper HQ','["ops_leadership"]','parent',$3,$7)`,
    [deeId, hqId, INTERNAL_ORG_ID, REGION_SOUTH, DEE, HQ, hash]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../services/gateway/src/main.ts", import.meta.url))], {
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

test("a person reads their own account, and sets name, status and note", { skip }, async () => {
  const s = await as(DEE, "S3");
  const me = await s.gateway.myAccount();
  assert.equal(me.userId, deeId);
  assert.equal(me.email, DEE);
  assert.equal(me.displayName, "Dee Dispatcher");
  assert.equal(me.presence, "available");
  assert.equal(me.avatar, null);
  assert.equal(me.passwordChangedAt, null);

  const set = await s.gateway.updateMyAccount({ displayName: "  Dee   D. ", presence: "busy", statusNote: "On the phone with Amped" });
  assert.equal(set.displayName, "Dee D.", "whitespace is folded");
  assert.equal(set.presence, "busy");
  assert.equal(set.statusNote, "On the phone with Amped");
  // Fields left out are left as they are; null clears the note.
  const cleared = await s.gateway.updateMyAccount({ statusNote: null });
  assert.equal(cleared.displayName, "Dee D.");
  assert.equal(cleared.presence, "busy");
  assert.equal(cleared.statusNote, null);

  await assert.rejects(s.gateway.updateMyAccount({ displayName: "   " }), refusedWith("blank_name"));
  await assert.rejects(s.gateway.updateMyAccount({ statusNote: "x".repeat(81) }), refusedWith("too_long"));
  await assert.rejects(s.gateway.updateMyAccount({ presence: "asleep" as never }), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "bad_request");
  await s.logout();
});

test("the read-only dashboard may still set its own picture — and a picture is judged by its bytes", { skip }, async () => {
  const s = await as(HQ, "S4");
  const withPic = await s.gateway.setAccountAvatar({ dataBase64: PNG });
  assert.deepEqual(withPic.avatar, { contentType: "image/png", image: PNG });
  assert.deepEqual((await s.gateway.myAccount()).avatar, { contentType: "image/png", image: PNG });
  await assert.rejects(s.gateway.setAccountAvatar({ dataBase64: Buffer.from("not a picture").toString("base64") }), refusedWith("not_a_photo"));
  const big = Buffer.alloc(70 * 1024); big.set([0xff, 0xd8, 0xff]);
  await assert.rejects(s.gateway.setAccountAvatar({ dataBase64: big.toString("base64") }), refusedWith("avatar_too_large"));
  assert.equal((await s.gateway.setAccountAvatar({ dataBase64: null })).avatar, null);
  // Nobody else's row moved.
  const [dee] = await admin("SELECT avatar FROM users WHERE id = $1", [deeId]);
  assert.equal(dee.avatar, null);
  await s.logout();
});

test("a password change needs the current one, ends every other session, keeps this one, and the old password stops working", { skip }, async () => {
  const here = await as(DEE, "S3");
  const elsewhere = await as(DEE, "S3");
  await assert.rejects(here.gateway.changePassword({ currentPassword: "wrong one, but long", newPassword: NEXT }), refusedWith("wrong_password"));
  await assert.rejects(here.gateway.changePassword({ currentPassword: PASSWORD, newPassword: "short" }), refusedWith("password_too_short"));
  await assert.rejects(here.gateway.changePassword({ currentPassword: PASSWORD, newPassword: PASSWORD }), refusedWith("password_unchanged"));

  const out = await here.gateway.changePassword({ currentPassword: PASSWORD, newPassword: NEXT });
  assert.equal(out.ok, true);
  assert.ok(out.endedSessions >= 1, `ended ${out.endedSessions}`);
  assert.ok((await here.gateway.myAccount()).passwordChangedAt, "this session stays, and says when");
  await assert.rejects(elsewhere.gateway.me(), (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "token");
  await assert.rejects(as(DEE, "S3", PASSWORD), (e: unknown) => e instanceof GatewayRefusal);
  await (await as(DEE, "S3", NEXT)).logout();
  await here.logout();
});

test("every change is audited as the person's own, and no audit row carries a secret or the picture", { skip }, async () => {
  const rows = await admin(`SELECT action, entity, entity_id, actor_id, surface_id, before, after FROM audit_log WHERE entity = 'user' AND entity_id = ANY($1) ORDER BY occurred_at`, [[deeId, hqId]]);
  const actions = rows.map((r: { action: string }) => r.action);
  assert.ok(actions.includes("account.update"));
  assert.ok(actions.includes("account.set_avatar"));
  assert.ok(actions.includes("account.change_password"));
  for (const r of rows as { entity_id: string; actor_id: string; before: unknown; after: unknown }[]) {
    assert.equal(r.actor_id, r.entity_id, "a person changes only their own account");
    const text = JSON.stringify([r.before, r.after]);
    assert.ok(!text.includes(PASSWORD) && !text.includes(NEXT) && !text.includes("scrypt$") && !text.includes(PNG), text);
  }
});
