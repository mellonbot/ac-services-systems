import { html, DataGrid, pageHead, panel, statStrip, shortRef, type VNode } from "../../../../packages/ui/src/index.ts";
import { formatMoney, formatQuantity } from "../../../../packages/ui/src/fixed-units.ts";
import type { AccountWire, ContractWire, DeviceWire, FirmWire, CrewWire, InvoiceWire, LeadWire, OrganizationWire, PaymentWire, PoLineWire, ProjectWire, PurchaseOrderWire, RegionWire, TechnicianWire, VendorWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * OFFICE — S2's records, read from HQ. Every read here is one S2 makes, served
 * to S4 by the catalogue; none of S2's writes are, so these screens show what
 * the office recorded and offer nothing to change it. A change is made in S2.
 */

export const OFFICE_TABS = [
  ["office.customers", "Customers"], ["office.leads", "Leads"], ["office.projects", "Projects"], ["office.network", "Technician network"],
  ["office.purchasing", "Purchasing"], ["office.billing", "Billing"], ["office.devices", "Field devices"],
] as const;

export const officeNav = (ctx: ScreenContext, at: (typeof OFFICE_TABS)[number][0]): VNode =>
  html`<nav class="s4-asof" aria-label="Office records">${OFFICE_TABS.map(([id, label]) => (id === at ? html`<strong aria-current="page">${label}</strong>` : linkTo(ctx, id, {}, label)))}</nav>`;

export const day = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
export const word = (s: string): string => `${s[0]!.toUpperCase()}${s.slice(1).replace(/_/g, " ")}`;
const num = (v: string | number): VNode => html`<span class="s4-num">${v}</span>`;

const readRegions = (ctx: ScreenContext) => ctx.store.read(keyOf("regions.list"), () => ctx.shell.gateway.listRegions());
export const regionsBy = (ctx: ScreenContext): ((id: string) => string) => {
  const r = readRegions(ctx).value;
  const list: readonly RegionWire[] = r.state === "ready" ? r.value.regions : [];
  return (id) => list.find((x) => x.id === id)?.name ?? "—";
};
const readOrgs = (ctx: ScreenContext) => ctx.store.read(keyOf("organizations.list", { kind: "customer" }), () => ctx.shell.gateway.listOrganizations({ kind: "customer" }));

const readOnly = html`<p class="s4-readonly">Read only — the office changes these records in Service Manager.</p>`;

// ---------------------------------------------------------------------------
export const officeCustomers: Screen = (ctx) => {
  const orgs = readOrgs(ctx);
  return html`<section>
    ${officeNav(ctx, "office.customers")}
    ${pageHead("Customers", "Every customer organization the office serves. Open one for its account tree, agreements and projects.")}
    ${panel(whenReady(ctx, orgs.value, (o) => DataGrid<OrganizationWire>({
      density: ctx.density, caption: "Customers", stack: true, linked: true, rows: o.organizations, rowKey: (r) => r.id, emptyText: "No customers yet.",
      columns: [
        { key: "name", header: "Customer", cell: (r) => linkTo(ctx, "office.customer", { orgId: r.id }, r.name) },
        { key: "segment", header: "Segment", cell: (r) => (r.segment ? word(r.segment) : "—") },
        { key: "ref", header: "Their reference", cell: (r) => r.externalRef ?? "—" },
        { key: "regions", header: "Regions", numeric: true, align: "end", cell: (r) => num(r.regionNodeCount) },
        { key: "active", header: "Standing", cell: (r) => (r.active ? "Active" : "Inactive") },
      ],
    }) ?? html``, () => ctx.store.invalidate("organizations.list")))}
    ${readOnly}
  </section>`;
};

export const officeCustomer: Screen = (ctx, params) => {
  const orgId = params["orgId"]!;
  const orgs = readOrgs(ctx);
  const accounts = ctx.store.read(keyOf("accounts.list", { orgId }), () => ctx.shell.gateway.listAccounts({ orgId }));
  const contracts = ctx.store.read(keyOf("contracts.list", { orgId }), () => ctx.shell.gateway.listContracts({ orgId }));
  const projects = ctx.store.read(keyOf("projects.list", { orgId }), () => ctx.shell.gateway.listProjects({ orgId }));
  const region = regionsBy(ctx);
  const name = orgs.value.state === "ready" ? orgs.value.value.organizations.find((o) => o.id === orgId)?.name ?? "Customer" : "Customer";
  const nodeName = (id: string): string => (accounts.value.state === "ready" ? accounts.value.value.nodes.find((n) => n.id === id)?.name : undefined) ?? (id === orgId ? name : shortRef(id));
  return html`<section>
    ${officeNav(ctx, "office.customers")}
    ${pageHead(name, "The account tree the office authored, the agreements it signed and the projects sold under them.", linkTo(ctx, "office.customers", {}, "All customers"))}
    ${panel(whenReady(ctx, accounts.value, (o) => DataGrid<AccountWire>({
      density: ctx.density, caption: "Account tree", stack: true, rows: o.nodes, rowKey: (r) => r.id, emptyText: "No accounts under this customer yet.",
      columns: [
        { key: "name", header: "Account", cell: (r) => html`<span style=${`padding-inline-start:calc(var(--space-4) * ${r.path.length - 1})`}>${r.name}</span>` },
        { key: "tier", header: "Tier", cell: (r) => word(r.tier) },
        { key: "region", header: "Our region", cell: (r) => region(r.regionId) },
        { key: "addr", header: "Address", cell: (r) => (r.address ? [r.address.line1, r.address.city, r.address.state].filter(Boolean).join(", ") : "—") },
        { key: "active", header: "Standing", cell: (r) => (r.active ? "Active" : "Inactive") },
      ],
    }) ?? html``), "Accounts")}
    ${panel(whenReady(ctx, contracts.value, (o) => DataGrid<ContractWire>({
      density: ctx.density, caption: "Agreements", stack: true, rows: o.contracts, rowKey: (r) => r.id, emptyText: "No agreements yet.",
      columns: [
        { key: "ref", header: "Agreement", numeric: true, cell: (r) => shortRef(r.id) },
        { key: "kind", header: "Kind", cell: (r) => word(r.kind) },
        { key: "scope", header: "Covers", cell: (r) => `${word(r.scopeTier)} · ${nodeName(r.scopeId)}` },
        { key: "from", header: "From", numeric: true, cell: (r) => r.effectiveFrom },
        { key: "to", header: "To", numeric: true, cell: (r) => r.effectiveTo ?? "Evergreen" },
        { key: "billing", header: "Billing", cell: (r) => word(r.billingPath) },
        { key: "state", header: "Standing", cell: (r) => word(r.state) },
      ],
    }) ?? html``), "Agreements")}
    ${panel(whenReady(ctx, projects.value, (o) => projectGrid(ctx, o.projects)), "Projects")}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const officeLeads: Screen = (ctx) => {
  const leads = ctx.store.read(keyOf("leads.list", { include: "all" }), () => ctx.shell.gateway.listLeads({ include: "all" }));
  return html`<section>
    ${officeNav(ctx, "office.leads")}
    ${pageHead("Leads", "Everyone who asked us to call them from the website, and whether the office has made them a customer.")}
    ${whenReady(ctx, leads.value, (o) => html`
      ${statStrip([
        { n: num(o.leads.length), label: "Leads" },
        { n: num(o.leads.filter((l) => !l.convertedAccountId).length), label: "Waiting", ...(o.leads.some((l) => !l.convertedAccountId) ? { tone: "at_risk" as const } : {}) },
        { n: num(o.leads.filter((l) => l.convertedAccountId).length), label: "Converted" },
      ])}
      ${panel(DataGrid<LeadWire>({
        density: ctx.density, caption: "Every lead, newest first", stack: true, rows: o.leads, rowKey: (r) => r.id, emptyText: "No leads yet.",
        columns: [
          { key: "at", header: "Received", numeric: true, cell: (r) => day(r.createdAt) },
          { key: "name", header: "Name", cell: (r) => r.contact.name },
          { key: "reach", header: "Reach them", cell: (r) => [r.contact.phone, r.contact.email].filter(Boolean).join(" · ") || "—" },
          { key: "metro", header: "Area", cell: (r) => r.requestedMetro ?? "—" },
          { key: "source", header: "Came from", cell: (r) => r.source },
          { key: "state", header: "Standing", cell: (r) => (r.convertedAccountId ? "Converted" : "Waiting") },
        ],
      }) ?? html``)}`, () => ctx.store.invalidate("leads.list"))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
const projectGrid = (ctx: ScreenContext, projects: readonly ProjectWire[]): VNode => DataGrid<ProjectWire>({
  density: ctx.density, caption: "Projects", stack: true, rows: projects, rowKey: (r) => r.id, emptyText: "No projects yet.",
  columns: [
    { key: "name", header: "Project", cell: (r) => r.name },
    { key: "customer", header: "Customer", cell: (r) => r.customer },
    { key: "foreman", header: "Sold by", cell: (r) => r.foremanName ?? "—" },
    { key: "window", header: "Window", numeric: true, cell: (r) => `${day(r.serviceWindowStart)} → ${day(r.serviceWindowEnd)}` },
    { key: "jobs", header: "Install jobs", numeric: true, align: "end", cell: (r) => num(r.installJobs) },
    { key: "state", header: "Standing", cell: (r) => word(r.state) },
  ],
}) ?? html``;

export const officeProjects: Screen = (ctx) => {
  const projects = ctx.store.read(keyOf("projects.list", {}), () => ctx.shell.gateway.listProjects({}));
  return html`<section>
    ${officeNav(ctx, "office.projects")}
    ${pageHead("Projects", "What every install was sold under, and the foreman who sold it.")}
    ${panel(whenReady(ctx, projects.value, (o) => projectGrid(ctx, o.projects), () => ctx.store.invalidate("projects.list")))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const officeNetwork: Screen = (ctx) => {
  const firms = ctx.store.read(keyOf("firms.list", {}), () => ctx.shell.gateway.listFirms({}));
  const crews = ctx.store.read(keyOf("crews.list", {}), () => ctx.shell.gateway.listCrews({}));
  const techs = ctx.store.read(keyOf("technicians.list", {}), () => ctx.shell.gateway.listTechnicians({}));
  const region = regionsBy(ctx);
  const firmName = (id: string | null): string => (id === null ? "Ours" : (firms.value.state === "ready" ? firms.value.value.firms.find((f) => f.id === id)?.legalName : undefined) ?? shortRef(id));
  const crewName = (id: string | null): string => (id === null ? "—" : (crews.value.state === "ready" ? crews.value.value.crews.find((c) => c.id === id)?.label : undefined) ?? shortRef(id));
  return html`<section>
    ${officeNav(ctx, "office.network")}
    ${pageHead("Technician network", "The subcontracting firms, every crew — ours and theirs — and each technician on them.")}
    ${panel(whenReady(ctx, firms.value, (o) => DataGrid<FirmWire>({
      density: ctx.density, caption: "Firms", stack: true, rows: o.firms, rowKey: (r) => r.id, emptyText: "No firms recorded.",
      columns: [
        { key: "name", header: "Firm", cell: (r) => r.legalName },
        { key: "region", header: "Dispatched from", cell: (r) => region(r.regionId) },
        { key: "crews", header: "Crews active", numeric: true, align: "end", cell: (r) => num(`${r.activeCrewCount} / ${r.crewCount}`) },
        { key: "terms", header: "Settles in", numeric: true, align: "end", cell: (r) => num(`${r.settlementTermsDays} d`) },
        { key: "msa", header: "MSA signed", numeric: true, cell: (r) => day(r.msaSignedAt) },
        { key: "status", header: "Standing", cell: (r) => word(r.status) },
      ],
    }) ?? html``, () => ctx.store.invalidate("firms.list")), "Firms")}
    ${panel(whenReady(ctx, crews.value, (o) => DataGrid<CrewWire>({
      density: ctx.density, caption: "Crews", stack: true, rows: o.crews, rowKey: (r) => r.id, emptyText: "No crews recorded.",
      columns: [
        { key: "label", header: "Crew", cell: (r) => r.label },
        { key: "firm", header: "Firm", cell: (r) => firmName(r.firmId) },
        { key: "kind", header: "Work", cell: (r) => word(r.kind) },
        { key: "emp", header: "Employment", cell: (r) => word(r.employmentType) },
        { key: "home", header: "Home region", cell: (r) => region(r.homeRegionId) },
        { key: "active", header: "Standing", cell: (r) => (r.active ? "Active" : "Inactive") },
      ],
    }) ?? html``, () => ctx.store.invalidate("crews.list")), "Crews")}
    ${panel(whenReady(ctx, techs.value, (o) => DataGrid<TechnicianWire>({
      density: ctx.density, caption: "Technicians", stack: true, rows: o.technicians, rowKey: (r) => r.id, emptyText: "No technicians recorded.",
      columns: [
        { key: "name", header: "Technician", cell: (r) => r.name },
        { key: "role", header: "Role", cell: (r) => word(r.role) },
        { key: "crew", header: "Crew", cell: (r) => crewName(r.crewId) },
        { key: "firm", header: "Firm", cell: (r) => firmName(r.firmId) },
        { key: "skills", header: "Specialties", cell: (r) => r.specialties.map(word).join(", ") || "—" },
        { key: "phone", header: "Phone", numeric: true, cell: (r) => r.phone ?? "—" },
        { key: "active", header: "Standing", cell: (r) => (r.active ? "Active" : "Inactive") },
      ],
    }) ?? html``, () => ctx.store.invalidate("technicians.list")), "Technicians")}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const officePurchasing: Screen = (ctx) => {
  const pos = ctx.store.read(keyOf("pos.list", {}), () => ctx.shell.gateway.listPurchaseOrders({}));
  const vendors = ctx.store.read(keyOf("vendors.list"), () => ctx.shell.gateway.listVendors());
  const region = regionsBy(ctx);
  return html`<section>
    ${officeNav(ctx, "office.purchasing")}
    ${pageHead("Purchasing", "Every purchase order the office raised, where it stands, and the vendors it buys from.")}
    ${panel(whenReady(ctx, pos.value, (o) => DataGrid<PurchaseOrderWire>({
      density: ctx.density, caption: "Purchase orders", stack: true, linked: true, rows: o.orders, rowKey: (r) => r.id, emptyText: "No purchase orders yet.",
      columns: [
        { key: "no", header: "PO", numeric: true, cell: (r) => linkTo(ctx, "office.po", { poId: r.id }, r.number) },
        { key: "vendor", header: "Vendor", cell: (r) => r.vendorName ?? "—" },
        { key: "to", header: "Deliver to", cell: (r) => r.receivingPointCode ?? "—" },
        { key: "region", header: "Region", cell: (r) => region(r.regionId) },
        { key: "issued", header: "Issued", numeric: true, cell: (r) => day(r.issuedAt) },
        { key: "ship", header: "Ships", numeric: true, cell: (r) => r.promisedShipOn ?? "—" },
        { key: "total", header: "Total", numeric: true, align: "end", cell: (r) => formatMoney(r.totalMinor, r.currency) },
        { key: "state", header: "Standing", cell: (r) => word(r.state) },
      ],
    }) ?? html``, () => ctx.store.invalidate("pos.list")), "Purchase orders")}
    ${panel(whenReady(ctx, vendors.value, (o) => DataGrid<VendorWire>({
      density: ctx.density, caption: "Vendors", stack: true, rows: o.vendors, rowKey: (r) => r.id, emptyText: "No vendors recorded.",
      columns: [
        { key: "name", header: "Vendor", cell: (r) => r.legalName },
        { key: "region", header: "Region", cell: (r) => region(r.regionId) },
        { key: "terms", header: "Pay in", numeric: true, align: "end", cell: (r) => num(`${r.paymentTermsDays} d`) },
        { key: "email", header: "Contact", cell: (r) => r.contactEmail ?? "—" },
        { key: "status", header: "Standing", cell: (r) => word(r.status) },
      ],
    }) ?? html``, () => ctx.store.invalidate("vendors.list")), "Vendors")}
    ${readOnly}
  </section>`;
};

export const officePo: Screen = (ctx, params) => {
  const poId = params["poId"]!;
  const po = ctx.store.read(keyOf("pos.detail", { poId }), () => ctx.shell.gateway.purchaseOrder({ poId }));
  const back = linkTo(ctx, "office.purchasing", {}, "All purchase orders");
  return html`<section>
    ${officeNav(ctx, "office.purchasing")}
    ${whenReady(ctx, po.value, (d) => html`
      ${pageHead(`PO ${d.order.number}`, `${d.order.vendorName ?? "Vendor"} · ${word(d.order.state)}`, back)}
      <dl class="ac-facts">
        <div><dt>Total</dt><dd class="ac-num">${formatMoney(d.order.totalMinor, d.order.currency)}</dd></div>
        <div><dt>Deliver to</dt><dd>${d.receivingPoint?.code ?? "—"}</dd></div>
        <div><dt>Issued</dt><dd class="ac-num">${day(d.order.issuedAt)}</dd></div>
        <div><dt>Promised ship</dt><dd class="ac-num">${d.order.promisedShipOn ?? "—"}</dd></div>
      </dl>
      ${panel(DataGrid<PoLineWire>({
        density: ctx.density, caption: "Lines", stack: true, rows: d.lines, rowKey: (r) => r.id,
        columns: [
          { key: "no", header: "#", numeric: true, cell: (r) => r.lineNo },
          { key: "sku", header: "SKU", numeric: true, cell: (r) => r.vendorSku },
          { key: "desc", header: "Item", cell: (r) => r.description },
          { key: "qty", header: "Ordered", numeric: true, align: "end", cell: (r) => `${formatQuantity(r.quantityMilli)} ${r.uom}` },
          { key: "shipped", header: "Shipped", numeric: true, align: "end", cell: (r) => formatQuantity(r.shippedMilli) },
          { key: "recv", header: "Received", numeric: true, align: "end", cell: (r) => formatQuantity(r.receivedMilli) },
          { key: "inv", header: "Invoiced", numeric: true, align: "end", cell: (r) => formatQuantity(r.invoicedMilli) },
          { key: "amt", header: "Amount", numeric: true, align: "end", cell: (r) => formatMoney(r.amountMinor, d.order.currency) },
        ],
      }) ?? html``, "Lines", `${d.shipments.length} shipments · ${d.receipts.length} receipts · ${d.invoices.length} vendor invoices · ${d.returns.length} returns`)}`,
    () => ctx.store.invalidate("pos.detail"))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const owedMinor = (inv: InvoiceWire): bigint =>
  inv.status === "draft" || inv.status === "void" ? 0n : BigInt(inv.totalMinor) - BigInt(inv.paidMinor);

const billedTo = (inv: InvoiceWire, orgs: readonly OrganizationWire[]): string =>
  inv.billToTier === "parent" ? orgs.find((o) => o.id === inv.billToId)?.name ?? "—" : `${word(inv.billToTier)} ${shortRef(inv.billToId)}`;

const pastDue = (inv: InvoiceWire, now: number): boolean =>
  (inv.status === "open" || inv.status === "partially_paid") && inv.dueAt !== null && Date.parse(inv.dueAt) < now;

export const officeBilling: Screen = (ctx) => {
  const invoices = ctx.store.read(keyOf("invoices.list", {}), () => ctx.shell.gateway.listInvoices({}));
  const orgs = readOrgs(ctx);
  const names = orgs.value.state === "ready" ? orgs.value.value.organizations : [];
  const now = ctx.now();
  return html`<section>
    ${officeNav(ctx, "office.billing")}
    ${pageHead("Billing", "Every invoice, what was paid against it and what is still owed. Open one for its payments.")}
    ${whenReady(ctx, invoices.value, (o) => {
      const owed = o.invoices.reduce((s, i) => s + owedMinor(i), 0n);
      const late = o.invoices.filter((i) => pastDue(i, now)).length;
      const currency = o.invoices[0]?.currency ?? "USD";
      return html`
        ${statStrip([
          { n: num(o.invoices.length), label: "Invoices" },
          { n: num(formatMoney(owed.toString(), currency)), label: "Still owed" },
          { n: num(late), label: "Past due", ...(late > 0 ? { tone: "breached" as const } : {}) },
        ])}
        ${panel(DataGrid<InvoiceWire>({
          density: ctx.density, caption: "Invoices", stack: true, linked: true, rows: o.invoices, rowKey: (r) => r.id, emptyText: "No invoices yet.",
          columns: [
            { key: "ref", header: "Invoice", numeric: true, cell: (r) => linkTo(ctx, "office.invoice", { invoiceId: r.id }, shortRef(r.id)) },
            { key: "to", header: "Billed to", cell: (r) => billedTo(r, names) },
            { key: "issued", header: "Issued", numeric: true, cell: (r) => day(r.issuedAt) },
            { key: "due", header: "Due", numeric: true, cell: (r) => day(r.dueAt) },
            { key: "total", header: "Total", numeric: true, align: "end", cell: (r) => formatMoney(r.totalMinor, r.currency) },
            { key: "owed", header: "Still owed", numeric: true, align: "end", cell: (r) => formatMoney(owedMinor(r).toString(), r.currency) },
            { key: "state", header: "Standing", cell: (r) => (pastDue(r, now) ? "Past due" : word(r.status)) },
          ],
        }) ?? html``)}`;
    }, () => ctx.store.invalidate("invoices.list"))}
    ${readOnly}
  </section>`;
};

export const officeInvoice: Screen = (ctx, params) => {
  const invoiceId = params["invoiceId"]!;
  // invoices.list has no by-id read; HQ reads every invoice, so the one asked for is in it.
  const invoices = ctx.store.read(keyOf("invoices.list", {}), () => ctx.shell.gateway.listInvoices({}));
  const payments = ctx.store.read(keyOf("payments.list", { invoiceId }), () => ctx.shell.gateway.listPayments({ invoiceId }));
  const back = linkTo(ctx, "office.billing", {}, "All invoices");
  return html`<section>
    ${officeNav(ctx, "office.billing")}
    ${whenReady(ctx, invoices.value, (o) => {
      const inv = o.invoices.find((i) => i.id === invoiceId);
      if (!inv) return pageHead("Invoice not found", "No invoice with this reference is visible to you.", back);
      return html`
        ${pageHead(`Invoice ${shortRef(inv.id)}`, `${word(inv.billingPath)} · ${word(inv.status)}`, back)}
        <dl class="ac-facts">
          <div><dt>Total</dt><dd class="ac-num">${formatMoney(inv.totalMinor, inv.currency)}</dd></div>
          <div><dt>Received</dt><dd class="ac-num">${formatMoney(inv.paidMinor, inv.currency)}</dd></div>
          <div><dt>Still owed</dt><dd class="ac-num">${formatMoney(owedMinor(inv).toString(), inv.currency)}</dd></div>
          <div><dt>Due</dt><dd class="ac-num">${day(inv.dueAt)}</dd></div>
        </dl>
        ${panel(whenReady(ctx, payments.value, (p) => DataGrid<PaymentWire>({
          density: ctx.density, caption: "Payments", stack: true, rows: p.payments, rowKey: (r) => r.id, emptyText: "No payments recorded against this invoice.",
          columns: [
            { key: "at", header: "Received", numeric: true, cell: (r) => day(r.receivedAt) },
            { key: "amount", header: "Amount", numeric: true, align: "end", cell: (r) => formatMoney(r.amountMinor, r.currency) },
            { key: "method", header: "Method", cell: (r) => word(r.method) },
            { key: "ref", header: "Reference", cell: (r) => r.reference ?? "—" },
            { key: "state", header: "Standing", cell: (r) => (r.returnedAt ? `Returned — ${r.returnReason ?? "no reason given"}` : word(r.state)) },
          ],
        }) ?? html``), "Payments")}`;
    }, () => ctx.store.invalidate("invoices.list"))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const officeDevices: Screen = (ctx) => {
  const devices = ctx.store.read(keyOf("devices.list", {}), () => ctx.shell.gateway.listDevices({}));
  const region = regionsBy(ctx);
  return html`<section>
    ${officeNav(ctx, "office.devices")}
    ${pageHead("Field devices", "The hardware technicians sign in on, and the region each is kept in.")}
    ${panel(whenReady(ctx, devices.value, (o) => DataGrid<DeviceWire>({
      density: ctx.density, caption: "Devices", stack: true, rows: o.devices, rowKey: (r) => r.id, emptyText: "No devices registered.",
      columns: [
        { key: "hw", header: "Hardware", numeric: true, cell: (r) => r.hardwareId },
        { key: "kind", header: "Kind", cell: (r) => word(r.kind) },
        { key: "owner", header: "Held by", cell: (r) => (r.firmId ? `Firm ${shortRef(r.firmId)}` : "Ours") },
        { key: "region", header: "Region", cell: (r) => region(r.regionId) },
        { key: "active", header: "Standing", cell: (r) => (r.active ? "Active" : "Retired") },
      ],
    }) ?? html``, () => ctx.store.invalidate("devices.list")))}
    ${readOnly}
  </section>`;
};
