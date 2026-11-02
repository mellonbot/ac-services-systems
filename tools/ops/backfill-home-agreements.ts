import { randomUUID } from "node:crypto";
import { createPool, beginTx, hierarchyReader } from "../../services/gateway/src/db/pg-tx.ts";
import { createUnitOfWork } from "../../services/gateway/src/db/unit-of-work.ts";
import { buildContext } from "../../services/gateway/src/http/context.ts";
import { startStandardHomeAgreement } from "../../services/gateway/src/handlers/residential.ts";
import type { Principal, Tier } from "../../packages/contracts/src/index.ts";

/**
 * ONE-OFF: puts every home made before 2026-10-23 on the standard home
 * agreement. Homes made since get it in createResidential's own unit of work;
 * these were made without one, so their first call is refused `no_value`
 * (tools/ops/audit-msa-terms.ts lists them as "customers with sites and no MSA").
 *
 * It calls startStandardHomeAgreement — the same handlers, checks and events
 * S2 uses — once per home, each in its own transaction, acting as the staff
 * login named by --as, so the audit log says who did it. Commercial customers
 * are never touched: their terms are negotiated, not standard.
 *
 *   node tools/ops/backfill-home-agreements.ts --as <staff email>            lists, writes nothing
 *   node tools/ops/backfill-home-agreements.ts --as <staff email> --apply    writes
 */
const url = process.env.DATABASE_URL;
const as = process.argv[process.argv.indexOf("--as") + 1];
const apply = process.argv.includes("--apply");
if (!url) { console.error("DATABASE_URL is not set."); process.exit(2); }
if (!process.argv.includes("--as") || !as) { console.error("--as <staff email> is required: the audit log names who put these homes on the agreement."); process.exit(2); }

const pool = createPool(url, "ac-backfill-home-agreements");
const now = new Date();

const actor = (await pool.query<{ id: string; org_id: string; region_id: string; roles: string[]; scope_tier: Tier; scope_id: string }>(
  `SELECT id, org_id, region_id, roles, scope_tier, scope_id FROM users WHERE email = $1 AND namespace = 'internal' AND active`, [as],
)).rows[0];
if (!actor) { console.error(`no active internal login ${as}`); process.exit(2); }
const principal: Principal = {
  namespace: "internal", subjectId: actor.id, orgId: actor.org_id, regionId: actor.region_id, scopeTier: actor.scope_tier, scopeId: actor.scope_id,
  roles: actor.roles, firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: randomUUID(),
};

// A home's region is its one region node's — the region createResidential was given.
const homes = (await pool.query<{ org_id: string; name: string; region_id: string }>(`
  SELECT o.id AS org_id, o.name, r.region_id
    FROM organizations o
    JOIN accounts r ON r.org_id = o.id AND r.tier = 'region'
   WHERE o.segment = 'residential'
     AND EXISTS (SELECT 1 FROM accounts s WHERE s.org_id = o.id AND s.tier = 'site')
     AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.org_id = o.id AND c.kind = 'msa' AND c.state IN ('draft', 'active'))
   ORDER BY o.name`)).rows;

console.log(`${homes.length} home(s) with no agreement${apply ? "" : " (dry run — pass --apply to write)"}:`);
for (const h of homes) console.log(`  ${h.name}  ${h.org_id}`);

let failed = 0;
if (apply) {
  for (const h of homes) {
    const tx = await beginTx(pool, "ac_gateway");
    try {
      const uow = await createUnitOfWork({ surfaceId: "S2", principal, requestId: randomUUID(), now: () => now, newId: randomUUID }, tx);
      const ctx = await buildContext(principal, hierarchyReader(tx));
      const contractId = await startStandardHomeAgreement(uow, ctx, { orgId: h.org_id, regionId: h.region_id }, now, randomUUID);
      await uow.commit();
      console.log(`  ✓ ${h.name}: agreement ${contractId} active`);
    } catch (e) {
      await tx.rollback().catch(() => {});
      failed++;
      console.error(`  ✗ ${h.name}: ${(e as Error).message}`);
    }
  }
}
await pool.end();
process.exit(failed > 0 ? 1 : 0);
