import { html, mount, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, refusalHeading, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { overview } from "./screens/overview.ts";
import { area } from "./screens/area.ts";
import { region } from "./screens/region.ts";
import { S4_CSS } from "./styles.ts";

/**
 * S4 — THE BROWSER ENTRY (item 10). Same boot shape as S2, S3, S6 and S8:
 * resume the cookie session with `session.me`; on a gone token, show login;
 * login posts through the shell in cookie mode. Then the router from SCREENS
 * and the degraded slot driven by `shell.isDegraded()`.
 *
 * What is S4's alone is what is NOT here. No event subscription: the
 * registry says `realtime: false`, and the figures only move when the
 * worker's rollup does, so the open page re-reads every REREAD_MS instead.
 * No write: the catalogue serves S4 two reads and a login, so there is no
 * method on the client for this bundle to misuse. No filter: the figures are
 * every region's, because the principal is org-wide and 0010 lets the
 * internal namespace read every row.
 */
export const DENSITY = densityOf("S4");

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = { overview, area, region };

/** How often the open dashboard re-reads the rollup. S4 is not realtime (the registry); the figures move when the worker's do. */
export const REREAD_MS = 60_000;

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const become = (shell: ConnectedShell) => {
    const store = createStore(shell, now);
    phase.value = { kind: "ready", shell, store };
    const at = router.current.value;
    if (!at || at.screen === "login") router.navigate("overview", {});
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
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("overview", {}); }
  };

  let lastRead = now();
  const tick = () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    degraded.value = p.shell.isDegraded();
    if (now() - lastRead >= REREAD_MS) { lastRead = now(); p.store.invalidate("hq."); }
  };
  let lastProbe = 0;
  const probe = () => {
    const p = phase.value;
    if (p.kind !== "ready" || !degraded.value) return;
    if (now() - lastProbe < 15_000) return;
    lastProbe = now();
    p.shell.gateway.health().catch(() => {});
  };

  const nav = (screen: "overview", label: string, current: boolean): VNode =>
    html`<a class="s4-nav__link" data-current=${current ? "true" : "false"} href=${router.href(screen, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(screen, {}); }}>${label}</a>`;

  const view = (): VNode => {
    const p = phase.value;
    if (p.kind === "booting") return html`<p class="s4-loading" role="status">Connecting…</p>`;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, router, density: DENSITY, degraded: degraded.value, now };
    void p.store.version.value;
    const loc = router.current.value;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const who = p.shell.principal.roles.join(", ");
    return html`<div class="s4-app">
      <nav class="s4-nav" aria-label="Screens">
        ${nav("overview", "Company", loc?.screen === "overview")}
        <span class="s4-nav__who" id="who">${who} · ${p.shell.context?.parent.name ?? ""} · read only</span>
        <button type="button" class="s4-nav__logout" onClick=${logout}>Sign out</button>
      </nav>
      ${screen ? screen(ctx, loc!.params) : html`<p class="s4-empty">Nothing at this address.</p>`}
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
  return html`<section class="s4-login">
    <h1 class="s4-h1">${SURFACE.name}</h1>
    <form class="s4-form" onSubmit=${submit} id="login-form">
      <label class="s4-field"><span>Email</span><input class="s4-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="s4-field"><span>Password</span><input class="s4-input" name="password" type="password" required autocomplete="current-password" /></label>
      ${PrimaryAction({ density: DENSITY, label: p.busy ? "Signing in…" : "Sign in", type: "submit", id: "sign-in" })}
    </form>
    ${p.refusal ? html`<section class="s4-refusal" role="alert" data-kind=${p.refusal.kind}><h2 class="s4-refusal__heading">${refusalHeading(p.refusal)}</h2><p class="s4-refusal__message">${p.refusal.message}</p></section>` : null}
  </section>`;
};

// ---------------------------------------------------------------------------
// Browser entry. Guarded so the module is importable under node --test.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = S4_CSS;
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
  void app.boot();
}
