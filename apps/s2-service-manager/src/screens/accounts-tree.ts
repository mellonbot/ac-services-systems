import { html, pageHead, panel, DataGrid, signal, CustomerCard, PLAN_WORD, KIND_WORD, addressLines, type VNode } from "../../../../packages/ui/src/index.ts";
import { serviceLabel, type AccountWire, type JobWire, type OrganizationWire, type RegionWire, type CustomerSegment } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";
import { customerDetail } from "./customer-detail.ts";
import { finding, setFind, clearFind, filterCount, findCustomers, servicesOnFile, STATUS_WORD, WORK_WORD, type Found, type StatusFilter, type WorkFilter } from "./customer-find.ts";

/**
 * C1 — Accounts. Left: every customer parent we serve, with how many of our
 * regions it meets, a search over names and jobs and a Filter menu
 * (customer-find.ts). Right, once one is picked: its card beside the site from
 * above, the agreements on file, the service history (customer-detail.ts) —
 * and under them the tree: the parent's nodes, region node → location
 * → site, each row saying which of OUR regions it is dispatched from — the
 * shard key made visible, because "why did Austin's jobs move to West?" is
 * answered by this column and nothing else.
 */
/** Which customers the list shows (0019). Residential or commercial is fixed per customer, so it is a classifier to filter by, never an edit. */
type Show = "all" | CustomerSegment;
const SHOW_WORD: Readonly<Record<Show, string>> = { all: "All", residential: "Residential", commercial: "Commercial" };
const showing = signal<Show>("all");
export const showSegment = (s: Show) => { showing.value = s; };
/** The Filter menu, open or shut. Shut whenever focus leaves it, so it never lingers over the list. */
const filterOpen = signal(false);
export const openFilter = (open: boolean) => { filterOpen.value = open; };
export const SEGMENT_WORD: Readonly<Record<CustomerSegment, string>> = { residential: "Residential", commercial: "Commercial" };

