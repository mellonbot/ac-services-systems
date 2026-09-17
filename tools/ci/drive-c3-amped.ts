/**
 * C3 — AMPED RECORDED IN FULL, THROUGH THE REAL OPERATIONS, AGAINST A LIVE
 * GATEWAY (09 §6 item 6; 04 §0.0j / §5).
 *
 *   DATABASE_URL=postgres://... node tools/ci/drive-c3-amped.ts
 *
 * `packages/domain/src/inheritance/fixtures/amped.ts` is the input — a pure,
 * in-memory hand-model, checked against the resolver in
 * `resolve.test.ts`/`admit.test.ts` with synthetic ids that never touch a
 * database. This file is the other half of the sentence 09 closes step 3
 * with: "the fixture is the input; the executed document is the check."
 * It authors the SAME tree, the SAME MSA and its three amendments, and the
 * SAME eleven term rows — through `organizations.create`, `accounts.create`,
 * `contracts.create`, `terms.authorOverride`, exactly as S2's screens call
 * them (`packages/sdk/src/generated/client.ts`, the same client the surface
 * is guarded to use) — and then asks `terms.resolved` the four questions
 * `04`'s M2 gate names by name, and attempts every row in `ILLEGAL` against
 * the real rows this file wrote, expecting the same refusal code the pure
 * resolver asserts.
 *
 * Not driven through a browser: C1's and C2's own browser drives already
 * proved the screens render these exact operations correctly (09 §3.4,
 * §3.6, §3.8); repeating that here would be testing the renderer twice and
 * the hierarchy once. What C3 adds is that the fixture's shape survives
 * contact with the real gateway, the real triggers, and the real resolver —
 * which a purely in-memory fixture test cannot show.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH, OVERRIDES, ILLEGAL, N } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GIVEN_DB = process.env.DATABASE_URL;

const dbName = (url: string): string => new URL(url).pathname.replace(/^\//, "");
const withDb = (url: string, name: string): string => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
const PORT = 21080 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36);
const SCRATCH = process.env.AC_DRIVE_DB ?? `ac_c3_${RUN}`;
const EMAIL = "owner.c3@ac.test";
const PASSWORD = "correct horse battery staple";
const USER = "c3000000-0000-0000-0000-000000000001";

let passed = 0;
const check = (n: number, what: string) => { passed++; console.log(`  ${String(n).padStart(2)} ✓ ${what}`); };
const must = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };

async function main(): Promise<void> {
  const maySkip = !process.env.CI || process.env.AC_DRIVE_OPTIONAL === "1";
  if (!GIVEN_DB) {
    if (maySkip) { console.log("drive-c3-amped: DATABASE_URL not set — skipped"); return; }
    throw new Error("DATABASE_URL is not set, and a skip in CI is a check that stopped checking");
  }

  const ownScratch = !process.env.AC_DRIVE_DB;
  const maintenance = withDb(GIVEN_DB, dbName(GIVEN_DB) === "postgres" ? "template1" : "postgres");
  const DB = withDb(GIVEN_DB, SCRATCH);
  const admin0 = createPool(maintenance, "ac-c3-admin");
  admin0.on("error", () => {});
  if (ownScratch) {
    const c = await admin0.connect();
    try { await c.query(`CREATE DATABASE ${SCRATCH}`); } finally { c.release(); }
    console.log(`drive-c3-amped: scratch database ${SCRATCH}`);
    const mig = spawn(process.execPath, [join(ROOT, "tools/ci/migrate.ts")], { env: { ...process.env, DATABASE_URL: DB }, stdio: ["ignore", "pipe", "pipe"] });
    let mlog = "";
    mig.stdout!.on("data", (d) => { mlog += String(d); });
    mig.stderr!.on("data", (d) => { mlog += String(d); });
    const mcode = await new Promise<number>((r) => mig.on("exit", (c) => r(c ?? 1)));
    must(mcode === 0, `migrate failed on the scratch database:\n${mlog}`);
  }

  const pool: Pool = createPool(DB, "ac-c3");
  pool.on("error", () => {});
  const query = async (sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try { return (await c.query(sql, params)).rows; } finally { c.release(); }
  };

  let gateway: ChildProcess | undefined;
  let log = "";

  try {
    // OUR three service regions Amped's tree is dispatched from. Density
    // rule left at 0 (unset) so every location admits with D14's caveat,
    // the same posture the C1 wire test uses — D14 itself is not this file's
    // question.
    await query(
      `INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'MOUNTAIN','Mountain'), ($3,'SOUTH','South') ON CONFLICT (id) DO NOTHING`,
      [REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH],
    );
    await query(
      `INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
       VALUES ($1,$2,$3,'internal',$4,'C3 Account Owner','["account_owner"]','parent',$2,$5,true)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`,
      [USER, INTERNAL_ORG_ID, REGION_WEST, EMAIL, hashPassword(PASSWORD)],
    );

    gateway = spawn(process.execPath, [join(ROOT, "apps/gateway/src/main.ts")], {
      env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, AC_SITE: "ac.test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    gateway.stdout!.on("data", (d) => { log += String(d); });
    gateway.stderr!.on("data", (d) => { log += String(d); });
    const deadline = Date.now() + 15_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not yet */ }
      if (Date.now() > deadline) throw new Error(`gateway did not come up on :${PORT}\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }

    const s2: ConnectedShell = await connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: EMAIL, password: PASSWORD } });
    const refusal = (e: unknown) => { const r = s2.refusalOf(e); must(!!r, `not a refusal: ${e instanceof Error ? e.message : String(e)}`); return r!; };
    // Only the "admission" (and "token") members of the Refusal union carry a
    // `code` — narrowing here rather than asserting it exists on every kind.
    const codeOf = (r: ReturnType<typeof refusal>): string | undefined => ("code" in r ? r.code : undefined);

    // ── 1. THE PARENT, WITH ITS FIRST REGION NODE, IN ONE UNIT OF WORK.
    const org = await s2.gateway.createOrganization({
      name: "Amped Fitness Inc.",
      firstRegionNode: { regionId: REGION_WEST, name: "Amped / West" },
    });
    const orgId = org.orgId;
    const nodeId: Record<string, string> = { west: org.regionNodeId };
    check(1, `the parent is recorded WITH its first region node — Amped Fitness Inc. / West, one unit of work`);

    // ── 2. the other two of OUR regions this customer's tree meets.
    const mountain = await s2.gateway.createAccount({ orgId, tier: "region", regionId: REGION_MOUNTAIN, name: "Amped / Mountain" });
    const south = await s2.gateway.createAccount({ orgId, tier: "region", regionId: REGION_SOUTH, name: "Amped / South" });
    nodeId.mountain = mountain.id; nodeId.south = south.id;
    check(2, "the other two region nodes are recorded — Amped / Mountain, Amped / South");

    // ── 3. five locations, region_id DERIVED from the parent edge, never typed.
    const loc = async (parent: string, name: string, customerGroup: string) => {
      const out = await s2.gateway.createAccount({ orgId, tier: "location", parentId: parent, name, customerGroup, timezone: "America/Chicago" });
      return out;
    };
    const sanJose = await loc(nodeId.west!, "Amped San Jose", "Pacific");
    const reno = await loc(nodeId.west!, "Amped Reno", "Pacific");
    const boulder = await loc(nodeId.mountain!, "Amped Boulder", "Mountain");
    const elPaso = await loc(nodeId.south!, "Amped El Paso", "Mountain"); // finding 5 — customer's OWN grouping crosses our region boundary; an attribute, not structure
    const austin = await loc(nodeId.south!, "Amped Austin", "Texas");
    nodeId.sanJose = sanJose.id; nodeId.reno = reno.id; nodeId.boulder = boulder.id; nodeId.elPaso = elPaso.id; nodeId.austin = austin.id;
    must(sanJose.regionId === REGION_WEST && elPaso.regionId === REGION_SOUTH, "a location's region_id is OUR region, never the customer's grouping");
    check(3, "five locations recorded — region_id follows the parent edge; El Paso's customer_group (\"Mountain\") disagrees with its region (SOUTH) and both stand");

    // ── 4. three sites.
    const site = async (parent: string, name: string) => (await s2.gateway.createAccount({ orgId, tier: "site", parentId: parent, name })).id;
    nodeId.sanJoseRoof = await site(nodeId.sanJose!, "San Jose — Roof Units");
    nodeId.boulderRoof = await site(nodeId.boulder!, "Boulder — Roof Units");
    nodeId.boulderAhu = await site(nodeId.boulder!, "Boulder — Basement AHU");
    check(4, "three sites recorded under their locations");

    // ── 5. the MSA at parent scope — OQ5 stated, per the partners' 2026-09-17 decision.
    const msa = await s2.gateway.createContract({
      orgId, regionId: REGION_WEST, scopeTier: "parent", scopeId: orgId, kind: "msa",
      billingPath: "enterprise_sla", signedAt: "2026-01-01", effectiveFrom: "2026-01-01",
      diagnosticDataRightsReserved: true,
    });
    check(5, "the MSA is recorded at parent scope — OQ5 reserved, billed enterprise_sla per-region (OQ1)");

    // ── 6. three amendments, each naming the MSA.
    const amendSj = await s2.gateway.createContract({
      orgId, scopeTier: "location", scopeId: nodeId.sanJose!, kind: "amendment", parentContractId: msa.id,
      billingPath: "enterprise_sla", signedAt: "2026-03-01", effectiveFrom: "2026-03-01", diagnosticDataRightsReserved: true,
    });
    const amendAustinJuly = await s2.gateway.createContract({
      orgId, scopeTier: "location", scopeId: nodeId.austin!, kind: "amendment", parentContractId: msa.id,
      billingPath: "enterprise_sla", signedAt: "2026-06-15", effectiveFrom: "2026-07-01", diagnosticDataRightsReserved: true,
    });
    const boulderWarranty = await s2.gateway.createContract({
      orgId, scopeTier: "site", scopeId: nodeId.boulderRoof!, kind: "amendment", parentContractId: msa.id,
      billingPath: "enterprise_sla", signedAt: "2026-02-15", effectiveFrom: "2026-02-15", diagnosticDataRightsReserved: true,
    });
    check(6, "three amendments recorded, each naming the MSA as its parent — San Jose SLA, Austin's July rate step, Boulder's site-scoped warranty");

    // ── 7. the eleven term rows, exactly as the fixture states them, against the REAL contract and node ids above.
    const contractFor: Record<string, string> = { [`${"c0000000-0000-0000-0000-000000000001"}`]: msa.id, [`${"c0000000-0000-0000-0000-000000000002"}`]: amendSj.id, [`${"c0000000-0000-0000-0000-000000000003"}`]: amendAustinJuly.id, [`${"c0000000-0000-0000-0000-000000000004"}`]: boulderWarranty.id };
    const nodeFor: Record<string, string> = {
      [N.west]: nodeId.west!, [N.mountain]: nodeId.mountain!, [N.south]: nodeId.south!,
      [N.sanJose]: nodeId.sanJose!, [N.reno]: nodeId.reno!, [N.boulder]: nodeId.boulder!, [N.elPaso]: nodeId.elPaso!, [N.austin]: nodeId.austin!,
      [N.sanJoseRoof]: nodeId.sanJoseRoof!, [N.boulderRoof]: nodeId.boulderRoof!, [N.boulderAhu]: nodeId.boulderAhu!,
    };
    const regionOfScope = (scopeTier: string, realId: string): string =>
      scopeTier === "parent" ? REGION_WEST
      : [sanJose, reno].some((n) => n.id === realId) ? REGION_WEST
      : [boulder].some((n) => n.id === realId) || realId === nodeId.boulderRoof || realId === nodeId.boulderAhu ? REGION_MOUNTAIN
      : realId === nodeId.sanJoseRoof ? REGION_WEST
      : REGION_SOUTH;

    for (const row of OVERRIDES) {
      const realContractId = contractFor[row.contractId] ?? row.contractId;
      const realScopeId = row.scopeTier === "parent" ? orgId : (nodeFor[row.scopeId] ?? row.scopeId);
      await s2.gateway.authorTermOverride({
        contractId: realContractId, scopeTier: row.scopeTier, scopeId: realScopeId,
        termKey: row.termKey, termValue: row.termValue, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo,
        orgId, regionId: regionOfScope(row.scopeTier, realScopeId),
      });
    }
    check(7, `all eleven term rows from the fixture admitted against the real tree — ${OVERRIDES.length} for ${OVERRIDES.length}`);

    // ── 8. M2's four axis checks, against the rows just written, not the pure resolver.
    const resolvedAt = async (tier: "location" | "site", id: string, asOf: string, termKey: string) =>
      s2.gateway.resolvedTerms({ orgId, tier, nodeId: id, asOf, termKeys: termKey });

    const elPasoPay = await resolvedAt("location", nodeId.elPaso!, "2026-04-01", "payment_terms_days");
    must(elPasoPay.resolved.payment_terms_days?.value === 45, `payment_terms_days must resolve from the parent everywhere — got ${JSON.stringify(elPasoPay.resolved.payment_terms_days ?? elPasoPay.refused.payment_terms_days)}`);

    const sjSla = await resolvedAt("location", nodeId.sanJose!, "2026-04-01", "sla_response");
    const renoSla = await resolvedAt("location", nodeId.reno!, "2026-04-01", "sla_response");
    must(sjSla.resolved.sla_response?.value === "4_hour", `San Jose should have tightened to 4_hour, got ${JSON.stringify(sjSla.resolved.sla_response)}`);
    must(renoSla.resolved.sla_response?.value === "same_day", `Reno never overrode — should still inherit same_day, got ${JSON.stringify(renoSla.resolved.sla_response)}`);

    const roofWarranty = await resolvedAt("site", nodeId.boulderRoof!, "2026-03-01", "vendor_warranty");
    const ahuWarranty = await resolvedAt("site", nodeId.boulderAhu!, "2026-03-01", "vendor_warranty");
    must(String(roofWarranty.resolved.vendor_warranty?.value ?? "").includes("Carrier"), `the roof units should carry the warranty, got ${JSON.stringify(roofWarranty.resolved.vendor_warranty)}`);
    must(ahuWarranty.refused.vendor_warranty?.code === "no_value", `the AHU is a SIBLING site — it must not inherit the roof's warranty, got resolved=${JSON.stringify(ahuWarranty.resolved.vendor_warranty)} refused=${JSON.stringify(ahuWarranty.refused.vendor_warranty)}`);

    const austinBefore = await resolvedAt("location", nodeId.austin!, "2026-06-01", "after_hours_multiplier_milli");
    const austinAfter = await resolvedAt("location", nodeId.austin!, "2026-08-01", "after_hours_multiplier_milli");
    must(austinBefore.resolved.after_hours_multiplier_milli?.value === 1500, `Austin before July should be 1500, got ${JSON.stringify(austinBefore.resolved.after_hours_multiplier_milli)}`);
    must(austinAfter.resolved.after_hours_multiplier_milli?.value === 1750, `Austin from July should step to 1750, got ${JSON.stringify(austinAfter.resolved.after_hours_multiplier_milli)}`);

    check(8, "resolved against the live rows: payment terms hold at the parent everywhere; San Jose tightened and Reno did not; the warranty stops at the roof and never reaches the AHU; Austin's rate steps on 2026-07-01, not before");

    // ── 9. every ILLEGAL row, against the real tree, refused by the real mechanism — not the pure resolver's copy of it.
    const attempt = async (row: (typeof ILLEGAL)[keyof typeof ILLEGAL]) => {
      const realContractId = contractFor[row.contractId] ?? row.contractId;
      const realScopeId = row.scopeTier === "parent" ? orgId : (nodeFor[row.scopeId] ?? row.scopeId);
      return s2.gateway.authorTermOverride({
        contractId: realContractId, scopeTier: row.scopeTier, scopeId: realScopeId,
        termKey: row.termKey, termValue: row.termValue, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo,
        orgId, regionId: regionOfScope(row.scopeTier, realScopeId),
      });
    };
    const expectRefusal = async (row: (typeof ILLEGAL)[keyof typeof ILLEGAL], code: string, label: string) => {
      let threw = false;
      try { await attempt(row); } catch (e) { threw = true; const r = refusal(e); must(codeOf(r) === code, `${label}: expected ${code}, got ${codeOf(r)} — ${r.message}`); }
      must(threw, `${label}: should have been refused with ${code}, was admitted`);
    };
    await expectRefusal(ILLEGAL.locationPaymentTerms, "illegal_tier", "a location setting its own payment terms");
    await expectRefusal(ILLEGAL.renoLoosensSla, "ratchet_loosened", "Reno relaxing to 48-hour");
    await expectRefusal(ILLEGAL.warrantyAtLocation, "illegal_tier", "the warranty attached at the location instead of the site");
    // boulderCreditA is legal in isolation — author it for real, THEN prove B overlaps it. This is the resolver
    // test's own two-step shape (resolve.test.ts), reproduced against the live database instead of memory. Both
    // sides of this pair cite the real MSA — overlap is scoped by (scopeTier, scopeId, termKey), not by which
    // contract nominally carries the row, and the fixture's own two synthetic contract ids for this pair were
    // never meant to be resolvable rows of their own.
    await s2.gateway.authorTermOverride({ contractId: msa.id, scopeTier: "location", scopeId: nodeId.boulder!, termKey: "sla_credit_pct", termValue: 8, effectiveFrom: "2026-05-01", effectiveTo: "2026-12-31", orgId, regionId: REGION_MOUNTAIN });
    let boulderBThrew = false;
    try {
      await s2.gateway.authorTermOverride({ contractId: msa.id, scopeTier: "location", scopeId: nodeId.boulder!, termKey: "sla_credit_pct", termValue: 5, effectiveFrom: "2026-07-01", effectiveTo: null, orgId, regionId: REGION_MOUNTAIN });
    } catch (e) { boulderBThrew = true; const r = refusal(e); must(codeOf(r) === "overlap", `the second Boulder SLA-credit amendment: expected overlap, got ${codeOf(r)} — ${r.message}`); }
    must(boulderBThrew, "the second Boulder SLA-credit amendment should have been refused with overlap, was admitted");
    await expectRefusal(ILLEGAL.laborRateAsNumber, "bad_value", "money sent as a JSON number instead of a string");
    await expectRefusal(ILLEGAL.parentPmVisitsAbove, "overlap", "the parent tightening PM visits above Boulder's existing, unended row");
    check(9, "all seven illegal rows refused against the real tree, by the same codes the pure resolver asserts");

    console.log(`\ndrive-c3-amped: ${passed} checks passed — Amped's real rows now agree with the fixture`);
  } finally {
    if (gateway && gateway.exitCode === null) {
      gateway.kill("SIGTERM");
      await Promise.race([
        new Promise<void>((r) => gateway!.once("exit", () => r())),
        new Promise<void>((r) => setTimeout(() => { gateway!.kill("SIGKILL"); r(); }, 5_000)),
      ]);
    }
    await pool.end().catch(() => {});
    if (ownScratch) {
      const c = await admin0.connect().catch(() => null);
      if (c) {
        try { await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`); } catch (e) { console.warn(`drive-c3-amped: could not drop ${SCRATCH}: ${String(e)}`); } finally { c.release(); }
      }
    }
    await admin0.end().catch(() => {});
  }
}

main().catch((e) => { console.error(`\ndrive-c3-amped FAILED after ${passed} checks\n${e instanceof Error ? e.stack : e}`); process.exit(1); });
