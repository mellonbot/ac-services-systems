import { KINDS, kindsOf } from "../kinds.ts";
import type { Kind, KindId, UserRecord } from "../kinds.ts";
import { ROLES, CUSTOMER_ROLES, type CustomerRole } from "../../../../packages/contracts/src/scope.ts";
import type { Role } from "../../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../../packages/contracts/src/tiers.ts";
import type { CustomerSegment, DeviceKind } from "../../../../packages/contracts/src/operations.ts";
import type { Api } from "../preload.ts";
import type { DbName } from "../connections.ts";
import type { NewLogin } from "../rows.ts";
import type { AccountNode, Company, LoginEdit } from "../db.ts";
import { DEFAULT_PAYMENT_TERMS_DAYS } from "../companies.ts";
import type { NewCompany } from "../companies.ts";

// Injected by build.mjs from connections.ts, which the browser bundle cannot import (node:fs).
declare const LOCAL_DEFAULT: string;
declare global { interface Window { logins: Api } }

const api = window.logins;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Child = Node | string | null | false;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (typeof v === "boolean") { if (v) el.setAttribute(k, ""); }
    else if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
};

const state = {
  db: "local" as DbName,
  production: false,
  localIsDefault: true,
  kind: "S2" as KindId | "companies",
  showInactive: false,
  /** The Customer Portal tab's residential / commercial selection (0019). */
  segment: "all" as CustomerSegment | "all",
  users: [] as readonly UserRecord[],
  companies: [] as readonly Company[],
};

// ── Banner ────────────────────────────────────────────────────────────────
const banner = (text: string, tone: "error" | "info" = "error"): void => {
  const b = $("banner");
  b.className = `banner ${tone}`;
  b.textContent = text;
  b.hidden = false;
};
const clearBanner = (): void => { $("banner").hidden = true; };
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const signedOut = (n: number): void => { if (n > 0) banner(`Signed out of ${n} session(s).`, "info"); };

