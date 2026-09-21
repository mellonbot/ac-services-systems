import { html, mount, signal, effect, createRouter, browserHistory, applyDegraded, type VNode } from "../../../packages/ui/src/index.ts";
import type { AnonymousShell } from "../../../packages/shell/src/index.ts";
import { densityOf, type SubmitLeadInput } from "../../../packages/contracts/src/index.ts";
import { SURFACE, open } from "./main.ts";
import { SCREENS, type ScreenId } from "./screens.ts";
import { createStore } from "./state.ts";
import { createLeadBuffer, type LeadBuffer, type BufferStore } from "./buffer.ts";
import type { Screen, ScreenContext } from "./screens/common.ts";
import { home, coverageScreen } from "./screens/home.ts";
import { enquire } from "./screens/enquire.ts";
import { S1_CSS } from "./styles.ts";

/**
 * S1 — THE BROWSER ENTRY (item 8). The boot that is not a boot.
 *
 * Every other surface starts with `connect` and a phase called `booting`,
 * because every other surface is unusable until the gateway has said who the
 * visitor is. This one has no such phase, and its absence is the whole
 * design: `open()` constructs a shell from a constant and a transport, the
 * router starts, and the page renders. If nothing ever answers, the visitor
 * still reads the page and can still leave their number — the coverage list
 * is the only thing that is missing, and it says it is missing.
 *
 * "Site stays up when the gateway does not" (SURFACES.S1.degraded) is not a
 * quality of the deployment. It is this file having no await before its first
 * render.
 *
 * The other half is the buffer. A submit enqueues, instantly and durably, and
 * a flush walks the queue — on submit, on `online`, and on a timer while
 * anything is waiting. The session is minted at the same moment, lazily, by
 * the shell.
 */
export const DENSITY = densityOf("S1");

export const gatewayOrigin = (doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null; location: { protocol: string; host: string } }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

export const SCREEN_VIEWS: Readonly<Record<ScreenId, Screen>> = {
  home, coverage: coverageScreen, enquire,
};

/** How often a waiting queue tries again. Long enough not to hammer a gateway that is down, short enough to catch a connection that came back while the visitor was still reading. */
const RETRY_MS = 20_000;

