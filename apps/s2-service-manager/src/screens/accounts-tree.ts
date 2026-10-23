import { html, pageHead, panel, DataGrid, signal, CustomerCard, PLAN_WORD, KIND_WORD, addressLines, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, OrganizationWire, RegionWire, CustomerSegment } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";
import { homeCard } from "./home-card.ts";

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

/**
 * The customer card on hover (and on keyboard focus — a hover-only affordance
 * is an invisible control): S6's own card for this customer, so the office sees
 * what the customer sees without leaving the list. Opens after a short pause
 * so a pointer crossing the list does not flash a card per row; Escape or
 * leaving closes it. Fixed-positioned beside the name, so the grid's own
 * container never clips it.
 */
const hover = signal<{ readonly orgId: string; readonly left: number; readonly top: number } | null>(null);
let openTimer: ReturnType<typeof setTimeout> | undefined;
/** The card's footprint, for placing it: 48ch at console type, and a homeowner's card (address, units, membership) is taller. */
const CARD_W = 420, CARD_H = { home: 380, account: 160 };
const openCard = (o: OrganizationWire) => (e: Event) => {
  const orgId = o.id;
  // Beside the ROW, not the name, so the row being read stays uncovered; inside the window either way.
  const el = e.currentTarget as HTMLElement;
  const r = (el.closest("tr") ?? el).getBoundingClientRect();
  const vw = typeof window === "undefined" ? Infinity : window.innerWidth, vh = typeof window === "undefined" ? Infinity : window.innerHeight;
  const h = o.segment === "residential" ? CARD_H.home : CARD_H.account;
  const at = r.right + CARD_W + 16 <= vw
    ? { left: r.right + 12, top: Math.max(8, Math.min(r.top - 8, vh - h - 8)) }
    : { left: Math.max(8, Math.min(r.left, vw - CARD_W - 8)), top: r.bottom + h + 8 <= vh ? r.bottom + 8 : Math.max(8, r.top - h - 8) };
  clearTimeout(openTimer);
  openTimer = setTimeout(() => { hover.value = { orgId, ...at }; }, e.type === "focusin" ? 0 : 150);
};
const closeCard = () => { clearTimeout(openTimer); hover.value = null; };
export const showCustomerCard = (orgId: string | null) => { hover.value = orgId ? { orgId, left: 0, top: 0 } : null; };