// ── Header ────────────────────────────────────────────────────────────────
const renderHeader = (): void => {
  document.querySelectorAll<HTMLButtonElement>("[data-db]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.db === state.db)));
  $("prod-label").hidden = state.db !== "production";
  document.body.dataset.db = state.db;
};

// ── Sidebar + table ───────────────────────────────────────────────────────
const kindOf = (id: KindId): Kind => KINDS.find((k) => k.id === id)!;
const inKind = (u: UserRecord, id: KindId): boolean => kindsOf(u).includes(id);

const renderSidebar = (): void => {
  const active = state.users.filter((u) => u.active);
  const item = (id: KindId | "companies", name: string, count: number, cls = ""): HTMLLIElement => h("li", { class: cls },
    h("button", { type: "button", "aria-current": id === state.kind ? "true" : undefined, onclick: () => { state.kind = id; render(); } },
      h("span", { class: "name" }, name),
      h("span", { class: "count" }, String(count))));
  $("kinds").replaceChildren(
    ...KINDS.map((k) => item(k.id, k.name, active.filter((u) => inKind(u, k.id)).length)),
    item("companies", "Crews & units", state.companies.filter((c) => c.active).length, "companies"));
};

const SEGMENT_WORD: Readonly<Record<CustomerSegment, string>> = { residential: "Residential", commercial: "Commercial" };
const SEGMENT_CHOICES = [["all", "All"], ["residential", "Residential"], ["commercial", "Commercial"]] as const;
const inSegment = (segment: CustomerSegment | null): boolean => state.segment === "all" || segment === state.segment;

/** Residential / Commercial / All — shown on the Customer Portal tab only. */
const renderSegment = (): void => {
  const wrap = $("segment");
  wrap.hidden = state.kind !== "S6";
  wrap.replaceChildren(...SEGMENT_CHOICES.map(([v, t]) => h("button", {
    type: "button", "aria-pressed": String(state.segment === v), onclick: () => { state.segment = v; render(); },
  }, t)));
};

const roles = (u: UserRecord): string => u.roles.join(", ") || "—";
const KIND_WORD: Record<Company["kind"], string> = { service: "Service unit", install: "Install crew" };
/** Who employs the people on a crew: us, or the contractor firm by name. */
const employer = (type: Company["employmentType"] | null, firmName: string | null): string =>
  type === null ? "—" : type === "employed" ? "Ours" : firmName ?? "Contractor";
/** 0024: a technician's unit is their own; one shared or an install crew predates that and can be moved off in Edit. */
const unitWord = (u: UserRecord): string =>
  u.crewLabel === null ? "—" : u.ownUnit ? "Own unit" : `${u.crewKind === "install" ? "Install crew" : "Shared"} — ${u.crewLabel}`;
const COLUMNS: Record<KindId, readonly [string, (u: UserRecord) => string][]> = {
  S2: [["Roles", roles], ["Scope", (u) => (u.scopeTier === "parent" ? "org-wide" : u.regionCode)]],
  S3: [["Roles", roles], ["Scope", (u) => (u.scopeTier === "parent" ? "org-wide" : u.regionCode)]],
  S4: [["Roles", roles], ["Scope", (u) => (u.scopeTier === "parent" ? "org-wide" : u.regionCode)]],
  S5: [["Employer", (u) => employer(u.crewEmployment, u.crewFirmName)], ["Service unit", unitWord]],
  S6: [["Customer", (u) => u.orgName], ["Type", (u) => (u.orgSegment ? SEGMENT_WORD[u.orgSegment] : "—")], ["Sees", (u) => (u.scopeTier === "parent" ? (u.orgSegment === "residential" ? "Whole household" : "Whole company") : u.scopeName ?? "—")]],
  S8: [["Firm", (u) => u.firmName ?? "—"]],
  S7: [],
  other: [["Namespace", (u) => u.namespace], ["Roles", roles]],
};

const COMPANY_COLUMNS: readonly [string, (c: Company) => string, string?][] = [
  ["Kind", (c) => KIND_WORD[c.kind]],
  ["Employer", (c) => employer(c.employmentType, c.firmName)],
  ["Region", (c) => c.regionCode],
  ["Technicians", (c) => String(c.technicians), "num"],
  ["Documents", (c) => c.documents],
  ["Firm status", (c) => (c.employmentType === "subcontracted" ? c.firmStatus ?? "" : "")],
];

const renderCompanies = (): void => {
  $("title").textContent = "Crews & units";
  $("add").hidden = false;
  $("add").textContent = "+ Add install crew";
  $("note").hidden = true;
  $("thead").replaceChildren(...["Name", ...COMPANY_COLUMNS.map(([t]) => t), ""].map((t) => h("th", { scope: "col" }, t)));
  const rows = state.companies.filter((c) => state.showInactive || c.active);
  $("tbody").replaceChildren(...(rows.length === 0
    ? [h("tr", {}, h("td", { colspan: COMPANY_COLUMNS.length + 2, class: "empty" }, "No crews or units."))]
    : rows.map((c) => h("tr", { class: c.active ? "" : "inactive" },
      h("td", {}, c.label, !c.active && h("span", { class: "tag" }, "inactive")),
      ...COMPANY_COLUMNS.map(([, f, cls]) => h("td", cls ? { class: cls } : {}, f(c))),
      h("td", { class: "actions" }, c.active
        ? h("button", { type: "button", onclick: () => void removeCompany(c) }, "Remove")
        : h("button", { type: "button", onclick: () => void reactivateCompany(c) }, "Reactivate"))))));
};

const renderTable = (): void => {
  renderSegment();
  if (state.kind === "companies") { renderCompanies(); return; }
  const kind = kindOf(state.kind);
  $("title").textContent = `${kind.name} logins`;
  $("add").hidden = !kind.canAdd;
  $("add").textContent = "+ Add login";
  const note = $("note");
  note.hidden = !kind.note;
  note.textContent = kind.note ?? "";
  const cols = COLUMNS[kind.id];
  $("thead").replaceChildren(...["Email", "Name", ...cols.map(([t]) => t), ""].map((t) => h("th", { scope: "col" }, t)));
  const rows = state.users.filter((u) => inKind(u, kind.id) && (state.showInactive || u.active) && (kind.id !== "S6" || inSegment(u.orgSegment)));
  $("tbody").replaceChildren(...(rows.length === 0
    ? [h("tr", {}, h("td", { colspan: cols.length + 3, class: "empty" }, "No logins."))]
    : rows.map((u) => h("tr", { class: u.active ? "" : "inactive" },
      h("td", { class: "email" }, u.email, !u.active && h("span", { class: "tag" }, "inactive")),
      h("td", {}, u.displayName),
      ...cols.map(([, f]) => h("td", {}, f(u))),
      h("td", { class: "actions" }, ...(u.active
        ? [
          h("button", { type: "button", onclick: () => resetForm(u) }, "Reset password"),
          h("button", { type: "button", onclick: () => editForm(u) }, "Edit"),
          kind.id === "S5" && h("button", { type: "button", onclick: () => void shiftForm(u) }, "Grant shift"),
          h("button", { type: "button", onclick: () => void remove(u) }, "Remove"),
        ]
        : [h("button", { type: "button", onclick: () => void reactivate(u) }, "Reactivate")]))))));
};

const render = (): void => { renderHeader(); renderSidebar(); renderTable(); };

// Every awaited call captures the database it asked; a reply for a database the window no longer shows is dropped.
const stale = (db: DbName): boolean => state.db !== db;

const reload = async (): Promise<void> => {
  const db = state.db;
  try {
    const [users, companies] = await Promise.all([api.listUsers(db, state.showInactive), api.listCompanies(db, state.showInactive)]);
    if (stale(db)) return;
    state.users = users;
    state.companies = companies;
  } catch (e) {
    if (stale(db)) return;
    state.users = [];
    state.companies = [];
    banner(message(e));
  }
  render();
};

// ── Row actions ───────────────────────────────────────────────────────────
const remove = async (u: UserRecord): Promise<void> => {
  const db = state.db;
  if (db === "production" && !confirm(`Remove ${u.email}? They will be signed out everywhere.`)) return;
  try {
    clearBanner();
    const { revokedSessions } = await api.deactivate(db, u.id);
    if (stale(db)) return;
    signedOut(revokedSessions);
  } catch (e) { if (stale(db)) return; banner(message(e)); }
  await reload();
};

const reactivate = async (u: UserRecord): Promise<void> => {
  const db = state.db;
  try {
    clearBanner();
    await api.reactivate(db, u.id);
  } catch (e) { if (stale(db)) return; banner(message(e)); }
  if (stale(db)) return;
  await reload();
};

const removeCompany = async (c: Company): Promise<void> => {
  const db = state.db;
  if (db === "production" && !confirm(`Remove ${c.label}?`)) return;
  try {
    clearBanner();
    await api.removeCompany(db, c.id);
  } catch (e) { if (stale(db)) return; banner(message(e)); }
  if (stale(db)) return;
  await reload();
};

const reactivateCompany = async (c: Company): Promise<void> => {
  const db = state.db;
  try {
    clearBanner();
    await api.reactivateCompany(db, c.id);
  } catch (e) { if (stale(db)) return; banner(message(e)); }
  if (stale(db)) return;
  await reload();
};

// ── Modal forms ───────────────────────────────────────────────────────────
const dialog = (): HTMLDialogElement => $("dialog");
const closeForm = (): void => { if (dialog().open) dialog().close(); };

const field = (label: string, control: HTMLElement): HTMLLabelElement => h("label", { class: "field" }, h("span", {}, label), control);
const input = (name: string, props: Record<string, unknown> = {}): HTMLInputElement => h("input", { name, required: true, ...props });
const select = (name: string, options: readonly [string, string][], placeholder = "Choose…"): HTMLSelectElement => {
  const s = h("select", { name, required: true }, h("option", { value: "" }, placeholder), ...options.map(([v, t]) => h("option", { value: v }, t)));
  if (options.length === 1) s.value = options[0]![0];
  return s;
};
const passwordFields = (): HTMLElement[] => [
  field("Password", input("password", { type: "password", autocomplete: "new-password" })),
  field("Password again", input("password2", { type: "password", autocomplete: "new-password" })),
];

type OpenForm = { readonly save: HTMLButtonElement; showError(text: string): void };

/** Opens the modal. `submit` returns the revoked-session count, if the call reports one. */
const openForm = (title: string, body: HTMLElement[], submit: (f: FormData) => Promise<number | void>): OpenForm => {
  const form = $<HTMLFormElement>("form");
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const save = h("button", { type: "submit", class: "primary" }, "Save");
  const showError = (text: string): void => { error.textContent = text; error.hidden = !text; };
  form.replaceChildren(
    h("h3", {}, title),
    ...body,
    error,
    h("div", { class: "buttons" },
      h("button", { type: "button", onclick: closeForm }, "Cancel"),
      save),
  );
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    if (data.has("password") && data.get("password") !== data.get("password2")) {
      showError("The two passwords differ.");
      return;
    }
    // One save at a time: a second click while the first is in flight would write twice.
    if (save.disabled) return;
    save.disabled = true;
    try {
      const revoked = await submit(data);
      closeForm();
      clearBanner();
      if (typeof revoked === "number") signedOut(revoked);
      await reload();
    } catch (e) {
      showError(message(e));
    } finally {
      save.disabled = false;
    }
  };
  dialog().showModal();
  return { save, showError };
};

