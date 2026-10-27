import { html, pageHead, panel, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { ContractWire, ForemanWire, ListProjectsOutput, OrganizationWire, ProjectWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen } from "./common.ts";

/**
 * 0024 — WHAT AN INSTALL WAS SOLD UNDER. Every install job sits under one of
 * these, and its foreman is the person who sold it. The office records the
 * sale here; dispatch opens the install work under it (S3, new job).
 *
 * The form offers only agreements in force and only foremen: the two things
 * the gateway refuses (`contract_not_in_force`, `not_a_foreman`) are choices
 * this form never lets a person make.
 */
const form = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

/**
 * The office reads what was sold by who sold it: pick a foreman, then narrow
 * to the customers they sold to. The account search is every customer, sold
 * to or not — it is how a new sale finds its customer.
 */
const view = signal<{ readonly foremanId: string | null; readonly customerQ: string; readonly accountQ: string }>({ foremanId: null, customerQ: "", accountQ: "" });
const NOBODY = "nobody";
const matches = (name: string, q: string): boolean => name.toLowerCase().includes(q.trim().toLowerCase());

type Seller = { readonly id: string; readonly name: string; readonly projects: number; readonly customers: number };

/** Every foreman on staff, plus anyone who sold something and no longer holds the role, plus the projects nobody is named on. */
const sellersOf = (l: ListProjectsOutput): readonly Seller[] => {
  const names = new Map<string, string>(l.foremen.map((f) => [f.id, f.name]));
  for (const p of l.projects) if (p.foremanId && !names.has(p.foremanId)) names.set(p.foremanId, p.foremanName ?? "unnamed");
  const sold = (id: string | null) => l.projects.filter((p) => p.foremanId === id);
  const seller = (id: string, name: string, ps: readonly ProjectWire[]): Seller => ({ id, name, projects: ps.length, customers: new Set(ps.map((p) => p.orgId)).size });
  const named = [...names].map(([id, name]) => seller(id, name, sold(id))).sort((a, b) => a.name.localeCompare(b.name));
  const nobody = sold(null);
  return nobody.length > 0 ? [...named, seller(NOBODY, "Nobody named", nobody)] : named;
};

/** By foreman, then customer; within a customer the gateway's order holds — latest window first. */
const byForeman = (a: ProjectWire, b: ProjectWire): number =>
  (a.foremanName === null ? 1 : 0) - (b.foremanName === null ? 1 : 0)
  || (a.foremanName ?? "").localeCompare(b.foremanName ?? "")
  || a.customer.localeCompare(b.customer);

/** A date input's day at local midnight, as an instant. The window's end is the morning after its last day. */
const dayStart = (d: string, plusDays = 0): string => {
  const at = new Date(`${d}T00:00`);
  at.setDate(at.getDate() + plusDays);
  return at.toISOString();
};
const dayOf = (iso: string): string => iso.slice(0, 10);

export const projects: Screen = (ctx, params) => {
  const { store, shell } = ctx;
  const orgId = params.orgId;
  const pick = view.value;
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));
  const listed = store.read(keyOf("projects.list", {}), () => shell.gateway.listProjects({}));

  const foremanGrid = (l: ListProjectsOutput): VNode => DataGrid({
    density: ctx.density,
    stack: true, caption: "Foremen",
    columns: [
      { key: "name", header: "Foreman" },
      { key: "projects", header: "Projects", align: "end", numeric: true, cell: (s: Seller) => html`<span class="s2-num">${s.projects}</span>` },
      { key: "customers", header: "Customers", align: "end", numeric: true, cell: (s: Seller) => html`<span class="s2-num">${s.customers}</span>` },
    ],
    rows: sellersOf(l), rowKey: (s: Seller) => s.id, selectedKey: pick.foremanId ?? "",
    onSelect: (s: Seller) => { view.value = { ...pick, foremanId: pick.foremanId === s.id ? null : s.id, customerQ: "" }; },
    emptyText: "Nobody on our staff holds the foreman role.",
  });

  const accountGrid = (list: readonly OrganizationWire[], l: ListProjectsOutput): VNode => DataGrid({
    density: ctx.density,
    stack: true, caption: "Customer accounts",
    columns: [
      { key: "name", header: "Customer", cell: (o: OrganizationWire) => linkTo(ctx, "projects", { orgId: o.id }, o.name) },
      { key: "sold", header: "Projects", align: "end", numeric: true, cell: (o: OrganizationWire) => html`<span class="s2-num">${l.projects.filter((p) => p.orgId === o.id).length}</span>` },
    ],
    rows: list.filter((o) => matches(o.name, pick.accountQ)), rowKey: (o: OrganizationWire) => o.id, selectedKey: orgId ?? "",
    onSelect: (o: OrganizationWire) => ctx.router.navigate("projects", { orgId: o.id }),
    emptyText: pick.accountQ ? "No customer account matches." : "No customers yet.",
  });

  const sellerName = (l: ListProjectsOutput): string | null =>
    pick.foremanId === null ? null : sellersOf(l).find((s) => s.id === pick.foremanId)?.name ?? null;

  const grid = (l: ListProjectsOutput): VNode => {
    const rows = l.projects
      .filter((p) => pick.foremanId === null || (p.foremanId ?? NOBODY) === pick.foremanId)
      .filter((p) => !orgId || p.orgId === orgId)
      .filter((p) => matches(p.customer, pick.customerQ))
      .sort(byForeman);
    return DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        ...(pick.foremanId === null ? [{ key: "foremanName", header: "Sold by", cell: (p: ProjectWire) => p.foremanName ?? html`<span class="s2-muted">nobody named</span>` }] : []),
        { key: "customer", header: "Customer", cell: (p: ProjectWire) => linkTo(ctx, "projects", { orgId: p.orgId }, p.customer) },
        { key: "name", header: "Project" },
        { key: "serviceWindowStart", header: "Window", cell: (p: ProjectWire) => html`<span class="s2-num">${dayOf(p.serviceWindowStart)} → ${dayOf(p.serviceWindowEnd)}</span>` },
        { key: "installJobs", header: "Install jobs", align: "end", numeric: true, cell: (p: ProjectWire) => html`<span class="s2-num">${p.installJobs}</span>` },
        { key: "state", header: "State" },
      ],
      rows, rowKey: (p: ProjectWire) => p.id,
      emptyText: pick.customerQ ? "No customer they sold to matches." : orgId ? "Nothing sold to this customer yet." : "Nothing sold yet.",
    });
  };

  const soldSub = (l: ListProjectsOutput): VNode => {
    const who = sellerName(l);
    const o = orgs.value;
    const customer = orgId && o.state === "ready" ? o.value.organizations.find((x) => x.id === orgId)?.name : undefined;
    return html`${who ? `Sold by ${who}` : "Every foreman's sales, by foreman"}${customer ? html` · to ${customer} — ${linkTo(ctx, "projects", {}, "every customer")}` : null}.`;
  };

  const customerSearch = (l: ListProjectsOutput): VNode => html`<input class="ac-input" type="search" name="customerQ"
    placeholder=${sellerName(l) ? `Customers ${sellerName(l)} sold to` : "Customer sold to"} aria-label="Search the customers sold to" value=${pick.customerQ}
    onInput=${(e: Event) => { view.value = { ...view.value, customerQ: (e.currentTarget as HTMLInputElement).value }; }} />`;

  const accountSearch = html`<input class="ac-input" type="search" name="accountQ" placeholder="Customer account name"
    aria-label="Search every customer account by name" value=${pick.accountQ}
    onInput=${(e: Event) => { view.value = { ...view.value, accountQ: (e.currentTarget as HTMLInputElement).value }; }} />`;

  const head = pageHead("Projects", "What each install was sold under, and who sold it. Every install job is opened under a project, and the foreman who sold it stays on it.");
  const aside = html`<aside class="s2-col--orgs">
    ${panel(whenReady(ctx, listed.value, foremanGrid), "Foremen", "Pick one to see what they sold. Pick again for everyone.", undefined, "project-foremen")}
    ${panel(html`${accountSearch}${whenReady(ctx, orgs.value, (o) => whenReady(ctx, listed.value, (l) => accountGrid(o.organizations, l)))}`,
      "Customer accounts", "Every customer, sold to or not. Pick one to record a sale.", undefined, "project-accounts")}
  </aside>`;
  const sold = whenReady(ctx, listed.value, (l) => panel(grid(l), "Sold", soldSub(l), customerSearch(l), "projects"));

  if (!orgId) {
    return html`${head}<div class="s2-two-col">
      ${aside}
      <div>${sold}<p class="s2-empty">Find the customer under Customer accounts to record a sale.</p></div>
    </div>`;
  }

  const contracts = store.read(keyOf("contracts.list", { orgId }), () => shell.gateway.listContracts({ orgId }));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || form.value.busy) return;
    const formEl = e.currentTarget as HTMLFormElement;
    const v = formValues(formEl);
    form.value = { refusal: null, busy: true };
    try {
      await shell.gateway.createProject({
        contractId: v.contractId ?? "", name: v.name ?? "", foremanId: v.foremanId ?? "",
        serviceWindowStart: dayStart(v.from ?? ""), serviceWindowEnd: dayStart(v.to ?? "", 1),
      });
      store.invalidate(keyOf("projects.list", {}));
      store.notice.value = [`${v.name} recorded. Install work can now be opened under it.`];
      form.value = { refusal: null, busy: false };
      formEl.reset();
    } catch (err) {
      form.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };
  const sellForm = (inForce: readonly ContractWire[], foremen: readonly ForemanWire[]): VNode => {
    if (inForce.length === 0) return html`<p class="s2-empty">This customer has no agreement in force — nothing can be sold under a draft or an ended one. ${linkTo(ctx, "contracts.list", { orgId }, "Agreements")}</p>`;
    if (foremen.length === 0) return html`<p class="s2-empty">Nobody on our staff holds the foreman role, and a project is sold by a foreman.</p>`;
    return html`<form class="ac-form" onSubmit=${submit} id="project-form">
      <label class="ac-field"><span>Project</span><input class="ac-input" name="name" required autocomplete="off" /></label>
      <label class="ac-field">
        <span>Sold by</span>
        <select name="foremanId" required class="ac-input">${foremen.map((f) => html`<option value=${f.id} selected=${f.id === view.value.foremanId}>${f.name}</option>`)}</select>
        <small>The foreman who sold it. They stay on the project, and on every install job under it.</small>
      </label>
      <label class="ac-field">
        <span>Agreement</span>
        <select name="contractId" required class="ac-input">${inForce.map((c) => html`<option value=${c.id}>${c.kind.replace(/_/g, " ")} · from ${c.effectiveFrom}</option>`)}</select>
        <small>Agreements in force only.</small>
      </label>
      <div class="s2-address-row">
        <label class="ac-field"><span>First day</span><input class="ac-input" type="date" name="from" required /></label>
        <label class="ac-field"><span>Last day</span><input class="ac-input" type="date" name="to" required /></label>
      </div>
      <div class="s2-form__actions">${submitAction(ctx, form.value.busy ? "Recording…" : "Record project", "record-project")}</div>
    </form>`;
  };

  return html`${head}<div class="s2-two-col">
    ${aside}
    <div>
      ${sold}
      ${panel(html`${whenReady(ctx, contracts.value, (c) => whenReady(ctx, listed.value, (l) => sellForm(c.contracts.filter((x) => x.state === "active"), l.foremen)))}
        ${form.value.refusal ? refusalView(ctx, form.value.refusal, [{ label: "Dismiss", onSelect: () => { form.value = { refusal: null, busy: false }; } }]) : null}`,
        "Record a sale", "Who sold it, under which agreement, and when the work runs.", undefined, "project-new")}
    </div>
  </div>`;
};
