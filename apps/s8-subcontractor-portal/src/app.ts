import { html, mount, spinFavicon, signal, createRouter, browserHistory, driveDegraded, pageHead, PrimaryAction, RefusalNotice, type VNode, AccountMenu, createAccountMenu, type AccountMenuState, sessionTools, bindCookieSession } from "../../../packages/ui/src/index.ts";
import { gatewayOrigin, type ConnectedShell } from "../../../packages/shell/src/index.ts";
export { gatewayOrigin };
import { densityOf, SURFACE_PATHS, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { firm } from "./screens/firm.ts";
import { crews } from "./screens/crews.ts";
import { documents } from "./screens/documents.ts";
import { work } from "./screens/work.ts";
import { statements, statement } from "./screens/statements.ts";
import { S8_CSS } from "./styles.ts";

/**
 * S8 — THE BROWSER ENTRY (item 7). Same boot shape as S2, S3 and S6: resume
 * the cookie session with `session.me`; on a gone token, show login; login
 * posts through the shell in cookie mode. Then the router from SCREENS, the
 * degraded slot driven by `shell.isDegraded()`, and the event subscription.
 *
 * What is S8's alone is what is NOT here. No brand: a firm works under
 * Rankine's plate (`whiteLabel: false`, `stateRamp: true`). No filter: what
 * the firm sees is what the gateway returned, and the gateway returned what
 * 0005 and 0007 admit for this principal — one firm, its crews, their
 * documents, the work its crews were sent to, the statements issued to it.
 * Two firms run this same bundle; the difference between their portals is
 * entirely in the rows.
 */
export const DENSITY = densityOf("S8");

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  firm, crews, documents, work, statements, statement,
};

type Phase = { kind: "booting" } | { kind: "login"; refusal: Refusal | null; busy: boolean } | { kind: "ready"; shell: ConnectedShell; store: Store; account: AccountMenuState };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window }) => {
  const now = opts.now ?? (() => Date.now());
  const phase = signal<Phase>({ kind: "booting" });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S8) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const become = (shell: ConnectedShell) => {
    const store = createStore(shell, now);
    phase.value = { kind: "ready", shell, store, account: createAccountMenu(shell.gateway, shell.refusalOf) };
    const at = router.current.value;
    if (!at || at.screen === "login") router.navigate("firm", {});
    // Envelopes carry no payload; refetch what the event touched (09 §3.5).
    // A firm's own events: its documents verified, its status moved, its
    // price set, a statement issued — and the work its crews are on.
    shell.subscribe(() => {
      store.invalidate("crews.list");
      store.invalidate("credentials.list");
      store.invalidate("firms.list");
      store.invalidate("jobs.list");
      store.invalidate("settlements.list");
    }, { topics: [
      "credential.verified", "credential.expiring", "credential.expired", "crew.updated", "firm.status_changed", "firm.updated", "rate_card.changed",
      "job.assigned", "job.reassigned", "job.transitioned", "job.completed", "job.cancelled",
      "sla.timer_opened", "sla.escalated", "sla.breached", "sla.satisfied",
      "settlement.statement_issued",
    ] });
  };

  const session = bindCookieSession({
    degraded,
    now,
    isReady: () => (phase.value.kind === "ready" ? phase.value : null),
    setLogin: (busy, refusal) => { phase.value = { kind: "login", refusal, busy }; },
    setReady: become,
    connect: (credentials) => connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials }),
    afterLogout: () => { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("firm", {}); },
  });

  const nav = (screen: "firm" | "crews" | "work" | "statements", label: string): VNode =>
    html`<a class="ac-seg__item" data-current=${router.current.value?.screen === screen || (screen === "statements" && router.current.value?.screen === "statement") || (screen === "crews" && router.current.value?.screen === "documents") ? "true" : "false"} href=${router.href(screen, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(screen, {}); }}>${label}</a>`;

  const { login, logout } = session;

  const view = (): VNode => {
    const p = phase.value;
    if (p.kind === "booting") return html`<p class="s8-loading" role="status">Connecting…</p>`;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, router, density: DENSITY, degraded: degraded.value };
    void p.store.version.value;
    const loc = router.current.value;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const who = p.shell.context?.parent.name ?? "";
    return html`<div class="s8-app">
      <nav class="ac-nav" aria-label="Screens">
        ${nav("firm", "Your firm")}
        ${nav("crews", "Crews")}
        ${nav("work", "Work")}
        ${nav("statements", "Statements")}
        <span class="ac-nav__who" id="who">${who}</span>
        ${sessionTools(AccountMenu({ density: DENSITY, menu: p.account }), logout)}
      </nav>
      ${screen ? screen(ctx, loc!.params) : html`<p class="s8-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
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
  return html`<section class="s8-login">
    ${pageHead(SURFACE.name)}
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
  style.textContent = S8_CSS;
  document.head.appendChild(style);

  const baseUrl = gatewayOrigin(document);
  const app = createApp({ baseUrl, fetch: globalThis.fetch.bind(globalThis), window });
  const el = document.getElementById("mount")!;
  const slot = document.querySelector("ac-degraded") as (HTMLElement | null);
  const Root = () => app.view();
  mount(html`<${Root} />`, el);
  spinFavicon(document);
  const degradedTick = slot ? driveDegraded(slot, () => {
    const p = app.phase.value;
    return { degraded: app.degraded.value, text: SURFACE.degradedNotice, lastOkAt: p.kind === "ready" ? p.store.lastOkAt.value : null };
  }, Date.now) : () => {};
  app.router.start();
  setInterval(() => { app.tick(); app.probe(); degradedTick(); }, 1000);
  void app.boot();
}