/** Shows a value the pickers no longer offer (inactive region, node, crew), so an untouched form keeps it. */
const keepOption = (sel: HTMLSelectElement, value: string, text: string): void => {
  if (!Array.from(sel.options).some((o) => o.value === value)) sel.add(h("option", { value }, text), 1);
  sel.value = value;
};

const str = (f: FormData, k: string): string => String(f.get(k) ?? "");

const indented = (nodes: readonly AccountNode[]): [string, string][] => {
  const out: [string, string][] = [];
  const walk = (parent: string | null, depth: number): void => {
    for (const n of nodes.filter((x) => x.parentId === parent)) {
      out.push([n.id, `${"\u00a0\u00a0\u00a0".repeat(depth)}${n.name}`]); // NBSP: an <option> collapses ordinary spaces
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
};

const radios = (name: string, legend: string, options: readonly [string, string][], checked: string | null): HTMLFieldSetElement =>
  h("fieldset", { class: "choice" }, h("legend", {}, legend),
    ...options.map(([v, t]) => h("label", { class: "check" }, h("input", { type: "radio", name, value: v, checked: v === checked }), t)));

/** A group of fields shown for one choice; disabled while hidden, so its controls are neither validated nor submitted. */
const branch = (...children: HTMLElement[]): HTMLFieldSetElement => h("fieldset", { class: "group" }, ...children);
const showBranch = (g: HTMLFieldSetElement, on: boolean): void => { g.hidden = !on; g.disabled = !on; };

const DATA_RIGHTS_UNCHOSEN = "Choose whether diagnostic data rights are reserved";

const companyForm = async (db: DbName): Promise<void> => {
  const [regions, firms] = await Promise.all([api.listRegions(db), api.listFirms(db)]);
  if (stale(db)) return;
  const regionOptions = regions.map((r): [string, string] => [r.id, `${r.code} — ${r.name}`]);

  const type = radios("type", "Employer", [["ours", "Ours"], ["contractor", "Contractor"]], "ours");
  const ours = branch(field("Name", input("name")), field("Region", select("regionId", regionOptions)));

  const firmMode = radios("firmMode", "Firm", [["new", "New firm"], ["existing", "Existing firm"]], "new");
  firmMode.querySelector<HTMLInputElement>("[value=existing]")!.disabled = firms.length === 0;
  const firm = select("firmId", firms.map((x) => [x.id, x.status === "suspended" ? `${x.legalName} (suspended)` : x.legalName]));
  const existing = branch(field("Firm", firm));
  const legalName = input("legalName");
  const fresh = branch(
    field("Legal name", legalName),
    field("Region", select("firmRegionId", regionOptions)),
    field("Payment terms (days)", input("paymentTermsDays", { type: "number", min: 0, step: 1, value: DEFAULT_PAYMENT_TERMS_DAYS })),
    radios("dataRights", "Diagnostic data rights reserved", [["yes", "Yes"], ["no", "No"]], null),
    field("MSA signed date", h("input", { name: "msaSignedAt", type: "date" })),
  );
  // The company name follows the firm's legal name until the user types their own.
  const companyName = input("companyName");
  let named = false;
  companyName.addEventListener("input", () => { named = companyName.value !== ""; });
  const follow = (text: string): void => { if (!named) companyName.value = text; };
  legalName.addEventListener("input", () => follow(legalName.value));
  firm.addEventListener("change", () => follow(firms.find((x) => x.id === firm.value)?.legalName ?? ""));
  const contractor = branch(firmMode, existing, fresh, field("Crew name", companyName));

  const sync = (): void => {
    const isOurs = type.querySelector<HTMLInputElement>("[value=ours]")!.checked;
    const isNew = firmMode.querySelector<HTMLInputElement>("[value=new]")!.checked;
    showBranch(ours, isOurs);
    showBranch(contractor, !isOurs);
    showBranch(existing, !isOurs && !isNew);
    showBranch(fresh, !isOurs && isNew);
    follow(isNew ? legalName.value : firms.find((x) => x.id === firm.value)?.legalName ?? "");
  };
  type.addEventListener("change", sync);
  firmMode.addEventListener("change", sync);
  sync();

  openForm("Add install crew", [type, ours, contractor], async (f) => {
    let n: NewCompany;
    if (str(f, "type") === "ours") {
      n = { type: "ours", name: str(f, "name"), regionId: str(f, "regionId") };
    } else if (str(f, "firmMode") === "existing") {
      n = { type: "contractor", name: str(f, "companyName"), firm: { existing: str(f, "firmId") } };
    } else {
      if (!f.has("dataRights")) throw new Error(DATA_RIGHTS_UNCHOSEN);
      n = { type: "contractor", name: str(f, "companyName"), firm: {
        legalName: str(f, "legalName"), regionId: str(f, "firmRegionId"), paymentTermsDays: Number(str(f, "paymentTermsDays")),
        dataRightsReserved: str(f, "dataRights") === "yes", msaSignedAt: str(f, "msaSignedAt") || null,
      } };
    }
    await api.addCompany(db, n);
  });
};

const WHOLE = "parent";

/** Customer scope: "Whole company" (+ a region from the org's region nodes) or one node of the tree. */
const customerScope = (wrap: HTMLElement, getNodes: () => readonly AccountNode[]): void => {
  const nodes = getNodes();
  const regionNodes = nodes.filter((n) => n.tier === "region");
  const sees = select("node", [[WHOLE, "Whole company"], ...indented(nodes)]);
  const region = select("wholeRegion", regionNodes.map((n) => [n.regionId, n.name]));
  const regionField = field("Region", region);
  const sync = (): void => { regionField.hidden = sees.value !== WHOLE; region.required = sees.value === WHOLE; };
  sees.addEventListener("change", sync);
  sync();
  wrap.replaceChildren(field("Sees", sees), regionField);
};

const customerPlacement = (f: FormData, nodes: readonly AccountNode[], orgId: string): { tier: Tier; nodeId: string; regionId: string } => {
  const id = str(f, "node");
  if (id === WHOLE) return { tier: "parent", nodeId: orgId, regionId: str(f, "wholeRegion") };
  const n = nodes.find((x) => x.id === id)!;
  return { tier: n.tier, nodeId: n.id, regionId: n.regionId };
};

const roleBoxes = (checked: readonly string[]): HTMLElement => h("fieldset", { class: "roles" }, h("legend", {}, "Roles"),
  ...[...ROLES, ...checked.filter((r) => !(ROLES as readonly string[]).includes(r))].map((r) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "roles", value: r, checked: checked.includes(r) }), r)));

