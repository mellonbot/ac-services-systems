import { html, pageHead, mount, spinFavicon, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, RefusalCard, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, SURFACE_PATHS, type AccountWire, type CrewWire, type FirmWire, type OrganizationWire, type PurchaseOrderDetailOutput, type Refusal, type TechnicianWire, type VendorWire } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, keyOf, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { accountsTree } from "./screens/accounts-tree.ts";
import { accountsNew } from "./screens/accounts-new.ts";
import { accountsMove } from "./screens/accounts-move.ts";
import { organizationsNew } from "./screens/organizations-new.ts";
import { leads } from "./screens/leads.ts";
import { contractsList } from "./screens/contracts-list.ts";
import { projects } from "./screens/projects.ts";
import { contractsNew } from "./screens/contracts-new.ts";
import { termsOverride } from "./screens/terms-override.ts";
import { termsResolved } from "./screens/terms-resolved.ts";
import { network, OWN_CREWS_LABEL } from "./screens/network.ts";
import { networkFirmNew, networkCrewNew } from "./screens/network-new.ts";
import { networkCrewDocuments } from "./screens/network-documents.ts";
import { networkRates } from "./screens/network-rates.ts";
import { networkTechnicianNew, networkTechnicianEdit } from "./screens/network-technicians.ts";
import { purchasing, purchasingVendor, purchasingPo, refreshProcurement } from "./screens/purchasing.ts";
import { S2_CSS } from "./styles.ts";

/**
 * S2 — THE BROWSER ENTRY. `build-surface.ts` bundles this file; the emitted
 * `main.ts` beside it is the registry boot (SURFACE, connect) and is generated.
 *
 * Boot (09 §3.2): resume the cookie session with `session.me`; if the gateway
 * says the token is gone, show login; the login posts through the shell in
 * cookie mode, so script never holds the token. Then: router from SCREENS,
 * degraded slot driven by `shell.isDegraded()`, account events → refetch.
 */
export const DENSITY = densityOf("S2");

/**
 * The gateway origin — the one URL the surface layer names (ConnectConfig.baseUrl).
 * Stamped into the frame at build (`<meta name="ac-gateway">`, from AC_GATEWAY);
 * absent, derived from the site: s2.<site> talks to api.<site>.
 */
export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  "accounts.tree": accountsTree,
  "accounts.new": accountsNew,
  "accounts.move": accountsMove,
  "organizations.new": organizationsNew,
  "leads": leads,
  "contracts.list": contractsList,
  "projects": projects,
  "contracts.new": contractsNew,
  "terms.override": termsOverride,
  "terms.resolved": termsResolved,
  "network": network,
  "network.firm.new": networkFirmNew,
  "network.crew.new": networkCrewNew,
  "network.crew.documents": networkCrewDocuments,
  "network.rates": networkRates,
  "network.technician.new": networkTechnicianNew,
  "network.technician.edit": networkTechnicianEdit,
  "purchasing": purchasing,
  "purchasing.vendor": purchasingVendor,
  "purchasing.po": purchasingPo,
};

const NAV_GROUPS = [
  { label: "Customer records", screens: ["accounts.tree", "contracts.list", "projects", "leads"] as const },
  { label: "Technician Network", screens: ["network"] as const },
  { label: "Purchasing", screens: ["purchasing"] as const },
] as const;

/** A terminated firm will field no more crews for us, so it gets no tab; it stays in the screen's firm list. */
export const firmTabs = (firms: readonly FirmWire[]): readonly FirmWire[] => firms.filter((f) => f.status !== "terminated");

/** The firm the open network screen belongs to; null is our own crews. A crew's documents follow the crew's firm. */
const networkFirmOf = (params: Readonly<Record<string, string>>, store: Store): string | null => {
  if (params.firmId) return params.firmId;
  if (params.technicianId) {
    const techs = store.peek<{ readonly technicians: readonly TechnicianWire[] }>(keyOf("technicians.list"));
    return techs?.state === "ready" ? techs.value.technicians.find((t) => t.id === params.technicianId)?.firmId ?? null : null;
  }
  if (params.crewId) {
    const crews = store.peek<{ readonly crews: readonly CrewWire[] }>(keyOf("crews.list"));
    return crews?.state === "ready" ? crews.value.crews.find((c) => c.id === params.crewId)?.firmId ?? null : null;
  }
  return null;
};

