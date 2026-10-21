import { KINDS, kindsOf } from "../kinds.ts";
import type { Kind, KindId, UserRecord } from "../kinds.ts";
import { ROLES } from "../../../../packages/contracts/src/scope.ts";
import type { Role } from "../../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../../packages/contracts/src/tiers.ts";
import type { Api } from "../preload.ts";
import type { DbName } from "../connections.ts";
import type { NewLogin } from "../rows.ts";
import type { AccountNode, LoginEdit } from "../db.ts";

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
  kind: "S2" as KindId,
  showInactive: false,
  users: [] as readonly UserRecord[],
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
  $("kinds").replaceChildren(...KINDS.map((k) => h("li", {},
    h("button", { type: "button", "aria-current": k.id === state.kind ? "true" : undefined, onclick: () => { state.kind = k.id; render(); } },
      h("span", { class: "name" }, k.name),
      h("span", { class: "count" }, String(active.filter((u) => inKind(u, k.id)).length))))));
};

const roles = (u: UserRecord): string => u.roles.join(", ") || "—";
const COLUMNS: Record<KindId, readonly [string, (u: UserRecord) => string][]> = {
  S2: [["Roles", roles], ["Scope", (u) => (u.scopeTier === "parent" ? "org-wide" : u.regionCode)]],
  S3: [["Roles", roles], ["Scope", (u) => (u.scopeTier === "parent" ? "org-wide" : u.regionCode)]],
  S4: [["Roles", roles], ["Scope", (u) => (u.scopeTier === "parent" ? "org-wide" : u.regionCode)]],
  S5: [["Crew", (u) => u.crewLabel ?? "—"], ["Employment", (u) => u.crewEmployment ?? "—"]],
  S6: [["Customer", (u) => u.orgName], ["Sees", (u) => (u.scopeTier === "parent" ? "Whole company" : u.scopeName ?? "—")]],
  S8: [["Firm", (u) => u.firmName ?? "—"]],
  S7: [],
  other: [["Namespace", (u) => u.namespace], ["Roles", roles]],
};

const renderTable = (): void => {
  const kind = kindOf(state.kind);
  $("title").textContent = `${kind.name} logins`;
  $("add").hidden = !kind.canAdd;
  const note = $("note");
  note.hidden = !kind.note;
  note.textContent = kind.note ?? "";
  const cols = COLUMNS[kind.id];
  $("thead").replaceChildren(...["Email", "Name", ...cols.map(([t]) => t), ""].map((t) => h("th", { scope: "col" }, t)));
  const rows = state.users.filter((u) => inKind(u, kind.id) && (state.showInactive || u.active));
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
    const users = await api.listUsers(db, state.showInactive);
    if (stale(db)) return;
    state.users = users;
  } catch (e) {
    if (stale(db)) return;
    state.users = [];
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

/** Opens the modal. `submit` returns the revoked-session count, if the call reports one. */
const openForm = (title: string, body: HTMLElement[], submit: (f: FormData) => Promise<number | void>): void => {
  const form = $<HTMLFormElement>("form");
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  form.replaceChildren(
    h("h3", {}, title),
    ...body,
    error,
    h("div", { class: "buttons" },
      h("button", { type: "button", onclick: closeForm }, "Cancel"),
      h("button", { type: "submit", class: "primary" }, "Save")),
  );
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    if (data.has("password") && data.get("password") !== data.get("password2")) {
      error.textContent = "The two passwords differ.";
      error.hidden = false;
      return;
    }
    try {
      const revoked = await submit(data);
      closeForm();
      clearBanner();
      if (typeof revoked === "number") signedOut(revoked);
      await reload();
    } catch (e) {
      error.textContent = message(e);
      error.hidden = false;
    }
  };
  dialog().showModal();
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
  ...ROLES.map((r) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "roles", value: r, checked: checked.includes(r) }), r)));

const scopeRadios = (current: "org" | "region"): HTMLElement => h("fieldset", { class: "scope" }, h("legend", {}, "Scope"),
  ...(["org", "region"] as const).map((v) => h("label", { class: "check" },
    h("input", { type: "radio", name: "scope", value: v, checked: v === current, required: true }), v === "org" ? "org-wide" : "one region")));

