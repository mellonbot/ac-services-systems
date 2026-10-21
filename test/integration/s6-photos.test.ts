/**
 * PHOTOS ON A REQUEST, OVER THE WIRE — S6 through the shell, against a
 * spawned gateway writing to a real directory store and a live PostgreSQL.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * What 0017 makes true, each a test below:
 *   - the customer who made a request attaches photos; the bytes land in the
 *     store under region/org/request_photo/id and come back byte for byte;
 *   - a photo is seen wherever its request is: the executive above, the
 *     office's dispatcher in the region; NOT a manager at another location,
 *     NOT another customer — for them it is unknown, not forbidden;
 *   - only the requester attaches, only before a job is open, at most six —
 *     and the database refuses the same rows when the handler is bypassed;
 *   - a photo row cannot carry another tenancy's object.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { PHOTOS_PER_REQUEST } from "../../packages/contracts/src/operations.ts";
import { diskStore, storageKey } from "../../packages/storage/src/index.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — request photos (0017) were not verified over the wire";
if (!URL_) test("request photos over the wire", { skip }, () => {});

const PORT = 25080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `d7000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP = U(2), USER_FM_AUSTIN = U(3), USER_FM_AUSTIN_2 = U(4), USER_FM_RENO = U(5), USER_EXEC = U(6), USER_OTHER = U(7);
const PASSWORD = "correct horse battery staple";
const RUN = `d7-${Date.now().toString(36)}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001080600000" + "01f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const b64 = (b: Buffer) => b.toString("base64");

let pool: Pool;
let gateway: ChildProcess;
/** The gateway creates it on first write; the test reads back through the same store interface, never around it. */
const storeDir = join(tmpdir(), `ac-photos-${RUN}`);
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
const customerBinding = (orgId: string, regionId: string, scopeTier: string, scopeId: string, actor: string) => ({
  "ac.namespace": "customer", "ac.org_id": orgId, "ac.region_id": regionId, "ac.scope_tier": scopeTier, "ac.scope_id": scopeId,
  "ac.firm_id": "", "ac.device_id": "", "ac.actor_id": actor, "ac.surface_id": "S6",
});

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-photos-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.d7@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.south.d7@ac.test','South Dispatcher','["dispatcher"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test", AC_STORAGE_DIR: storeDir },
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
const code = (s: ConnectedShell, e: unknown): string | null => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return "code" in r! ? r!.code : null; };
const refusedWith = async (s: ConnectedShell, p: Promise<unknown>, expected: string) => {
  try { await p; } catch (e) { assert.equal(code(s, e), expected); return; }
  assert.fail(`expected a refusal ${expected}, and it was admitted`);
};

let amped = "", southNode = "", austin = "", austinRoof = "", reno = "";
let other = "", otherLoc = "";
let fmAustin: ConnectedShell, fmAustin2: ConnectedShell, fmReno: ConnectedShell, exec: ConnectedShell, otherFm: ConnectedShell, disp: ConnectedShell;
let request = "", photoJpeg = "", photoPng = "";