const ROUTE_LABELS: Readonly<Record<Exclude<ScreenId, "login">, string>> = {
  "accounts.tree": "Accounts",
  "accounts.new": "New account node",
  "accounts.move": "Move account node",
  "organizations.new": "New customer",
  "leads": "Leads",
  "contracts.list": "Agreements",
  "projects": "Projects",
  "contracts.new": "New agreement",
  "terms.override": "Term overrides",
  "terms.resolved": "Resolved terms",
  "network": "Technician Network",
  "network.firm.new": "New firm",
  "network.crew.new": "New crew",
  "network.crew.documents": "Crew documents",
  "network.rates": "Rate card",
  "network.technician.new": "New technician",
  "network.technician.edit": "Edit technician",
  "purchasing": "Purchasing",
  "purchasing.vendor": "Vendor catalogue",
  "purchasing.po": "Purchase order",
};

const navGroupFor = (screen: Exclude<ScreenId, "login">): (typeof NAV_GROUPS)[number] | undefined =>
  NAV_GROUPS.find((group) => (group.screens as readonly Exclude<ScreenId, "login">[]).some((id) =>
    id === screen ||
    (id === "accounts.tree" && screen === "organizations.new") ||
    (id === "contracts.list" && (screen.startsWith("contracts.") || screen.startsWith("terms."))) ||
    (id === "network" && screen.startsWith("network.")) ||
    (id === "purchasing" && screen.startsWith("purchasing."))));

const navTargetFor = (screen: Exclude<ScreenId, "login">): Exclude<ScreenId, "login"> => {
  if (screen === "organizations.new" || screen.startsWith("accounts.")) return "accounts.tree";
  if (screen.startsWith("contracts.") || screen.startsWith("terms.")) return "contracts.list";
  if (screen.startsWith("network.")) return "network";
  if (screen.startsWith("purchasing.")) return "purchasing";
  return screen;
};

