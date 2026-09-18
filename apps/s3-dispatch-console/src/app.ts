import { html, mount, signal, effect, createRouter, browserHistory, applyDegraded, PrimaryAction, RefusalCard, type VNode } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { board } from "./screens/board.ts";
import { dispatch } from "./screens/dispatch.ts";
import { S3_CSS } from "./styles.ts";

/**
 * S3 — THE BROWSER ENTRY, mirroring S2's (`build-surface.ts` bundles this
 * file; `main.ts` beside it is the generated registry boot).
 *
 * Boot is identical in shape to S2's: resume the cookie session with
 * `session.me`; on a gone token, show login; login posts through the shell
 * in cookie mode. Then: router from SCREENS, degraded slot driven by
 * `shell.isDegraded()`, and event subscription — explicit topics, not the
 * OFC block default in SUBSCRIBERS, because that default (declared before
 * item 4 existed) does not yet include job.created/job.assigned; the fan-out
 * is by region regardless of which topics a surface asks for (the gateway's
 * events.stream handler), so naming the topics S3 actually needs here is
 * correct and is the same move S2's app.ts already makes for firm/crew
 * events C4 added after OFC's list was written.
 */
export const DENSITY = densityOf("S3");

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  board,
  dispatch,
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
    if (!at || at.screen === "login") router.navigate("board", {});
    // Envelopes carry no payload; refetch what the event touched (09 §3.5).
    // Every one of these is a reason the board itself could be stale — a new
    // job, an assignment made or released from elsewhere, a state a
    // technician's own device pushed, or the cascade escalating a timer —
    // and the dry run is invalidated with it because a credential event can
    // change what candidateCrews would say about a crew already on screen.
    shell.subscribe((_e) => {
      store.invalidate("jobs.list");
      store.invalidate("dispatch.candidates");
    }, { topics: [
      "job.created", "job.assigned", "job.reassigned", "job.transitioned", "job.completed", "job.cancelled",
      "sla.timer_opened", "sla.escalated", "sla.breached", "sla.satisfied",
      "crew.compliance_refused", "credential.verified", "credential.expiring", "credential.expired",
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
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("board", {}); }
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
    if (p.kind === "booting") return html`<p class="s3-loading" role="status">Connecting…</p>`;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, router, density: DENSITY, degraded: degraded.value };
    void p.store.version.value; // subscribe: an invalidate re-renders the mounted screen, which re-reads its resources
    const loc = router.current.value;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const notice = p.store.notice.value;
    return html`<div class="s3-app">
      <nav class="s3-nav" aria-label="Screens">
        <a class="s3-link" href=${router.href("board", {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate("board", {}); }}>Board</a>
        <span class="s3-nav__who">${p.shell.principal.roles.join(", ")} · ${p.shell.context?.parent.name ?? ""}</span>
        <button type="button" class="s3-nav__logout" onClick=${logout}>Sign out</button>
      </nav>
      ${notice.length ? html`<div class="s3-notice" role="status">${notice.map((n) => html`<p>${n}</p>`)}<button type="button" class="s3-notice__dismiss" onClick=${() => { p.store.notice.value = []; }} aria-label="Dismiss">×</button></div>` : null}
      ${screen ? screen(ctx, loc!.params) : html`<p class="s3-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
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
  return html`<section class="s3-login">
    <h1 class="s3-h1">${SURFACE.name}</h1>
    <form class="s3-form" onSubmit=${submit} id="login-form">
      <label class="s3-field"><span>Email</span><input class="s3-input" name="email" type="email" required autocomplete="username" /></label>
      <label class="s3-field"><span>Password</span><input class="s3-input" name="password" type="password" required autocomplete="current-password" /></label>
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
  style.textContent = S3_CSS;
  document.head.appendChild(style);

  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window });
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
