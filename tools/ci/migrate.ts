#!/usr/bin/env node
/**
 * THE MIGRATION RUNNER.
 *
 * Dependency-free for the same reason the guard is: `pnpm db:migrate` has to
 * work on the machine that is about to touch production, on the day someone is
 * in a hurry, without a working node_modules. Nothing outside node:, and psql
 * as the only external binary — the one already installed anywhere a database
 * is being migrated.
 *
 *   node tools/ci/migrate.ts            apply pending migrations, in order
 *   node tools/ci/migrate.ts --assert   assert region_id is still total
 *
 * The second is not an afterthought and not the same check as the guard's.
 * `pnpm guard:schema` asserts region_id against the DEFINITIONS; this asserts
 * it against the LIVE SCHEMA, which is the case where the two disagree — a
 * hand-run ALTER, a migration applied out of band. It runs in CI after every
 * migration because the failure it catches is the one that converts Tier 3
 * from a routing change into a migration project.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../packages/schema/migrations/", import.meta.url));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Nothing was applied.");
  process.exit(2);
}

/** psql, always with ON_ERROR_STOP — a migration that half-applies is worse than one that fails. */
const psql = (...args: string[]): string => {
  try {
    return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (err) {
    const e = err as { code?: string; status?: number };
    if (e.code === "ENOENT") {
      console.error("psql is not on PATH. The runner shells out to psql on purpose — install the\nPostgres client rather than adding a driver dependency to the migration path.");
      process.exit(2);
    }
    // psql already wrote the reason to stderr. A child_process dump on top of
    // it buries the one line in the CI log that says what actually failed.
    if (typeof e.status === "number") process.exit(e.status);
    throw err;
  }
};

if (process.argv.includes("--assert")) {
  psql("-tAc", "SELECT ac_assert_region_id_everywhere()");
  console.log("region_id is total in the live schema.");
  process.exit(0);
}

// 0001 creates schema_migrations, so on an empty database the ledger does not
// exist yet. to_regclass answers that without raising.
const ledgerExists = psql("-tAc", "SELECT to_regclass('public.schema_migrations') IS NOT NULL").trim() === "t";
const applied = new Set(
  ledgerExists
    ? psql("-tAc", "SELECT version FROM schema_migrations").split("\n").map((s) => s.trim()).filter(Boolean)
    : [],
);

const pending = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, version: f.slice(0, -4) }))
  .filter((m) => !applied.has(m.version));

if (pending.length === 0) {
  console.log(`migrate: nothing to do — ${applied.size} migration(s) already applied`);
  process.exit(0);
}

for (const m of pending) {
  // --single-transaction covers the -f and the -c together: the migration and
  // the row recording it land atomically, or neither does.
  psql(
    "--single-transaction",
    "-f", join(MIGRATIONS, m.file),
    "-c", `INSERT INTO schema_migrations (version) VALUES ('${m.version}') ON CONFLICT DO NOTHING`,
  );
  console.log(`  applied ${m.version}`);
}
console.log(`migrate: ${pending.length} migration(s) applied`);
