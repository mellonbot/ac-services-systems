import { html, pageHead, mount, spinFavicon, signal, createRouter, browserHistory, driveDegraded, PrimaryAction, RefusalCard, type VNode, AccountMenu, createAccountMenu, type AccountMenuState, Messenger, createMessenger, type MessengerState, sessionTools, surfaceSwitch, bindCookieSession } from "../../../packages/ui/src/index.ts";
import { gatewayOrigin, type ConnectedShell } from "../../../packages/shell/src/index.ts";
export { gatewayOrigin };
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
import { billing, billingInvoice, refreshBilling } from "./screens/billing.ts";
import { devices, devicesNew, devicesGrant } from "./screens/devices.ts";
import { regionsList, regionNew, regionPage } from "./screens/regions.ts";
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
  "billing": billing,
  "billing.invoice": billingInvoice,
  "devices": devices,
  "regions": regionsList,
  "regions.new": regionNew,
  "regions.region": regionPage,
  "devices.new": devicesNew,
  "devices.grant": devicesGrant,
};

/**
 * The global bar. Only Customers is scoped to a customer (its three screens take an
 * `orgId`, so its tabs carry the open customer); Invoicing and Follow-ups are lists
 * across every customer, which is why they sit in the bar and not under a customer.
 * Field devices sit with the network because they are the technicians' phones and tablets.
 */
const NAV_GROUPS = [
  { label: "Customers", home: "accounts.tree", screens: ["accounts.tree", "contracts.list", "projects"] as const },
  { label: "Invoicing", screens: ["billing"] as const },
  { label: "Follow-ups", screens: ["leads"] as const },
  { label: "Technician Network", screens: ["network", "devices"] as const },
  { label: "Purchasing", screens: ["purchasing"] as const },
  // 0038: shown to principals only — the gateway refuses regions.* to everyone else.
  { label: "Regions", screens: ["regions"] as const },
] as const;
/** A group with more than one screen gets a second row of tabs. */
const hasSubTabs = (g: (typeof NAV_GROUPS)[number]) => g.screens.length > 1;

/** A terminated firm will field no more crews for us, so the picker does not offer it; it stays in the screen's firm list. */
export const pickableFirms = (firms: readonly FirmWire[]): readonly FirmWire[] => firms.filter((f) => f.status !== "terminated");

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

/** The tab a screen belongs under: its own id, or the `nav` it names in the registry. */
const navTargetFor = (id: Exclude<ScreenId, "login">): Exclude<ScreenId, "login"> => {
  const spec = SCREENS[id];
  return ("nav" in spec ? spec.nav : id) as Exclude<ScreenId, "login">;
};

const screenTitle = (id: Exclude<ScreenId, "login">): string => {
  const spec = SCREENS[id];
  return "title" in spec ? spec.title : id;
};

const navGroupFor = (screen: Exclude<ScreenId, "login">): (typeof NAV_GROUPS)[number] | undefined => {
  const target = navTargetFor(screen);
  return NAV_GROUPS.find((group) => (group.screens as readonly string[]).includes(target));
};

/** The customer an `orgId` names and the account node open inside it, once their lists have been read. */
const openCustomer = (params: Readonly<Record<string, string>>, store: Store): { readonly name: string; readonly node: string | null } | null => {
  if (!params.orgId) return null;
  const orgs = store.peek<{ readonly organizations: readonly OrganizationWire[] }>(keyOf("organizations.list", { kind: "customer" }));
  const org = orgs?.state === "ready" ? orgs.value.organizations.find((item) => item.id === params.orgId) : undefined;
  if (!org) return null;
  const nodeId = params.nodeId ?? params.id;
  const nodes = nodeId ? store.peek<{ readonly nodes: readonly AccountWire[] }>(keyOf("accounts.list", { orgId: params.orgId })) : undefined;
  const node = nodes?.state === "ready" ? nodes.value.nodes.find((item) => item.id === nodeId) : undefined;
  return { name: org.name, node: node?.name ?? null };
};

