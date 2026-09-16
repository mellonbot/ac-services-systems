import { html, mount, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, RefusalCard, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, keyOf, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { accountsTree } from "./screens/accounts-tree.ts";
import { accountsNew } from "./screens/accounts-new.ts";
import { accountsMove } from "./screens/accounts-move.ts";
import { organizationsNew } from "./screens/organizations-new.ts";
import { contractsList } from "./screens/contracts-list.ts";
import { contractsNew } from "./screens/contracts-new.ts";
import { termsOverride } from "./screens/terms-override.ts";
import { termsResolved } from "./screens/terms-resolved.ts";
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
  "contracts.list": contractsList,
  "contracts.new": contractsNew,
  "terms.override": termsOverride,
  "terms.resolved": termsResolved,
};

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window) : { path: () => "/", push: () => {}, onPop: () => () => {} });

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
    }, { topics: ["account.created", "account.updated", "account.deactivated", "contract.created", "contract.amended", "contract.expired", "contract.term_overridden"] });
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
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const notice = p.store.notice.value;
    return html`<div class="s2-app">
      <nav class="s2-nav" aria-label="Screens">
        ${Object.entries(SCREENS).filter(([, s]) => "title" in s).map(([id, s]) => html`<a class="s2-nav__link" data-current=${loc?.screen === id ? "true" : "false"} href=${router.href(id as ScreenId, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(id as ScreenId, {}); }}>${(s as { title: string }).title}</a>`)}
        <span class="s2-nav__who">${p.shell.principal.roles.join(", ")} · ${p.shell.context?.parent.name ?? ""}</span>
        <button type="button" class="s2-nav__logout" onClick=${logout}>Sign out</button>
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
    <h1 class="s2-h1">${SURFACE.name}</h1>
    <form class="s2-form" onSubmit=${submit} id="login-form">
      <label class="s2-field"><span>Email</span><input class="s2-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="s2-field"><span>Password</span><input class="s2-input" name="password" type="password" required autocomplete="current-password" /></label>
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
