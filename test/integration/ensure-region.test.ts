/**
 * A REGION ON A FRESH PRODUCTION DATABASE — tools/ops/ensure-region.ts, run as
 * production runs it: a non-superuser login that holds ac_gateway WITH SET and
 * no BYPASSRLS. Since 0021 `regions_write` admits only the system namespace, so
 * seed-logins' old bare psql INSERT was refused there; CI's superuser never saw it.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, type Pool } from "../../services/gateway/src/db/pg-tx.ts";
import { ensureRegion } from "../../tools/ops/ensure-region.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — ensure-region was not verified against a database";
if (!URL_) test("ensure-region", { skip }, () => {});

const LOGIN = "ac_ensure_region_login";
const LOGIN_PASSWORD = "ensure-region-only";
const CODE = `ER${Date.now().toString(36).toUpperCase()}`;

let admin: Pool;
let pool: Pool;

before(async () => {
  if (!URL_) return;
  admin = createPool(URL_, "ac-ensure-region-admin");
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN}') THEN
      CREATE ROLE ${LOGIN} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${LOGIN_PASSWORD}';
    END IF;
  END $$`);
  await admin.query(`GRANT ac_gateway TO ${LOGIN} WITH SET TRUE`);
  const url = new URL(URL_);
  url.username = LOGIN;
  url.password = LOGIN_PASSWORD;
  pool = createPool(url.toString(), "ac-ensure-region-test");
});

after(async () => {
  if (admin) await admin.query("DELETE FROM regions WHERE code LIKE $1", [`${CODE}%`]);
  await pool?.end();
  await admin?.end();
});

test("a non-superuser holding ac_gateway creates the region", { skip }, async () => {
  const region = await ensureRegion(pool, CODE, "Ensure Region Test");
  assert.equal(region.code, CODE);
  assert.equal(region.active, true);
  const { rows } = await admin.query<{ n: string }>("SELECT count(*) AS n FROM regions WHERE code = $1", [CODE]);
  assert.equal(Number(rows[0]!.n), 1);
});

test("a second run returns the same row", { skip }, async () => {
  const first = await ensureRegion(pool, CODE, "Ensure Region Test");
  const again = await ensureRegion(pool, CODE, "Other Name");
  assert.equal(again.id, first.id);
  assert.equal(again.name, "Ensure Region Test");
});

test("the code is trimmed and upper-cased", { skip }, async () => {
  const region = await ensureRegion(pool, ` ${CODE.toLowerCase()}2 `, "x");
  assert.equal(region.code, `${CODE}2`);
});

test("a malformed code is refused before touching the database", { skip }, async () => {
  await assert.rejects(ensureRegion(pool, "dfw-1", "x"), /region code/);
});
