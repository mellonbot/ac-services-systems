/**
 * THE DEMO GATEWAY — an in-memory stand-in for apps/gateway, for the clickable
 * demo only (tools/demo/build.ts). It answers the same catalogue
 * (packages/contracts/src/operations.ts) with the same wire shapes, so the
 * surfaces it serves are the real bundles, unmodified.
 *
 * What it is NOT: the product. Visibility here is a hand-written filter per
 * principal that imitates what migrations 0005–0009 enforce with RLS; the
 * real system never filters in a handler. Where a rule is the domain's own
 * (term resolution, override admission, the compliance gate, context
 * resolution) the real module is imported and run.
 *
 * The stand-in is split across model.ts (seed, visibility, events), handlers.ts
 * (the operation table) and sync.ts (offline replay). This file is the wire.
 */
import {
  OPERATIONS,
  routeKey,
  type OperationId,
} from "../../packages/contracts/src/operations.ts";
import {
  type SurfaceId,
} from "../../packages/contracts/src/surfaces.ts";
import {
  ANONYMOUS_PRINCIPAL_IDS,
} from "../../packages/contracts/src/scope.ts";
import {
  type EventEnvelope,
} from "../../packages/contracts/src/events.ts";
import {
  AdmissionRefused,
} from "../../packages/domain/src/inheritance/admit.ts";
import {
  buildContext,
} from "../../apps/gateway/src/context.ts";
import {
  MIN,
  HOUR,
  at,
  uid,
  Refused,
  crews,
  devices,
  users,
  type Session,
  cookieSessions,
  bearerSessions,
  liveSession,
  anonTokens,
  principalOf,
  mint,
  reader,
  listeners,
  log,
} from "./model.ts";
import { handlers as H, type Ctx } from "./handlers.ts";

export { DEMO_PASSWORD, PERSONAS, onActivity, eventFor } from "./model.ts";
export type { ActivityEntry } from "./model.ts";

// ---------------------------------------------------------------------------
// The wire. `handle` is what a surface frame's fetch reaches, by postMessage.
// ---------------------------------------------------------------------------
const ROUTES = new Map(Object.values(OPERATIONS).map((op) => [routeKey(op), op]));
export type WireRequest = { surface: SurfaceId; url: string; method: string; headers: Record<string, string>; body?: string };
export type WireResponse = { status: number; body: unknown };

let offline = false;
export const setOffline = (v: boolean) => { offline = v; };
export const isOffline = () => offline;