const HOUSEHOLD_WORD: Readonly<Record<CustomerRole, string>> = { payer: "Pays the balance", requester: "Requests service" };
/** A customer login's job (R6). Both ticked by default: one person on an account does both. */
const householdBoxes = (checked: readonly string[]): HTMLElement => h("fieldset", { class: "roles" }, h("legend", {}, "Does"),
  ...CUSTOMER_ROLES.map((r) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "householdRoles", value: r, checked: checked.includes(r) }), HOUSEHOLD_WORD[r])));

/** Which kind of customer the new login belongs to; narrows the Customer list to that segment. */
const segmentRadios = (current: CustomerSegment): HTMLElement => h("fieldset", { class: "scope" }, h("legend", {}, "Customer type"),
  ...(["residential", "commercial"] as const).map((v) => h("label", { class: "check" },
    h("input", { type: "radio", name: "segment", value: v, checked: v === current }), SEGMENT_WORD[v])));

const scopeRadios = (current: "org" | "region"): HTMLElement => h("fieldset", { class: "scope" }, h("legend", {}, "Scope"),
  ...(["org", "region"] as const).map((v) => h("label", { class: "check" },
    h("input", { type: "radio", name: "scope", value: v, checked: v === current, required: true }), v === "org" ? "org-wide" : "one region")));

