import { html, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, OrganizationWire, RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen } from "./common.ts";

/**
 * C1 — the tree. Left: every customer parent we serve, with how many of our
 * regions it meets. Right: the selected parent's nodes, region node → location
 * → site, each row saying which of OUR regions it is dispatched from — the
 * shard key made visible, because "why did Austin's jobs move to West?" is
 * answered by this column and nothing else.
 */
const TIER_ORDER: Record<AccountWire["tier"], number> = { region: 0, location: 1, site: 2 };

export const orderTree = (nodes: readonly AccountWire[]): readonly AccountWire[] => {
  // Depth-first by path so a site sits under its location and a location under its region node.
  const byParent = new Map<string | null, AccountWire[]>();
  for (const n of nodes) { const k = n.parentId; const arr = byParent.get(k) ?? []; arr.push(n); byParent.set(k, arr); }
  for (const arr of byParent.values()) arr.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.name.localeCompare(b.name));
  const out: AccountWire[] = [];
  const walk = (parentId: string | null) => { for (const n of byParent.get(parentId) ?? []) { out.push(n); walk(n.id); } };
  walk(null);
  return out;
};

const childTier = (t: AccountWire["tier"]): "location" | "site" | null => (t === "region" ? "location" : t === "location" ? "site" : null);

export const accountsTree: Screen = (ctx, params) => {
  const { store, shell } = ctx;
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const orgId = params.orgId;

  const orgGrid = (list: readonly OrganizationWire[]): VNode =>
    DataGrid({
      density: ctx.density,
      caption: "Customers",
      columns: [
        { key: "name", header: "Customer", cell: (o: OrganizationWire) => linkTo(ctx, "accounts.tree", { orgId: o.id }, o.name) },
        { key: "regionNodeCount", header: "Our regions", align: "end" },
        { key: "active", header: "Status", cell: (o: OrganizationWire) => StatusPill({ density: ctx.density, status: o.active ? "ok" : "blocked", label: o.active ? "Active" : "Inactive" }) },
      ],
      rows: list,
      rowKey: (o: OrganizationWire) => o.id,
      selectedKey: orgId ?? "",
      onSelect: (o: OrganizationWire) => ctx.router.navigate("accounts.tree", { orgId: o.id }),
      emptyText: "No customers yet.",
    });

  const treeGrid = (nodes: readonly AccountWire[], regionList: readonly RegionWire[], org: OrganizationWire | undefined): VNode => {
    const regionName = (id: string) => regionList.find((r) => r.id === id)?.name ?? id;
    const ordered = orderTree(nodes);
    return html`<section class="s2-tree" aria-label="Account tree">
      <header class="s2-tree__head">
        <h2 class="s2-h2">${org?.name ?? "Customer"}</h2>
        ${linkTo(ctx, "accounts.new", { orgId: orgId!, tier: "region" }, "+ Region node", "ac-action s2-link--action")}
      </header>
      ${DataGrid({
        density: ctx.density,
        columns: [
          { key: "name", header: "Node", cell: (n: AccountWire) => html`<span class="s2-node" data-depth=${n.path.length - 1} data-tier=${n.tier}>${n.name}</span>` },
          { key: "tier", header: "Tier" },
          { key: "regionId", header: "Our region", cell: (n: AccountWire) => regionName(n.regionId) },
          { key: "customerGroup", header: "Customer group", cell: (n: AccountWire) => n.customerGroup ?? "—" },
          { key: "active", header: "Status", cell: (n: AccountWire) => StatusPill({ density: ctx.density, status: n.active ? "ok" : "blocked", label: n.active ? "Active" : "Inactive" }) },
          { key: "actions", header: "", align: "end", cell: (n: AccountWire) => html`<span class="s2-row-actions">
              ${childTier(n.tier) ? linkTo(ctx, "accounts.new", { orgId: orgId!, tier: childTier(n.tier)!, parentId: n.id }, `+ ${childTier(n.tier)}`) : null}
              ${n.tier !== "region" ? linkTo(ctx, "accounts.move", { orgId: orgId!, id: n.id }, "Move") : null}
            </span>` },
        ],
        rows: ordered,
        rowKey: (n: AccountWire) => n.id,
        emptyText: "No nodes. A customer parent always has at least one region node — if this is empty, the tree failed to load.",
      })}
    </section>`;
  };

  return html`<div class="s2-two-col">
    <aside class="s2-col s2-col--orgs">
      ${whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations), () => store.invalidate("organizations.list"))}
      <p class="s2-aside-actions">${linkTo(ctx, "organizations.new", {}, "+ New customer", "ac-action s2-link--action")}</p>
    </aside>
    <div class="s2-col s2-col--tree">
      ${orgId
        ? whenReady(ctx, store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId })).value,
            (t) => whenReady(ctx, regions.value, (r) => treeGrid(t.nodes, r.regions, orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === orgId) : undefined)),
            () => store.invalidate(keyOf("accounts.list", { orgId })))
        : html`<p class="s2-empty">Select a customer to see its tree.</p>`}
    </div>
  </div>`;
};
