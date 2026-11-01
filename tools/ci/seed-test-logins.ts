#!/usr/bin/env node
/**
 * SEED THE TEST LOGINS — superadmin-test, dispatcher-test, service_manager-test
 * and, when a customer org is named, customer-test (definitions and the
 * surfaces each must open: ./test-logins.ts).
 *
 *   DATABASE_URL=postgres://… AC_TEST_LOGIN_PASSWORD=… [AC_TEST_LOGIN_REGION=SOUTH] \
 *     [AC_TEST_LOGIN_CUSTOMER_ORG="Amped"] [AC_TEST_LOGIN_SUPERADMIN=0] node tools/ci/seed-test-logins.ts
 *
 * Idempotent: a second run re-applies roles, scope and password to the same
 * rows (matched by email) and reactivates them. The password is never a
 * default and never in the repository — every seeded database gets the one it
 * is given. The region is a region CODE; it may be omitted only when the
 * database has exactly one real service region, because a login's region is a
 * fact about who it is and is not guessed. The customer org is an active
 * customer organization's name or id; customer-test sees that org's whole tree
 * on S6, bound to the same region as the others.
 *
 * Runs as ac_gateway under the system binding, exactly as the gateway's own
 * login does: `users` admits the system writer and nothing broader is needed.
 */
import { fileURLToPath } from "node:url";
import { createPool, beginTx, bindSystem, type Pool } from "../../services/gateway/src/pg-tx.ts";
import { hashPassword } from "../../services/gateway/src/auth.ts";
import { UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { TEST_LOGINS, CUSTOMER_TEST_LOGIN, testLoginRow, MIN_TEST_LOGIN_PASSWORD } from "./test-logins.ts";

export type SeededLogin = { readonly id: string; readonly email: string; readonly roles: readonly string[]; readonly scopeTier: string };

/** A region id from its code, or the only real region when no code is given. */
export const resolveRegion = async (pool: Pool, code?: string): Promise<{ id: string; code: string }> => {
  const tx = await beginTx(pool, "ac_gateway");
  await bindSystem(tx);
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

/** An active customer org from its name (case-insensitive) or id. */
export const resolveCustomerOrg = async (pool: Pool, ref: string): Promise<{ id: string; name: string }> => {
  const tx = await beginTx(pool, "ac_gateway");
  await bindSystem(tx);
  try {
    const rows = await tx.query<{ id: string; name: string }>(
      "SELECT id, name FROM organizations WHERE active AND kind = 'customer' AND (id::text = $1 OR lower(name) = lower($1))", [ref.trim()]);
    if (rows.length === 1) return rows[0]!;
    throw new Error(rows.length === 0 ? `no active customer org named ${ref}` : `${rows.length} customer orgs are named ${ref}; give its id`);
  } finally {
    await tx.rollback().catch(() => {});
  }
};

/** The login a shared password must not put into production unless someone asked for it by name. */
export const SUPERADMIN_TEST_EMAIL = TEST_LOGINS.find((t) => t.login === "superadmin-test")!.email;

/**
 * `superadmin: false` leaves superadmin-test out — and deactivates it if an earlier seed made it, since an
 * org-wide principal behind a shared password is the one test login a production database should not keep.
 */
export const seedTestLogins = async (pool: Pool, opts: { readonly password: string; readonly regionId: string; readonly customerOrgId?: string | undefined; readonly superadmin?: boolean }): Promise<readonly SeededLogin[]> => {
  if (opts.password.length < MIN_TEST_LOGIN_PASSWORD) throw new Error(`the test-login password must be at least ${MIN_TEST_LOGIN_PASSWORD} characters`);
  const hash = hashPassword(opts.password);
  const tx = await beginTx(pool, "ac_gateway");
  await bindSystem(tx);
  try {
    const out: SeededLogin[] = [];
    const superadmin = opts.superadmin ?? true;
    if (!superadmin) await tx.query("UPDATE users SET active = false WHERE email = $1", [SUPERADMIN_TEST_EMAIL]);
    for (const t of opts.customerOrgId ? [...TEST_LOGINS, CUSTOMER_TEST_LOGIN] : TEST_LOGINS) {
      if (!superadmin && t.email === SUPERADMIN_TEST_EMAIL) continue;
      const r = testLoginRow(t, opts.regionId, opts.customerOrgId);
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
    const customerRef = process.env.AC_TEST_LOGIN_CUSTOMER_ORG;
    const customer = customerRef ? await resolveCustomerOrg(pool, customerRef) : undefined;
    // AC_TEST_LOGIN_SUPERADMIN=0 (the seed-logins workflow's default) leaves superadmin-test out.
    const superadmin = process.env.AC_TEST_LOGIN_SUPERADMIN !== "0";
    for (const s of await seedTestLogins(pool, { password, regionId: region.id, customerOrgId: customer?.id, superadmin })) {
      const t = [...TEST_LOGINS, CUSTOMER_TEST_LOGIN].find((x) => x.email === s.email)!;
      const level = t.scope === "customer" ? `customer ${customer!.name}` : s.scopeTier === "parent" ? "org-wide" : `region ${region.code}`;
      console.log(`seed-test-logins: ${s.email}  roles [${s.roles.join(", ")}]  ${level}  → ${t.surfaces.join(", ")}`);
    }
    if (!superadmin) console.log(`seed-test-logins: ${SUPERADMIN_TEST_EMAIL} not seeded (and deactivated if present) — AC_TEST_LOGIN_SUPERADMIN=0`);
    if (!customer) console.log(`seed-test-logins: ${CUSTOMER_TEST_LOGIN.email} not seeded — set AC_TEST_LOGIN_CUSTOMER_ORG to a customer org's name or id`);
  } catch (e) {
    console.error(`seed-test-logins: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
