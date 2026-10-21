import { html, pageHead, mount, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, RefusalNotice, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, SURFACE_PATHS, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect, brand } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { sites } from "./screens/sites.ts";
import { work } from "./screens/work.ts";
import { agreements } from "./screens/agreements.ts";
import { terms } from "./screens/terms.ts";
import { request } from "./screens/request.ts";
import { site } from "./screens/site.ts";
import { S6_CSS } from "./styles.ts";

/**
 * S6 — THE BROWSER ENTRY (item 6). Same boot shape as S2 and S3: resume the
 * cookie session with `session.me`; on a gone token, show login; login posts
 * through the shell in cookie mode. Then the router from SCREENS, the
 * degraded slot driven by `shell.isDegraded()`, and the event subscription.
 *
 * Two things are S6's alone. FIRST, the brand: `brand()` runs before anything
 * else — a portal branded only after a successful password looks like someone
 * else's until you are inside it — and cannot fail in a way that matters (no
 * theme, no answer, unknown host all leave Rankine's plate). SECOND, the
 * scope: nothing in this file, and nothing in any screen, filters by org,
 * region or node. What the customer sees is what the gateway returned, and
 * the gateway returned what 0006's policies admitted for this principal. A
 * facility manager and an executive run this same bundle; the difference
 * between their portals is entirely in the rows.
 */
export const DENSITY = densityOf("S6");

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  sites, work, agreements, terms, request, site,
};

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S6) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const become = (shell: ConnectedShell) => {
    const store = createStore(shell, now);
    phase.value = { kind: "ready", shell, store };
    const at = router.current.value;
    if (!at || at.screen === "login") router.navigate("work", {});
    // Envelopes carry no payload; refetch what the event touched (09 §3.5).
    // The region feed is filtered to the principal's region at the gateway;
    // a customer's own events are the ones about its jobs and its agreements.
    shell.subscribe(() => {
      store.invalidate("jobs.list");
      store.invalidate("serviceRequests.list");
      store.invalidate("terms.resolved");
      store.invalidate("contracts.list");
      // item 9: the site card's own facts.
      store.invalidate("equipment.list");
      store.invalidate("contacts.list");
      store.invalidate("invoices.list");
    }, { topics: [
      "job.created", "job.assigned", "job.reassigned", "job.transitioned", "job.completed", "job.cancelled",
      "sla.timer_opened", "sla.escalated", "sla.breached", "sla.satisfied",
      "service_request.created", "contract.created", "contract.amended", "contract.term_overridden", "contract.expired",
      "account.created", "account.updated", "account.deactivated",
      "equipment.registered", "account_contact.set", "invoice.issued",
    ] });
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
      phase.value = { kind: "login", refusal: r.kind === "token" ? null : r, busy: false };
    }
  };

  const logout = async () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("work", {}); }
  };

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

  const nav = (screen: Exclude<ScreenId, "login" | "terms" | "request" | "site">, label: string): VNode =>
    html`<a class="ac-seg__item" data-current=${router.current.value?.screen === screen ? "true" : "false"} href=${router.href(screen, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(screen, {}); }}>${label}</a>`;

  const view = (): VNode => {
    const p = phase.value;
    if (p.kind === "booting") return html`<p class="s6-loading" role="status">Connecting…</p>`;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, router, density: DENSITY, degraded: degraded.value };
    void p.store.version.value;
    const loc = router.current.value;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const who = p.shell.context?.path.map((n) => n.name).join(" › ") ?? p.shell.context?.parent.name ?? "";
    return html`<div class="s6-app">
      <nav class="ac-nav" aria-label="Screens">
        ${nav("work", "Work orders")}
        ${nav("sites", "Sites")}
        ${nav("agreements", "Agreements")}
        <span class="ac-nav__who" id="who">${who}</span>
        ${PrimaryAction({ density: DENSITY, label: "Request service", id: "nav-request", onClick: () => router.navigate("request", {}) })}
        <button type="button" class="ac-nav__signout" onClick=${logout}>Sign out</button>
      </nav>
      ${screen ? screen(ctx, loc!.params) : html`<p class="s6-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
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
  return html`<section class="s6-login">
    ${pageHead(SURFACE.name, "Sign in to see your sites, your work and your agreements.")}
    <form class="ac-form" onSubmit=${submit} id="login-form">
      <label class="ac-field"><span>Email</span><input class="ac-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="ac-field"><span>Password</span><input class="ac-input" name="password" type="password" required autocomplete="current-password" /></label>
      ${PrimaryAction({ density: DENSITY, label: p.busy ? "Signing in…" : "Sign in", type: "submit", id: "sign-in" })}
    </form>
    ${p.refusal ? RefusalNotice({ density: DENSITY, refusal: p.refusal }) : null}
  </section>`;
};

// ---------------------------------------------------------------------------
// Browser entry. Guarded so the module is importable under node --test.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = S6_CSS;
  document.head.appendChild(style);

  const baseUrl = gatewayOrigin(document);
  const app = createApp({ baseUrl, fetch: globalThis.fetch.bind(globalThis), window });
  const el = document.getElementById("mount")!;
  const slot = document.querySelector("ac-degraded") as (HTMLElement | null);
  const Root = () => app.view();
  mount(html`<${Root} />`, el);
  effect(() => {
    if (!slot) return;
    const p = app.phase.value;
    const lastOkAt = p.kind === "ready" ? p.store.lastOkAt.value : null;
    applyDegraded(slot, { degraded: app.degraded.value, text: SURFACE.degraded, lastOkAt, now: Date.now() });
  });
  app.router.start();
  setInterval(() => { app.tick(); app.probe(); }, 1000);
  // The tenant's colours first, then the session — the sign-in screen is already theirs.
  void brand({ baseUrl, fetch: globalThis.fetch.bind(globalThis), host: location.hostname }, document.getElementById("ac-brand"))
    .then(() => app.boot(), () => app.boot());
}
