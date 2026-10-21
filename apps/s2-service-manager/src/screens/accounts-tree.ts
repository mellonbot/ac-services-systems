import { html, pageHead, panel, DataGrid, StatusPill, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, OrganizationWire, RegionWire, CustomerSegment } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen } from "./common.ts";

/**
 * C1 — the tree. Left: every customer parent we serve, with how many of our
 * regions it meets. Right: the selected parent's nodes, region node → location
 * → site, each row saying which of OUR regions it is dispatched from — the
 * shard key made visible, because "why did Austin's jobs move to West?" is
 * answered by this column and nothing else.
 */
/** Which customers the list shows (0019). Residential or commercial is fixed per customer, so it is a classifier to filter by, never an edit. */
type Show = "all" | CustomerSegment;
const SHOW_WORD: Readonly<Record<Show, string>> = { all: "All", residential: "Residential", commercial: "Commercial" };
const showing = signal<Show>("all");
export const showSegment = (s: Show) => { showing.value = s; };
export const SEGMENT_WORD: Readonly<Record<CustomerSegment, string>> = { residential: "Residential", commercial: "Commercial" };

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
      stack: true,
      caption: "Customers",
      columns: [
        { key: "name", header: "Customer", cell: (o: OrganizationWire) => linkTo(ctx, "accounts.tree", { orgId: o.id }, o.name) },
        { key: "segment", header: "Type", cell: (o: OrganizationWire) => (o.segment ? SEGMENT_WORD[o.segment] : "—") },
        { key: "regionNodeCount", header: "Our regions", align: "end", numeric: true },
        { key: "active", header: "Status", cell: (o: OrganizationWire) => StatusPill({ density: ctx.density, status: o.active ? "ok" : "blocked", label: o.active ? "Active" : "Inactive" }) },
      ],
      rows: list.filter((o) => showing.value === "all" || o.segment === showing.value),
      rowKey: (o: OrganizationWire) => o.id,
      selectedKey: orgId ?? "",
      onSelect: (o: OrganizationWire) => ctx.router.navigate("accounts.tree", { orgId: o.id }),
      emptyText: showing.value === "all" ? "No customers yet." : `No ${SHOW_WORD[showing.value].toLowerCase()} customers.`,
    });

  const treeGrid = (nodes: readonly AccountWire[], regionList: readonly RegionWire[], org: OrganizationWire | undefined): VNode => {
    const regionName = (id: string) => regionList.find((r) => r.id === id)?.name ?? id;
    const ordered = orderTree(nodes);
    return panel(DataGrid({
      density: ctx.density,
      stack: true,
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
    }), org?.name ?? "Customer", undefined, linkTo(ctx, "accounts.new", { orgId: orgId!, tier: "region" }, "+ Region node", "ac-action s2-link--action"), "account-tree");
  };

  return html`${pageHead("Accounts", "Every customer and its tree of regions, locations and sites, against the regions we serve them from. Pick a customer to see its tree.", linkTo(ctx, "organizations.new", {}, "+ New customer", "ac-action s2-link--action"))}<div class="s2-two-col">
    <aside class="s2-col s2-col--orgs">
      ${panel(whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations), () => store.invalidate("organizations.list")), "Customers", undefined,
        html`<div class="s2-chips" role="group" aria-label="Customer type" id="customer-type">
          ${(Object.keys(SHOW_WORD) as Show[]).map((k) => html`<button type="button" class="ac-chip" aria-pressed=${showing.value === k ? "true" : "false"} onClick=${() => showSegment(k)}>${SHOW_WORD[k]}</button>`)}
        </div>`, "customers")}
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
