import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createPool, beginTx, hierarchyReader, listenEvents } from "./pg-tx.ts";
import { generateKeypair, keypairFromPem, mintToken, verifyToken, principalFromClaims, verifyPassword, AuthError } from "./auth.ts";
import { buildContext, ScopeResolutionError } from "./context.ts";
import { createUnitOfWork, SurfaceWriteDenied, TenancyMismatch, SurfaceDisabled, RoleDenied } from "./unit-of-work.ts";
import { authorTermOverride, resolvedTermsAt } from "./handlers/terms.ts";
import { assignCrew } from "./handlers/assignment.ts";
import { ingestSync } from "./handlers/sync.ts";
import { AdmissionRefused } from "../../../packages/domain/src/inheritance/admit.ts";
import { ResolutionError } from "../../../packages/domain/src/inheritance/resolve.ts";
import { SURFACES, type SurfaceId } from "../../../packages/contracts/src/surfaces.ts";
import type { Claims, Namespace } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";

/**
 * THE GATEWAY — B3. The sole access path.
 *
 * Every route below: verify token → principal → open a unit of work for the
 * declared surface → handler → commit. The handler never sees a connection;
 * it sees a Tx that is already scope-bound. There is no route that bypasses
 * the unit of work, because there is no other way to get a Tx.
 *
 * Phase 1 transport is plain node:http + JSON, and SSE for the event stream.
 * A framework would add nothing the frame needs and one more place a
 * middleware could be forgotten.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const PORT = Number(process.env.PORT ?? 8080);
const TOKEN_TTL = Number(process.env.TOKEN_TTL_SECONDS ?? 8 * 3600);

const keypair = process.env.AC_SIGNING_KEY_PEM
  ? keypairFromPem(process.env.AC_SIGNING_KEY_PEM, process.env.AC_SIGNING_KID ?? "k1")
  : generateKeypair("ephemeral");
if (keypair.kid === "ephemeral") console.warn("gateway: AC_SIGNING_KEY_PEM not set — tokens die with this process");
const keys = new Map([[keypair.kid, keypair.publicKey]]);
const pool = createPool(DATABASE_URL);

type Json = Record<string, unknown>;
const readJson = (req: IncomingMessage): Promise<Json> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const statusFor = (e: unknown): number => {
  if (e instanceof HttpError) return e.status;
  if (e instanceof AuthError) return 401;
  if (e instanceof SurfaceWriteDenied || e instanceof TenancyMismatch || e instanceof ScopeResolutionError || e instanceof RoleDenied) return 403;
  if (e instanceof SurfaceDisabled) return 404;
  if (e instanceof AdmissionRefused || e instanceof ResolutionError) return 422;
  return 500;
};

const principalOf = (req: IncomingMessage) => {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer ")) throw new AuthError("no bearer token", "malformed");
  return principalFromClaims(verifyToken(auth.slice(7), keys, Date.now()));
};

/** Open a scope-bound unit of work for one request. Rolls back on any throw. */
const withUow = async <T>(req: IncomingMessage, surfaceId: SurfaceId, fn: (uow: Awaited<ReturnType<typeof createUnitOfWork>>, principal: ReturnType<typeof principalOf>) => Promise<T>): Promise<T> => {
  const principal = principalOf(req);
  const tx = await beginTx(pool, "ac_gateway");
  const uow = await createUnitOfWork({ surfaceId, principal, requestId: String(req.headers["x-request-id"] ?? randomUUID()), now: () => new Date(), newId: randomUUID }, tx);
  try {
    const out = await fn(uow, principal);
    await uow.commit();
    return out;
  } catch (e) {
    await uow.rollback().catch(() => {});
    throw e;
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const login = async (body: Json) => {
  const { email, password, surface } = body as { email?: string; password?: string; surface?: SurfaceId };
  if (!email || !password || !surface || !SURFACES[surface]) throw new HttpError(400, "email, password and surface are required");
  // Login runs unscoped (no principal yet) as the gateway role; users is not RLS-bound.
  const tx = await beginTx(pool, "ac_gateway");
  try {
    const u = (await tx.query<{ id: string; namespace: Namespace; org_id: string; region_id: string; scope_tier: Tier; scope_id: string; roles: string[]; firm_id: string | null; password_hash: string | null; active: boolean }>(
      "SELECT id, namespace, org_id, region_id, scope_tier, scope_id, roles, firm_id, password_hash, active FROM users WHERE email = $1", [email],
    ))[0];
    if (!u || !u.active || !u.password_hash || !verifyPassword(password, u.password_hash)) throw new AuthError("invalid credentials", "bad_claims");
    if (SURFACES[surface].namespace !== u.namespace) throw new HttpError(403, `${surface} serves the ${SURFACES[surface].namespace} namespace`);
    const claims: Omit<Claims, "iat" | "exp" | "sid"> = {
      sub: u.id, ns: u.namespace, org: u.org_id, region: u.region_id, scope_tier: u.scope_tier, scope_id: u.scope_id, roles: u.roles,
      ...(u.firm_id ? { firm: u.firm_id } : {}),
    };
    const minted = mintToken(keypair, claims, Date.now(), TOKEN_TTL);
    await tx.query("INSERT INTO sessions (id, org_id, region_id, principal_kind, principal_id, expires_at, surface_id) VALUES ($1,$2,$3,'user',$4,to_timestamp($5),$6)",
      [minted.claims.sid, u.org_id === INTERNAL_ORG_ID ? INTERNAL_ORG_ID : u.org_id, u.region_id, u.id, minted.claims.exp, surface]);
    // Hierarchy context, resolved at login, returned once.
    const context = await buildContext(principalFromClaims(minted.claims), hierarchyReader(tx));
    await tx.commit();
    return { token: minted.token, expiresAt: new Date(minted.claims.exp * 1000).toISOString(), context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId } };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

const routes: Record<string, (req: IncomingMessage, body: Json, url: URL) => Promise<unknown>> = {
  "POST /auth/login": (_req, body) => login(body),

  "GET /me": async (req) => {
    const principal = principalOf(req);
    const tx = await beginTx(pool, "ac_gateway");
    try { return await buildContext(principal, hierarchyReader(tx)); } finally { await tx.rollback(); }
  },

  // S2 — author a contract term override. Refusals come back as 422 with the reason.
  "POST /s2/terms/override": (req, body) => withUow(req, "S2", async (uow, p) => {
    const ctx = await buildContext(p, hierarchyReader(uow.tx));
    const b = body as { contractId: string; scopeTier: Tier; scopeId: string; termKey: string; termValue: unknown; effectiveFrom: string; effectiveTo?: string | null; orgId: string; regionId: string };
    return authorTermOverride(uow, ctx, { ...b, effectiveTo: b.effectiveTo ?? null });
  }),

  // S2/S6 — resolved terms at a node as of a date, with the trace.
  "GET /terms/resolved": async (req, _body, url) => {
    const principal = principalOf(req);
    const tx = await beginTx(pool, "ac_gateway");
    const uow = await createUnitOfWork({ surfaceId: principal.namespace === "customer" ? "S6" : "S2", principal, requestId: randomUUID(), now: () => new Date(), newId: randomUUID }, tx);
    try {
      const q = url.searchParams;
      const r = await resolvedTermsAt(uow, q.get("orgId") ?? principal.orgId, (q.get("tier") ?? "site") as Tier, q.get("nodeId") ?? "", q.get("asOf") ?? new Date().toISOString().slice(0, 10));
      return { resolved: r.resolved, refused: Object.fromEntries(Object.entries(r.refused).map(([k, e]) => [k, { code: e.code, message: e.message }])) };
    } finally { await uow.rollback(); }
  },

  // S3 — the one gated door.
  "POST /s3/assign": (req, body) => withUow(req, "S3", async (uow, p) => {
    const b = body as { jobId: string; crewId: string; orgId: string; regionId: string };
    return assignCrew(uow, p.subjectId, b, new Date());
  }),

  // S5 — replay a device log.
  "POST /s5/sync": (req, body) => withUow(req, "S5", async (uow, p) => {
    if (!p.deviceId) throw new HttpError(403, "sync is a device principal's operation");
    const b = body as { orgId: string; regionId: string; mutations: Parameters<typeof ingestSync>[2]["mutations"] };
    return { outcomes: await ingestSync(uow, p.subjectId, { deviceId: p.deviceId, orgId: b.orgId, regionId: b.regionId, mutations: b.mutations }, new Date()) };
  }),
};

// SSE event stream: one LISTEN client, fan out per connected principal's region.
const sseClients = new Set<{ res: ServerResponse; regionId: string; orgScoped: boolean }>();
await listenEvents(DATABASE_URL, (payload) => {
  const env = JSON.parse(payload) as { regionId: string };
  for (const c of sseClients) {
    if (c.orgScoped || c.regionId === env.regionId) c.res.write(`event: domain\ndata: ${payload}\n\n`);
  }
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const key = `${req.method} ${url.pathname}`;
  try {
    if (key === "GET /events") {
      const p = principalOf(req);
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const client = { res, regionId: p.regionId, orgScoped: p.namespace === "internal" && p.scopeTier === "parent" };
      sseClients.add(client);
      req.on("close", () => sseClients.delete(client));
      return;
    }
    if (key === "GET /healthz") return send(res, 200, { ok: true, surfaces: Object.values(SURFACES).filter((s) => s.enabled).map((s) => s.id) });
    const route = routes[key];
    if (!route) return send(res, 404, { error: `no route ${key}` });
    const body = req.method === "POST" ? await readJson(req) : {};
    send(res, 200, await route(req, body, url));
  } catch (e) {
    const status = statusFor(e);
    const err = e as Error & { code?: string };
    if (status === 500) console.error(err);
    send(res, status, { error: err.name, code: err.code, message: status === 500 ? "internal error" : err.message });
  }
});

server.listen(PORT, () => console.log(`gateway listening on :${PORT} — the sole access path`));