const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The card for one customer. `id` tells the hover card from the selected homeowner's card, which can be on screen together. `selected` adds the map and the service history. */
const customerCard = (ctx: ScreenContext, org: OrganizationWire, id = "customer-card", selected = false): VNode => {
  const { store, shell } = ctx;
  const nodes = store.read(keyOf("accounts.list", { orgId: org.id }), () => shell.gateway.listAccounts({ orgId: org.id }));
  const contracts = store.read(keyOf("contracts.list", { orgId: org.id }), () => shell.gateway.listContracts({ orgId: org.id }));
  if (nodes.value.state !== "ready" || contracts.value.state !== "ready") {
    const refused = nodes.value.state === "refused" ? nodes.value : contracts.value.state === "refused" ? contracts.value : null;
    return html`<article class="ac-customer-card" id=${id}><h3 class="ac-customer-card__name">${org.name}</h3>
      <p class="ac-customer-card__muted" role="status">${refused ? "This customer's card could not be read — open the customer to see why." : "Loading…"}</p></article>`;
  }
  return whenReady(ctx, nodes.value, (n) => whenReady(ctx, contracts.value, (c) => {
    const active = c.contracts.filter((x) => x.state === "active");
    const sites = n.nodes.filter((x) => x.tier === "site");
    const base = { id, density: ctx.density, name: org.name, segment: org.segment, sites: sites.length, locations: n.nodes.filter((x) => x.tier === "location").length, plans: [...new Set(active.map((x) => PLAN_WORD[x.billingPath]))] };
    if (org.segment !== "residential") return CustomerCard(base) ?? html``;
    const site = sites[0] ?? null;
    const equipment = site ? store.read(keyOf("equipment.list", { siteId: site.id }), () => shell.gateway.listEquipment({ siteId: site.id })).value : null;
    const member = active.find((x) => x.billingPath === "residential_membership") ?? null;
    const card = CustomerCard({
      ...base,
      home: {
        address: addressLines(site?.address ?? null),
        units: equipment === null ? [] : equipment.state === "ready"
          ? equipment.value.equipment.filter((u) => u.active).map((u) => ({
              name: u.label ?? KIND_WORD[u.kind],
              detail: [u.label ? KIND_WORD[u.kind] : null, [u.manufacturer, u.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
              servicedOn: u.lastServicedAt ? shortDay(u.lastServicedAt) : null,
            }))
          : null,
        membership: member ? { name: PLAN_WORD[member.billingPath], since: shortDay(member.effectiveFrom), through: member.effectiveTo ? shortDay(member.effectiveTo) : null } : null,
      },
    }) ?? html``;
    return selected ? homeCard(ctx, card, site) : card;
  }));
};

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

/**
 * How each row joins the tree, drawn the way a file tree is: one guide per
 * level below the region node — a rail where an ancestor still has siblings to
 * come, blank where it has none — then the row's own tee, or an elbow if it is
 * the last child. Read off `path`, so it holds for any depth.
 */
type Guide = "rail" | "blank" | "tee" | "elbow";
export const treeGuides = (ordered: readonly AccountWire[]): ReadonlyMap<string, readonly Guide[]> => {
  const last = new Map<string | null, string>();
  for (const n of ordered) last.set(n.parentId, n.id);
  const isLast = (n: AccountWire) => last.get(n.parentId) === n.id;
  const byId = new Map(ordered.map((n) => [n.id, n]));
  return new Map(ordered.map((n) => [n.id, n.path.slice(1).map((id, i, below): Guide => {
    const at = byId.get(id);
    const lastHere = at ? isLast(at) : true;
    return i === below.length - 1 ? (lastHere ? "elbow" : "tee") : (lastHere ? "blank" : "rail");
  })]));
};

/** What sits under each node, by tier — "2 locations · 5 sites" — so a collapsed glance at the region rows still says how big each is. */
const descendantCounts = (nodes: readonly AccountWire[]): ReadonlyMap<string, { location: number; site: number }> => {
  const out = new Map<string, { location: number; site: number }>();
  for (const n of nodes) {
    if (n.tier === "region") continue;
    for (const id of n.path.slice(0, -1)) {
      const c = out.get(id) ?? { location: 0, site: 0 };
      c[n.tier] += 1;
      out.set(id, c);
    }
  }
  return out;
};
const countLine = (n: AccountWire, c: { location: number; site: number } | undefined): VNode | null => {
  if (n.tier === "site") return null;
  const parts = ([["location", c?.location ?? 0], ["site", c?.site ?? 0]] as const)
    .filter(([t]) => n.tier === "region" || t === "site")
    .map(([t, k]) => html`<span class="s2-num">${k}</span> ${t}${k === 1 ? "" : "s"}`);
  return html`<span class="s2-node__count">${parts.map((p, i) => html`${i ? " · " : ""}${p}`)}</span>`;
};

export const accountsTree: Screen = (ctx, params) => {
  const { store, shell } = ctx;
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const orgId = params.orgId;

  const orgGrid = (list: readonly OrganizationWire[]): VNode =>
    DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        {
          key: "name", header: "Customer",
          cell: (o: OrganizationWire) => html`<a class="ac-link" href=${ctx.router.href("accounts.tree", { orgId: o.id })}
            aria-describedby=${hover.value?.orgId === o.id ? "customer-card" : undefined}
            onClick=${(e: Event) => { e.preventDefault(); closeCard(); ctx.router.navigate("accounts.tree", { orgId: o.id }); }}
            onMouseEnter=${openCard(o)} onMouseLeave=${closeCard} onFocusIn=${openCard(o)} onFocusOut=${closeCard}
            onKeyDown=${(e: KeyboardEvent) => { if (e.key === "Escape") closeCard(); }}>${o.name}</a>`,
        },
        { key: "segment", header: "Type", cell: (o: OrganizationWire) => (o.segment ? SEGMENT_WORD[o.segment] : "—") },
        { key: "regionNodeCount", header: "Our regions", align: "end", numeric: true },
        { key: "active", header: "Status", cell: (o: OrganizationWire) => html`<span class="s2-state" data-tone=${o.active ? "live" : "ended"}>${o.active ? "Active" : "Inactive"}</span>` },
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
    const guides = treeGuides(ordered);
    const counts = descendantCounts(ordered);
    return panel(DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        { key: "name", header: "Node", cell: (n: AccountWire) => html`<span class="s2-node" data-depth=${n.path.length - 1} data-tier=${n.tier}>${(guides.get(n.id) ?? []).map((g) => html`<span class="s2-node__guide" data-guide=${g} aria-hidden="true"></span>`)}<span class="s2-node__label"><span class="s2-node__name">${n.name}</span>${countLine(n, counts.get(n.id))}</span></span>` },
        { key: "tier", header: "Tier", cell: (n: AccountWire) => html`<span class="s2-tier">${n.tier}</span>` },
        // Below the region node the region is inherited, so it reads quiet; the region node is where it is set.
        { key: "regionId", header: "Our region", cell: (n: AccountWire) => n.tier === "region" ? regionName(n.regionId) : html`<span class="s2-muted">${regionName(n.regionId)}</span>` },
        { key: "customerGroup", header: "Customer group", cell: (n: AccountWire) => n.customerGroup ?? "—" },
        { key: "active", header: "Status", cell: (n: AccountWire) => html`<span class="s2-state" data-tone=${n.active ? "live" : "ended"}>${n.active ? "Active" : "Inactive"}</span>` },
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

  const selected = orgId && orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === orgId) : undefined;
  const selectedHome = selected?.segment === "residential" ? selected : undefined;
  const hovered = hover.value && orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === hover.value!.orgId) : undefined;
  return html`${hovered ? html`<div class="s2-hovercard" role="tooltip" style=${`left:${hover.value!.left}px;top:${hover.value!.top}px`}>${customerCard(ctx, hovered)}</div>` : null}${pageHead("Accounts", "Every customer and its tree of regions, locations and sites, against the regions we serve them from. Pick a customer to see its tree.", linkTo(ctx, "organizations.new", {}, "+ New customer", "ac-action s2-link--action"))}<div class="s2-two-col s2-two-col--wide-side">
    <aside class="s2-col s2-col--orgs">
      ${panel(whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations), () => store.invalidate("organizations.list")), "Customers", undefined,
        html`<div class="s2-chips" role="group" aria-label="Customer type" id="customer-type">
          ${(Object.keys(SHOW_WORD) as Show[]).map((k) => html`<button type="button" class="ac-chip" aria-pressed=${showing.value === k ? "true" : "false"} onClick=${() => showSegment(k)}>${SHOW_WORD[k]}</button>`)}
        </div>`, "customers")}
    </aside>
    <div class="s2-col s2-col--tree">
      ${selectedHome ? panel(customerCard(ctx, selectedHome, "home-customer-card", true), "Home", "Where it is, and every visit we have finished there.", undefined, "home") : null}
      ${orgId
        ? whenReady(ctx, store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId })).value,
            (t) => whenReady(ctx, regions.value, (r) => treeGrid(t.nodes, r.regions, orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === orgId) : undefined)),
            () => store.invalidate(keyOf("accounts.list", { orgId })))
        : html`<p class="s2-empty">Select a customer to see its tree.</p>`}
    </div>
  </div>`;
};
