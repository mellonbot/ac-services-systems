#!/usr/bin/env node
/**
 * ENSURE A SERVICE REGION — creates a region by code if it is new, and prints it.
 *
 *   DATABASE_URL=postgres://… REGION_CODE=DFW REGION_NAME="Dallas–Fort Worth" node tools/ops/ensure-region.ts
 *
 * Runs as ac_gateway under the system binding, like tools/ops/seed-test-logins.ts.
 * Since 0021 `regions_write` admits only the system namespace and `regions` is
 * FORCE RLS, so a bare INSERT from a non-superuser owner (production's login) is
 * refused. Idempotent: an existing code is returned unchanged.
 */
import { fileURLToPath } from "node:url";
import { createPool, beginTx, bindSystem, type Pool } from "../../services/gateway/src/db/pg-tx.ts";

export type Region = { readonly id: string; readonly code: string; readonly name: string; readonly active: boolean };

export const ensureRegion = async (pool: Pool, code: string, name: string): Promise<Region> => {
  const normalised = code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(normalised)) {
    throw new Error(`region code must be upper-case letters/digits/underscore, got '${code}'`);
  }
  const tx = await beginTx(pool, "ac_gateway");
  try {
    await bindSystem(tx);
    await tx.query("INSERT INTO regions (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING", [normalised, name]);
    const rows = await tx.query<Region>("SELECT id, code, name, active FROM regions WHERE code = $1", [normalised]);
    await tx.commit();
    return rows[0]!;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { DATABASE_URL, REGION_CODE, REGION_NAME } = process.env;
  if (!DATABASE_URL || !REGION_CODE || !REGION_NAME) {
    console.error("DATABASE_URL, REGION_CODE and REGION_NAME are required");
    process.exit(2);
  }
  const pool = createPool(DATABASE_URL, "ac-ensure-region");
  try {
    const r = await ensureRegion(pool, REGION_CODE, REGION_NAME);
    console.log(`${r.code} ${r.name} active=${r.active}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