export const createApp = (opts: {
  baseUrl: string;
  fetch: Parameters<typeof open>[0]["fetch"];
  now?: () => number;
  window?: Window;
  store?: BufferStore | null;
  newId?: () => string;
  session?: "bearer" | "cookie";
}) => {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const degraded = signal(false);
  const shell: AnonymousShell = open({
    baseUrl: opts.baseUrl, fetch: opts.fetch, session: opts.session ?? "cookie",
    ...(opts.window ? { page: opts.window } : {}),
  });
  const store = createStore(shell, now);
  const buffer: LeadBuffer = createLeadBuffer({ store: opts.store ?? null, now });
  const router = createRouter(SCREENS, opts.window ? browserHistory(opts.window) : { path: () => "/", push: () => {}, onPop: () => () => {} });

  /**
   * One flush at a time, and the session minted inside it rather than at
   * boot. `ensureSession` is idempotent, so calling it on every flush is
   * cheaper to read than tracking whether we have one — and if the mint
   * itself fails, the queue simply stays queued, which is the correct
   * behaviour and needs no branch of its own.
   */
  /**
   * One pass over the queue, with the session minted inside it rather than at
   * boot. `ensureSession` is idempotent, so calling it every time is cheaper
   * to read than tracking whether we have one — and if the mint itself fails,
   * the queue is simply untouched, which is the correct behaviour and needs
   * no branch of its own.
   *
   * `retryStale` is the one recursion, and it is bounded to a single extra
   * pass: an anonymous session that expired while the visitor was typing gets
   * exactly one new session and one more attempt. If that fails too, the
   * queue waits for the timer like anything else, because a loop that mints a
   * session per attempt is a loop that writes a session row per attempt.
   */
  const flush = async (retryStale = true): Promise<void> => {
    if (buffer.pending.value.length === 0) return;
    try {
      await shell.ensureSession();
    } catch {
      return; // no session, no writes; the queue is untouched and will try again
    }
    const outcomes = await buffer.flush((input: SubmitLeadInput) => shell.gateway.submitLead(input));
    const landed = outcomes.filter((o) => o.kind === "landed").length;
    if (landed > 0) {
      store.notice.value = [...store.notice.value,
        landed === 1
          ? "Thanks — we have your message. Someone from the office for your area will be in touch."
          : `Thanks — we have your ${landed} messages. Someone from the office for your area will be in touch.`];
    }
    if (retryStale && outcomes.some((o) => o.kind === "stale")) {
      shell.forgetSession();
      await flush(false);
    }
  };

  const submit: ScreenContext["submit"] = (form) => {
    const submissionId = newId();
    const contact: SubmitLeadInput["contact"] = {
      name: form.name.trim(),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    };
    buffer.enqueue({
      submissionId, source: form.source, contact,
      ...(form.metro.trim() ? { requestedMetro: form.metro.trim() } : {}),
    });
    void flush();
    return submissionId;
  };

  /** The call button is a fact about a visitor, recorded on a best-effort basis. It never blocks the dial. */
  const recordCall = async (): Promise<void> => {
    try {
      await shell.ensureSession();
      await shell.gateway.recordCall({ direction: "inbound", occurredAt: new Date(now()).toISOString() });
    } catch { /* a call we failed to log is still a call; nothing on the page depends on this */ }
  };

  const tick = () => { degraded.value = shell.isDegraded(); };
  let lastRetry = 0;
  const retry = () => {
    if (buffer.pending.value.length === 0) return;
    if (now() - lastRetry < RETRY_MS) return;
    lastRetry = now();
    void flush();
  };

  const nav = (screen: ScreenId, label: string): VNode =>
    html`<a class="s1-link" href=${router.href(screen, {})} onClick=${(e: Event) => { e.preventDefault(); router.navigate(screen, {}); }}>${label}</a>`;

  const view = (): VNode => {
    const ctx: ScreenContext = { shell, store, buffer, router, density: DENSITY, degraded: degraded.value, submit };
    void store.version.value;
    const loc = router.current.value;
    const screen = loc ? SCREEN_VIEWS[loc.screen] : null;
    return html`<div class="s1-app">
      <nav class="s1-nav" aria-label="Sections">
        <span class="s1-nav__mark">Rankine</span>
        ${nav("home", "Home")}
        ${nav("coverage", "Where we work")}
        <span class="s1-nav__spacer"></span>
        ${nav("enquire", "Ask us to call")}
      </nav>
      ${screen ? screen(ctx, loc!.params) : html`<p class="s1-empty">Nothing at this address. ${nav("home", "Start here")}</p>`}
    </div>`;
  };

  return { shell, store, buffer, router, degraded, view, submit, flush, recordCall, tick, retry };
};

// ---------------------------------------------------------------------------
// Browser entry. Guarded so the module is importable under node --test.
// ---------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("mount")) {
  const style = document.createElement("style");
  style.textContent = S1_CSS;
  document.head.appendChild(style);

  // localStorage THROWS rather than returning null when site data is blocked,
  // so it is probed here and the buffer falls back to memory.
  let bufferStore: BufferStore | null = null;
  try {
    const probe = "ac.s1.probe";
    globalThis.localStorage.setItem(probe, "1");
    bufferStore = globalThis.localStorage;
  } catch { bufferStore = null; }

  const app = createApp({
    baseUrl: gatewayOrigin(document), fetch: globalThis.fetch.bind(globalThis), window, store: bufferStore,
  });
  const el = document.getElementById("mount")!;
  const slot = document.querySelector("ac-degraded") as (HTMLElement | null);
  const Root = () => app.view();
  mount(html`<${Root} />`, el);
  effect(() => {
    if (!slot) return;
    applyDegraded(slot, {
      degraded: app.degraded.value, text: SURFACE.degraded,
      lastOkAt: app.store.lastOkAt.value, now: Date.now(),
    });
  });
  app.router.start();
  window.addEventListener("online", () => { void app.flush(); });
  setInterval(() => { app.tick(); app.retry(); }, 1000);
  // The queue outlives the tab, so a visitor who comes back with a connection
  // sends what they wrote without pressing anything.
  void app.flush();
}
