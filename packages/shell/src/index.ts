import { SURFACES, SUBSCRIBERS, ANONYMOUS_PRINCIPAL, type SurfaceId, type Principal, type HierarchyContext, type EventEnvelope, type Topic, type Refusal } from "../../contracts/src/index.ts";
import { GatewayRefusal } from "../../contracts/src/refusals.ts";
import { DENSITY, type Density } from "../../tokens/src/index.ts";
import { createGatewayClient, type GatewayClient } from "../../sdk/src/generated/client.ts";
import { httpTransport, type Transport, type FetchLike, type StreamState } from "../../sdk/src/runtime.ts";
import { DEGRADED, type DegradedState } from "./internal.ts";
import { guardedTransport, unconnectedTransport } from "./transport.ts";

/**
 * S0 — THE SHARED SHELL. The one way a surface talks to the gateway.
 *
 * Every S0 obligation is discharged here, once, for all eight surfaces:
 *   - hierarchy context resolved at login (`connectShell` → `session.me`);
 *   - the generated SDK — `shell.gateway` is the only client a surface holds,
 *     bound to a transport the shell built with the gateway's origin;
 *   - event-stream subscription with `eventId` dedupe (`shell.subscribe`),
 *     filtered by default to the surface's block subscriptions in SUBSCRIBERS;
 *   - refusal mapping — every gateway refusal reaches a surface as a typed
 *     `Refusal` (`shell.refusalOf`), with the admission axis attached;
 *   - a declared degraded mode, carried here and flipped only by the transport.
 * The audit emitter is supplied by the gateway's unit of work, where a surface
 * cannot skip it; the shell's part is the request id on every call.
 *
 * Implemented once because eight implementations means eight, and by the third
 * one somebody has quietly skipped the audit emitter for a "read-mostly" screen.
 *
 * White-label lives beside this in ./brand.ts rather than inside `connectShell`,
 * because it has to run before login: a portal branded only after a successful
 * password looks like someone else's until you are already inside it.
 */
export type ShellConfig = {
  readonly surfaceId: SurfaceId;
  readonly principal: Principal;
  /** Omit for a configuration-only shell (server-rendered checks, tests): every call is then a transport refusal. */
  readonly transport?: Transport;
  readonly context?: HierarchyContext;
  /**
   * The page the shell lives on, for the stream's lifecycle (see `subscribe`).
   * Defaults to `globalThis`, which is a page in a browser and nothing under
   * node — a shell in a test or a device runtime has no page and no cache to
   * survive. Tests pass a fake to drive the two events.
   */
  readonly page?: unknown;
};

/** A page, if `g` is one: something that dispatches `pagehide`/`pageshow` and has a document. Null under node. */
type PageLike = { addEventListener(t: string, cb: (ev: { persisted?: boolean }) => void): void; removeEventListener(t: string, cb: (ev: { persisted?: boolean }) => void): void };
const pageOf = (g: unknown): PageLike | null => {
  const w = g as { document?: unknown; addEventListener?: unknown; removeEventListener?: unknown } | null;
  if (!w || typeof w !== "object" && typeof w !== "function") return null;
  if (typeof w.document !== "object" || w.document === null) return null;
  if (typeof w.addEventListener !== "function" || typeof w.removeEventListener !== "function") return null;
  return w as PageLike;
};

export type SubscribeOptions = {
  /** Defaults to the surface's block in SUBSCRIBERS. Pass `"all"` to receive every topic the region feed carries. */
  readonly topics?: readonly Topic[] | "all";
  readonly onState?: (s: StreamState) => void;
};

export type Shell = {
  readonly surfaceId: SurfaceId;
  readonly density: Density;
  readonly principal: Principal;
  readonly degradedMode: string;
  /** `SURFACES[id].degradedNotice` — the reader-facing line a paused control gives as its reason. */
  readonly degradedNotice: string;
  /** Resolved at login. Null on a configuration-only shell. */
  readonly context: HierarchyContext | null;
  /** The generated client. Every read and every write a surface makes goes through this object. */
  readonly gateway: GatewayClient;
  /** True when the gateway is unreachable. Every surface must render this state. */
  isDegraded(): boolean;
  /** Domain events for this surface, deduplicated on eventId. Returns unsubscribe. */
  subscribe(handler: (e: EventEnvelope) => void, opts?: SubscribeOptions): () => void;
  /** Close every stream this shell opened. A shell whose session is over must not keep reconnecting on it. */
  close(): void;
  /** The typed refusal behind a rejected gateway call, or null if the error is not one. */
  refusalOf(e: unknown): Refusal | null;
};

