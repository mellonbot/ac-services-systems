import { html, mount, spinFavicon, signal, createRouter, browserHistory, driveDegraded, PrimaryAction, RefusalNotice, pageHead, AccountMenu, createAccountMenu, type AccountMenuState, Messenger, createMessenger, type MessengerState, sessionTools, type VNode, type Signal } from "../../../packages/ui/src/index.ts";
import { gatewayOrigin, SHIFT_TAB_KEY, heldShift, holdShift, forgetShift, resumeHeldShift, type ConnectedShell, type TabMark } from "../../../packages/shell/src/index.ts";
export { gatewayOrigin };
import { densityOf, SURFACE_PATHS, type Refusal } from "../../../packages/contracts/src/index.ts";
import { SURFACE, connect } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore, type Store } from "./state.ts";
import { createOfflineQueue, othersPending, type OfflineQueue, type QueueStore } from "./offline.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { jobList } from "./screens/job-list.ts";
import { jobDetail } from "./screens/job-detail.ts";
import { timesheet } from "./screens/timesheet.ts";
import { wrapUp } from "./screens/wrap-up.ts";
import { createWrapUps, indexedDbMedia, memoryMedia, type MediaStore, type WrapUps } from "./wrap-ups.ts";
import { S5_CSS } from "./styles.ts";

/**
 * S5 — THE BROWSER ENTRY. A sign-in made HERE is `{ hardwareId, email,
 * password }`, always bearer, held in memory (packages/shell's own
 * ConnectConfig doc). A sign-in made at the FRONT DOOR (S1, `auth.signIn`
 * with a device ID) arrives as the session cookie instead, so boot first
 * tries to resume that — `resume()` — and keeps it only when it is a device
 * session with a crew, in a tab S1 marked (SHIFT_TAB_KEY): the shift lasts
 * across a reload and ends with the tab. Anything else falls through to this page's own login,
 * as before. A reload losing a bearer session is the accepted cost of the web
 * fallback being the fallback; re-authenticating with the hardware in hand is quick.
 *
 * OFFLINE: a shift resumed that way is also held in the tab (packages/shell's
 * `holdShift`), with the last jobs and punches the gateway answered. When the
 * next load of that tab cannot reach the gateway, `resume()` opens the held
 * shift instead — the same crew, the last list, every tap queued as ever. A
 * tab with nothing held is told so; nothing is ever signed in offline.
 *
 * `become()` is also where the two things S2/S3 have no equivalent of are
 * created once per session: the offline mutation queue (./offline.ts) and
 * the running-clock signal (ScreenContext.clock), both read back from this
 * device's storage for the technician who signed in — never for whoever was
 * signed in before.
 */
export const DENSITY = densityOf("S5");

export const SCREEN_VIEWS: Readonly<Record<Exclude<ScreenId, "login">, Screen>> = {
  jobs: jobList,
  job: jobDetail,
  timesheet,
  wrapup: wrapUp,
};

type Phase =
  | { kind: "login"; refusal: Refusal | null; busy: boolean }
  | { kind: "ready"; shell: ConnectedShell; store: Store; queue: OfflineQueue; wrapUps: WrapUps; crew: { id: string; label: string }; clock: Signal<Readonly<Record<string, string>>>; account: AccountMenuState; messages: MessengerState };