/**
 * The customer card on hover (and on keyboard focus — a hover-only affordance
 * is an invisible control): S6's own card for this customer, so the office sees
 * what the customer sees without leaving the list. Opens after a short pause
 * so a pointer crossing the list does not flash a card per row; Escape or
 * leaving closes it. Fixed-positioned beside the name, so the grid's own
 * container never clips it. Hidden from screen readers: read out on every
 * focus it buried the list, and opening the customer gives the same card.
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

/** The card for one customer. `id` tells the hover card from the selected customer's card, which can be on screen together. */
const customerCard = (ctx: ScreenContext, org: OrganizationWire, id = "customer-card"): VNode => {
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
    return CustomerCard({
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

  const jobsRes = store.read(keyOf("jobs.list"), () => shell.gateway.listJobs({})).value;
  const jobs = jobsRes.state === "ready" ? jobsRes.value.jobs : null;
  const f = finding.value;
  const narrowed = f.q.trim() !== "" || filterCount(f) > 0;

  const foundBy = (j: JobWire): VNode => html`<span class="s2-found">Job at ${j.siteName ?? "a site"}${j.siteAddress?.line1 && j.siteAddress.line1 !== j.siteName ? html` · ${j.siteAddress.line1}` : null}${j.siteAddress?.postal ? html` · <span class="s2-num">${j.siteAddress.postal}</span>` : null} · ${serviceLabel(j.serviceCode)}</span>`;

  const orgGrid = (list: readonly OrganizationWire[]): VNode => {
    const found = findCustomers(list, jobs, f, showing.value, Date.now());
    const segmentOnly = list.filter((o) => showing.value === "all" || o.segment === showing.value).length;
    return html`${narrowed ? html`<p class="s2-find__tally" role="status"><span class="s2-num">${found.length}</span> of <span class="s2-num">${segmentOnly}</span> ${segmentOnly === 1 ? "customer" : "customers"}
        <button type="button" class="s2-find__clear" onClick=${clearFind}>Clear search and filters</button></p>` : null}
      ${DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        {
          key: "name", header: "Customer",
          cell: (r: Found) => html`<span class="s2-customer"><a class="ac-link" href=${ctx.router.href("accounts.tree", { orgId: r.org.id })}
            onClick=${(e: Event) => { e.preventDefault(); closeCard(); ctx.router.navigate("accounts.tree", { orgId: r.org.id }); }}
            onMouseEnter=${openCard(r.org)} onMouseLeave=${closeCard} onFocusIn=${openCard(r.org)} onFocusOut=${closeCard}
            onKeyDown=${(e: KeyboardEvent) => { if (e.key === "Escape") closeCard(); }}>${r.org.name}</a>${r.via ? foundBy(r.via) : null}</span>`,
        },
        { key: "segment", header: "Type", cell: (r: Found) => (r.org.segment ? SEGMENT_WORD[r.org.segment] : "—") },
        { key: "regionNodeCount", header: "Our regions", align: "end", numeric: true, cell: (r: Found) => html`<span class="s2-num">${r.org.regionNodeCount}</span>` },
        { key: "active", header: "Status", cell: (r: Found) => html`<span class="s2-state" data-tone=${r.org.active ? "live" : "ended"}>${r.org.active ? "Active" : "Inactive"}</span>` },
      ],
      rows: found,
      rowKey: (r: Found) => r.org.id,
      selectedKey: orgId ?? "",
      onSelect: (r: Found) => ctx.router.navigate("accounts.tree", { orgId: r.org.id }),
      linked: true,
      emptyText: narrowed ? "No customer matches. Try fewer words, or clear the filters."
        : showing.value === "all" ? "No customers yet." : `No ${SHOW_WORD[showing.value].toLowerCase()} customers.`,
    })}`;
  };

  const filterMenu = (): VNode => {
    const count = filterCount(f);
    const services = jobs ? servicesOnFile(jobs) : [];
    const leave = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (!to || !(e.currentTarget as HTMLElement).contains(to)) filterOpen.value = false;
    };
    return html`<div class="s2-filter" id="customer-filter" onFocusOut=${leave}
      onKeyDown=${(e: KeyboardEvent) => { if (e.key === "Escape" && filterOpen.value) { e.stopPropagation(); filterOpen.value = false; } }}>
      <button type="button" class="s2-filter__toggle" aria-expanded=${filterOpen.value ? "true" : "false"} aria-controls="customer-filter-menu"
        onClick=${() => { filterOpen.value = !filterOpen.value; }}>
        Filter${count ? html` <span class="s2-filter__count s2-num" aria-label=${`${count} set`}>${count}</span>` : null}
      </button>
      ${filterOpen.value ? html`<div class="s2-filter__menu" id="customer-filter-menu" role="group" aria-label="Filter customers" tabindex="-1">
        <label class="s2-filter__field"><span>Status</span>
          <select class="ac-input" name="status" onChange=${(e: Event) => setFind({ status: (e.currentTarget as HTMLSelectElement).value as StatusFilter })}>
            ${(Object.keys(STATUS_WORD) as StatusFilter[]).map((k) => html`<option value=${k} selected=${f.status === k}>${STATUS_WORD[k]}</option>`)}
          </select></label>
        <label class="s2-filter__field"><span>Work</span>
          <select class="ac-input" name="work" onChange=${(e: Event) => setFind({ work: (e.currentTarget as HTMLSelectElement).value as WorkFilter })}>
            ${(Object.keys(WORK_WORD) as WorkFilter[]).map((k) => html`<option value=${k} selected=${f.work === k}>${WORK_WORD[k]}</option>`)}
          </select></label>
        <label class="s2-filter__field"><span>Service</span>
          <select class="ac-input" name="service" disabled=${!services.length} onChange=${(e: Event) => setFind({ service: (e.currentTarget as HTMLSelectElement).value })}>
            <option value="" selected=${!f.service}>${jobs ? "Any service" : "Loading jobs…"}</option>
            ${services.map((sv) => html`<option value=${sv.code} selected=${f.service === sv.code}>${sv.label}</option>`)}
          </select></label>
        <div class="s2-filter__foot">
          <button type="button" class="s2-mutation s2-mutation--quiet" disabled=${!count} onClick=${() => setFind({ status: "any", work: "any", service: "" })}>Clear filters</button>
          <button type="button" class="s2-mutation" onClick=${() => { filterOpen.value = false; }}>Done</button>
        </div>
      </div>` : null}
    </div>`;
  };

  const finder = html`<div class="s2-find" id="customer-find">
    <input type="search" class="ac-input s2-find__q" name="q" aria-label="Search customers" autocomplete="off"
      placeholder="Name, site, street, ZIP or job number" value=${f.q}
      onInput=${(e: Event) => setFind({ q: (e.currentTarget as HTMLInputElement).value })} />
    ${filterMenu()}
  </div>`;

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
            ${childTier(n.tier) ? linkTo(ctx, "accounts.new", { orgId: orgId!, tier: childTier(n.tier)!, parentId: n.id }, `+ ${childTier(n.tier)}`, undefined, `Add a ${childTier(n.tier)} under ${n.name}`) : null}
            ${n.tier !== "region" ? linkTo(ctx, "accounts.move", { orgId: orgId!, id: n.id }, "Move", undefined, `Move ${n.name}`) : null}
          </span>` },
      ],
      rows: ordered,
      rowKey: (n: AccountWire) => n.id,
      groupHead: (n: AccountWire) => n.tier === "region",
      emptyText: "No nodes. A customer parent always has at least one region node — if this is empty, the tree failed to load.",
    }), "Account tree", org ? `How ${org.name} is filed: region nodes, locations and sites, and which of our regions serves each` : undefined, linkTo(ctx, "accounts.new", { orgId: orgId!, tier: "region" }, "+ Region node", "ac-action s2-link--action"), "account-tree");
  };

  const selected = orgId && orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === orgId) : undefined;
  const hovered = hover.value && orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === hover.value!.orgId) : undefined;
  return html`${hovered ? html`<div class="s2-hovercard" role="tooltip" aria-hidden="true" style=${`left:${hover.value!.left}px;top:${hover.value!.top}px`}>${customerCard(ctx, hovered)}</div>` : null}${pageHead("Accounts", "Every customer, where its sites are, what it is signed up for and what we have done there — and the tree of regions, locations and sites it is filed under. Search or filter to find one.", linkTo(ctx, "organizations.new", {}, "+ New customer", "ac-action s2-link--action"))}<div class="s2-two-col s2-two-col--wide-side s2-accounts">
    <aside class="s2-col s2-col--orgs">
      ${panel(html`${finder}${whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations), () => store.invalidate("organizations.list"))}`, "Customers", undefined,
        html`<div class="s2-chips" role="group" aria-label="Customer type" id="customer-type">
          ${(Object.keys(SHOW_WORD) as Show[]).map((k) => html`<button type="button" class="ac-chip" aria-pressed=${showing.value === k ? "true" : "false"} onClick=${() => showSegment(k)}>${SHOW_WORD[k]}</button>`)}
        </div>`, "customers")}
    </aside>
    <div class="s2-col s2-col--tree">
      ${selected ? customerDetail(ctx, selected, customerCard(ctx, selected, "selected-customer-card")) : null}
      ${orgId
        ? whenReady(ctx, store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId })).value,
            (t) => whenReady(ctx, regions.value, (r) => treeGrid(t.nodes, r.regions, selected)),
            () => store.invalidate(keyOf("accounts.list", { orgId })))
        : html`<p class="s2-empty">Select a customer to see its site, agreements, service history and tree.</p>`}
    </div>
  </div>`;
};
