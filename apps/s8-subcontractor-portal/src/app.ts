import { html, mount, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, refusalHeading, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, type Refusal } from "../../../packages/contracts/src/index.ts";
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

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  firm, crews, documents, work, statements, statement,
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
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("firm", {}); }
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

  const nav = (screen: "firm" | "crews" | "work" | "statements", label: string): VNode =>
    html`<a class="s8-link" href=${router.href(screen, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(screen, {}); }}>${label}</a>`;

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
      <nav class="s8-nav" aria-label="Screens">
        ${nav("firm", "Your firm")}
        ${nav("crews", "Crews")}
        ${nav("work", "Work")}
        ${nav("statements", "Statements")}
        <span class="s8-nav__who" id="who">${who}</span>
        <button type="button" class="s8-nav__logout" onClick=${logout}>Sign out</button>
      </nav>
      ${screen ? screen(ctx, loc!.params) : html`<p class="s8-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
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
  return html`<section class="s8-login">
    <h1 class="s8-h1">${SURFACE.name}</h1>
    <form class="s8-form" onSubmit=${submit} id="login-form">
      <label class="s8-field"><span>Email</span><input class="s8-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="s8-field"><span>Password</span><input class="s8-input" name="password" type="password" required autocomplete="current-password" /></label>
      ${PrimaryAction({ density: DENSITY, label: p.busy ? "Signing in…" : "Sign in", type: "submit", id: "sign-in" })}
    </form>
    ${p.refusal ? html`<section class="s8-refusal" role="alert" data-kind=${p.refusal.kind}><h2 class="s8-refusal__heading">${refusalHeading(p.refusal)}</h2><p class="s8-refusal__message">${p.refusal.message}</p></section>` : null}
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
