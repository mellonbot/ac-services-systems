import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { admitLocationSupply } from "../../../../packages/domain/src/supply/density.ts";
import type {
  ListRegionsOutput, ListOrganizationsInput, ListOrganizationsOutput, CreateOrganizationInput, CreateOrganizationOutput,
  ListAccountsOutput, AccountWire, CreateAccountInput, CreateAccountOutput, MoveAccountInput, MoveAccountOutput,
  UpdateAccountInput, UpdateAccountOutput, OrganizationKind,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * C1 — THE HIERARCHY S2 AUTHORS. Non-negotiable #1 and #2, at the one door
 * through which a customer's tree enters the system.
 *
 * What these handlers decide, and what they leave to the layer below:
 *
 *   - Which INPUTS are admissible: `region_id` is an input for a region node
 *     and for nothing else (D2 part 3 — it derives from the parent edge); a
 *     parent is created WITH its first region node so no parent exists
 *     without a place we serve it from; D14 is asked before a location is
 *     signed in.
 *   - Which STRUCTURE is admissible is NOT decided here. The tier ladder,
 *     cross-org edges, inactive regions, the shard key following a move —
 *     `ac_accounts_derive_region` and `ac_accounts_cascade` (migrations/0002)
 *     hold those, for this path and for every other one, and since 0004 their
 *     refusals reach the surface as 422 with the trigger's own words. A
 *     handler that re-checked the ladder would be a second copy that drifts.
 *
 * Every write goes through `uow.apply`, so the allowlist, the tenancy, the
 * audit row and the outbox event are not this file's problem to remember.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const requireText = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.trim().length === 0) throw new BadInput(`${field} is required`);
  return v.trim();
};

type RegionRow = { id: string; code: string; name: string; timezone: string; min_crew_density: number; active: boolean };
type AccountRow = { id: string; tier: AccountWire["tier"]; name: string; parent_id: string | null; region_id: string; org_id: string; customer_group: string | null; external_ref: string | null; timezone: string | null; active: boolean; path: string[] };

const toWire = (a: AccountRow): AccountWire => ({
  id: a.id, tier: a.tier, name: a.name, parentId: a.parent_id, regionId: a.region_id,
  customerGroup: a.customer_group, externalRef: a.external_ref, timezone: a.timezone, active: a.active, path: a.path,
});

const ACCOUNT_COLUMNS = "id, tier, name, parent_id, region_id, org_id, customer_group, external_ref, timezone, active, path";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export const listRegions = async (uow: UnitOfWork): Promise<ListRegionsOutput> => {
  const rows = await uow.tx.query<RegionRow>("SELECT id, code, name, timezone, min_crew_density, active FROM regions ORDER BY code");
  return { regions: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, timezone: r.timezone, minCrewDensity: r.min_crew_density, active: r.active })) };
};

export const listOrganizations = async (uow: UnitOfWork, input: ListOrganizationsInput): Promise<ListOrganizationsOutput> => {
  const kind = input.kind;
  if (kind !== undefined && kind !== "customer" && kind !== "subcontractor") throw new BadInput(`kind must be customer or subcontractor`);
  const rows = await uow.tx.query<{ id: string; name: string; kind: OrganizationKind; external_ref: string | null; active: boolean; region_node_count: string }>(
    `SELECT o.id, o.name, o.kind, o.external_ref, o.active,
            (SELECT count(*) FROM accounts a WHERE a.org_id = o.id AND a.tier = 'region' AND a.active) AS region_node_count
       FROM organizations o
      WHERE o.kind IN ('customer', 'subcontractor') AND ($1::text IS NULL OR o.kind = $1)
      ORDER BY o.name`,
    [kind ?? null],
  );
  return { organizations: rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, externalRef: r.external_ref, active: r.active, regionNodeCount: Number(r.region_node_count) })) };
};