const SEEN_LIMIT = 10_000;

export const createShell = (config: ShellConfig): Shell => {
  const surface = SURFACES[config.surfaceId];

  if (!surface.enabled) {
    throw new Error(
      `${surface.id} (${surface.name}) is Phase ${surface.phase} and not enabled. ` +
      `Enabling it is a data change in the surface registry — see D9.`,
    );
  }
  if (surface.namespace !== config.principal.namespace) {
    throw new Error(
      `${surface.id} serves the ${surface.namespace} namespace; this principal is ${config.principal.namespace}. ` +
      `Namespaces are walls below the role layer: a subcontractor is neither a customer nor a parts vendor.`,
    );
  }
  // Every operational caller carries a region. This is the runtime half of the
  // invariant the schema holds structurally.
  if (surface.scopeBinding === "region" && !config.principal.regionId) {
    throw new Error(`${surface.id} is region-scoped and the principal carries no region.`);
  }

  // The transport flips this; the surface can only read it. The state object is
  // reachable ONLY through the DEGRADED symbol in ./internal.ts, which is not on
  // this package's exports map — so a surface cannot clear its own flag to make
  // a screen render.
  //
  // Note the order: the symbol goes on BEFORE the freeze. Freezing first and
  // assigning after throws TypeError in strict mode (every ES module is strict),
  // which is to say it throws on every call for every surface.
  const state: DegradedState = { degraded: false };
  const transport = guardedTransport(config.transport ?? unconnectedTransport(), state);
  const gateway = createGatewayClient(transport);

  // Every open subscription's unsubscribe. A surface that signs out and in
  // again builds a new shell; the old one's streams would otherwise keep
  // reconnecting on a revoked session, one connection each against the
  // browser's per-origin limit, until the page could open no request at all.
  const streams = new Set<() => void>();
  const close = () => { for (const unsubscribe of [...streams]) unsubscribe(); };

  const RECONNECT_MIN_MS = 1000;
  const RECONNECT_MAX_MS = 30_000;
  const subscribe: Shell["subscribe"] = (handler, opts = {}) => {
    const wanted: ReadonlySet<string> | null =
      opts.topics === "all" ? null : new Set(opts.topics ?? SUBSCRIBERS[surface.block]);
    const seen = new Set<string>();
    const report = opts.onState ?? (() => {});
    const deliver = (e: EventEnvelope) => {
      if (wanted && !wanted.has(e.topic)) return;
      // At-least-once delivery; the outbox relay may republish after a crash.
      if (seen.has(e.eventId)) return;
      seen.add(e.eventId);
      if (seen.size > SEEN_LIMIT) { const first = seen.values().next().value; if (first !== undefined) seen.delete(first); }
      // A surface's handler that throws must not end the stream for every later event.
      try { handler(e); } catch (err) { console.error("shell: an event handler threw", err); }
    };

    // A STREAM THAT ENDS IS REOPENED. A gateway deploy, a restart or a proxy's
    // idle timeout closes it, and nothing else would ever open it again: the
    // surface would hear no event for the rest of the page's life while every
    // request still succeeded. Reopened with jittered backoff (1s doubling to
    // 30s), with the same dedupe set; `open` resets the backoff.
    let live = true;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = RECONNECT_MIN_MS;
    let stop: () => void = () => {};
    const open = () => { stop = gateway.events(deliver, onState); };
    function onState(st: Parameters<NonNullable<typeof opts.onState>>[0]) {
      report(st);
      if (st === "open") { delay = RECONNECT_MIN_MS; return; }
      if ((st === "closed" || st === "failed") && live && retry === null) {
        const wait = delay / 2 + Math.random() * (delay / 2);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        retry = setTimeout(() => { retry = null; if (live) open(); }, wait);
        // Never the reason a process (or a test run) stays alive.
        (retry as { unref?: () => void }).unref?.();
      }
    }
    const halt = () => {
      live = false;
      if (retry !== null) { clearTimeout(retry); retry = null; }
      stop();
    };
    open();
    const page = pageOf(config.page ?? globalThis);
    if (!page) {
      const unsubscribe = () => { streams.delete(unsubscribe); if (live) halt(); };
      streams.add(unsubscribe);
      return unsubscribe;
    }

    // A STREAM BELONGS TO A PAGE THAT IS SHOWING. A browser keeps the last few
    // pages alive in its back/forward cache, and a page kept alive keeps its
    // event stream open — one connection each, against a per-origin limit of
    // about six. Six full navigations later the page that is actually on
    // screen cannot open a single request: every screen reads "Loading…" and
    // the gateway never hears from it. drive-s6 found this at its 11th check.
    // So the stream closes on `pagehide` and, if the page comes back from the
    // cache, reopens on `pageshow` — with the same dedupe set, so an event
    // republished across the gap is still delivered once.
    const onHide = () => { if (!live) return; halt(); report("closed"); };
    const onShow = (ev: { persisted?: boolean }) => { if (live || !ev.persisted) return; live = true; delay = RECONNECT_MIN_MS; open(); };
    page.addEventListener("pagehide", onHide);
    page.addEventListener("pageshow", onShow);
    const unsubscribe = () => {
      streams.delete(unsubscribe);
      page.removeEventListener("pagehide", onHide);
      page.removeEventListener("pageshow", onShow);
      if (live) halt();
    };
    streams.add(unsubscribe);
    return unsubscribe;
  };

  return Object.freeze(Object.assign(
    {
      surfaceId: surface.id,
      density: surface.density,
      principal: config.principal,
      degradedMode: surface.degraded,
      degradedNotice: surface.degradedNotice,
      context: config.context ?? null,
      gateway,
      isDegraded: () => state.degraded,
      subscribe,
      close,
      refusalOf: (e: unknown) => (e instanceof GatewayRefusal ? e.refusal : null),
    },
    { [DEGRADED]: state },
  )) as Shell;
};

