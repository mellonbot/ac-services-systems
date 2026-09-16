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
// 3d. A trigger refusal is a refusal, not an outage. Every RAISE in the LATEST
//     definition of every trigger function carries an ERRCODE the gateway maps
//     (AC422 invariant, AC403 policy). Without one it is SQLSTATE P0001, the
//     gateway answers 500, and the shell flips the surface degraded — a wrong
//     parent tier would look like an outage. Found by design, 09 §3.7.
// ---------------------------------------------------------------------------
{
  const dir = join(ROOT, "packages/schema/migrations");
  const latest = new Map<string, { file: string; body: string }>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = read(join(dir, f));
    for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION (ac_\w+)\(\) RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE plpgsql/g))
      latest.set(m[1]!, { file: f, body: m[2]! });
  }
  for (const [name, { file, body }] of latest) {
    // Walk each RAISE EXCEPTION to its terminating ';' outside single quotes.
    for (const m of body.matchAll(/RAISE EXCEPTION\b/g)) {
      let i = m.index! + m[0].length, inq = false;
      for (; i < body.length; i++) {
        const c = body[i];
        if (inq) { if (c === "'") { if (body[i + 1] === "'") { i++; continue; } inq = false; } }
        else if (c === "'") inq = true;
        else if (c === ";") break;
      }
      const stmt = body.slice(m.index!, i);
      if (!/USING\b[^;]*\bERRCODE\s*=\s*'AC4(22|03)'/.test(stmt))
        fail("trigger refusals carry a code", `${name} (${file}) raises without ERRCODE 'AC422'/'AC403' — the gateway would answer 500 and the shell would go degraded`);
    }
  }
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
// 4b. Non-negotiable #14 — the operation catalogue, the generated client and
//     the gateway's route table are one list.
// ---------------------------------------------------------------------------
{
  const { OPERATIONS, OPERATION_IDS } = await import(join(ROOT, "packages/contracts/src/operations.ts"));
  const ids = OPERATION_IDS as string[];
  const ops = OPERATIONS as Record<string, { method: string; path: string; sdkMethod: string }>;

  // The generated client is byte-identical to what the catalogue emits today.
  const { render } = await import(join(ROOT, "tools/ci/emit-sdk.ts"));
  const generatedPath = join(ROOT, "packages/sdk/src/generated/client.ts");
  let generated = "";
  try { generated = read(generatedPath); } catch { /* missing is drift */ }
  if (generated !== (render as () => string)())
    fail("generated SDK current", "packages/sdk/src/generated/client.ts differs from the catalogue — run `npm run sdk:generate`");
  for (const id of ids)
    if (!generated.includes(`${ops[id]!.sdkMethod}(`)) fail("generated SDK complete", `no client method for ${id} (${ops[id]!.sdkMethod})`);

  // The gateway handles exactly the catalogue: one handler per id, no route
  // string that is not an operation. `handlers` is typed over OperationId, so
  // typecheck says the same; this says it with nothing installed.
  const main = read(join(ROOT, "apps/gateway/src/main.ts"));
  const handlerBlock = /const handlers[^=]*=\s*\{([\s\S]*?)\n\};/.exec(main)?.[1] ?? "";
  // Dotted segments, not exactly two: `terms.overrides.list` is as much an
  // operation id as `terms.resolved`. A two-segment pattern here made the
  // textual twin NARROWER than the type it mirrors, so the guard reported a
  // handled operation as unhandled while typecheck disagreed — the guard has
  // to admit every id the catalogue can hold, or it fails honest diffs.
  const handled = [...handlerBlock.matchAll(/^\s{2}"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)":/gm)].map((m) => m[1]!);
  for (const id of ids) if (!handled.includes(id)) fail("catalogue ↔ gateway", `operation ${id} has no handler in apps/gateway/src/main.ts`);
  for (const h of handled) if (!ids.includes(h)) fail("catalogue ↔ gateway", `gateway handles "${h}", which is not in the operation catalogue`);
  for (const m of main.matchAll(/["'`](GET|POST|PUT|PATCH|DELETE) \/[^"'`]*["'`]/g))
    fail("catalogue ↔ gateway", `apps/gateway/src/main.ts keys a route by string ${m[0]} — routes are built from OPERATIONS, not typed`);
  // No handler-side path literal that the catalogue does not know. A path
  // typed in the gateway beside the catalogue is the second source of truth.
  const paths = new Set(ids.map((id) => ops[id]!.path));
  for (const m of main.matchAll(/["'`](\/(?:auth|s\d|terms|me|events|healthz)[^"'`\s]*)["'`]/g))
    if (!paths.has(m[1]!)) fail("catalogue ↔ gateway", `apps/gateway/src/main.ts names path ${m[1]} which is not in the catalogue`);
}

// ---------------------------------------------------------------------------
// 4c. A package with sources and no test file is not lightly covered; it is
//     unexecuted (frame Rev E — createShell threw on every call for a month).
//     The allowlist names today's gap so it is a reviewed line, not a silence.
//     Removing a name is the job; adding one needs a reason in the diff.
// ---------------------------------------------------------------------------
{
  const UNEXECUTED_PACKAGES = ["audit", "events", "schema", "storage", "testing"];
  for (const pkg of readdirSync(join(ROOT, "packages"))) {
    const dir = join(ROOT, "packages", pkg);
    if (!statSync(dir).isDirectory()) continue;
    const srcs = walk(dir).filter((f) => !f.endsWith(".test.ts"));
    const tests = walk(dir).filter((f) => f.endsWith(".test.ts"));
    if (srcs.length > 0 && tests.length === 0 && !UNEXECUTED_PACKAGES.includes(pkg))
      fail("no unexecuted package", `packages/${pkg} has ${srcs.length} source file(s) and no *.test.ts — it has never been run`);
    if (tests.length > 0 && UNEXECUTED_PACKAGES.includes(pkg))
      fail("no unexecuted package", `packages/${pkg} now has tests — remove it from UNEXECUTED_PACKAGES in tools/ci/schema-guard.ts`);
  }
}

// ---------------------------------------------------------------------------
// 4d. The surface runtime (09 §3.10). Four checks, all textual.
// ---------------------------------------------------------------------------
{
  const { SURFACES, SURFACE_IDS } = await import(join(ROOT, "packages/contracts/src/index.ts"));
  const { OPERATIONS } = await import(join(ROOT, "packages/contracts/src/operations.ts"));
  const ops = OPERATIONS as Record<string, { surfaces: readonly string[] }>;
  const S = SURFACES as Record<string, { app: string }>;
  const appToSurface = new Map<string, string>((SURFACE_IDS as string[]).map((id) => [S[id]!.app, id]));

  // Frame is current: every emitted file — frame.html above all — is byte-identical
  // to what the registry renders today. The emitter exports its renderers and
  // writes nothing on import, so this is a comparison, not a side effect.
  const { drifted } = await import(join(ROOT, "tools/ci/emit-surfaces.ts"));
  for (const p of (drifted as () => readonly string[])())
    fail("frame is current", `${p} differs from what the registry emits — run \`node tools/ci/emit-surfaces.ts\` and commit`);

  for (const f of files) {
    const r = rel(f);
    const inSurface = /^apps[\\/]s\d[^\\/]*[\\/]/.test(r);
    const inUi = /^packages[\\/]ui[\\/]/.test(r);
    if (!inSurface && !inUi) continue;
    if (r.endsWith(".test.ts")) continue;
    const src = read(f);

    // Screens use admitted operations: every id a screen registry names exists
    // in the catalogue and lists this surface. Today a screen reaching for an
    // operation its surface may not call would be a 403 in the demo; here it is
    // a build failure.
    if (inSurface && /[\\/]screens\.ts$/.test(r)) {
      const app = /^apps[\\/]([^\\/]+)/.exec(r)![1]!;
      const surface = appToSurface.get(app);
      if (!surface) fail("screens use admitted operations", `${r}: app directory ${app} is not in the surface registry`);
      else for (const block of src.matchAll(/uses:\s*\[([^\]]*)\]/g))
        for (const m of block[1]!.matchAll(/["']([a-z]+\.[A-Za-z.]+)["']/g)) {
          const id = m[1]!;
          if (!ops[id]) fail("screens use admitted operations", `${r} names operation "${id}", which is not in the catalogue`);
          else if (!ops[id].surfaces.includes(surface))
            fail("screens use admitted operations", `${r} names "${id}", which ${surface} may not call (admitted: ${ops[id].surfaces.join(", ")}) — a screen cannot be written against an operation its surface does not have`);
        }
    }

    // Renderer stays behind packages/ui: a surface imports @ac/ui, which is
    // where a renderer swap happens once. The count of files outside
    // packages/ui that would change in that swap is kept at zero here.
    if (inSurface && /from\s+["'](preact|htm|@preact\/[a-z-]+|preact-render-to-string)(?:[\\/][^"']*)?["']/.test(src))
      fail("renderer stays behind packages/ui", `${r} imports the renderer directly — import from packages/ui, where preact/htm/signals live`);

    // No colour literal in a surface or in the component set. Status is a
    // role (`var(--color-status-breached)`), never a colour; the only file
    // that may hold a hex value is in packages/tokens.
    const colour = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(/.exec(src);
    if (colour) fail("no colour literal outside tokens", `${r} contains ${colour[0]} — colours are roles from packages/tokens, so a white-label tenant can re-point them and the field's dark surface renders the same component`);
  }
}

// ---------------------------------------------------------------------------
// 4e. No surface fetches a typeface from a third party (errata E-05).
//     The tier that most depends on aligned digits is the tier least likely to
//     have a network. When that request fails the instrument face falls back to
//     a proportional one, the SLA column stops aligning, and nothing reports an
//     error — on the surface where being wrong costs the most.
// ---------------------------------------------------------------------------
{
  const { FORBIDDEN_FONT_HOSTS } = await import(join(ROOT, "packages/tokens/src/type.ts"));
  const surfaces = readdirSync(join(ROOT, "apps")).filter((d) => /^s\d/.test(d));
  const targets = [
    ...files.filter((f) => /^(apps[\\/]s\d|packages[\\/](ui|tokens))/.test(rel(f))),
    ...surfaces.map((d) => join(ROOT, "apps", d, "frame.html")),
  ];
  for (const f of targets) {
    // type.ts is where the list itself lives; naming a host in order to ban it
    // is not reaching for it.
    if (rel(f).endsWith(join("tokens", "src", "type.ts"))) continue;
    let src = "";
    try { src = read(f); } catch { continue; }
    for (const host of FORBIDDEN_FONT_HOSTS as string[])
      if (src.includes(host))
        fail("faces are self-hosted", `${rel(f)} reaches ${host} — a face fetched at runtime is a face the attic does not get, and the SLA column stops aligning with no error`);
  }
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

  // Non-negotiable #14. The wire is touched in exactly one file. Everything
  // above the SDK — surfaces, the shell, the component set — holds a client
  // and never a URL.
  const surfaceLayer = /^(apps[\\/]s\d[^\\/]*|packages[\\/](shell|ui|tokens))[\\/]/.test(r);
  if (surfaceLayer && /(^|[^.\w])(fetch|EventSource|XMLHttpRequest|WebSocket)\s*\(/.test(src))
    fail("no surface writes its own fetch call", `${r} touches the wire directly — packages/sdk/src/runtime.ts is the only place that does`);
  if (surfaceLayer && /from\s+["'](node:https?|https?|undici|axios|ky|got|node-fetch|cross-fetch|eventsource|ws)["']/.test(src))
    fail("no surface writes its own fetch call", `${r} imports a wire library`);
  // A surface app imports the shell, the component set, the tokens and the
  // contracts (types). Not the SDK — a surface holding httpTransport can name
  // an origin — and nothing below the gateway.
  if (/^apps[\\/]s\d/.test(r) && /from\s+["'][^"']*packages[\\/](sdk|domain|events|audit|storage|testing)[\\/]/.test(src))
    fail("dependencies point one way", `${r} imports below the shell — surfaces → shell → sdk → contracts, and a surface stops at the shell`);
  if (/^apps[\\/]s\d/.test(r) && /from\s+["'][^"']*apps[\\/](gateway|worker)[\\/]/.test(src))
    fail("dependencies point one way", `${r} imports the gateway or worker — a surface reaches them over the wire, through the shell`);
  if (/^packages[\\/](sdk|shell)[\\/]/.test(r) && /from\s+["'][^"']*(apps[\\/]|packages[\\/](domain|schema|events|audit|storage)[\\/])/.test(src))
    fail("dependencies point one way", `${r} imports below contracts — the sdk and the shell see the gateway only through the catalogue`);

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