test("fixture: Amped at Austin and Reno, another customer in the same region, and the people who will look", { skip }, async () => {
  const s2 = await shell("S2", "owner.d7@ac.test");
  const a = await s2.gateway.createOrganization({ name: `Amped Photos ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: "Amped / South" } });
  amped = a.orgId; southNode = a.regionNodeId;
  const westNode = (await s2.gateway.createAccount({ orgId: amped, tier: "region", regionId: REGION_WEST, name: "Amped / West" })).id;
  austin = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: southNode, name: "Austin" })).id;
  austinRoof = (await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: austin, name: "Austin — Roof" })).id;
  reno = (await s2.gateway.createAccount({ orgId: amped, tier: "location", parentId: westNode, name: "Reno" })).id;
  await s2.gateway.createAccount({ orgId: amped, tier: "site", parentId: reno, name: "Reno — Roof" });
  const o = await s2.gateway.createOrganization({ name: `Other Photos ${RUN}`, externalRef: `${RUN}-other`, firstRegionNode: { regionId: REGION_SOUTH, name: "Other / South" } });
  other = o.orgId;
  otherLoc = (await s2.gateway.createAccount({ orgId: other, tier: "location", parentId: o.regionNodeId, name: "Other HQ" })).id;

  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'customer',$4,'Austin FM','[]','location',$5,$6,true),
           ($7,$2,$3,'customer',$8,'Austin FM 2','[]','location',$5,$6,true),
           ($9,$2,$10,'customer',$11,'Reno FM','[]','location',$12,$6,true),
           ($13,$2,$3,'customer',$14,'Amped Exec','[]','parent',$2,$6,true),
           ($15,$16,$3,'customer',$17,'Other FM','[]','location',$18,$6,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, region_id = EXCLUDED.region_id, scope_id = EXCLUDED.scope_id, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_FM_AUSTIN, amped, REGION_SOUTH, `fm.austin.${RUN}@amped.test`, austin, hash,
     USER_FM_AUSTIN_2, `fm2.austin.${RUN}@amped.test`,
     USER_FM_RENO, REGION_WEST, `fm.reno.${RUN}@amped.test`, reno,
     USER_EXEC, `exec.${RUN}@amped.test`,
     USER_OTHER, other, `fm.${RUN}@other.test`, otherLoc]);
  fmAustin = await shell("S6", `fm.austin.${RUN}@amped.test`);
  fmAustin2 = await shell("S6", `fm2.austin.${RUN}@amped.test`);
  fmReno = await shell("S6", `fm.reno.${RUN}@amped.test`);
  exec = await shell("S6", `exec.${RUN}@amped.test`);
  otherFm = await shell("S6", `fm.${RUN}@other.test`);
  disp = await shell("S3", "disp.south.d7@ac.test");
});

test("the requester attaches a JPEG and a PNG; the bytes land in the store under region/org/request_photo/id and come back byte for byte", { skip }, async () => {
  request = (await fmAustin.gateway.createServiceRequest({ siteId: austinRoof, priority: "urgent", description: "No cooling — server closet unit." })).id;
  const j = await fmAustin.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(JPEG) });
  const p = await fmAustin.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(PNG) });
  photoJpeg = j.id; photoPng = p.id;
  assert.equal(j.contentType, "image/jpeg");
  assert.equal(p.contentType, "image/png");
  assert.deepEqual(Buffer.from(await diskStore(storeDir).get(storageKey(REGION_SOUTH, amped, "request_photo", photoJpeg))), JPEG);

  const mine = (await fmAustin.gateway.listServiceRequests({ siteId: austinRoof })).requests.find((r) => r.id === request)!;
  assert.deepEqual(mine.photos, [{ id: photoJpeg, contentType: "image/jpeg", bytes: JPEG.length }, { id: photoPng, contentType: "image/png", bytes: PNG.length }], "oldest first");
  const got = await fmAustin.gateway.getMedia({ id: photoPng });
  assert.equal(got.image, `data:image/png;base64,${b64(PNG)}`);
  const audit = await admin(`SELECT entity, action FROM audit_log WHERE entity_id = $1`, [photoJpeg]);
  assert.deepEqual(audit, [{ entity: "photo", action: "service_request.attach_photo" }]);
});

test("a photo is seen wherever its request is — the executive, the region's dispatcher — and is unknown, not forbidden, to everyone else", { skip }, async () => {
  assert.equal((await exec.gateway.getMedia({ id: photoJpeg })).contentType, "image/jpeg", "the executive, above the location");
  assert.equal((await disp.gateway.getMedia({ id: photoJpeg })).contentType, "image/jpeg", "the office, by region (S3)");
  assert.equal((await fmAustin2.gateway.getMedia({ id: photoJpeg })).contentType, "image/jpeg", "a colleague at the same location sees the request, so the photo");
  await refusedWith(fmReno, fmReno.gateway.getMedia({ id: photoJpeg }), "unknown_photo");
  await refusedWith(otherFm, otherFm.gateway.getMedia({ id: photoJpeg }), "unknown_photo");
  // and at the table, under their own bindings: zero rows, not an error
  assert.equal((await asBinding(customerBinding(amped, REGION_WEST, "location", reno, USER_FM_RENO), `SELECT id FROM service_request_media WHERE id = $1`, [photoJpeg])).length, 0);
  assert.equal((await asBinding(customerBinding(other, REGION_SOUTH, "location", otherLoc, USER_OTHER), `SELECT id FROM storage_objects WHERE id = $1`, [photoJpeg])).length, 0);
});

test("refused over the wire, each in its own words: a colleague's photo, an invisible request, a file that is not a photo, the seventh, and any after a job is open", { skip }, async () => {
  await refusedWith(fmAustin2, fmAustin2.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(JPEG) }), "not_your_request");
  await refusedWith(fmReno, fmReno.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(JPEG) }), "unknown_request");
  await refusedWith(fmAustin, fmAustin.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(Buffer.from("%PDF-1.7 a quote")) }), "not_a_photo");
  for (let n = 2; n < PHOTOS_PER_REQUEST; n++) await fmAustin.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(JPEG) });
  await refusedWith(fmAustin, fmAustin.gateway.attachServiceRequestPhoto({ requestId: request, dataBase64: b64(JPEG) }), "too_many_photos");

  const second = (await fmAustin.gateway.createServiceRequest({ siteId: austinRoof, description: "Noise from RTU-2." })).id;
  const job = (await admin(`INSERT INTO jobs (org_id, region_id, site_id, service_code, priority, state, service_window)
    VALUES ($1, $2, $3, 'HVAC-REPAIR', 'urgent', 'created', tstzrange(now() + interval '1 day', now() + interval '1 day 4 hours')) RETURNING id`, [amped, REGION_SOUTH, austinRoof]))[0]!.id as string;
  await admin(`UPDATE service_requests SET job_id = $1 WHERE id = $2`, [job, second]);
  await refusedWith(fmAustin, fmAustin.gateway.attachServiceRequestPhoto({ requestId: second, dataBase64: b64(JPEG) }), "job_open");
});

test("the database refuses the same rows when the handler is bypassed: another person's request, and a photo row carrying another tenancy's object", { skip }, async () => {
  const third = (await fmAustin.gateway.createServiceRequest({ siteId: austinRoof, description: "Thermostat dark." })).id;
  const obj = randomUUID(), foreign = randomUUID(), wrongRegion = randomUUID();
  // The colleague writes an object as itself (admitted: its own org), then tries to hang it on the requester's request.
  await asBinding(customerBinding(amped, REGION_SOUTH, "location", austin, USER_FM_AUSTIN_2),
    `INSERT INTO storage_objects (id, org_id, region_id, storage_key, content_type, byte_size, sha256, uploaded_by) VALUES ($1,$2,$3,$4,'image/jpeg',1,'\\x00',$5)`,
    [obj, amped, REGION_SOUTH, `${REGION_SOUTH}/${amped}/request_photo/${obj}`, USER_FM_AUSTIN_2]);
  await assert.rejects(asBinding(customerBinding(amped, REGION_SOUTH, "location", austin, USER_FM_AUSTIN_2),
    `INSERT INTO service_request_media (id, org_id, region_id, request_id, storage_object_id, uploaded_by) VALUES ($1,$2,$3,$4,$1,$5)`,
    [obj, amped, REGION_SOUTH, third, USER_FM_AUSTIN_2]), /row-level security/);
  // Another org's object cannot be written as Amped's at all.
  await assert.rejects(asBinding(customerBinding(amped, REGION_SOUTH, "location", austin, USER_FM_AUSTIN),
    `INSERT INTO storage_objects (id, org_id, region_id, storage_key, content_type, byte_size, sha256, uploaded_by) VALUES ($1,$2,$3,'k','image/jpeg',1,'\\x00',$4)`,
    [foreign, other, REGION_SOUTH, USER_FM_AUSTIN]), /row-level security/);
  // Unbound (the tenancy trigger, not a policy): Reno's region on an Austin request.
  await admin(`INSERT INTO storage_objects (id, org_id, region_id, storage_key, content_type, byte_size, sha256, uploaded_by) VALUES ($1,$2,$3,$4,'image/jpeg',1,'\\x00',$5)`,
    [wrongRegion, amped, REGION_WEST, `${REGION_WEST}/${amped}/request_photo/${wrongRegion}`, USER_FM_AUSTIN]);
  await assert.rejects(admin(`INSERT INTO service_request_media (id, org_id, region_id, request_id, storage_object_id, uploaded_by) VALUES ($1,$2,$3,$4,$1,$5)`,
    [wrongRegion, amped, REGION_WEST, third, USER_FM_AUSTIN]), /does not match the tenancy of its request and its object/);
});
