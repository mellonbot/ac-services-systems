#!/usr/bin/env node
/**
 * SEED THE TEST LOGINS — superadmin-test, dispatcher-test, service_manager-test
 * (definitions and the surfaces each must open: ./test-logins.ts).
 *
 *   DATABASE_URL=postgres://… AC_TEST_LOGIN_PASSWORD=… [AC_TEST_LOGIN_REGION=SOUTH] \
 *     node tools/ci/seed-test-logins.ts
 *
 * Idempotent: a second run re-applies roles, scope and password to the same
 * three rows (matched by email) and reactivates them. The password is never a
 * default and never in the repository — every seeded database gets the one it
 * is given. The region is a region CODE; it may be omitted only when the
 * database has exactly one real service region, because a login's region is a
 * fact about who it is and is not guessed.
 *
 * Runs unbound as ac_gateway, exactly as the gateway's own login does: `users`
 * admits an unbound writer and nothing broader is needed.
 */
import { fileURLToPath } from "node:url";
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { TEST_LOGINS, testLoginRow, MIN_TEST_LOGIN_PASSWORD } from "./test-logins.ts";

export type SeededLogin = { readonly id: string; readonly email: string; readonly roles: readonly string[]; readonly scopeTier: string };

/** A region id from its code, or the only real region when no code is given. */
export const resolveRegion = async (pool: Pool, code?: string): Promise<{ id: string; code: string }> => {
  const tx = await beginTx(pool, "ac_gateway");
  try {
    const rows = await tx.query<{ id: string; code: string }>(
      "SELECT id, code FROM regions WHERE active AND id <> $1 ORDER BY code", [UNASSIGNED_REGION_ID]);
    if (code) {
      const hit = rows.find((r) => r.code === code.trim().toUpperCase());
      if (!hit) throw new Error(`no active region with code ${code}; known: [${rows.map((r) => r.code).join(", ") || "none"}]`);
      return hit;
    }
    if (rows.length === 1) return rows[0]!;
    throw new Error(rows.length === 0
      ? "this database has no service region yet — create one before seeding logins (only anonymous principals may be UNASSIGNED)"
      : `set AC_TEST_LOGIN_REGION to one of [${rows.map((r) => r.code).join(", ")}]`);
  } finally {
    await tx.rollback().catch(() => {});
  }
};

export const seedTestLogins = async (pool: Pool, opts: { readonly password: string; readonly regionId: string }): Promise<readonly SeededLogin[]> => {
  if (opts.password.length < MIN_TEST_LOGIN_PASSWORD) throw new Error(`the test-login password must be at least ${MIN_TEST_LOGIN_PASSWORD} characters`);
  const hash = hashPassword(opts.password);
  const tx = await beginTx(pool, "ac_gateway");
  try {
    const out: SeededLogin[] = [];
    for (const t of TEST_LOGINS) {
      const r = testLoginRow(t, opts.regionId);
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO users (org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,true)
         ON CONFLICT (email) DO UPDATE SET org_id = EXCLUDED.org_id, region_id = EXCLUDED.region_id, namespace = EXCLUDED.namespace,
           display_name = EXCLUDED.display_name, roles = EXCLUDED.roles, scope_tier = EXCLUDED.scope_tier, scope_id = EXCLUDED.scope_id,
           firm_id = NULL, crew_id = NULL, password_hash = EXCLUDED.password_hash, active = true
         RETURNING id`,
        [r.org_id, r.region_id, r.namespace, r.email, r.display_name, JSON.stringify(r.roles), r.scope_tier, r.scope_id, hash],
      ))[0]!;
      out.push({ id: row.id, email: t.email, roles: t.roles, scopeTier: r.scope_tier });
    }
    await tx.commit();
    return out;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const url = process.env.DATABASE_URL;
  const password = process.env.AC_TEST_LOGIN_PASSWORD;
  if (!url || !password) {
    console.error("DATABASE_URL and AC_TEST_LOGIN_PASSWORD are required. Nothing was written.");
    process.exit(2);
  }
  const pool = createPool(url, "ac-seed-test-logins");
  try {
    const region = await resolveRegion(pool, process.env.AC_TEST_LOGIN_REGION);
    for (const s of await seedTestLogins(pool, { password, regionId: region.id })) {
      const t = TEST_LOGINS.find((x) => x.email === s.email)!;
      console.log(`seed-test-logins: ${s.email}  roles [${s.roles.join(", ")}]  ${s.scopeTier === "parent" ? "org-wide" : `region ${region.code}`}  → ${t.surfaces.join(", ")}`);
    }
  } catch (e) {
    console.error(`seed-test-logins: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