const addForm = async (): Promise<void> => {
  const db = state.db;
  if (state.kind === "companies") {
    try { await companyForm(db); } catch (e) { if (!stale(db)) banner(message(e)); }
    return;
  }
  const kind = kindOf(state.kind);
  const base = (f: FormData) => ({ email: str(f, "email"), displayName: str(f, "displayName"), password: str(f, "password") });
  const head = [field("Email", input("email", { type: "email", autocomplete: "off" })), field("Name", input("displayName"))];
  try {
    switch (kind.id) {
      case "S2": case "S3": case "S4": {
        const regions = await api.listRegions(db);
        if (stale(db)) return;
        openForm(`Add ${kind.name} login`, [...head, roleBoxes([]), scopeRadios("region"),
          field("Region", select("regionId", regions.map((r) => [r.id, `${r.code} — ${r.name}`]))), ...passwordFields()],
        async (f) => {
          const n: NewLogin = { ...base(f), kind: "internal", roles: f.getAll("roles") as Role[], scope: str(f, "scope") as "org" | "region", regionId: str(f, "regionId") };
          await api.addLogin(db, n);
        });
        return;
      }
      case "S5": {
        // 0024: the technician's own service unit is made with the login, under whoever employs them.
        const [regions, firms] = await Promise.all([api.listRegions(db), api.listFirms(db)]);
        if (stale(db)) return;
        const type = radios("employer", "Employer", [["ours", "Ours"], ["contractor", "Contractor"]], "ours");
        type.querySelector<HTMLInputElement>("[value=contractor]")!.disabled = firms.length === 0;
        const ours = branch(field("Region", select("regionId", regions.map((r) => [r.id, `${r.code} — ${r.name}`]))));
        const contractor = branch(field("Firm", select("firmId", firms.map((x) => [x.id, x.status === "suspended" ? `${x.legalName} (suspended)` : x.legalName]))));
        const sync = (): void => {
          const isOurs = type.querySelector<HTMLInputElement>("[value=ours]")!.checked;
          showBranch(ours, isOurs);
          showBranch(contractor, !isOurs);
        };
        type.addEventListener("change", sync);
        sync();
        openForm("Add Technician login", [...head, type, ours, contractor, ...passwordFields()],
          async (f) => {
            const employer = str(f, "employer") === "ours"
              ? { type: "ours" as const, regionId: str(f, "regionId") }
              : { type: "contractor" as const, firmId: str(f, "firmId") };
            await api.addLogin(db, { ...base(f), kind: "technician", employer });
          });
        return;
      }
      case "S6": {
        const orgs = await api.listCustomerOrgs(db);
        if (stale(db)) return;
        // `nodes` is only ever the tree of `treeOf`; Save stays disabled until the chosen org's tree has arrived.
        let nodes: readonly AccountNode[] = [];
        let treeOf = "";
        const scope = h("div", { class: "group" });
        const org = h("select", { name: "orgId", required: true });
        const segment = segmentRadios(state.segment === "all" ? "residential" : state.segment);
        const fillOrgs = (): void => {
          const chosen = (segment.querySelector<HTMLInputElement>("input:checked")?.value ?? "residential") as CustomerSegment;
          org.replaceChildren(h("option", { value: "" }, "Choose…"), ...orgs.filter((o) => o.segment === chosen).map((o) => h("option", { value: o.id }, o.name)));
          if (org.options.length === 2) org.value = org.options[1]!.value;
        };
        fillOrgs();
        const form = openForm("Add Customer Portal login", [...head, segment, field("Customer", org), scope, householdBoxes(CUSTOMER_ROLES), ...passwordFields()], async (f) => {
          const orgId = str(f, "orgId");
          if (treeOf !== orgId) throw new Error("The customer's sites have not loaded yet.");
          await api.addLogin(db, { ...base(f), kind: "customer", orgId, ...customerPlacement(f, nodes, orgId), roles: f.getAll("householdRoles") as CustomerRole[] });
        });
        const loadTree = async (): Promise<void> => {
          const orgId = org.value;
          nodes = [];
          treeOf = "";
          scope.replaceChildren();
          form.showError("");
          form.save.disabled = orgId !== "";
          if (!orgId) return;
          try {
            const tree = await api.listAccountTree(db, orgId);
            if (stale(db) || org.value !== orgId) return;
            nodes = tree;
            treeOf = orgId;
            customerScope(scope, () => nodes);
            form.save.disabled = false;
          } catch (e) {
            if (!stale(db) && org.value === orgId) form.showError(message(e));
          }
        };
        org.addEventListener("change", () => void loadTree());
        segment.addEventListener("change", () => { fillOrgs(); void loadTree(); });
        await loadTree();
        return;
      }
      case "S8": {
        const [firms, regions] = await Promise.all([api.listFirms(db), api.listRegions(db)]);
        if (stale(db)) return;
        const firm = select("firmId", firms.map((x) => [x.id, x.legalName]));
        const region = select("regionId", regions.map((r) => [r.id, `${r.code} — ${r.name}`]));
        firm.addEventListener("change", () => { region.value = firms.find((x) => x.id === firm.value)?.regionId ?? ""; });
        openForm(`Add ${kind.name} login`, [...head, field("Firm", firm), field("Region", region), ...passwordFields()], async (f) => {
          await api.addLogin(db, { ...base(f), kind: "subcontractor", firmId: str(f, "firmId"), regionId: str(f, "regionId") });
        });
        return;
      }
      default:
        return;
    }
  } catch (e) { if (!stale(db)) banner(message(e)); }
};