export const densityTokens = (id: SurfaceId) => DENSITY[SURFACES[id].density];

// ---------------------------------------------------------------------------
// Boot against a live gateway.
// ---------------------------------------------------------------------------
export type ConnectConfig = {
  readonly surfaceId: SurfaceId;
  /** The gateway's origin. The only place in the surface layer a URL is named. */
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  /**
   * How the session is held.
   *   { email, password }                    password login; the token from the body is held in memory and sent as a bearer (devices, tests, non-browser clients)
   *   { email, password, session: "cookie" } password login; the body's token is DISCARDED — the browser holds the httpOnly cookie the gateway set
   *   { hardwareId, email, password }        S5 only — a technician's own credential plus the hardware in their hands (auth.deviceLogin); always bearer, held in memory. The web fallback IS the fallback, so its own session survives a reload with nothing else to hold a cookie's place.
   *   { token }                              a token already held (customer IdP exchange, device shift grant, resumed non-browser session)
   *   { session: "cookie" }                  resume a browser session: no login, the cookie is already there; `session.me` says who
   */
  readonly credentials:
    | { readonly email: string; readonly password: string; readonly session?: "bearer" | "cookie" }
    | { readonly hardwareId: string; readonly email: string; readonly password: string }
    | { readonly token: string }
    | { readonly session: "cookie" };
  readonly requestId?: () => string;
};

export type ConnectedShell = Shell & {
  /** The bearer token in force, for a non-browser surface to persist. Null in cookie-session mode — script never sees it. */
  readonly token: () => string | null;
  /**
   * Set only when connected with `{ hardwareId, email, password }` — the crew
   * `auth.deviceLogin` resolved for this shift. Null otherwise. S5 needs this
   * for anything it writes that carries a crew_id (a time entry), but it is
   * deliberately NOT a token claim (context.ts's own reasoning: a crew claim
   * on the token would be wrong the moment the shift grant is revoked, so the
   * principal carries none) — this is the one place a device-logged-in
   * surface can read it, from the login response itself, once, at connect.
   */
  readonly deviceCrew: { readonly id: string; readonly label: string } | null;
  /** Revoke the session at the gateway and forget the token. The next call with either is a `token` refusal (revoked). */
  logout(): Promise<void>;
};

/**
 * The gateway origin a surface names as `ConnectConfig.baseUrl`.
 *
 * A stamped `<meta name="ac-gateway">` wins. Otherwise the site after the
 * first dot talks to `api.<site>`: `s2.ac.example` → `https://api.ac.example`.
 * An empty host is left as written.
 *
 * `localFallback` is the dispatch console's loopback preview. Only then is an
 * empty host read as localhost, and only then do localhost, 127.0.0.1, ::1
 * and 127.* return that fallback. The other surfaces do not take it, and this
 * function does not read `hostname` unless it is set — a test document for
 * those surfaces has no hostname.
 */
export type GatewayDocument = {
  querySelector(sel: string): { getAttribute(n: string): string | null } | null;
  location: { protocol: string; host: string; hostname?: string };
};