const activeEntity = (params: Readonly<Record<string, string>>, store: Store): string | null => {
  if (params.orgId) {
    const orgs = store.peek<{ readonly organizations: readonly OrganizationWire[] }>(keyOf("organizations.list", { kind: "customer" }));
    const org = orgs?.state === "ready" ? orgs.value.organizations.find((item) => item.id === params.orgId) : undefined;
    if (org) {
      const nodeId = params.nodeId ?? params.id;
      if (nodeId) {
        const nodes = store.peek<{ readonly nodes: readonly AccountWire[] }>(keyOf("accounts.list", { orgId: params.orgId }));
        const node = nodes?.state === "ready" ? nodes.value.nodes.find((item) => item.id === nodeId) : undefined;
        if (node) return `${org.name} / ${node.name}`;
      }
      return org.name;
    }
  }
  if (params.firmId) {
    const firms = store.peek<{ readonly firms: readonly FirmWire[] }>(keyOf("firms.list"));
    const firm = firms?.state === "ready" ? firms.value.firms.find((item) => item.id === params.firmId) : undefined;
    if (firm) return firm.legalName;
  }
  if (params.crewId) {
    const crews = store.peek<{ readonly crews: readonly CrewWire[] }>(keyOf("crews.list"));
    const crew = crews?.state === "ready" ? crews.value.crews.find((item) => item.id === params.crewId) : undefined;
    if (crew) return crew.label;
  }
  if (params.vendorId) {
    const vendors = store.peek<{ readonly vendors: readonly VendorWire[] }>(keyOf("vendors.list"));
    const vendor = vendors?.state === "ready" ? vendors.value.vendors.find((item) => item.id === params.vendorId) : undefined;
    if (vendor) return vendor.legalName;
  }
  if (params.poId) {
    const order = store.peek<PurchaseOrderDetailOutput>(keyOf("pos.detail", { poId: params.poId }));
    if (order?.state === "ready") return order.value.order.number;
  }
  return null;
};

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S2) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const become = (shell: ConnectedShell) => {
    const store = createStore(shell, now);
    phase.value = { kind: "ready", shell, store };
    // "/" and "/login" are not screens once signed in; the tree is home.
    const at = router.current.value;
    if (!at || at.screen === "login") router.navigate("accounts.tree", {});
    // Envelopes carry no payload; refetch what the event touched (09 §3.5).
    shell.subscribe((e) => {
      store.invalidate(keyOf("accounts.list", { orgId: e.orgId }));
      store.invalidate("organizations.list");
      // C2: an agreement or an override changing is a refetch of the same
      // shape — the envelope carries no payload, so the only correct response
      // to any of these is to forget and re-read.
      store.invalidate(keyOf("contracts.list", { orgId: e.orgId }));
      store.invalidate("terms.overrides.list");
      store.invalidate("terms.resolved");
      // C4: a firm's own events arrive with the FIRM as the org — a firm is its
      // own tenant — so these are invalidated wholesale rather than by orgId.
      // Four prefixes, because a verification changes both the document list
      // and the crew summary that reads it.
      store.invalidate("firms.list");
      store.invalidate("crews.list");
      store.invalidate("credentials.list");
      store.invalidate("rateCards.list");
      store.invalidate("technicians.list");
    }, { topics: ["account.created", "account.updated", "account.deactivated", "contract.created", "contract.amended", "contract.expired", "contract.term_overridden",
                  "firm.created", "firm.updated", "firm.status_changed", "crew.created", "crew.updated",
                  "credential.recorded", "credential.verified", "credential.expiring", "credential.expired", "rate_card.changed",
                  "technician.recorded", "technician.updated"] });
    // Item 11: the vendor's side of an order lands here as a refetch — a proposed
    // price, an acknowledgement, a shipment, an invoice, an answer on a return.
    // S1's arc 1: a lead arrives, or someone here converts one.
    shell.subscribe(() => store.invalidate("leads.list"), { topics: ["lead.captured", "lead.converted"] });
    shell.subscribe(() => refreshProcurement(store), { topics: ["vendor_price.proposed", "vendor_price.withdrawn", "po.acknowledged", "po.shipped", "vendor_invoice.submitted", "rma.responded"] });
  };

  const login = async (email: string, password: string) => {
    phase.value = { kind: "login", refusal: null, busy: true };
    try { become(await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { email, password, session: "cookie" } })); }
    catch (e) { phase.value = { kind: "login", refusal: refusalOf(e), busy: false }; }
  };

  const boot = async () => {
    try { become(await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { session: "cookie" } })); }
    catch (e) {
      const r = refusalOf(e);
      // No session is the normal first visit; anything else is worth showing above the login form.
      phase.value = { kind: "login", refusal: r.kind === "token" ? null : r, busy: false };
    }
  };

  const logout = async () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("accounts.tree", {}); }
  };

  /** Poll the flag the transport writes; while degraded, probe health so recovery is noticed without a click (09 §3.9). */
  const tick = () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    degraded.value = p.shell.isDegraded();
  };
  let lastProbe = 0;
  const probe = () => {
    const p = phase.value;
    if (p.kind !== "ready" || !degraded.value) return;
    if (now() - lastProbe < 15_000) return;
    lastProbe = now();
    p.shell.gateway.health().catch(() => {});
  };

  const view = (): VNode => {
    const p = phase.value;
    if (p.kind === "booting") return html`<p class="s2-loading" role="status">Connecting…</p>`;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, router, density: DENSITY, degraded: degraded.value };
    void p.store.version.value; // subscribe: an invalidate re-renders the mounted screen, which re-reads its resources
    const loc = router.current.value;
    const routeId = loc && loc.screen !== "login" ? loc.screen : undefined;
    const screen = routeId ? SCREEN_VIEWS[routeId] : null;
    const notice = p.store.notice.value;
    const group = routeId ? navGroupFor(routeId) : undefined;
    const path = p.shell.context?.path.length
      ? p.shell.context.path
      : p.shell.context ? [p.shell.context.parent] : [];
    // The network screen with no firm open is our own crews; say so, as its tab does.
    const entity = loc ? activeEntity(loc.params, p.store) ?? (routeId === "network" ? OWN_CREWS_LABEL : null) : null;
    const firms = p.store.read(keyOf("firms.list"), () => p.shell.gateway.listFirms({})).value;
    const tab = (id: Exclude<ScreenId, "login">, params: Readonly<Record<string, string>>, title: string, current: boolean): VNode =>
      html`<a class="ac-seg__item" data-current=${current ? "true" : "false"} aria-current=${current ? "page" : undefined} href=${router.href(id, params)} onClick=${(e: Event) => { e.preventDefault(); router.navigate(id, params); }}>${title}</a>`;
    const tabsFor = (navGroup: (typeof NAV_GROUPS)[number]): VNode[] => {
      const open = routeId !== undefined && group?.label === navGroup.label;
      if (navGroup.label === "Technician Network") {
        const at = open && loc ? networkFirmOf(loc.params, p.store) : undefined;
        const firmList = firms.state === "ready" ? firmTabs(firms.value.firms) : [];
        return [
          tab("network", {}, OWN_CREWS_LABEL, open && at === null && routeId !== "network.firm.new"),
          ...firmList.map((f) => tab("network", { firmId: f.id }, f.legalName, at === f.id)),
        ];
      }
      return navGroup.screens.map((id) => {
        const spec = SCREENS[id];
        return tab(id, {}, "title" in spec ? spec.title : ROUTE_LABELS[id], open && navTargetFor(routeId!) === id);
      });
    };
    return html`<div class="s2-app">
      <nav class="ac-nav ac-nav--grouped" aria-label="Workspace">
        ${NAV_GROUPS.map((navGroup) => html`<div class="ac-nav__group" role="group" aria-label=${navGroup.label} data-current=${group?.label === navGroup.label ? "true" : "false"}>
          <span class="ac-nav__group-label">${navGroup.label}</span>
          <div class="ac-seg">${tabsFor(navGroup)}</div>
        </div>`)}
        <div class="ac-nav__end">
          <span class="ac-nav__who">${p.shell.principal.roles.join(", ")} · ${p.shell.context?.parent.name ?? ""}</span>
          <button type="button" class="ac-nav__signout" onClick=${logout}>Sign out</button>
        </div>
      </nav>
      <nav class="s2-context" aria-label="Current location">
        <div class="s2-context__scope">
          <span class="s2-context__label">Signed-in scope</span>
          <ol>${path.map((node) => html`<li><span>${node.name ?? node.tier}</span><small>${node.tier}</small></li>`)}</ol>
        </div>
        <div class="s2-context__current">
          <span class="s2-context__label">Current location</span>
          <ol>
            ${group ? html`<li>${group.label}</li>` : null}
            ${routeId === "network" ? null : html`<li>${routeId ? ROUTE_LABELS[routeId] : "Workspace"}</li>`}
            ${entity ? html`<li aria-current="location">${entity}</li>` : null}
          </ol>
        </div>
      </nav>
      ${notice.length ? html`<div class="s2-notice" role="status">${notice.map((n) => html`<p>${n}</p>`)}<button type="button" class="s2-notice__dismiss" onClick=${() => { p.store.notice.value = []; }} aria-label="Dismiss">×</button></div>` : null}
      ${screen ? screen(ctx, loc!.params) : html`<p class="s2-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
    </div>`;
  };

  return { phase, degraded, router, view, boot, login, logout, tick, probe };
};

const refusalOf = (e: unknown): Refusal =>
  (e as { refusal?: Refusal })?.refusal ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) };

export const loginView = (p: { refusal: Refusal | null; busy: boolean }, login: (email: string, password: string) => void): VNode => {
  const submit = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    login(String(f.get("email") ?? ""), String(f.get("password") ?? ""));
  };
  return html`<section class="s2-login">
    ${pageHead(SURFACE.name, "Sign in to keep customer records, the technician network and purchasing.")}
    <form class="ac-form" onSubmit=${submit} id="login-form">
      <label class="ac-field"><span>Email</span><input class="ac-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="ac-field"><span>Password</span><input class="ac-input" name="password" type="password" required autocomplete="current-password" /></label>
      ${PrimaryAction({ density: DENSITY, label: p.busy ? "Signing in…" : "Sign in", type: "submit", id: "sign-in" })}
    </form>
    ${p.refusal ? RefusalCard({ density: DENSITY, refusal: p.refusal }) : null}
  </section>`;
};

// ---------------------------------------------------------------------------
// Browser entry. Guarded so the module is importable under node --test.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = S2_CSS;
  document.head.appendChild(style);

  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window });
  const el = document.getElementById("mount")!;
  const slot = document.querySelector("ac-degraded") as (HTMLElement | null);
  // Root is the one Preact component; every signal a screen reads during its render re-renders Root.
  const Root = () => app.view();
  mount(html`<${Root} />`, el);
  spinFavicon(document);
  effect(() => {
    if (!slot) return;
    const p = app.phase.value;
    const lastOkAt = p.kind === "ready" ? p.store.lastOkAt.value : null;
    applyDegraded(slot, { degraded: app.degraded.value, text: SURFACE.degradedNotice, lastOkAt, now: Date.now() });
  });
  app.router.start();
  setInterval(() => { app.tick(); app.probe(); }, 1000);
  void app.boot();
}