const resetForm = (u: UserRecord): void => {
  const db = state.db;
  openForm(`Reset password — ${u.email}`, passwordFields(), async (f) => (await api.resetPassword(db, u.id, str(f, "password"))).revokedSessions);
};

const NEW_DEVICE = "new";
const DEVICE_KINDS: readonly [DeviceKind, string][] = [["web_fallback", "Web fallback (browser)"], ["android_pilot", "Android pilot"], ["yocto_tablet", "Field tablet"]];
/** A datetime-local value in this machine's wall clock. */
const localInput = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** S5 signs a technician in with a device ID plus their own login, only while a grant on that device covers now. */
const shiftForm = async (u: UserRecord): Promise<void> => {
  const db = state.db;
  let devices;
  try { devices = (await api.listDevices(db)).filter((d) => d.active); } catch (e) { if (!stale(db)) banner(message(e)); return; }
  if (stale(db)) return;
  const device = select("deviceId", [...devices.map((d): [string, string] => [d.id, d.hardwareId]), [NEW_DEVICE, "New device…"]]);
  if (devices.length === 0) device.value = NEW_DEVICE;
  const fresh = branch(
    field("Device ID", input("hardwareId", { autocomplete: "off" })),
    field("Kind", select("kind", DEVICE_KINDS)),
  );
  (fresh.querySelector("select[name=kind]") as HTMLSelectElement).value = "web_fallback";
  const sync = (): void => showBranch(fresh, device.value === NEW_DEVICE);
  device.addEventListener("change", sync);
  sync();
  const now = new Date();
  openForm(`Grant shift — ${u.email}`, [
    field("Device", device), fresh,
    field("Shift starts", input("windowStart", { type: "datetime-local", value: localInput(now) })),
    field("Shift ends", input("windowEnd", { type: "datetime-local", value: localInput(new Date(now.getTime() + 12 * 3_600_000)) })),
    h("p", { class: "hint" }, "They sign in to the technician app with the device ID, their email and password, only inside this window."),
  ], async (f) => {
    await api.grantShift(db, {
      userId: u.id,
      device: str(f, "deviceId") === NEW_DEVICE ? { hardwareId: str(f, "hardwareId"), kind: str(f, "kind") as DeviceKind } : { id: str(f, "deviceId") },
      windowStart: new Date(str(f, "windowStart")).toISOString(), windowEnd: new Date(str(f, "windowEnd")).toISOString(),
    });
  });
};

