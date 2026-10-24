/**
 * The Amped seed: the customer, our three regions, its account tree, its
 * agreements and the fixture's term overrides — the rows several suites read
 * and none should depend on another having written. Idempotent, so whichever
 * file runs first (or alone) gets the same database.
 *
 * The overrides go in through the database's own admission trigger, as an
 * authored override would; `authoredBy` is whoever the calling suite says
 * wrote them.
 */
import { ORG, N, REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH, NODES, OVERRIDES, MSA, AMEND_SJ, AMEND_AUSTIN_JULY, BOULDER_WARRANTY } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

type Admin = (sql: string, params?: unknown[]) => Promise<unknown[]>;

export const seedAmped = async (admin: Admin, authoredBy: string): Promise<void> => {
  await admin(`INSERT INTO organizations (id, name, kind, segment) VALUES ($1,'Amped Fitness Inc.','customer','commercial') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'MOUNTAIN','Mountain'), ($3,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH]);
  for (const n of NODES) {
    if (n.tier === "parent") continue;
    await admin(`INSERT INTO accounts (id, org_id, region_id, parent_id, tier, name, customer_group) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [n.id, ORG, n.serviceRegion, n.parent === ORG ? null : n.parent, n.tier, n.name, n.customerGroup ?? null]);
  }
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'parent',$2,'msa','enterprise_sla','2025-12-15','[2026-01-01,)',true,'active'),
           ($4,$2,$5,'location',$6,'amendment','enterprise_sla','2026-02-20','[2026-03-01,)',true,'active'),
           ($7,$2,$3,'location',$8,'amendment','enterprise_sla','2026-06-15','[2026-07-01,)',true,'active') ON CONFLICT (id) DO NOTHING`,
    [MSA, ORG, REGION_SOUTH, AMEND_SJ, REGION_WEST, N.sanJose, AMEND_AUSTIN_JULY, N.austin]);
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'site',$4,'amendment','enterprise_sla','2026-02-10','[2026-02-15,)',true,'active') ON CONFLICT (id) DO NOTHING`, [BOULDER_WARRANTY, ORG, REGION_MOUNTAIN, N.boulderRoof]);
  const regionOf = (tier: string, id: string) => (tier === "parent" ? REGION_SOUTH : NODES.find((n) => n.id === id)!.serviceRegion);
  for (const o of OVERRIDES) {
    await admin(`INSERT INTO contract_term_overrides (org_id, region_id, contract_id, scope_tier, scope_id, term_key, term_value, effective, authored_by)
      SELECT $1,$2,$3,$4,$5,$6,$7::jsonb, daterange($8::date,$9::date,'[)'), $10
      WHERE NOT EXISTS (SELECT 1 FROM contract_term_overrides WHERE scope_tier=$4 AND scope_id=$5 AND term_key=$6 AND lower(effective)=$8::date)`,
      [ORG, regionOf(o.scopeTier, o.scopeId), o.contractId, o.scopeTier, o.scopeId, o.termKey, JSON.stringify(o.termValue), o.effectiveFrom, o.effectiveTo, authoredBy]);
  }
};
