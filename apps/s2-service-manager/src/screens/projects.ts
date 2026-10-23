import { html, pageHead, panel, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { ContractWire, ForemanWire, OrganizationWire, ProjectWire, Refusal } from "../../../../packages/contracts/src/index.ts";
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
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));

  const orgGrid = (list: readonly OrganizationWire[]): VNode => DataGrid({
    density: ctx.density,
    stack: true, caption: "Customers",
    columns: [{ key: "name", header: "Customer", cell: (o: OrganizationWire) => linkTo(ctx, "projects", { orgId: o.id }, o.name) }],
    rows: list, rowKey: (o: OrganizationWire) => o.id, selectedKey: orgId ?? "",
    onSelect: (o: OrganizationWire) => ctx.router.navigate("projects", { orgId: o.id }),
    emptyText: "No customers yet.",
  });

  const head = pageHead("Projects", "What each install was sold under, and who sold it. Every install job is opened under a project, and the person who sold it stays on it as its foreman.");
  const orgPanel = panel(whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations)));
  if (!orgId) {
    return html`${head}<div class="s2-two-col">
      <aside class="s2-col--orgs">${orgPanel}</aside>
      <p class="s2-empty">Pick a customer to see what has been sold to them.</p>
    </div>`;
  }

  const listed = store.read(keyOf("projects.list", { orgId }), () => shell.gateway.listProjects({ orgId }));
  const contracts = store.read(keyOf("contracts.list", { orgId }), () => shell.gateway.listContracts({ orgId }));

  const grid = (rows: readonly ProjectWire[]): VNode => DataGrid({
    density: ctx.density,
    stack: true,
    columns: [
      { key: "name", header: "Project" },
      { key: "foremanName", header: "Sold by", cell: (p: ProjectWire) => p.foremanName ?? html`<span class="s2-muted">nobody named</span>` },
      { key: "serviceWindowStart", header: "Window", cell: (p: ProjectWire) => html`<span class="s2-num">${dayOf(p.serviceWindowStart)} → ${dayOf(p.serviceWindowEnd)}</span>` },
      { key: "installJobs", header: "Install jobs", align: "end", numeric: true, cell: (p: ProjectWire) => html`<span class="s2-num">${p.installJobs}</span>` },
      { key: "state", header: "State" },
    ],
    rows, rowKey: (p: ProjectWire) => p.id,
    emptyText: "Nothing sold to this customer yet.",
  });

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || form.value.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    form.value = { refusal: null, busy: true };
    try {
      await shell.gateway.createProject({
        contractId: v.contractId ?? "", name: v.name ?? "", foremanId: v.foremanId ?? "",
        serviceWindowStart: dayStart(v.from ?? ""), serviceWindowEnd: dayStart(v.to ?? "", 1),
      });
      store.invalidate(keyOf("projects.list", { orgId }));
      store.notice.value = [`${v.name} recorded. Install work can now be opened under it.`];
      form.value = { refusal: null, busy: false };
      (e.currentTarget as HTMLFormElement).reset();
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
        <select name="foremanId" required class="ac-input">${foremen.map((f) => html`<option value=${f.id}>${f.name}</option>`)}</select>
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
    <aside class="s2-col--orgs">${orgPanel}</aside>
    <div>
      ${panel(whenReady(ctx, listed.value, (l) => grid(l.projects)), "Sold", undefined, undefined, "projects")}
      ${panel(html`${whenReady(ctx, contracts.value, (c) => whenReady(ctx, listed.value, (l) => sellForm(c.contracts.filter((x) => x.state === "active"), l.foremen)))}
        ${form.value.refusal ? refusalView(ctx, form.value.refusal, [{ label: "Dismiss", onSelect: () => { form.value = { refusal: null, busy: false }; } }]) : null}`,
        "Record a sale", "Who sold it, under which agreement, and when the work runs.", undefined, "project-new")}
    </div>
  </div>`;
};