const editForm = async (u: UserRecord): Promise<void> => {
  const db = state.db;
  const body: HTMLElement[] = [
    field("Email", h("input", { value: u.email, readonly: true, class: "readonly" })),
    field("Name", input("displayName", { value: u.displayName })),
  ];
  let build: (f: FormData) => LoginEdit = (f) => ({ displayName: str(f, "displayName") });
  try {
    if (u.namespace === "internal" && u.crewId !== null) {
      body.push(roleBoxes(u.roles), field("Employer", h("input", { value: employer(u.crewEmployment, u.crewFirmName), readonly: true, class: "readonly" })));
      if (!u.ownUnit) {
        body.push(h("label", { class: "check" }, h("input", { type: "checkbox", name: "ownUnit", value: "yes" }),
          `Move to their own service unit (now on ${u.crewKind === "install" ? "install crew" : "shared unit"} ${u.crewLabel ?? ""})`));
      }
      build = (f) => ({ displayName: str(f, "displayName"), roles: f.getAll("roles") as Role[], ...(f.has("ownUnit") ? { ownUnit: true as const } : {}) });
    } else if (u.namespace === "internal") {
      const regions = await api.listRegions(db);
      const region = select("regionId", regions.map((r) => [r.id, `${r.code} — ${r.name}`]));
      keepOption(region, u.regionId, u.regionCode);
      const was = u.scopeTier === "parent" ? "org" : "region";
      body.push(roleBoxes(u.roles), scopeRadios(was), field("Region", region));
      build = (f) => {
        const regionId = str(f, "regionId");
        const roles = f.getAll("roles") as Role[];
        if (str(f, "scope") === was && regionId === u.regionId) return { displayName: str(f, "displayName"), roles };
        const scope = str(f, "scope") === "org"
          ? { tier: "parent" as const, scopeId: u.orgId, regionId }
          : { tier: "region" as const, scopeId: regionId, regionId };
        return { displayName: str(f, "displayName"), roles, scope };
      };
    } else if (u.namespace === "customer") {
      const nodes = await api.listAccountTree(db, u.orgId);
      const scope = h("div", { class: "group" });
      customerScope(scope, () => nodes);
      const sees = scope.querySelector<HTMLSelectElement>("select[name=node]")!;
      const wasNode = u.scopeTier === "parent" ? WHOLE : u.scopeId;
      keepOption(sees, wasNode, u.scopeName ?? u.scopeId);
      sees.dispatchEvent(new Event("change"));
      if (u.scopeTier === "parent") keepOption(scope.querySelector<HTMLSelectElement>("select[name=wholeRegion]")!, u.regionId, u.regionCode);
      body.push(field("Customer", h("input", { value: u.orgName, readonly: true, class: "readonly" })), scope, householdBoxes(u.roles));
      build = (f) => {
        const roles = f.getAll("householdRoles") as CustomerRole[];
        if (roles.length === 0) throw new Error("A customer login pays the balance, requests service, or both — tick at least one.");
        if (str(f, "node") === wasNode && (wasNode !== WHOLE || str(f, "wholeRegion") === u.regionId)) return { displayName: str(f, "displayName"), roles };
        const p = customerPlacement(f, nodes, u.orgId);
        return { displayName: str(f, "displayName"), roles, scope: { tier: p.tier, scopeId: p.nodeId, regionId: p.regionId } };
      };
    }
  } catch (e) { if (!stale(db)) banner(message(e)); return; }
  if (stale(db)) return;
  openForm(`Edit ${u.email}`, body, async (f) => (await api.editLogin(db, u.id, build(f))).revokedSessions);
};

