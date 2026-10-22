import type { UnitOfWork } from "../unit-of-work.ts";
import type { HierarchyContext } from "../context.ts";
import { admitOverride, type Candidate } from "../../../../packages/domain/src/inheritance/admit.ts";
import { resolveAll, type Override, type ScopePath } from "../../../../packages/domain/src/inheritance/resolve.ts";
import { TERM_KEYS } from "../../../../packages/contracts/src/terms.ts";
import type { Tier } from "../../../../packages/contracts/src/tiers.ts";
import { InputRefused } from "../refusals.ts";

/**
 * S2 → gateway: author a term override. The one door through which a
 * contract term enters the system.
 *
 *   1. load every override row in the org for this term (all tiers);
 *   2. domain admission (tier, value, overlap, ratchet up AND down);
 *   3. insert — where the DB trigger and EXCLUDE constraint check again;
 *   4. audit + event in the same transaction, via the unit of work.
 *
 * Three layers say the same thing so that the one a tired person bypasses is
 * not the only one.
 */
type Row = { id: string; contract_id: string; scope_tier: Tier; scope_id: string; term_key: string; term_value: unknown; eff_from: string; eff_to: string | null };

const toOverride = (r: Row): Override => ({
  id: r.id, contractId: r.contract_id, scopeTier: r.scope_tier, scopeId: r.scope_id, termKey: r.term_key,
  termValue: r.term_value, effectiveFrom: r.eff_from, effectiveTo: r.eff_to,
});

/**
 * An override speaks for its agreement only while the agreement could be in
 * force: a terminated or expired MSA's terms do not drive a due date. A
 * draft's do — terms are authored before the signature they lead up to.
 */
const IN_FORCE = ["draft", "active"];

export const loadOrgOverrides = async (uow: UnitOfWork, orgId: string, termKey?: string): Promise<readonly Override[]> => {
  const rows = await uow.tx.query<Row>(
    `SELECT o.id, o.contract_id, o.scope_tier, o.scope_id, o.term_key, o.term_value,
            to_char(lower(o.effective), 'YYYY-MM-DD') AS eff_from,
            CASE WHEN upper_inf(o.effective) THEN NULL ELSE to_char(upper(o.effective), 'YYYY-MM-DD') END AS eff_to
       FROM contract_term_overrides o JOIN contracts c ON c.id = o.contract_id
      WHERE o.org_id = $1 AND ($2::text IS NULL OR o.term_key = $2) AND c.state = ANY($3::text[])`,
    [orgId, termKey ?? null, IN_FORCE],
  );
  return rows.map(toOverride);
};

/** Ancestor chain for any node in the org — the resolver's ScopePath, from the database. */
export const pathLoader = async (uow: UnitOfWork, orgId: string) => {
  const org = await uow.tx.query<{ id: string; name: string }>("SELECT id, name FROM organizations WHERE id = $1", [orgId]);
  const nodes = await uow.tx.query<{ id: string; tier: Tier; name: string; parent_id: string | null }>(
    "SELECT id, tier, name, parent_id FROM accounts WHERE org_id = $1", [orgId],
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (tier: Tier, id: string): ScopePath => {
    if (tier === "parent") return [{ tier: "parent", id: orgId, name: org[0]?.name ?? "" }];
    const out: { tier: Tier; id: string; name: string }[] = [];
    let cur = byId.get(id);
    if (!cur || cur.tier !== tier) throw new InputRefused(`no ${tier} node ${id} in org ${orgId}`, "unknown_scope");
    while (cur) {
      out.unshift({ tier: cur.tier, id: cur.id, name: cur.name });
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return [{ tier: "parent", id: orgId, name: org[0]?.name ?? "" }, ...out];
  };
};

export type AuthorOverrideInput = Candidate & { readonly orgId: string; readonly regionId: string };

export const authorTermOverride = async (uow: UnitOfWork, ctx: HierarchyContext, input: AuthorOverrideInput): Promise<{ id: string; eventId: string }> => {
  // Admission reads every row for this (org, term) and decides against them;
  // two authors at once would each decide against a set missing the other's
  // row. One at a time per (org, term).
  await uow.tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`term-override:${input.orgId}:${input.termKey}`]);
  const contract = (await uow.tx.query<{ org_id: string; state: string }>("SELECT org_id, state FROM contracts WHERE id = $1", [input.contractId]))[0];
  if (!contract) throw new InputRefused(`no contract ${input.contractId} visible in this scope — an override is authored against an existing agreement`, "unknown_contract");
  if (contract.org_id !== input.orgId) throw new InputRefused(`agreement ${input.contractId} is not this organization's`, "tenancy_mismatch");
  if (!IN_FORCE.includes(contract.state)) throw new InputRefused(`agreement ${input.contractId} is ${contract.state} — a term is authored against an agreement that can be in force`, "contract_not_in_force");
  const existing = await loadOrgOverrides(uow, input.orgId, input.termKey);
  const pathOf = await pathLoader(uow, input.orgId);
  admitOverride(input, existing, pathOf); // throws AdmissionRefused with the reason for a human

  let id = "";
  const eventId = await uow.apply(
    {
      entity: "contract", entityId: input.contractId, action: "term_override.author", topic: "contract.term_overridden",
      before: null, after: { ...input }, orgId: input.orgId, regionId: input.regionId,
      payload: { termKey: input.termKey, scopeTier: input.scopeTier, scopeId: input.scopeId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo },
    },
    async (tx) => {
      const r = await tx.query<{ id: string }>(
        `INSERT INTO contract_term_overrides (org_id, region_id, contract_id, scope_tier, scope_id, term_key, term_value, effective, authored_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, daterange($8::date, $9::date, '[)'), $10) RETURNING id`,
        [input.orgId, input.regionId, input.contractId, input.scopeTier, input.scopeId, input.termKey, JSON.stringify(input.termValue),
         input.effectiveFrom, input.effectiveTo, ctx.principal.subjectId],
      );
      id = r[0]!.id;
    },
  );
  return { id, eventId };
};

/** The S2 "resolved terms" panel and the invoice engine's input: every term at a node, as of a date. */
export const resolvedTermsAt = async (uow: UnitOfWork, orgId: string, tier: Tier, nodeId: string, asOf: string, termKeys?: readonly string[]) => {
  const overrides = await loadOrgOverrides(uow, orgId);
  const pathOf = await pathLoader(uow, orgId);
  // An unregistered key is refused by name, not silently dropped — the trace panel asked for it.
  for (const k of termKeys ?? []) if (!(TERM_KEYS as readonly string[]).includes(k)) throw new InputRefused(`"${k}" is not a registered term`, "unknown_term");
  return resolveAll(overrides, pathOf(tier, nodeId), asOf, termKeys ?? TERM_KEYS);
};
