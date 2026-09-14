#!/usr/bin/env node
/**
 * THE ZERO-INSTALL GUARD.
 *
 * Runs with `node tools/ci/schema-guard.ts` on a laptop with nothing installed,
 * on the day someone is in a hurry. That is the entire design constraint: no
 * imports outside node:, no build step, no pnpm install. A guard that needs a
 * working toolchain is a guard that gets skipped exactly when it is needed.
 *
 * It checks the invariants that are cheap to state and expensive to lose.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const failures: string[] = [];
const fail = (check: string, detail: string) => failures.push(`${check}\n    ${detail}`);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
};
const files = walk(ROOT);
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(ROOT, p);

// ---------------------------------------------------------------------------
// 1. region_id is total — asserted against the DEFINITIONS.
//    (0003_assert_region_id.sql asserts the same thing against the live schema
//    after every migration. Both, because the definitions and the database can
//    disagree, and the disagreement is the interesting case.)
// ---------------------------------------------------------------------------
{
  const { ALL_TABLES } = await import(join(ROOT, "packages/schema/src/index.ts"));
  for (const t of ALL_TABLES as { name: string; kind: string; columns: { name: string; nullable?: boolean }[] }[]) {
    if (t.kind !== "operational") continue;
    const c = t.columns.find((x) => x.name === "region_id");
    if (!c) fail("region_id total", `${t.name} is operational but has no region_id`);
    else if (c.nullable) fail("region_id total", `${t.name}.region_id is nullable — the Tier 3 shard key needs a fallback now, and the fallback needs a home`);
  }
}

// ---------------------------------------------------------------------------
// 2. The allowlists in tenancy.ts and in the SQL assertion agree.
//    They are two copies on purpose — one for the code path, one for the
//    database path — and two copies drift. This is the thing that notices.
// ---------------------------------------------------------------------------
{
  const ts = read(join(ROOT, "packages/schema/src/tenancy.ts"));
  const sql = read(join(ROOT, "packages/schema/migrations/0003_assert_region_id.sql"));
  const names = (src: string, key: RegExp) => {
    const m = key.exec(src);
    return m ? [...m[1]!.matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]!).sort() : [];
  };
  const pairs: [string, RegExp, RegExp][] = [
    ["TENANCY_ROOT_TABLES", /TENANCY_ROOT_TABLES = \[([^\]]*)\]/s, /tenancy_roots TEXT\[\] := ARRAY\[([^\]]*)\]/s],
    ["GLOBAL_REFERENCE_TABLES", /GLOBAL_REFERENCE_TABLES = \[([^\]]*)\]/s, /global_refs\s+TEXT\[\] := ARRAY\[([^\]]*)\]/s],
  ];
  for (const [label, tsRe, sqlRe] of pairs) {
    const a = names(ts, tsRe), b = names(sql, sqlRe);
    if (a.join(",") !== b.join(","))
      fail("allowlists agree", `${label}: tenancy.ts has [${a}] but 0003_assert_region_id.sql has [${b}]`);
  }
}

// ---------------------------------------------------------------------------
// 3. The generated bootstrap SQL has not drifted from the definitions.
// ---------------------------------------------------------------------------
{
  const { ALL_TABLES, toDdl } = await import(join(ROOT, "packages/schema/src/index.ts"));
  const sql = read(join(ROOT, "packages/schema/migrations/0001_bootstrap.sql"));
  for (const t of ALL_TABLES as { name: string }[]) {
    const ddl = (toDdl as (x: unknown) => string)(t);
    if (!sql.includes(ddl))
      fail("generated SQL current", `${t.name} differs from the committed migration — run \`node tools/ci/emit-schema.ts\``);
  }
}

// ---------------------------------------------------------------------------
// 3b. The term-register mirror has not drifted from the code register, and
//     every term declares at least one authoring tier. The register is code;
//     R_term_registry.sql is its shadow.
// ---------------------------------------------------------------------------
{
  const { TERMS } = await import(join(ROOT, "packages/contracts/src/terms.ts"));
  const sql = read(join(ROOT, "packages/schema/migrations/repeatable/R_term_registry.sql"));
  for (const [key, t] of Object.entries(TERMS as Record<string, { authoring: string[]; combine: { kind: string } }>)) {
    if (t.authoring.length === 0) fail("term register", `${key} has no authoring tier — a term nobody may set is a term that raises forever`);
    if (!sql.includes(`('${key}', '${JSON.stringify(t.authoring)}'::jsonb, '${t.combine.kind}'`))
      fail("term register mirror current", `${key} differs from R_term_registry.sql — run \`node tools/ci/emit-schema.ts\``);
  }
  // Every table kind of "operational" in code must appear in the assert allowlists' complement — covered by check 1.
}

// ---------------------------------------------------------------------------
// 3c. Every mutation topic used in the gateway and worker is in the catalogue.
// ---------------------------------------------------------------------------
{
  const { TOPICS } = await import(join(ROOT, "packages/contracts/src/events.ts"));
  for (const f of files) {
    const r = rel(f);
    if (!/^apps[\\/](gateway|worker)[\\/]src/.test(r) || r.endsWith(".test.ts")) continue;
    for (const m of read(f).matchAll(/topic:\s*"([a-z_]+\.[a-z_]+)"/g)) {
      if (!(TOPICS as string[]).includes(m[1]!)) fail("event catalogue", `${r} emits "${m[1]}", which is not in packages/contracts/src/events.ts`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Surface write allowlists.
// ---------------------------------------------------------------------------
{
  const { SURFACES, SURFACE_IDS, WRITE_ENTITIES } = await import(join(ROOT, "packages/contracts/src/index.ts"));
  const S = SURFACES as Record<string, { writes: string[] }>;
  if (S.S4!.writes.length > 0)
    fail("S4 read-only", `S4 declares writes [${S.S4!.writes}] — if HQ can act from the dashboard, regional autonomy is decorative`);
  for (const e of ["account", "contract", "subcontractor_firm", "rate_card"]) {
    const authors = (SURFACE_IDS as string[]).filter((id) => S[id]!.writes.includes(e));
    if (authors.join(",") !== "S2") fail("S2 authors truth", `${e} is written by [${authors}], not S2 alone`);
  }
  const assigners = (SURFACE_IDS as string[]).filter((id) => S[id]!.writes.includes("assignment"));
  if (assigners.join(",") !== "S3")
    fail("one gated door", `assignment is written by [${assigners}] — the compliance gate guards one door, and this is more than one`);
  for (const id of SURFACE_IDS as string[])
    for (const w of S[id]!.writes)
      if (!(WRITE_ENTITIES as string[]).includes(w)) fail("declared entities", `${id} writes undeclared entity "${w}"`);
}

// ---------------------------------------------------------------------------
// 5. The textual guards — the same things the lint plugin catches, checked
//    without needing eslint installed.
// ---------------------------------------------------------------------------
for (const f of files) {
  const src = read(f), r = rel(f);
  if (r.endsWith(".test.ts")) continue;
  // Build tooling is not product code; it reads the repo by definition.
  if (!/^(apps|packages)[\\/]/.test(r)) continue;

  // The driver is importable from exactly one file. Everything else — surfaces,
  // domain, worker, tools — reaches the database through the gateway's Tx.
  if (/from\s+["'](pg|postgres|drizzle-orm|knex|typeorm|mysql2?)["']/.test(src) && r !== "apps/gateway/src/pg-tx.ts")
    fail("gateway is sole access path", `${r} imports a database driver — apps/gateway/src/pg-tx.ts is the only door`);
  if (/apps[\\/]s\d/.test(r) && /packages[\\/]schema/.test(src))
    fail("gateway is sole access path", `${r} imports the schema package — a surface owns no data`);

  const path = /domain[\\/]src[\\/]billing[\\/]paths[\\/]([a-z_]+)/.exec(r);
  if (path) {
    // Any spelling: the package path, and the `../enterprise_sla/` an IDE
    // refactor writes on its own — which is how this erosion actually happens,
    // because nobody types the long form.
    const siblings = readdirSync(join(ROOT, "packages/domain/src/billing/paths"));
    for (const sib of siblings) {
      if (sib === path[1]) continue;
      if (new RegExp(`from\\s+["'][^"']*(^|[./])${sib}/`, "m").test(src))
        fail("four paths stay four", `${r} imports the ${sib} path — the next edit is \`if (isProject)\``);
    }
  }

  if (/apps[\\/]s5-technician|packages[\\/]ui[\\/]src[\\/]field/.test(r) && /employment_?[Tt]ype|isSubcontracted/.test(src))
    fail("one field experience", `${r} references employment shape below the gate`);

  if (/packages[\\/]domain[\\/]/.test(r) && /(Date\.now\(\)|new Date\(\s*\)|Math\.random\(\))/.test(src))
    fail("domain has no I/O", `${r} reads an ambient clock or RNG`);
  if (/packages[\\/]domain[\\/]/.test(r) && /from\s+["']node:/.test(src))
    fail("domain has no I/O", `${r} imports a node: module — the domain takes its inputs as parameters`);
  if (/packages[\\/]domain[\\/]/.test(r) && /from\s+["'][^"']*(apps|gateway|worker|schema)[\\/]/.test(src))
    fail("dependencies point one way", `${r} imports upward — domain depends on contracts and nothing else`);

  if (!/compliance[\\/]/.test(r) && /as\s+ComplianceClearance|mintClearance/.test(src))
    fail("gate cannot be forged", `${r} casts or mints a ComplianceClearance`);

  if (!/packages[\\/]storage[\\/]/.test(r) && /from\s+["']node:fs|from\s+["']fs["']/.test(src))
    fail("storage behind our interface", `${r} touches the filesystem directly`);
}

// ---------------------------------------------------------------------------
if (failures.length) {
  console.error(`\nschema-guard: ${failures.length} violation(s)\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  console.error("Each of these is a commitment from master plan §7.2. Breaking one converts a\nlater phase into a rewrite rather than an addition.\n");
  process.exit(1);
}
console.log(`schema-guard: ok — ${files.length} files, all invariants hold`);