// ── Connections + database switch ─────────────────────────────────────────
const connectionForm = (then?: DbName): void => {
  // Never the stored string: the default is prefilled; a custom one is only described.
  const local = h("input", {
    name: "local", autocomplete: "off", spellcheck: "false",
    value: state.localIsDefault ? LOCAL_DEFAULT : undefined,
    placeholder: state.localIsDefault ? undefined : "Custom connection saved — leave blank to keep it",
  });
  const production = h("input", {
    name: "production", autocomplete: "off", spellcheck: "false", type: "password",
    placeholder: state.production ? "Configured — enter a new string to replace it" : "postgres://…",
    required: then === "production" && !state.production,
  });
  openForm("Connections", [
    h("p", { class: "hint" }, "Stored in ~/.config/ac-logins/connections.json (0600). Saved strings are never shown again."),
    field("Production", production),
    field("Local", local),
  ], async (f) => {
    const prod = str(f, "production").trim();
    const loc = str(f, "local").trim();
    if (prod) { await api.setConnection("production", prod); state.production = true; }
    if (loc) { await api.setConnection("local", loc); state.localIsDefault = loc === LOCAL_DEFAULT; }
    if (then) await switchTo(then);
    else if ((prod && state.db === "production") || (loc && state.db === "local")) await switchTo(state.db);
  });
};

const switchTo = async (db: DbName): Promise<void> => {
  closeForm();
  if (db === "production" && !state.production) { connectionForm("production"); return; }
  state.db = db;
  state.users = [];
  clearBanner();
  render();
  try {
    await api.select(db);
  } catch (e) {
    if (!stale(db)) banner(message(e));
    return;
  }
  if (stale(db)) return;
  await reload();
};

// ── Wiring ────────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>("[data-db]").forEach((b) => b.addEventListener("click", () => void switchTo(b.dataset.db as DbName)));
$("settings").addEventListener("click", () => connectionForm());
$("add").addEventListener("click", () => void addForm());
$<HTMLInputElement>("inactive").addEventListener("change", (e) => { state.showInactive = (e.target as HTMLInputElement).checked; void reload(); });

const start = async (): Promise<void> => {
  const c = await api.connections();
  state.production = c.production;
  state.localIsDefault = c.localIsDefault;
  state.db = c.selected;
  render();
  await reload();
  if (c.error) banner(c.error);
  document.body.dataset.ready = "1";
};
void start();