export const listAccounts = async (uow: UnitOfWork, orgId: string): Promise<ListAccountsOutput> => {
  requireUuid(orgId, "orgId");
  // RLS decides what "every node" means for this principal: all of them for
  // internal; the subtree under the scope node for a customer (S6).
  const rows = await uow.tx.query<AccountRow>(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE org_id = $1 ORDER BY array_length(path, 1), name`, [orgId],
  );
  return { nodes: rows.map(toWire) };
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
const activeRegion = async (uow: UnitOfWork, regionId: string): Promise<RegionRow> => {
  const r = (await uow.tx.query<RegionRow>("SELECT id, code, name, timezone, min_crew_density, active FROM regions WHERE id = $1", [regionId]))[0];
  if (!r) throw new InputRefused(`no service region ${regionId}`, "unknown_region");
  if (!r.active) throw new InputRefused(`service region ${r.name} (${r.code}) is not active — a node cannot bind to a region we no longer serve`, "unknown_region");
  return r;
};

/**
 * No orphan parent. The organization and its first region node are two rows,
 * two audit entries, two events — and one transaction. If the node is
 * refused (an inactive region, say), the parent is not created either.
 */
export const createOrganization = async (uow: UnitOfWork, input: CreateOrganizationInput, newId: () => string): Promise<CreateOrganizationOutput> => {
  const name = requireText(input.name, "name");
  const kind: OrganizationKind = input.kind ?? "customer";
  if (kind !== "customer" && kind !== "subcontractor") throw new BadInput(`kind must be customer or subcontractor`);
  // C4: a firm is a root AND an operational row, and it has no customer tree to
  // hang a region node on. Its door is firms.create; this one would leave an
  // organization with no subcontractor_firms row behind it.
  if (kind === "subcontractor") {
    throw new InputRefused(`"${name}" is a subcontractor firm — record it through the network registry (firms.create), which writes the firm with its tenant root in one unit of work`, "use_firms_create");
  }
  if (!input.firstRegionNode || typeof input.firstRegionNode !== "object") throw new BadInput("firstRegionNode is required — a parent never exists without a place we serve it from");
  const regionId = requireUuid(input.firstRegionNode.regionId, "firstRegionNode.regionId");
  const nodeName = requireText(input.firstRegionNode.name, "firstRegionNode.name");
  const region = await activeRegion(uow, regionId);

  const orgId = newId();
  const eventId = await uow.apply(
    {
      entity: "account", entityId: orgId, action: "organization.create", topic: "account.created",
      before: null, after: { id: orgId, name, kind, externalRef: input.externalRef ?? null, tier: "parent" },
      orgId, regionId: region.id,
      payload: { tier: "parent", name, kind },
    },
    async (tx) => {
      await tx.query("INSERT INTO organizations (id, name, kind, external_ref) VALUES ($1, $2, $3, $4)", [orgId, name, kind, input.externalRef ?? null]);
    },
  );
  const regionNodeId = newId();
  await uow.apply(
    {
      entity: "account", entityId: regionNodeId, action: "account.create", topic: "account.created",
      before: null, after: { id: regionNodeId, tier: "region", name: nodeName, parentId: null, regionId: region.id },
      orgId, regionId: region.id,
      payload: { tier: "region", name: nodeName, regionCode: region.code },
    },
    async (tx) => {
      await tx.query("INSERT INTO accounts (id, org_id, region_id, parent_id, tier, name) VALUES ($1, $2, $3, NULL, 'region', $4)", [regionNodeId, orgId, region.id, nodeName]);
    },
  );
  return { orgId, regionNodeId, eventId };
};

export const createAccount = async (uow: UnitOfWork, input: CreateAccountInput, newId: () => string): Promise<CreateAccountOutput> => {
  const orgId = requireUuid(input.orgId, "orgId");
  const name = requireText(input.name, "name");
  const tier = input.tier;
  if (tier !== "region" && tier !== "location" && tier !== "site") throw new BadInput("tier must be region, location or site");
  const caveats: string[] = [];

  let regionId: string;
  let parentId: string | null;
  if (tier === "region") {
    // The one tier where region_id is an input: the meeting point of the customer's tree and one of our regions.
    if (input.parentId !== undefined) throw new InputRefused("a region node has no parent row — its parent is the organization", "region_node_has_no_parent");
    regionId = (await activeRegion(uow, requireUuid(input.regionId, "regionId"))).id;
    parentId = null;
  } else {
    parentId = requireUuid(input.parentId, "parentId");
    if (input.regionId !== undefined) {
      throw new InputRefused(
        `${tier} "${name}" declares regionId, but region_id derives from the parent edge and nothing else (D2 part 3). Name the parent; the region follows.`,
        "region_not_an_input",
      );
    }
    const parent = (await uow.tx.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [parentId]))[0];
    if (!parent) throw new InputRefused(`no node ${parentId} visible in this scope`, "unknown_scope");
    if (parent.org_id !== orgId) throw new InputRefused(`parent ${parent.name} belongs to org ${parent.org_id}, not ${orgId}`, "tenancy_mismatch");
    // The tier ladder is the trigger's to enforce; we hand it the parent's region and let it say no in its own words.
    regionId = parent.region_id;

    if (tier === "location") {
      // D14 — supply before signature.
      const region = await activeRegion(uow, regionId);
      const crews = Number((await uow.tx.query<{ n: string }>("SELECT count(*) AS n FROM crews WHERE region_id = $1 AND active", [regionId]))[0]?.n ?? 0);
      const decision = admitLocationSupply({ regionName: region.name, minCrewDensity: region.min_crew_density, activeCrews: crews });
      if (decision.kind === "refused") throw new InputRefused(decision.message, decision.code);
      caveats.push(...decision.caveats);
    }
  }

  const id = newId();
  const after = {
    id, tier, name, parentId, regionId,
    customerGroup: input.customerGroup ?? null, externalRef: input.externalRef ?? null, address: input.address ?? null, timezone: input.timezone ?? null,
  };
  const eventId = await uow.apply(
    { entity: "account", entityId: id, action: "account.create", topic: "account.created", before: null, after, orgId, regionId, payload: { tier, name, parentId } },
    async (tx) => {
      await tx.query(
        `INSERT INTO accounts (id, org_id, region_id, parent_id, tier, name, customer_group, external_ref, address, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [id, orgId, regionId, parentId, tier, name, after.customerGroup, after.externalRef, after.address === null ? null : JSON.stringify(after.address), after.timezone],
      );
    },
  );
  return { id, regionId, eventId, caveats };
};