const sessionFor = (req: WireRequest): Session | null => {
  const auth = req.headers["authorization"] ?? "";
  if (auth.startsWith("Bearer ")) return bearerSessions.get(auth.slice(7)) ?? null;
  return cookieSessions.get(req.surface) ?? null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a log line reads whatever shape came back
const noteOf = (id: OperationId, input: any, out: any): string => {
  if (id === "auth.login" || id === "auth.deviceLogin") return `as ${input?.email ?? "?"}`;
  if (id === "session.me") return "who is signed in, and where they sit in the hierarchy";
  if (id === "pos.detail") return `${out.order.number}: ${out.lines.length} line${out.lines.length === 1 ? "" : "s"}, ${out.order.state}`;
  if (typeof out?.number === "string") return `→ ${out.number}`;
  if (id === "hq.metrics") return `${out.values.length} figures across ${out.regions.length} regions`;
  if (id === "hq.history") return `${input?.metric}: ${out.points.length} daily points`;
  if (out && typeof out === "object") {
    for (const k of ["nodes", "jobs", "crews", "firms", "contracts", "settlements", "credentials", "requests", "candidates", "rateCards", "regions", "organizations", "metros", "equipment", "contacts", "invoices", "lines", "outcomes"]) {
      if (Array.isArray(out[k])) return `${out[k].length} row${out[k].length === 1 ? "" : "s"}`;
    }
    if (out.ok === false && out.refusal) return `refused: ${out.refusal.reason} ${out.refusal.credentialKind}`;
    if (typeof out.id === "string") return `→ ${out.id.slice(0, 8)}`;
  }
  return "";
};

export const handle = async (req: WireRequest): Promise<WireResponse | "offline"> => {
  const url = new URL(req.url);
  const op = ROUTES.get(`${req.method} ${url.pathname}`);
  if (offline && op?.id !== "events.stream") { log({ surface: req.surface, op: op?.id ?? url.pathname, status: 0, note: "gateway unreachable", kind: "offline" }); return "offline"; }
  if (!op) return { status: 404, body: { error: "NoRoute", message: `no route ${req.method} ${url.pathname}` } };
  if (!(op.surfaces as readonly string[]).includes(req.surface)) return { status: 403, body: { error: "SurfaceNotServed", message: `${op.id} is not served to ${req.surface}` } };
  const input = op.carrier === "body" ? (req.body ? JSON.parse(req.body) : {}) : op.carrier === "query" ? Object.fromEntries(url.searchParams) : undefined;

  try {
    let out: unknown;
    if (op.id === "auth.login" || op.id === "auth.deviceLogin") {
      const i = input as { email: string; password: string; hardwareId?: string };
      const user = users.find((u) => u.email.toLowerCase() === (i.email ?? "").trim().toLowerCase() && u.password === i.password && u.surfaces.includes(req.surface));
      if (!user || (op.id === "auth.deviceLogin" && i.hardwareId?.trim() !== devices[0]!.hardwareId)) throw new Refused(401, "AuthError", "invalid credentials", "invalid_credentials");
      const s = mint(user);
      if (op.id === "auth.deviceLogin") { bearerSessions.set(s.token, s); liveSession.device = s; } else cookieSessions.set(req.surface, s);
      const ctx = await buildContext(principalOf(s), reader);
      const crew = user.crewId ? crews.find((c) => c.id === user.crewId)! : null;
      out = { token: s.token, expiresAt: at(8 * HOUR), context: { path: ctx.path, parent: ctx.parent, regions: ctx.regions, activeRegionId: ctx.activeRegionId }, ...(crew ? { crewId: crew.id, crewLabel: crew.label } : {}) };
    } else if (op.id === "auth.anonymousSession") {
      const token = `demo.anon.${uid("t")}`;
      anonTokens.set(token, Date.now() + 15 * MIN);
      liveSession.anonCookieExpires = Date.now() + 15 * MIN;
      out = { token, expiresAt: at(15 * MIN) };
    } else if (op.id === "auth.logout") {
      const s = sessionFor(req);
      if (!s) throw new Refused(401, "AuthError", "no session", "missing");
      if (bearerSessions.has(s.token)) { bearerSessions.delete(s.token); if (liveSession.device === s) liveSession.device = null; } else cookieSessions.delete(req.surface);
      out = { ok: true, sessionId: s.id };
    } else {
      const h = H[op.id];
      if (!h) return { status: 404, body: { error: "NoRoute", message: `${op.id} is not in the demo gateway` } };
      let ctx: Ctx;
      if (op.auth === "bearer" && req.surface !== "S1") {
        const s = sessionFor(req);
        if (!s) throw new Refused(401, "AuthError", "no session — sign in", "missing");
        ctx = { surface: req.surface, p: principalOf(s), session: s };
      } else {
        if (op.auth === "bearer") {
          // S1: the anonymous token from auth.anonymousSession, unexpired — never nothing at all.
          const auth = req.headers["authorization"] ?? "";
          const exp = auth.startsWith("Bearer ") ? anonTokens.get(auth.slice(7)) : liveSession.anonCookieExpires;
          if (exp === undefined || exp < Date.now()) throw new Refused(401, "AuthError", "no anonymous session — the page asks for one first", "missing");
        }
        ctx = { surface: req.surface, p: { namespace: "anonymous", subjectId: ANONYMOUS_PRINCIPAL_IDS.actor, orgId: ANONYMOUS_PRINCIPAL_IDS.org, regionId: ANONYMOUS_PRINCIPAL_IDS.region, scopeTier: "parent", scopeId: ANONYMOUS_PRINCIPAL_IDS.org, roles: [], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "anon" }, session: null };
      }
      out = await h(input, ctx);
    }
    const kind = op.kind === "mutation" || op.kind === "login" ? "write" : "read";
    if (op.id !== "system.health" && op.id !== "brand.theme") log({ surface: req.surface, op: op.id, status: 200, note: noteOf(op.id, input, out), kind: (out as { ok?: boolean })?.ok === false ? "refused" : kind });
    return { status: 200, body: out };
  } catch (e) {
    if (e instanceof Refused) {
      log({ surface: req.surface, op: op.id, status: e.status, note: e.code ?? e.message.slice(0, 60), kind: "refused" });
      return { status: e.status, body: { error: e.name2, code: e.code, message: e.message } };
    }
    if (e instanceof AdmissionRefused) {
      log({ surface: req.surface, op: op.id, status: 422, note: e.code, kind: "refused" });
      return { status: 422, body: { error: "AdmissionRefused", code: e.code, message: e.message } };
    }
    console.error(e);
    return { status: 500, body: { error: "InternalError", message: String((e as Error).message) } };
  }
};

/** An SSE subscription: the frame keeps its stream open; the gateway pushes envelopes to it. */
export const subscribe = (surface: SurfaceId, push: (e: EventEnvelope) => void): (() => void) => {
  const l = { surface, push };
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The demo's persona switch: replace the surface's cookie session, as a sign-in would. */
export const signInAs = (surface: SurfaceId, email: string): void => {
  const user = users.find((u) => u.email === email && u.surfaces.includes(surface));
  if (user) cookieSessions.set(surface, mint(user));
};
export const signedInAs = (surface: SurfaceId): string | null => cookieSessions.get(surface)?.user.email ?? null;
