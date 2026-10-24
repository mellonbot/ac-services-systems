import { html, mount, spinFavicon, signal, createRouter, browserHistory, driveDegraded, PrimaryAction, RefusalNotice, pageHead, type VNode, type Signal } from "../../../packages/ui/src/index.ts";
import type { ConnectedShell } from "../../../packages/shell/src/index.ts";
import { densityOf, SURFACE_PATHS, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import { createOfflineQueue, othersPending, type OfflineQueue, type QueueStore } from "./offline.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { jobList } from "./screens/job-list.ts";
import { jobDetail } from "./screens/job-detail.ts";
import { S5_CSS } from "./styles.ts";

/**
 * S5 — THE BROWSER ENTRY. Boot is deliberately NOT S2's/S3's shape: there is
 * no cookie session to resume — `{ hardwareId, email, password }` is always
 * bearer, held in memory (packages/shell's own ConnectConfig doc) — so this
 * starts at login every time rather than trying `session: "cookie"` first.
 * A reload losing the session is the accepted cost of the web fallback being
 * the fallback; re-authenticating with the hardware in hand is quick.
 *
 * `become()` is also where the two things S2/S3 have no equivalent of are
 * created once per session: the offline mutation queue (./offline.ts) and
 * the running-clock signal (ScreenContext.clock), both read back from this
 * device's storage for the technician who signed in — never for whoever was
 * signed in before.
 */
export const DENSITY = densityOf("S5");

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  jobs: jobList,
  job: jobDetail,
};

type Phase =
  | { kind: "login"; refusal: Refusal | null; busy: boolean }
  | { kind: "ready"; shell: ConnectedShell; store: Store; queue: OfflineQueue; crew: { id: string; label: string }; clock: Signal<Readonly<Record<string, string>>> };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window; newId?: () => string; store?: QueueStore | null }) => {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => (globalThis.crypto?.randomUUID?.() ?? `${now()}-${Math.random()}`));
  const phase = signal<Phase>({ kind: "login", refusal: null, busy: false });
  const degraded = signal(false);
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S5) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  const login = async (hardwareId: string, email: string, password: string) => {
    phase.value = { kind: "login", refusal: null, busy: true };
    try {
      const shell = await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { hardwareId, email, password } });
      if (!shell.deviceCrew) throw new Error("auth.deviceLogin answered with no crew — the shell's own contract was not honored");
      const store = createStore(shell, now);
      // A device principal's subject is the technician who signed in (auth.deviceLogin's `sub`).
      const deviceId = shell.principal.deviceId ?? hardwareId;
      const queue = createOfflineQueue({ deviceId, subjectId: shell.principal.subjectId, newId, now, store: opts.store ?? null });
      const others = othersPending(opts.store, deviceId, shell.principal.subjectId);
      if (others > 0) store.notice.value = [...store.notice.value, `${others} change(s) another technician saved on this device are kept for them and will be sent when they sign in on it.`];
      phase.value = { kind: "ready", shell, store, queue, crew: shell.deviceCrew, clock: queue.clock };
      router.navigate("jobs", {});
      // Envelopes carry no payload; a job assigned to or pulled off this
      // shift's crew, or a term change affecting the field ground, is a
      // refetch of jobs.mine, same as every other surface's own event handling.
      shell.subscribe(() => { store.invalidate("jobs.mine"); }, { topics: ["job.assigned", "job.reassigned", "job.cancelled"] });
    } catch (e) {
      phase.value = { kind: "login", refusal: refusalOf(e), busy: false };
    }
  };

  const logout = async () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("login", {}); }
  };

  // Retry pacing: every tick while answers come back, then doubling to a
  // minute while they do not — a dead zone is not a reason to send a request a second.
  let retryAt = 0;
  let retryDelay = 1000;
  const tick = () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    degraded.value = p.shell.isDegraded();
    // Offline-first: a queue with something in it is retried on every tick
    // while the gateway is reachable, not only when a tech taps a button —
    // reconnecting after a dead zone should not need a second tap to notice.
    if (p.queue.pending.value.length > 0 && now() >= retryAt && !p.queue.flushing.value) {
      void p.queue.flush((mutations) => p.shell.gateway.replaySync({ orgId: p.shell.principal.orgId, regionId: p.shell.principal.regionId, mutations }))
        .then((answered) => {
          if (answered) { retryDelay = 1000; retryAt = 0; p.store.invalidate("jobs.mine"); return; }
          const refusal = refusalOf(p.queue.failure.value);
          if (refusal.kind === "token") {
            // The shift's token is over. The work is on this device; signing in again replays it.
            // Its stream goes with it: the next sign-in opens its own.
            p.shell.close();
            phase.value = { kind: "login", refusal: { ...refusal, message: `${refusal.message} — ${p.queue.pending.value.length} change(s) are saved on this device and will be sent after you sign in.` }, busy: false };
            router.navigate("login", {});
            return;
          }
          retryAt = now() + retryDelay;
          retryDelay = Math.min(retryDelay * 2, 60_000);
        });
    }
  };

  const view = (): VNode => {
    const p = phase.value;
    if (p.kind === "login") return loginView(p, login);
    const ctx: ScreenContext = { shell: p.shell, store: p.store, queue: p.queue, crew: p.crew, clock: p.clock, router, density: DENSITY, degraded: degraded.value };
    void p.store.version.value; // subscribe: an invalidate re-renders the mounted screen, which re-reads its resources
    void p.queue.pending.value; void p.queue.attention.value; // subscribe: enqueue/flush re-render the queued-count and any attention items
    const loc = router.current.value;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const notice = p.store.notice.value;
    return html`<div class="s5-app">
      <nav class="ac-nav" aria-label="Screens">
        <a class="ac-seg__item" data-current=${loc?.screen === "jobs" ? "true" : "false"} href=${router.href("jobs", {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate("jobs", {}); }}>My jobs</a>
        <span class="ac-nav__who">${p.crew.label}</span>
        <button type="button" class="ac-nav__signout" onClick=${logout}>Sign out</button>
      </nav>
      ${notice.length ? html`<div class="s5-notice" role="status">${notice.map((n) => html`<p>${n}</p>`)}<button type="button" class="s5-notice__dismiss" onClick=${() => { p.store.notice.value = []; }} aria-label="Dismiss">×</button></div>` : null}
      ${screen ? screen(ctx, loc!.params) : html`<p class="s5-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
    </div>`;
  };

  return { phase, degraded, router, view, login, logout, tick };
};

const refusalOf = (e: unknown): Refusal =>
  (e as { refusal?: Refusal })?.refusal ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) };

export const loginView = (p: { refusal: Refusal | null; busy: boolean }, login: (hardwareId: string, email: string, password: string) => void): VNode => {
  const submit = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    login(String(f.get("hardwareId") ?? ""), String(f.get("email") ?? ""), String(f.get("password") ?? ""));
  };
  return html`<section class="s5-login">
    ${pageHead(SURFACE.name, "Sign in with this device and your crew account to open the shift's jobs.")}
    <form class="ac-form" onSubmit=${submit} id="login-form">
      <label class="ac-field"><span>Device</span><input class="ac-input" name="hardwareId" type="text" required autocomplete="off" placeholder="Hardware ID" /></label>
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
  style.textContent = S5_CSS;
  document.head.appendChild(style);

  let store: QueueStore | null = null;
  try { store = window.localStorage; } catch { /* site data blocked: the queue lives in memory */ }
  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window, store });
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
  setInterval(() => { app.tick(); degradedTick(); }, 1000);
}