const addForm = async (): Promise<void> => {
  const kind = kindOf(state.kind);
  const db = state.db;
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
        const crews = await api.listCrews(db);
        if (stale(db)) return;
        openForm("Add Technician login", [...head, field("Crew (employed)", select("crewId", crews.map((c) => [c.id, c.label]))), ...passwordFields()],
          async (f) => {
            const crew = crews.find((c) => c.id === str(f, "crewId"))!;
            await api.addLogin(db, { ...base(f), kind: "technician", crewId: crew.id, crewHomeRegionId: crew.homeRegionId });
          });
        return;
      }
      case "S6": {
        const orgs = await api.listCustomerOrgs(db);
        if (stale(db)) return;
        let nodes: readonly AccountNode[] = [];
        const scope = h("div", { class: "group" });
        const org = select("orgId", orgs.map((o) => [o.id, o.name]));
        const loadTree = async (): Promise<void> => {
          const tree = org.value ? await api.listAccountTree(db, org.value) : [];
          if (stale(db)) return;
          nodes = tree;
          if (org.value) customerScope(scope, () => nodes); else scope.replaceChildren();
        };
        org.addEventListener("change", () => { void loadTree().catch((e) => { if (!stale(db)) banner(message(e)); }); });
        await loadTree();
        if (stale(db)) return;
        openForm("Add Customer Portal login", [...head, field("Customer", org), scope, ...passwordFields()], async (f) => {
          const orgId = str(f, "orgId");
          await api.addLogin(db, { ...base(f), kind: "customer", orgId, ...customerPlacement(f, nodes, orgId) });
        });
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

const editForm = async (u: UserRecord): Promise<void> => {
  const db = state.db;
  const body: HTMLElement[] = [
    field("Email", h("input", { value: u.email, readonly: true, class: "readonly" })),
    field("Name", input("displayName", { value: u.displayName })),
  ];
  let build: (f: FormData) => LoginEdit = (f) => ({ displayName: str(f, "displayName") });
  try {
    if (u.namespace === "internal" && u.crewId !== null) {
      const crews = await api.listCrews(db);
      const options: [string, string][] = crews.map((c) => [c.id, c.label]);
      if (!crews.some((c) => c.id === u.crewId)) options.unshift([u.crewId, u.crewLabel ?? u.crewId]);
      const crew = select("crewId", options);
      crew.value = u.crewId;
      body.push(roleBoxes(u.roles), field("Crew", crew));
      build = (f) => {
        const id = str(f, "crewId");
        const c = crews.find((x) => x.id === id);
        return { displayName: str(f, "displayName"), roles: f.getAll("roles") as Role[], ...(id !== u.crewId && c ? { crew: { id: c.id, homeRegionId: c.homeRegionId } } : {}) };
      };
    } else if (u.namespace === "internal") {
      const regions = await api.listRegions(db);
      const region = select("regionId", regions.map((r) => [r.id, `${r.code} — ${r.name}`]));
      region.value = u.regionId;
      body.push(roleBoxes(u.roles), scopeRadios(u.scopeTier === "parent" ? "org" : "region"), field("Region", region));
      build = (f) => {
        const regionId = str(f, "regionId");
        const scope = str(f, "scope") === "org"
          ? { tier: "parent" as const, scopeId: u.orgId, regionId }
          : { tier: "region" as const, scopeId: regionId, regionId };
        return { displayName: str(f, "displayName"), roles: f.getAll("roles") as Role[], scope };
      };
    } else if (u.namespace === "customer") {
      const nodes = await api.listAccountTree(db, u.orgId);
      const scope = h("div", { class: "group" });
      customerScope(scope, () => nodes);
      const sees = scope.querySelector<HTMLSelectElement>("select[name=node]")!;
      sees.value = u.scopeTier === "parent" ? WHOLE : u.scopeId;
      sees.dispatchEvent(new Event("change"));
      if (u.scopeTier === "parent") scope.querySelector<HTMLSelectElement>("select[name=wholeRegion]")!.value = u.regionId;
      body.push(field("Customer", h("input", { value: u.orgName, readonly: true, class: "readonly" })), scope);
      build = (f) => {
        const p = customerPlacement(f, nodes, u.orgId);
        return { displayName: str(f, "displayName"), scope: { tier: p.tier, scopeId: p.nodeId, regionId: p.regionId } };
      };
    }
  } catch (e) { if (!stale(db)) banner(message(e)); return; }
  if (stale(db)) return;
  openForm(`Edit ${u.email}`, body, async (f) => (await api.editLogin(db, u.id, build(f))).revokedSessions);
};

// ── Connections + database switch ─────────────────────────────────────────
const connectionForm = (then?: DbName): void => {
  const local = input("local", { value: LOCAL_DEFAULT, autocomplete: "off", spellcheck: "false" });
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
    if (loc && loc !== LOCAL_DEFAULT) await api.setConnection("local", loc);
    if (then) await switchTo(then);
    else if ((prod && state.db === "production") || (loc !== LOCAL_DEFAULT && state.db === "local")) await switchTo(state.db);
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
  render();
  await reload();
  if (c.error) banner(c.error);
  document.body.dataset.ready = "1";
};
void start();
