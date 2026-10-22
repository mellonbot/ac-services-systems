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
 *   node tools/ci/migrate.ts --assert   assert region_id is still total, and
 *                                       every table is behind row security
 *
 * The second is not an afterthought and not the same check as the guard's.
 * `pnpm guard:schema` asserts region_id against the DEFINITIONS; this asserts
 * it against the LIVE SCHEMA, which is the case where the two disagree — a
 * hand-run ALTER, a migration applied out of band. It runs in CI after every
 * migration because the failure it catches is the one that converts Tier 3
 * from a routing change into a migration project.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
      // DROP ... IF EXISTS on a fresh database is noise, not information.
      env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c client_min_messages=warning` },
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

/**
 * Tables with no tenant in them: reference data every principal may read and
 * none may write, and the ledger this file keeps. Every other table is behind
 * row security, FORCEd, with at least one policy — the finding three items in
 * a row was a table that had none (0021).
 */
const UNSCOPED_TABLES = ["currencies", "part_manufacturers", "schema_migrations", "term_registry"];

if (process.argv.includes("--assert")) {
  psql("-tAc", "SELECT ac_assert_region_id_everywhere()");
  console.log("region_id is total in the live schema.");
  const open = psql("-tAc", `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND c.relname <> ALL (ARRAY[${UNSCOPED_TABLES.map((t) => `'${t}'`).join(",")}])
       AND NOT (c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
     ORDER BY 1`).split("\n").map((x) => x.trim()).filter(Boolean);
  if (open.length) {
    console.error(`tables without forced row security and a policy: ${open.join(", ")}`);
    process.exit(1);
  }
  console.log("every tenant table is behind forced row security.");
  process.exit(0);
}

// 0001 creates schema_migrations, so on an empty database the ledger does not
// exist yet. to_regclass answers that without raising.
const ledgerExists = psql("-tAc", "SELECT to_regclass('public.schema_migrations') IS NOT NULL").trim() === "t";
// The ledger records what each file WAS when it ran. A file edited after it
// was applied never reaches a database that already has it, and nothing would
// say so; the checksum says so. A row from before checksums is trusted once.
if (ledgerExists) psql("-qc", "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");
const applied = new Map(
  ledgerExists
    ? psql("-tAc", "SELECT version || '|' || coalesce(checksum, '') FROM schema_migrations").split("\n").map((s) => s.trim()).filter(Boolean)
        .map((row) => { const [v, c] = row.split("|"); return [v!, c ?? ""] as const; })
    : [],
);

const all = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ file: f, version: f.slice(0, -4), checksum: createHash("sha256").update(readFileSync(join(MIGRATIONS, f))).digest("hex") }));

// 0001 is emitted from packages/schema/src/tables and regenerated after it has
// been applied (0007, 0008 say why) — its drift is by design and is carried by
// the later migrations. Every other file is frozen once applied.
const REGENERATED = new Set(["0001_bootstrap"]);
const drifted = all.filter((m) => !REGENERATED.has(m.version) && applied.get(m.version) && applied.get(m.version) !== m.checksum);
if (drifted.length) {
  console.error(`applied migration(s) edited since they ran: ${drifted.map((m) => m.version).join(", ")} — write a new migration instead`);
  process.exit(1);
}
const unrecorded = all.filter((m) => applied.get(m.version) === "");
for (const m of unrecorded) psql("-qc", `UPDATE schema_migrations SET checksum = '${m.checksum}' WHERE version = '${m.version}' AND checksum IS NULL`);

const pending = all.filter((m) => !applied.has(m.version));

for (const m of pending) {
  // --single-transaction covers the lock, the -f and the -c together: the
  // migration and the row recording it land atomically, or neither does. The
  // lock serialises two runners; the second then fails on the ledger's key
  // instead of applying the file twice and hiding it.
  psql(
    "--single-transaction",
    "-c", "SELECT pg_advisory_xact_lock(hashtext('ac-platform:migrate'))",
    "-f", join(MIGRATIONS, m.file),
    // On an empty database 0001 has only just created the ledger.
    "-c", "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
    "-c", `INSERT INTO schema_migrations (version, checksum) VALUES ('${m.version}', '${m.checksum}')`,
  );
  console.log(`  applied ${m.version}`);
}

// Repeatable migrations run on EVERY invocation, after the versioned ones.
// Today that is the term-register mirror: the database's copy of
// packages/contracts/src/terms.ts can never be older than the code that is
// about to run against it.
const REPEATABLE = join(MIGRATIONS, "repeatable");
const repeatable = readdirSync(REPEATABLE).filter((f) => f.endsWith(".sql")).sort();
for (const f of repeatable) {
  psql("--single-transaction", "-f", join(REPEATABLE, f));
}

if (pending.length === 0) {
  console.log(`migrate: nothing to do — ${applied.size} migration(s) already applied; ${repeatable.length} repeatable re-applied`);
} else {
  console.log(`migrate: ${pending.length} migration(s) applied; ${repeatable.length} repeatable re-applied`);
}
