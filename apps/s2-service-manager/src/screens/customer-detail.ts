import { html, panel, DataGrid, signal, PLAN_WORD, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, ContractKind, ContractState, ContractWire, OrganizationWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type ScreenContext } from "./common.ts";
import { siteMap, serviceHistory } from "./home-card.ts";

/**
 * ONE CUSTOMER, AS THE OFFICE READS IT — the right-hand side of Accounts, in
 * the order a call about the customer goes: who they are and where the site
 * is (the card beside the site from above), what they are signed up for (the
 * agreements on file), what we have done there (the service history), and
 * then the tree it is all filed under.
 *
 * The agreements here are read-only. Activating, expiring or terminating one
 * is Agreements' job, with its confirmation and its data-rights column; this
 * block links there rather than offering a second set of buttons.
 */

/** A customer with several sites picks which one the map shows; the first site with a point is the default. */
const pickedSite = signal<Readonly<Record<string, string>>>({});
export const pickSite = (orgId: string, siteId: string) => { pickedSite.value = { ...pickedSite.value, [orgId]: siteId }; };

export const KIND_WORD: Readonly<Record<ContractKind, string>> = {
  msa: "Master agreement", amendment: "Amendment", location_agreement: "Location agreement",
  project_sow: "Project SOW", residential_membership: "Membership", one_time: "One-time work",
};
const STATE_WORD: Readonly<Record<ContractState, string>> = { draft: "Draft", active: "Active", expired: "Expired", terminated: "Terminated" };
const STATE_TONE: Readonly<Record<ContractState, "pending" | "live" | "ended">> = { draft: "pending", active: "live", expired: "ended", terminated: "ended" };
const STATE_ORDER: Readonly<Record<ContractState, number>> = { active: 0, draft: 1, expired: 2, terminated: 3 };

/** Agreements on file, the live ones first, newest first within each state. */
export const agreementsOnFile = (contracts: readonly ContractWire[]): readonly ContractWire[] =>
  [...contracts].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.effectiveFrom.localeCompare(a.effectiveFrom) || a.id.localeCompare(b.id));

/** An agreement's dates are calendar days, not instants: read in UTC so a Central-time office does not see the day before. */
const calendarDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const agreements = (ctx: ScreenContext, org: OrganizationWire, contracts: readonly ContractWire[], nodes: readonly AccountWire[]): VNode => {
  const covers = (c: ContractWire) => c.scopeTier === "parent" ? "Whole customer" : (nodes.find((n) => n.id === c.scopeId)?.name ?? "A node no longer in the tree");
  const rows = agreementsOnFile(contracts);
  const live = rows.filter((c) => c.state === "active").length;
  return panel(DataGrid({
    density: ctx.density,
    stack: true,
    columns: [
      { key: "kind", header: "Agreement", cell: (c: ContractWire) => html`<span class="s2-agreement"><span class="s2-agreement__kind">${KIND_WORD[c.kind]}</span><span class="s2-muted">${PLAN_WORD[c.billingPath]}</span></span>` },
      { key: "scopeId", header: "Covers", cell: (c: ContractWire) => covers(c) },
      // effectiveTo is exclusive: "until" says the agreement stops at that day, not through it.
      { key: "effectiveFrom", header: "Effective", cell: (c: ContractWire) => html`<span class="s2-num">${calendarDay(c.effectiveFrom)}</span> → ${c.effectiveTo ? html`until <span class="s2-num">${calendarDay(c.effectiveTo)}</span>` : html`<span class="s2-muted">evergreen</span>`}` },
      { key: "state", header: "State", cell: (c: ContractWire) => html`<span class="s2-state" data-tone=${STATE_TONE[c.state]}>${STATE_WORD[c.state]}</span>` },
    ],
    rows,
    rowKey: (c: ContractWire) => c.id,
    emptyText: "No agreements on file. Work for this customer is billed one job at a time until one is signed.",
  }) ?? html``, "Agreements on file",
  rows.length ? `${live} active of ${rows.length}` : undefined,
  html`<span class="s2-row-actions">
    ${linkTo(ctx, "contracts.new", { orgId: org.id }, "+ Agreement", "ac-action s2-link--action")}
    ${linkTo(ctx, "contracts.list", { orgId: org.id }, "Manage agreements", undefined, `Manage ${org.name}'s agreements`)}
  </span>`, "customer-agreements");
};

const placeLine = (a: AccountWire["address"]) => a ? [a.line1, [a.city, [a.state, a.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : null;

/** The site the map shows: the one picked, else the first with a point on the map, else the first. */
export const mapSiteOf = (orgId: string, sites: readonly AccountWire[]): AccountWire | null =>
  sites.find((s) => s.id === pickedSite.value[orgId])
  ?? sites.find((s) => typeof s.address?.lat === "number" && typeof s.address?.lng === "number")
  ?? sites[0] ?? null;

const overview = (ctx: ScreenContext, org: OrganizationWire, card: VNode, sites: readonly AccountWire[]): VNode => {
  const site = mapSiteOf(org.id, sites);
  const where = site ? placeLine(site.address) : null;
  const picker = sites.length > 1 ? html`<label class="s2-site-pick">
      <span class="s2-site-pick__label">Site</span>
      <select class="ac-input" aria-label="Site shown on the map" onChange=${(e: Event) => pickSite(org.id, (e.currentTarget as HTMLSelectElement).value)}>
        ${sites.map((s) => html`<option value=${s.id} selected=${s.id === site?.id}>${s.name}</option>`)}
      </select>
    </label>` : null;
  return panel(html`<div class="s2-overview">
      ${card}
      <div class="s2-overview__site">
        ${site ? siteMap(ctx, site) : html`<div class="s2-map s2-map--empty" id="site-map"><p class="s2-muted">This customer has no site yet, so there is no address to pin.</p></div>`}
      </div>
    </div>`, "Customer and site",
    site ? (where ? `${site.name === site.address?.line1 ? "" : `${site.name} · `}${where}` : `${site.name} · no street address recorded`) : "No site yet",
    picker, "customer-overview");
};

/** The selected customer: overview, agreements, history. `card` is the customer card the list's hover shows, drawn in full. */
export const customerDetail = (ctx: ScreenContext, org: OrganizationWire, card: VNode): VNode => {
  const { store, shell } = ctx;
  const nodes = store.read(keyOf("accounts.list", { orgId: org.id }), () => shell.gateway.listAccounts({ orgId: org.id })).value;
  const contracts = store.read(keyOf("contracts.list", { orgId: org.id }), () => shell.gateway.listContracts({ orgId: org.id })).value;
  return whenReady(ctx, nodes, (n) => {
    const sites = n.nodes.filter((x) => x.tier === "site");
    return html`<div class="s2-detail" id="customer-detail">
      ${overview(ctx, org, card, sites)}
      ${whenReady(ctx, contracts, (c) => agreements(ctx, org, c.contracts, n.nodes), () => store.invalidate(keyOf("contracts.list", { orgId: org.id })))}
      ${panel(serviceHistory(ctx, sites), "Service history", sites.length > 1 ? `Every finished visit across ${sites.length} sites, oldest first` : "Every finished visit, oldest first", undefined, "customer-history")}
    </div>`;
  }, () => store.invalidate(keyOf("accounts.list", { orgId: org.id })));
};