/** The record open in a screen that is not a customer's: a firm, crew, vendor or purchase order. */
const activeEntity = (params: Readonly<Record<string, string>>, store: Store): string | null => {
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

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store; account: AccountMenuState; messages: MessengerState };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S2) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const become = (shell: ConnectedShell) => {
    const store = createStore(shell, now);
    phase.value = { kind: "ready", shell, store, account: createAccountMenu(shell.gateway, shell.refusalOf), messages: createMessenger(shell.gateway, shell.refusalOf) };
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
    // 0030: a payment recorded or returned, an invoice paid or voided — here or by another office user.
    shell.subscribe(() => refreshBilling(store), { topics: ["payment.recorded", "payment.returned", "invoice.paid", "invoice.voided", "invoice.issued"] });
    // 0038: a region opened, renamed or closed — every form that picks one reads it fresh. A shift extended or revoked refetches the grants.
    shell.subscribe(() => store.invalidate("regions.list"), { topics: ["region.created", "region.updated"] });
    shell.subscribe(() => store.invalidate("devices.listGrants"), { topics: ["device.shift_extended", "device.shift_revoked"] });
  };

  const session = bindCookieSession({
    degraded,
    now,
    isReady: () => (phase.value.kind === "ready" ? phase.value : null),
    setLogin: (busy, refusal) => { phase.value = { kind: "login", refusal, busy }; },
    setReady: become,
    connect: (credentials) => connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials }),
    onLogout: (ready) => { ready.messages.stop(); },
    afterLogout: () => { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("accounts.tree", {}); },
  });

  const { login, logout } = session;

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
    // A customer is the header's business; a firm, crew, vendor or purchase order is the trail's.
    const inCustomers = group?.label === "Customers";
    const customer = loc && inCustomers ? openCustomer(loc.params, p.store) : null;
    const entity = loc && !inCustomers ? activeEntity(loc.params, p.store) : null;
    const firms = p.store.read(keyOf("firms.list"), () => p.shell.gateway.listFirms({})).value;
    const tab = (id: Exclude<ScreenId, "login">, params: Readonly<Record<string, string>>, title: string, current: boolean): VNode =>
      html`<a class="ac-seg__item" data-current=${current ? "true" : "false"} aria-current=${current ? "page" : undefined} href=${router.href(id, params)} onClick=${(e: Event) => { e.preventDefault(); router.navigate(id, params); }}>${title}</a>`;
    const tabsFor = (navGroup: (typeof NAV_GROUPS)[number]): VNode[] => {
      const open = routeId !== undefined && group?.label === navGroup.label;
      if (navGroup.label === "Technician Network") {
        // Our own crews are a tab; the subcontractor firms are one picker, so the
        // track holds its width however many firms the network grows to; the
        // technicians' field devices are the last tab.
        const onCrews = open && navTargetFor(routeId!) === "network";
        const at = onCrews && loc ? networkFirmOf(loc.params, p.store) : undefined;
        const firmList = firms.state === "ready" ? pickableFirms(firms.value.firms) : [];
        const picked = firmList.find((f) => f.id === at);
        const pick = (e: Event) => { const firmId = (e.currentTarget as HTMLSelectElement).value; if (firmId) router.navigate("network", { firmId }); };
        return [
          tab("network", {}, OWN_CREWS_LABEL, onCrews && at === null && routeId !== "network.firm.new"),
          ...(firmList.length ? [html`<span class="ac-seg__pick" data-current=${picked ? "true" : "false"}>
            <select aria-label="Subcontractor firm" onChange=${pick}>
              <option value="" disabled selected=${!picked}>Subcontractor firms (${firmList.length})</option>
              ${firmList.map((f) => html`<option value=${f.id} selected=${f.id === picked?.id}>${f.legalName}</option>`)}
            </select>
          </span>`] : []),
          tab("devices", {}, screenTitle("devices"), open && navTargetFor(routeId!) === "devices"),
        ];
      }
      // A customer's tabs carry the open customer, so a tab changes the screen and never the customer.
      const carry = open && loc?.params.orgId ? { orgId: loc.params.orgId } : {};
      return navGroup.screens.map((id) => tab(id, carry, screenTitle(id), open && navTargetFor(routeId!) === id));
    };
    // The trail says only what the bar, the customer header and the tabs do not: the tab a
    // sub-screen sits under, and the record open in it. With neither, there is no trail.
    const target = routeId ? navTargetFor(routeId) : undefined;
    const targetTitle = target ? screenTitle(target) : undefined;
    const parentTab = routeId && target && routeId !== target && targetTitle !== group?.label ? targetTitle : null;
    const record = customer?.node ?? entity;
    const crumbs = [...(parentTab ? [{ text: parentTab, current: false }] : []), ...(record ? [{ text: record, current: true }] : [])];
    return html`<div class="s2-app">
      <nav class="s2-global" aria-label="Workspace">
        <div class="ac-seg">
          ${NAV_GROUPS.filter((navGroup) => navGroup.label !== "Regions" || p.shell.principal.roles.includes("principal")).map((navGroup) => {
            const current = group?.label === navGroup.label;
            const home = "home" in navGroup ? navGroup.home : navGroup.screens[0];
            // Customers keeps the customer that is open; the other groups hold none.
            const params = current && inCustomers && loc?.params.orgId ? { orgId: loc.params.orgId } : {};
            // A one-screen group's item IS the page; otherwise the tab row below carries it.
            const page = current && !hasSubTabs(navGroup) && routeId === home;
            return html`<a class="ac-seg__item" data-current=${current ? "true" : "false"} aria-current=${page ? "page" : current ? "true" : undefined}
              href=${router.href(home, params)} onClick=${(e: Event) => { e.preventDefault(); router.navigate(home, params); }}>${navGroup.label}</a>`;
          })}
        </div>
        <div class="s2-global__tools">
          ${Messenger({ density: DENSITY, menu: p.messages })}${sessionTools(AccountMenu({ density: DENSITY, menu: p.account }), logout, surfaceSwitch("S2", p.shell.principal))}
        </div>
      </nav>
      ${customer && target ? html`<section class="s2-custbar" aria-label="Customer">
        <p class="s2-custbar__name">${customer.name}</p>
        <a class="s2-custbar__all" href=${router.href(target, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(target, {}); }}>All customers</a>
      </section>` : null}
      ${group && hasSubTabs(group) ? html`<div class="s2-tabs" role="group" aria-label=${group.label}>
        <div class="ac-seg">${tabsFor(group)}</div>
      </div>` : null}
      ${notice.length ? html`<div class="s2-notice" role="status">${notice.map((n) => html`<p>${n}</p>`)}<button type="button" class="s2-notice__dismiss" onClick=${() => { p.store.notice.value = []; }} aria-label="Dismiss">×</button></div>` : null}
      ${group && crumbs.length ? html`<nav class="s2-trail" aria-label="Current location"><ol>
        ${customer ? null : html`<li>${group.label}</li>`}
        ${crumbs.map((c) => html`<li aria-current=${c.current ? "location" : undefined}>${c.text}</li>`)}
      </ol></nav>` : null}
      ${screen ? screen(ctx, loc!.params) : html`<p class="s2-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
    </div>`;
  };

  return { phase, degraded, router, view, boot: session.boot, login: session.login, logout: session.logout, tick: session.tick, probe: session.probe };
};

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
  // A refusal is announced (role="alert"), but under a long form it can land below the fold and the
  // click looks like it did nothing — bring a newly shown one into view.
  new MutationObserver((records) => {
    for (const r of records) for (const n of Array.from(r.addedNodes)) {
      const card = n instanceof HTMLElement ? (n.matches(".ac-refusal") ? n : n.querySelector(".ac-refusal")) : null;
      if (card) { card.scrollIntoView({ block: "nearest" }); return; }
    }
  }).observe(el, { childList: true, subtree: true });
  spinFavicon(document);
  const degradedTick = slot ? driveDegraded(slot, () => {
    const p = app.phase.value;
    return { degraded: app.degraded.value, text: SURFACE.degradedNotice, lastOkAt: p.kind === "ready" ? p.store.lastOkAt.value : null };
  }, Date.now) : () => {};
  app.router.start();
  setInterval(() => { app.tick(); app.probe(); degradedTick(); }, 1000);
  void app.boot();
}