export const createApp = (opts: { baseUrl: string; fetch: Parameters<typeof connect>[0]["fetch"]; now?: () => number; window?: Window; newId?: () => string; store?: QueueStore | null; media?: MediaStore; tab?: TabMark | null }) => {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => (globalThis.crypto?.randomUUID?.() ?? `${now()}-${Math.random()}`));
  const phase = signal<Phase>({ kind: "login", refusal: null, busy: false });
  const degraded = signal(false);
  const minute = signal(Math.floor(now() / 60_000));
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window, SURFACE_PATHS.S5) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  /** The signed-in phase, from a shell that already holds a device session and its crew. */
  const enter = (shell: ConnectedShell & { deviceCrew: { id: string; label: string } }, hardwareId: string) => {
    // A device principal's subject is the technician who signed in (auth.deviceLogin's `sub`).
    const deviceId = shell.principal.deviceId ?? hardwareId;
    const store = createStore(shell, now, heldReads(opts.tab, readsKey(deviceId, shell.principal.subjectId)));
    const queue = createOfflineQueue({ deviceId, subjectId: shell.principal.subjectId, newId, now, store: opts.store ?? null });
    const wrapUps = createWrapUps({ deviceId, subjectId: shell.principal.subjectId, newId, now, store: opts.store ?? null, media: opts.media ?? memoryMedia() });
    const others = othersPending(opts.store, deviceId, shell.principal.subjectId);
    if (others > 0) store.notice.value = [...store.notice.value, `${others} change(s) another technician saved on this device are kept for them and will be sent when they sign in on it.`];
    phase.value = { kind: "ready", shell, store, queue, wrapUps, crew: shell.deviceCrew, clock: queue.clock, account: createAccountMenu(shell.gateway, shell.refusalOf), messages: createMessenger(shell.gateway, shell.refusalOf) };
    router.navigate("jobs", {});
    // Envelopes carry no payload; a job assigned to or pulled off this
    // shift's crew, or a term change affecting the field ground, is a
    // refetch of jobs.mine, same as every other surface's own event handling.
    shell.subscribe(() => { store.invalidate("jobs.mine"); }, { topics: ["job.assigned", "job.reassigned", "job.cancelled"] });
  };

  const login = async (hardwareId: string, email: string, password: string) => {
    phase.value = { kind: "login", refusal: null, busy: true };
    try {
      const shell = await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { hardwareId, email, password } });
      if (!shell.deviceCrew) throw new Error("auth.deviceLogin answered with no crew — the shell's own contract was not honored");
      enter(shell as typeof shell & { deviceCrew: { id: string; label: string } }, hardwareId);
    } catch (e) {
      phase.value = { kind: "login", refusal: refusalOf(e), busy: false };
    }
  };

  /**
   * The session S1's front door minted, if there is one. Kept only when it is
   * a DEVICE session that knows its crew; a staff member's cookie, an expired
   * shift or no cookie at all is simply this page's login, with no refusal shown.
   */
  const resume = async () => {
    phase.value = { kind: "login", refusal: null, busy: true };
    try {
      const shell = await connect({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: { session: "cookie" } });
      if (shell.principal.namespace === "device" && shell.deviceCrew) {
        if (opts.tab?.getItem(SHIFT_TAB_KEY)) {
          holdShift(opts.tab, shell);
          enter(shell as typeof shell & { deviceCrew: { id: string; label: string } }, shell.principal.deviceId ?? "");
          return;
        }
        // A shift left behind by a closed tab: end it on the gateway, so the
        // next person at this browser does not walk into it.
        await shell.logout().catch(() => {});
      } else shell.close();
      forget();
    } catch (e) {
      if (refusalOf(e).kind !== "transport") forget(); // the gateway answered: whatever this tab held is over
      else {
        // No answer at all. Open the shift this tab holds, if it holds one that has not ended.
        const held = heldShift(opts.tab, now());
        if (held) {
          enter(resumeHeldShift({ surfaceId: "S5", baseUrl: opts.baseUrl, fetch: opts.fetch }, held) as ConnectedShell & { deviceCrew: { id: string; label: string } }, held.principal.deviceId ?? "");
          return;
        }
        phase.value = { kind: "login", refusal: { kind: "transport", status: null, message: NO_HELD_SHIFT }, busy: false };
        return;
      }
    }
    if (phase.value.kind === "login") phase.value = { kind: "login", refusal: null, busy: false };
  };

  /** End what this tab holds: the shift and its last reads. The queue stays — it is the technician's work. */
  const forget = () => {
    const p = phase.value;
    if (p.kind === "ready") { try { opts.tab?.removeItem(readsKey(p.shell.principal.deviceId ?? "", p.shell.principal.subjectId)); } catch { /* blocked */ } }
    forgetShift(opts.tab);
  };

  const logout = async () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    p.messages.stop();
    forget();
    opts.tab?.removeItem(SHIFT_TAB_KEY);
    try { await p.shell.logout(); } finally { phase.value = { kind: "login", refusal: null, busy: false }; router.navigate("login", {}); }
  };

  // Retry pacing: every tick while answers come back, then doubling to a
  // minute while they do not — a dead zone is not a reason to send a request a second.
  let retryAt = 0;
  let retryDelay = 1000;
  let wrapRetryAt = 0;
  let wrapRetryDelay = 1000;
  const tick = () => {
    const p = phase.value;
    if (p.kind !== "ready") return;
    degraded.value = p.shell.isDegraded();
    minute.value = Math.floor(now() / 60_000);
    // Offline-first: a queue with something in it is retried on every tick
    // while the gateway is reachable, not only when a tech taps a button —
    // reconnecting after a dead zone should not need a second tap to notice.
    // Wrap-ups go once the sync queue is empty: the moves that put the job in
    // progress reach the office before the wrap-up that completes it.
    if (p.queue.pending.value.length === 0 && p.wrapUps.outbox.value.some((e) => e.refused === null) && now() >= wrapRetryAt) {
      void p.wrapUps.flush(p.shell.gateway, (e) => (e as { refusal?: Refusal })?.refusal ?? null).then((reached) => {
        if (reached) { wrapRetryDelay = 1000; wrapRetryAt = 0; p.store.invalidate("jobs.mine"); return; }
        wrapRetryAt = now() + wrapRetryDelay;
        wrapRetryDelay = Math.min(wrapRetryDelay * 2, 60_000);
      });
    }
    if (p.queue.pending.value.length > 0 && now() >= retryAt && !p.queue.flushing.value) {
      void p.queue.flush((mutations) => p.shell.gateway.replaySync({ orgId: p.shell.principal.orgId, regionId: p.shell.principal.regionId, mutations }))
        .then((answered) => {
          if (answered) { retryDelay = 1000; retryAt = 0; p.store.invalidate("jobs.mine"); p.store.invalidate("punches.mine"); return; }
          const refusal = refusalOf(p.queue.failure.value);
          if (refusal.kind === "token") {
            // The shift's token is over. The work is on this device; signing in again replays it.
            // Its stream goes with it: the next sign-in opens its own.
            forget();
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
    const ctx: ScreenContext = { shell: p.shell, store: p.store, queue: p.queue, wrapUps: p.wrapUps, crew: p.crew, clock: p.clock, router, density: DENSITY, degraded: degraded.value, now: now() };
    void minute.value; // subscribe: a running shift clock moves on every minute
    void p.store.version.value; // subscribe: an invalidate re-renders the mounted screen, which re-reads its resources
    void p.queue.pending.value; void p.queue.attention.value; void p.wrapUps.drafts.value; void p.wrapUps.outbox.value; void p.wrapUps.previews.value; // subscribe: enqueue/flush re-render the queued-count and any attention items
    const loc = router.current.value;
    const screen = loc && loc.screen !== "login" ? SCREEN_VIEWS[loc.screen] : null;
    const notice = p.store.notice.value;
    return html`<div class="s5-app">
      <nav class="ac-nav" aria-label="Screens">
        <a class="ac-seg__item" data-current=${loc?.screen === "jobs" ? "true" : "false"} href=${router.href("jobs", {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate("jobs", {}); }}>Today</a>
        <a class="ac-seg__item" data-current=${loc?.screen === "timesheet" ? "true" : "false"} href=${router.href("timesheet", {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate("timesheet", {}); }}>Timesheet</a>
        <span class="ac-nav__who">${p.crew.label}</span>
        ${Messenger({ density: DENSITY, menu: p.messages })}${sessionTools(AccountMenu({ density: DENSITY, menu: p.account }), logout)}
      </nav>
      ${notice.length ? html`<div class="s5-notice" role="status">${notice.map((n) => html`<p>${n}</p>`)}<button type="button" class="s5-notice__dismiss" onClick=${() => { p.store.notice.value = []; }} aria-label="Dismiss">×</button></div>` : null}
      ${screen ? screen(ctx, loc!.params) : html`<p class="s5-empty">No screen at ${String(router.current.value ? router.current.value.screen : "this path")}.</p>`}
    </div>`;
  };

  return { phase, degraded, router, view, login, resume, logout, tick };
};

export const NO_HELD_SHIFT = "No signal, and this tab holds no shift to open offline. Sign in when you are back in signal.";

/**
 * The last answers to the reads a shift cannot work without — its jobs and its
 * punches (the clock gate) — kept in the tab beside the held shift, so an
 * offline load has the list and the gate it had. Only those two.
 */
const KEPT_READS = ["jobs.mine", "punches.mine"];
export const readsKey = (deviceId: string, subjectId: string): string => `ac.s5.reads.${deviceId}.${subjectId}`;
const heldReads = (tab: TabMark | null | undefined, key: string) => {
  let held: Record<string, unknown> = {};
  try {
    const parsed: unknown = tab?.getItem(SHIFT_TAB_KEY) ? JSON.parse(tab.getItem(key) ?? "{}") : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) held = parsed as Record<string, unknown>;
  } catch { /* unreadable: nothing held */ }
  const onAnswer = (k: string, value: unknown) => {
    if (!KEPT_READS.some((r) => k === r || k.startsWith(`${r}?`))) return;
    if (value === undefined) delete held[k]; else held[k] = value;
    try { if (tab?.getItem(SHIFT_TAB_KEY)) tab.setItem(key, JSON.stringify(held)); } catch { /* blocked or full: this tab opens offline without them */ }
  };
  return { held, onAnswer };
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
    ${p.refusal ? RefusalNotice({ density: DENSITY, refusal: p.refusal, ...(p.refusal.message === NO_HELD_SHIFT ? { message: NO_HELD_SHIFT } : {}) }) : null}
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
  let tab: TabMark | null = null;
  try { tab = window.sessionStorage; } catch { /* site data blocked: a front-door shift then always signs in again */ }
  const app = createApp({ baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window, store, tab, ...(typeof indexedDB !== "undefined" ? { media: indexedDbMedia("ac-s5-media") } : {}) });
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
  void app.resume();
  setInterval(() => { app.tick(); degradedTick(); }, 1000);
}