export const gatewayOrigin = (doc: GatewayDocument, opts?: { readonly localFallback?: string }): string => {
  const stamped = doc.querySelector('meta[name="ac-gateway"]')?.getAttribute("content")?.trim();
  if (stamped) return stamped;
  if (opts?.localFallback !== undefined) {
    const host = doc.location.host || "localhost";
    const hostname = doc.location.hostname || host.split(":")[0] || "localhost";
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.startsWith("127.")) return opts.localFallback;
    const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
    return `${doc.location.protocol}//api.${site}`;
  }
  const host = doc.location.host;
  const site = host.includes(".") ? host.slice(host.indexOf(".") + 1) : host;
  return `${doc.location.protocol}//api.${site}`;
};

/**
 * login (if needed) → `session.me` → createShell with the resolved principal and
 * hierarchy context. The namespace and region checks in createShell run against
 * the principal the GATEWAY resolved, not one the surface asserted.
 */
export const connectShell = async (cfg: ConnectConfig): Promise<ConnectedShell> => {
  const c = cfg.credentials;
  const session: "bearer" | "cookie" = "session" in c && c.session === "cookie" ? "cookie" : "bearer";
  let token: string | null = "token" in c ? c.token : null;
  const raw = httpTransport({
    baseUrl: cfg.baseUrl, surfaceId: cfg.surfaceId, fetch: cfg.fetch, token: () => token, session,
    ...(cfg.requestId ? { requestId: cfg.requestId } : {}),
  });
  const bootstrap = createGatewayClient(raw);

  let deviceCrew: ConnectedShell["deviceCrew"] = null;
  if ("hardwareId" in c) {
    const login = await bootstrap.deviceLogin({ hardwareId: c.hardwareId, email: c.email, password: c.password });
    token = login.token;
    deviceCrew = { id: login.crewId, label: login.crewLabel };
  } else if ("email" in c) {
    const login = await bootstrap.login({ email: c.email, password: c.password, surface: cfg.surfaceId });
    // In cookie mode the browser now holds the httpOnly cookie; the body's token is not retained anywhere script can read.
    if (session === "bearer") token = login.token;
  }
  const context = await bootstrap.me();
  // A device session resumed by cookie — one S1's front door signed in — learns its crew from session.me.
  if (!deviceCrew && context.deviceCrew) deviceCrew = { id: context.deviceCrew.id, label: context.deviceCrew.label };
  const shell = createShell({ surfaceId: cfg.surfaceId, principal: context.principal, transport: raw, context });
  const logout = async () => {
    try { await shell.gateway.logout(); } finally { shell.close(); token = null; }
  };
  // Spread copies own enumerable symbol keys too, so the DEGRADED handle travels with it.
  return Object.freeze({ ...shell, token: () => token, deviceCrew, logout });
};

/**
 * S0 FOR THE FRONT DOOR — a surface with no session of its own.
 *
 * `connectShell` above is login → `session.me` → createShell. S1 does none of
 * it: it signs a person in to ANOTHER surface (auth.signIn mints that
 * surface's session and the browser follows the path it answers with), so S1
 * itself is never anybody. And the registry's degraded line rules out a
 * round trip at boot: the page renders whether or not the gateway answers.
 *
 * So the shell is CONSTRUCTED, not connected: the principal is the shared
 * anonymous constant in packages/contracts, the transport is live, and the
 * degraded flag is the transport's, exactly as everywhere else.
 */
export type AnonymousShell = Shell;

export type AnonymousConfig = {
  readonly surfaceId: SurfaceId;
  readonly baseUrl: string;
  readonly fetch: FetchLike;
  /** `"cookie"` for a browser (the session auth.signIn mints is an httpOnly cookie); bearer for tests and drives. */
  readonly session?: "bearer" | "cookie";
  readonly requestId?: () => string;
  readonly page?: unknown;
};

export const openAnonymousShell = (cfg: AnonymousConfig): AnonymousShell => {
  const surface = SURFACES[cfg.surfaceId];
  if (surface.namespace !== "anonymous") {
    throw new Error(
      `${surface.id} serves the ${surface.namespace} namespace; openAnonymousShell is for the anonymous one. ` +
      `A surface with a principal boots through connectShell, which resolves that principal at the gateway.`,
    );
  }
  const transport = httpTransport({
    baseUrl: cfg.baseUrl, surfaceId: cfg.surfaceId, fetch: cfg.fetch, token: () => null, session: cfg.session ?? "cookie",
    ...(cfg.requestId ? { requestId: cfg.requestId } : {}),
  });
  return createShell({
    surfaceId: cfg.surfaceId,
    principal: ANONYMOUS_PRINCIPAL,
    transport,
    ...(cfg.page !== undefined ? { page: cfg.page } : {}),
  });
};

export { applyBrand, fetchBrand, installBrand, type BrandSlot, type BrandConfig, type BrandResult } from "./brand.ts";
