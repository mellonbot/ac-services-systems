import type { Principal, ScopeBinding } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import type { ScopePath } from "../../../packages/domain/src/inheritance/resolve.ts";

/**
 * HIERARCHY CONTEXT — resolved at login, not per view.
 *
 * Web-arch S0: "hierarchy context resolved at login". Every breadcrumb,
 * filter and default in a surface reads from this, which is why no surface
 * needs to filter by region itself, and why the lint rule forbidding it is
 * not an imposition.
 */
export type HierarchyNode = { readonly tier: Tier; readonly id: string; readonly name: string; readonly regionId: string | null; readonly customerGroup: string | null };

export type HierarchyContext = {
  readonly principal: Principal;
  /** The scope node's ancestor chain, broadest first — the resolver's ScopePath. */
  readonly path: ScopePath;
  /** The organization at the top. */
  readonly parent: HierarchyNode;
  /** Region nodes visible to this principal (all for org scope; one otherwise). */
  readonly regions: readonly HierarchyNode[];
  readonly activeRegionId: string;
};

/** What the context builder needs from the database. Kept as an interface so the builder is unit-testable. */
export type HierarchyReader = {
  organization(id: string): Promise<{ id: string; name: string } | null>;
  region(id: string): Promise<{ id: string; code: string; name: string } | null>;
  account(id: string): Promise<{ id: string; tier: Tier; name: string; parentId: string | null; regionId: string; orgId: string; customerGroup: string | null } | null>;
  regionNodesOf(orgId: string): Promise<readonly { id: string; name: string; regionId: string }[]>;
};

export class ScopeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeResolutionError";
  }
}

export const buildContext = async (p: Principal, db: HierarchyReader): Promise<HierarchyContext> => {
  const org = await db.organization(p.orgId);
  if (!org) throw new ScopeResolutionError(`principal ${p.subjectId} names org ${p.orgId}, which does not exist`);
  const parent: HierarchyNode = { tier: "parent", id: org.id, name: org.name, regionId: null, customerGroup: null };

  // OUR people are scoped to OUR structure: the org (leadership) or one of our
  // service regions (dispatch, foremen, device grants). Their scope_id is a
  // regions row, not a node in any customer's tree — a dispatcher serves every
  // customer in the region.
  if ((p.namespace === "internal" || p.namespace === "device") && p.scopeTier === "region") {
    const region = await db.region(p.scopeId);
    if (!region) throw new ScopeResolutionError(`internal scope names region ${p.scopeId}, which does not exist`);
    if (region.id !== p.regionId) throw new ScopeResolutionError(`internal principal scoped to region ${region.code} but token region is ${p.regionId}`);
    return {
      principal: p,
      path: [{ tier: "parent", id: org.id, name: org.name }, { tier: "region", id: region.id, name: region.name }],
      parent,
      regions: [{ tier: "region", id: region.id, name: region.name, regionId: region.id, customerGroup: null }],
      activeRegionId: p.regionId,
    };
  }

  if (p.scopeTier === "parent") {
    if (p.scopeId !== p.orgId) throw new ScopeResolutionError(`parent-tier scope ${p.scopeId} is not the principal's org ${p.orgId}`);
    const regions = await db.regionNodesOf(p.orgId);
    return {
      principal: p,
      path: [{ tier: "parent", id: org.id, name: org.name }],
      parent,
      regions: regions.map((r) => ({ tier: "region", id: r.id, name: r.name, regionId: r.regionId, customerGroup: null })),
      activeRegionId: p.regionId,
    };
  }

  // Walk up from the scope node. The path is what the resolver walks and what
  // RLS's customer-scope function recomputes — the two must agree, and they
  // do because both read parent_id.
  const chain: HierarchyNode[] = [];
  let cur = await db.account(p.scopeId);
  if (!cur) throw new ScopeResolutionError(`scope node ${p.scopeTier}:${p.scopeId} does not exist`);
  if (cur.tier !== p.scopeTier) throw new ScopeResolutionError(`scope node ${p.scopeId} is a ${cur.tier}, token says ${p.scopeTier}`);
  if (cur.orgId !== p.orgId) throw new ScopeResolutionError(`scope node ${p.scopeId} belongs to org ${cur.orgId}, token says ${p.orgId}`);
  if (p.namespace !== "internal" && cur.regionId !== p.regionId) {
    throw new ScopeResolutionError(`scope node ${p.scopeId} is in region ${cur.regionId}, token says ${p.regionId}. region derives from the parent edge; the token is stale.`);
  }
  while (cur) {
    chain.unshift({ tier: cur.tier, id: cur.id, name: cur.name, regionId: cur.regionId, customerGroup: cur.customerGroup });
    cur = cur.parentId ? await db.account(cur.parentId) : null;
  }
  const regionNode = chain.find((n) => n.tier === "region");
  return {
    principal: p,
    path: [{ tier: "parent", id: org.id, name: org.name }, ...chain.map((n) => ({ tier: n.tier, id: n.id, name: n.name }))],
    parent,
    regions: regionNode ? [regionNode] : [],
    activeRegionId: p.regionId,
  };
};

/**
 * THE SCOPE BINDING. What RLS reads. Built from the principal and nothing
 * else — never from a query parameter, never from a header a surface sets.
 * Applied with SET LOCAL inside the transaction (see pg-tx.ts), so it dies
 * with the transaction and cannot leak to the next request on the pool.
 */
export const scopeBinding = (p: Principal, surfaceId: string): ScopeBinding => ({
  "ac.namespace": p.namespace,
  "ac.org_id": p.orgId,
  "ac.region_id": p.regionId,
  "ac.scope_tier": p.scopeTier,
  "ac.scope_id": p.scopeId,
  "ac.firm_id": p.firmId ?? "",
  "ac.device_id": p.deviceId ?? "",
  "ac.actor_id": p.subjectId,
  "ac.surface_id": surfaceId,
});