/**
 * Re-parent. The handler changes ONE column. `ac_accounts_derive_region`
 * refuses a bad ladder or a cross-org edge, re-derives `region_id` and
 * `path`, and `ac_accounts_cascade` walks the descendants. The output counts
 * what moved so S2 can say "and 14 sites came with it".
 */
export const moveAccount = async (uow: UnitOfWork, input: MoveAccountInput): Promise<MoveAccountOutput> => {
  const accountId = requireUuid(input.accountId, "accountId");
  const newParentId = requireUuid(input.newParentId, "newParentId");
  const node = (await uow.tx.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [accountId]))[0];
  if (!node) throw new InputRefused(`no node ${accountId} visible in this scope`, "unknown_scope");
  if (node.tier === "region") {
    throw new InputRefused(
      `"${node.name}" is a region node — the meeting point of ${node.org_id} and one of our regions. It is not moved under another node; redrawing a region is an infrastructure event, not an edit here.`,
      "region_node_not_movable",
    );
  }
  if (node.parent_id === newParentId) throw new InputRefused(`"${node.name}" is already under ${newParentId}`, "already_there");
  const target = (await uow.tx.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [newParentId]))[0];
  if (!target) throw new InputRefused(`no node ${newParentId} visible in this scope`, "unknown_scope");
  if (target.path.includes(accountId)) throw new InputRefused(`"${target.name}" is a descendant of "${node.name}" — a node cannot be moved under itself`, "cycle");

  let regionId = node.region_id;
  let movedDescendants = 0;
  const eventId = await uow.apply(
    {
      entity: "account", entityId: accountId, action: "account.move", topic: "account.updated",
      before: { parentId: node.parent_id, regionId: node.region_id, path: node.path },
      after: { parentId: newParentId },
      // Tenancy of the row AFTER the move — the region it is going to. The trigger
      // makes this true on the row; a region-scoped principal may only move into its own region.
      orgId: node.org_id, regionId: target.region_id,
      payload: { tier: node.tier, fromParentId: node.parent_id, toParentId: newParentId, fromRegionId: node.region_id, toRegionId: target.region_id },
    },
    async (tx) => {
      const r = await tx.query<{ region_id: string }>("UPDATE accounts SET parent_id = $2 WHERE id = $1 RETURNING region_id", [accountId, newParentId]);
      regionId = r[0]!.region_id;
      const d = await tx.query<{ n: string }>("SELECT count(*) AS n FROM accounts WHERE $1 = ANY(path) AND id <> $1", [accountId]);
      movedDescendants = Number(d[0]?.n ?? 0);
    },
  );
  return { id: accountId, regionId, movedDescendants, eventId };
};

export const updateAccount = async (uow: UnitOfWork, input: UpdateAccountInput): Promise<UpdateAccountOutput> => {
  const accountId = requireUuid(input.accountId, "accountId");
  if ("parentId" in input || "regionId" in input) throw new InputRefused("parentId and regionId are not attributes — use accounts.move", "structure_is_not_an_attribute");
  const node = (await uow.tx.query<AccountRow>(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [accountId]))[0];
  if (!node) throw new InputRefused(`no node ${accountId} visible in this scope`, "unknown_scope");

  const sets: string[] = [];
  const params: unknown[] = [accountId];
  const after: Record<string, unknown> = {};
  const set = (col: string, key: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); after[key] = v; };
  if (input.name !== undefined) set("name", "name", requireText(input.name, "name"));
  if (input.customerGroup !== undefined) set("customer_group", "customerGroup", input.customerGroup);
  if (input.externalRef !== undefined) set("external_ref", "externalRef", input.externalRef);
  if (input.timezone !== undefined) set("timezone", "timezone", input.timezone);
  if (input.active !== undefined) { if (typeof input.active !== "boolean") throw new BadInput("active must be boolean"); set("active", "active", input.active); }
  if (input.address !== undefined) { params.push(input.address === null ? null : JSON.stringify(input.address)); sets.push(`address = $${params.length}::jsonb`); after.address = input.address; }
  if (sets.length === 0) throw new BadInput("nothing to update");

  const deactivating = input.active === false && node.active;
  const eventId = await uow.apply(
    {
      entity: "account", entityId: accountId, action: deactivating ? "account.deactivate" : "account.update",
      topic: deactivating ? "account.deactivated" : "account.updated",
      before: Object.fromEntries(Object.keys(after).map((k) => [k, (toWire(node) as unknown as Record<string, unknown>)[k] ?? null])),
      after, orgId: node.org_id, regionId: node.region_id,
      payload: { tier: node.tier, fields: Object.keys(after) },
    },
    async (tx) => { await tx.query(`UPDATE accounts SET ${sets.join(", ")} WHERE id = $1`, params); },
  );
  return { id: accountId, eventId };
};
