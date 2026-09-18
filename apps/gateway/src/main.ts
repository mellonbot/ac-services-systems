import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createPool, beginTx, hierarchyReader, listenEvents } from "./pg-tx.ts";
import { generateKeypair, keypairFromPem, mintToken, verifyToken, principalFromClaims, verifyPassword, AuthError } from "./auth.ts";
import { buildContext, scopeBinding, ScopeResolutionError } from "./context.ts";
import { createUnitOfWork, SurfaceWriteDenied, TenancyMismatch, SurfaceDisabled, RoleDenied } from "./unit-of-work.ts";
import { InputRefused, BadInput, dbRefusal } from "./refusals.ts";
import { sessionConfigFromEnv, allowedOrigins, sessionCookie, clearedCookie, cookieToken, cors, applyHeaders } from "./session.ts";
import type { Tx } from "./unit-of-work.ts";
import { authorTermOverride, resolvedTermsAt } from "./handlers/terms.ts";
import { assignCrew, candidateCrews, releaseAssignment } from "./handlers/assignment.ts";
import { listRegions, listOrganizations, createOrganization, listAccounts, createAccount, moveAccount, updateAccount } from "./handlers/hierarchy.ts";
import { listContracts, createContract, transitionContract, listTermOverrides, termRegister } from "./handlers/contracts.ts";
import { listFirms, createFirm, updateFirm, listCrews, createCrew, updateCrew, listCredentials, recordCredential, verifyCredential, listRateCards, setRateCard } from "./handlers/network.ts";
import { ingestSync } from "./handlers/sync.ts";
import { setBrandTheme, brandStylesheetFor } from "./handlers/brand.ts";
import { createJob, listJobs, listMyJobs } from "./handlers/jobs.ts";
import { listDevices, registerDevice, grantDeviceShift, resolveDeviceLogin } from "./handlers/devices.ts";
import { createServiceRequest, listServiceRequests } from "./handlers/service-requests.ts";
import { AdmissionRefused } from "../../../packages/domain/src/inheritance/admit.ts";
import { ResolutionError } from "../../../packages/domain/src/inheritance/resolve.ts";
import { SURFACES, type SurfaceId } from "../../../packages/contracts/src/surfaces.ts";
import { OPERATIONS, OPERATION_IDS, routeKey, surfacesFor, type OperationId, type OperationIO } from "../../../packages/contracts/src/operations.ts";
import type { Claims, Namespace, Principal } from "../../../packages/contracts/src/scope.ts";
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
 *
 * THE ROUTE TABLE IS THE OPERATION CATALOGUE. `handlers` is typed over
 * OperationId, so a catalogue row without a handler fails typecheck and a
 * handler without a row cannot be keyed; tools/ci/schema-guard.ts checks the
 * same parity textually with no install. The generated SDK is emitted from
 * the same constant. There is no route that is not an operation, and no
 * operation a surface can call that is not a route.
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
const SESSION = sessionConfigFromEnv(process.env);
const ORIGINS = allowedOrigins(SESSION);
if (!SESSION.site) console.warn(`gateway: AC_SITE not set — development posture: cookies are not Secure and browser origins are ${ORIGINS.size ? [...ORIGINS].join(", ") : "NONE (bearer only)"}`);

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
  res.setHeader("content-type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/**
 * Every refusal has a status, a name, a code and a message a human can read.
 * 500 is reserved for bugs: the shell treats it as a transport failure and
 * flips the surface degraded, which is the right response to a bug and the
 * wrong response to a refused row — so a refused row must never be a 500.
 */
const describe = (e: unknown): { status: number; name: string; code?: string | undefined; message: string } => {
  const err = e as Error & { code?: string };
  if (e instanceof HttpError) return { status: e.status, name: err.name, message: err.message };
  if (e instanceof BadInput) return { status: 400, name: err.name, message: err.message };
  if (e instanceof AuthError) return { status: 401, name: err.name, code: err.code, message: err.message };
  if (e instanceof SurfaceWriteDenied || e instanceof TenancyMismatch || e instanceof ScopeResolutionError || e instanceof RoleDenied) return { status: 403, name: err.name, message: err.message };
  if (e instanceof SurfaceDisabled) return { status: 404, name: err.name, message: err.message };
  if (e instanceof AdmissionRefused || e instanceof ResolutionError || e instanceof InputRefused) return { status: 422, name: err.name, code: err.code, message: err.message };
  const db = dbRefusal(e);
  if (db) return db;
  return { status: 500, name: "InternalError", message: "internal error" };
};

/**
 * Who is calling, and how they proved it. A bearer header wins; otherwise the
 * `ac_session` cookie. `viaCookie` is remembered because a cookie principal
 * must name its surface (surfaceOf) — that requirement is the CSRF line.
 */
type Caller = { readonly principal: Principal; readonly viaCookie: boolean };
const callerOf = (req: IncomingMessage): Caller => {
  const auth = req.headers.authorization ?? "";
  if (auth.startsWith("Bearer ")) return { principal: principalFromClaims(verifyToken(auth.slice(7), keys, Date.now())), viaCookie: false };
  const fromCookie = cookieToken(req.headers.cookie);
  if (fromCookie) return { principal: principalFromClaims(verifyToken(fromCookie, keys, Date.now())), viaCookie: true };
  throw new AuthError("no bearer token and no session cookie", "malformed");
};

/**
 * A token is only valid while its session row is not revoked (schema: sessions).
 * Logout revokes; this is what makes logout mean something. One indexed read per
 * request, inside the request's own transaction.
 */
const assertSessionLive = async (tx: Tx, p: Principal): Promise<void> => {
  const row = (await tx.query<{ revoked_at: string | null; expires_at: string }>("SELECT revoked_at, expires_at FROM sessions WHERE id = $1", [p.sessionId]))[0];
  if (!row) throw new AuthError(`session ${p.sessionId} is unknown to this gateway`, "revoked");
  if (row.revoked_at) throw new AuthError(`session was ended at ${new Date(row.revoked_at).toISOString()} — sign in again`, "revoked");
};

/**
 * Which surface is this request made AS? The client sends `x-ac-surface`; it
 * must be one the operation admits and one that serves the principal's
 * namespace. Absent, and exactly one of the operation's surfaces serves the
 * namespace, that one is used. The header selects; the token authorizes —
 * the unit of work still checks the surface's roles and write allowlist.
 */
const surfaceOf = (req: IncomingMessage, opId: OperationId, { principal, viaCookie }: Caller): SurfaceId => {
  const admitted = surfacesFor(opId, (s) => SURFACES[s].namespace, principal.namespace);
  const claimed = req.headers["x-ac-surface"];
  // A cookie is attached by the browser, not by our code. The header is attached
  // by our code and cannot be set by a cross-site form or a simple request — so
  // its presence is what tells a cookie request apart from a forged one.
  if (viaCookie && !(typeof claimed === "string" && claimed.length > 0))
    throw new HttpError(403, `a session-cookie request must name its surface in x-ac-surface (CSRF: a cross-site request cannot set that header)`);
  if (typeof claimed === "string" && claimed.length > 0) {
    if (!(admitted as readonly string[]).includes(claimed)) {
      throw new HttpError(403, `${opId} is not served to ${claimed} for a ${principal.namespace} principal — admitted: [${OPERATIONS[opId].surfaces.join(", ")}]`);
    }
    return claimed as SurfaceId;
  }
  if (admitted.length === 1) return admitted[0]!;
  if (admitted.length === 0) throw new HttpError(403, `${opId} is not served to the ${principal.namespace} namespace`);
  // No header (curl, smoke tests — the generated client always sends one).
  // Narrow by role admission, which the unit of work would apply anyway.
  const byRole = admitted.filter((s) => { const r = SURFACES[s].roles; return !r || r.some((x) => principal.roles.includes(x)); });
  if (byRole.length === 1) return byRole[0]!;
  throw new HttpError(400, `${opId} is ambiguous for this principal — one of [${byRole.join(", ")}]; send x-ac-surface`);
};

/** Open a scope-bound unit of work for one request. Rolls back on any throw. */
const withUow = async <T>(req: IncomingMessage, opId: OperationId, fn: (uow: Awaited<ReturnType<typeof createUnitOfWork>>, principal: Principal, surfaceId: SurfaceId) => Promise<T>): Promise<T> => {
  const caller = callerOf(req);
  const { principal } = caller;
  const surfaceId = surfaceOf(req, opId, caller);
  const tx = await beginTx(pool, "ac_gateway");
  try { await assertSessionLive(tx, principal); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  const uow = await createUnitOfWork({ surfaceId, principal, requestId: String(req.headers["x-request-id"] ?? randomUUID()), now: () => new Date(), newId: randomUUID }, tx);
  try {
    const out = await fn(uow, principal, surfaceId);
    await uow.commit();
    return out;
  } catch (e) {
    await uow.rollback().catch(() => {});
    throw e;
  }
};

/** A read: same scope binding, same surface admission, always rolled back. */
const withRead = async <T>(req: IncomingMessage, opId: OperationId, fn: (uow: Awaited<ReturnType<typeof createUnitOfWork>>, principal: Principal, surfaceId: SurfaceId) => Promise<T>): Promise<T> => {
  const caller = callerOf(req);
  const { principal } = caller;
  const surfaceId = surfaceOf(req, opId, caller);
  const tx = await beginTx(pool, "ac_gateway");
  try { await assertSessionLive(tx, principal); } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  const uow = await createUnitOfWork({ surfaceId, principal, requestId: String(req.headers["x-request-id"] ?? randomUUID()), now: () => new Date(), newId: randomUUID }, tx);
  try { return await fn(uow, principal, surfaceId); } finally { await uow.rollback().catch(() => {}); }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const login = async (body: Partial<OperationIO["auth.login"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.login"]["output"]> => {
  const { email, password, surface } = body;
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
    // Hierarchy context, resolved at login, returned once — UNDER THE PRINCIPAL'S
    // OWN SCOPE. `accounts` is behind row-level security; unbound, the policy
    // sees no namespace and a customer's scope node "does not exist". Internal
    // principals never noticed (their walk reads `regions`, which has no
    // policy); the first location-scoped customer login would have been refused
    // at the door. Bound here as the unit of work binds it for every request after.
    const principal = principalFromClaims(minted.claims);
    await tx.setLocal(scopeBinding(principal, surface));
    const context = await buildContext(principal, hierarchyReader(tx));
    await tx.commit();
    const expiresAt = new Date(minted.claims.exp * 1000);
    // The browser gets the token as an httpOnly cookie it cannot read; the body
    // carries it too, for devices and tests, and a browser surface ignores it.
    res.setHeader("set-cookie", sessionCookie(minted.token, expiresAt, SESSION));
    return { token: minted.token, expiresAt: expiresAt.toISOString(), context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId } };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

/**
 * S5 → gateway: a technician's own credential plus the hardware in their
 * hands. Runs unscoped, the same as `login()` — there is no principal to
 * bind a transaction to yet. Where it differs: the claims it mints are not
 * the user's own tier, but the shift grant's — `resolveDeviceLogin` is the
 * one place that reads `devices` and `device_grants` before authentication,
 * exactly as `login` reads `users` before it.
 */
const deviceLogin = async (body: Partial<OperationIO["auth.deviceLogin"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.deviceLogin"]["output"]> => {
  const { hardwareId, email, password } = body;
  if (!hardwareId || !email || !password) throw new HttpError(400, "hardwareId, email and password are required");
  const tx = await beginTx(pool, "ac_gateway");
  try {
    const u = (await tx.query<{ id: string; password_hash: string | null; active: boolean; crew_id: string | null }>(
      "SELECT id, password_hash, active, crew_id FROM users WHERE email = $1", [email],
    ))[0];
    if (!u || !u.active || !u.password_hash || !verifyPassword(password, u.password_hash) || !u.crew_id) {
      throw new AuthError("invalid credentials", "bad_claims");
    }
    const resolved = await resolveDeviceLogin(tx, hardwareId, u.id, new Date());
    if (!resolved) throw new AuthError("invalid credentials", "bad_claims");

    const ttl = Math.min(TOKEN_TTL, Math.max(1, Math.floor((resolved.shiftEndsAt.getTime() - Date.now()) / 1000)));
    const claims: Omit<Claims, "iat" | "exp" | "sid"> = {
      sub: resolved.technicianId, ns: "device", org: resolved.orgId, region: resolved.regionId,
      scope_tier: "region", scope_id: resolved.regionId, roles: ["technician"],
      device: resolved.deviceId, shift: resolved.grantId,
    };
    const minted = mintToken(keypair, claims, Date.now(), ttl);
    await tx.query("INSERT INTO sessions (id, org_id, region_id, principal_kind, principal_id, expires_at, surface_id) VALUES ($1,$2,$3,'device_grant',$4,to_timestamp($5),'S5')",
      [minted.claims.sid, resolved.orgId, resolved.regionId, resolved.grantId, minted.claims.exp]);
    // The grant's tenancy is already bound (resolveDeviceLogin bound it to read the crew).
    const context = await buildContext(principalFromClaims(minted.claims), hierarchyReader(tx));
    await tx.commit();
    const expiresAt = new Date(minted.claims.exp * 1000);
    res.setHeader("set-cookie", sessionCookie(minted.token, expiresAt, SESSION));
    return {
      token: minted.token, expiresAt: expiresAt.toISOString(), crewId: resolved.crewId, crewLabel: resolved.crewLabel,
      context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId },
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

type Handler<K extends OperationId> = (req: IncomingMessage, input: OperationIO[K]["input"], res: ServerResponse) => Promise<unknown>;

const handlers: { readonly [K in OperationId]: Handler<K> } = {
  "auth.login": (_req, input, res) => login(input, res),
  "auth.deviceLogin": (_req, input, res) => deviceLogin(input, res),

  // Ending a session is the one mutation outside the unit of work: it writes the
  // sessions row, which belongs to the gateway, not to any surface's allowlist.
  "auth.logout": async (req, _input, res) => {
    const caller = callerOf(req);
    surfaceOf(req, "auth.logout", caller);
    const tx = await beginTx(pool, "ac_gateway");
    try {
      await assertSessionLive(tx, caller.principal);
      await tx.query("UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [caller.principal.sessionId]);
      await tx.commit();
    } catch (e) { await tx.rollback().catch(() => {}); throw e; }
    res.setHeader("set-cookie", clearedCookie(SESSION));
    return { ok: true, sessionId: caller.principal.sessionId };
  },

  "session.me": (req) => withRead(req, "session.me", (uow, p) => buildContext(p, hierarchyReader(uow.tx))),

  // S2 — author a contract term override. Refusals come back as 422 with the reason.
  "terms.authorOverride": (req, input) => withUow(req, "terms.authorOverride", async (uow, p) => {
    const ctx = await buildContext(p, hierarchyReader(uow.tx));
    return authorTermOverride(uow, ctx, { ...input, effectiveTo: input.effectiveTo ?? null });
  }),

  // S2/S6 — resolved terms at a node as of a date, with the trace.
  "terms.resolved": (req, input) => withRead(req, "terms.resolved", async (uow, p) => {
    const keys = input.termKeys ? input.termKeys.split(",").map((k) => k.trim()).filter(Boolean) : undefined;
    // A customer resolves its own agreements. RLS (0006) already makes another
    // org's rows absent; naming the org from the token as well means the
    // answer for a customer never depends on what the query string said.
    const orgId = p.namespace === "internal" ? (input.orgId ?? p.orgId) : p.orgId;
    const r = await resolvedTermsAt(uow, orgId, input.tier ?? "site", input.nodeId ?? "", input.asOf ?? new Date().toISOString().slice(0, 10), keys);
    return { resolved: r.resolved, refused: Object.fromEntries(Object.entries(r.refused).map(([k, e]) => [k, { code: e.code, message: e.message }])) };
  }),

  // C1 — the hierarchy S2 authors. Structure is the trigger's to refuse; inputs are the handler's.
  "regions.list": (req) => withRead(req, "regions.list", (uow) => listRegions(uow)),
  "organizations.list": (req, input) => withRead(req, "organizations.list", (uow) => listOrganizations(uow, input)),
  "organizations.create": (req, input) => withUow(req, "organizations.create", (uow) => createOrganization(uow, input, randomUUID)),
  "accounts.list": (req, input) => withRead(req, "accounts.list", (uow, p) => listAccounts(uow, p.namespace === "internal" ? input.orgId : p.orgId)),
  "accounts.create": (req, input) => withUow(req, "accounts.create", (uow) => createAccount(uow, input, randomUUID)),
  "accounts.move": (req, input) => withUow(req, "accounts.move", (uow) => moveAccount(uow, input)),
  "accounts.update": (req, input) => withUow(req, "accounts.update", (uow) => updateAccount(uow, input)),

  // C2 — the agreements those nodes are served under, and the register the
  // override form is drawn from. The scope's existence at its declared tier is
  // ac_contract_scope_exists's to refuse, in its own words.
  "contracts.list": (req, input) => withRead(req, "contracts.list", (uow, p) => listContracts(uow, p.namespace === "internal" ? input : { ...input, orgId: p.orgId })),
  "contracts.create": (req, input) => withUow(req, "contracts.create", (uow) => createContract(uow, input, randomUUID)),
  "contracts.transition": (req, input) => withUow(req, "contracts.transition", (uow) => transitionContract(uow, input)),
  "terms.overrides.list": (req, input) => withRead(req, "terms.overrides.list", (uow) => listTermOverrides(uow, input)),
  // The register is code, not a row. No transaction is opened for it; the read
  // scope exists so the answer is still behind a live session.
  "terms.register": (req) => withRead(req, "terms.register", async () => termRegister()),

  // C4 — the subcontractor network: firm, crew, document, price. Reads are
  // served to S8 too and RLS makes "its own" true; writes are S2's. Whether a
  // verification is S2's and once is ac_credential_verification_is_earned's.
  "firms.list": (req, input) => withRead(req, "firms.list", (uow) => listFirms(uow, input)),
  "firms.create": (req, input) => withUow(req, "firms.create", (uow) => createFirm(uow, input, randomUUID)),
  "firms.update": (req, input) => withUow(req, "firms.update", (uow) => updateFirm(uow, input)),
  "crews.list": (req, input) => withRead(req, "crews.list", (uow) => listCrews(uow, input, new Date().toISOString().slice(0, 10))),
  "crews.create": (req, input) => withUow(req, "crews.create", (uow) => createCrew(uow, input, randomUUID)),
  "crews.update": (req, input) => withUow(req, "crews.update", (uow) => updateCrew(uow, input)),
  "credentials.list": (req, input) => withRead(req, "credentials.list", (uow) => listCredentials(uow, input)),
  "credentials.record": (req, input) => withUow(req, "credentials.record", (uow) => recordCredential(uow, input, randomUUID)),
  "credentials.verify": (req, input) => withUow(req, "credentials.verify", (uow, p) => verifyCredential(uow, input, p.subjectId, new Date())),
  "rateCards.list": (req, input) => withRead(req, "rateCards.list", (uow) => listRateCards(uow, input)),
  "rateCards.set": (req, input) => withUow(req, "rateCards.set", (uow) => setRateCard(uow, input, randomUUID)),

  // item 4 — the job itself, created in Office & Dispatch.
  "jobs.create": (req, input) => withUow(req, "jobs.create", (uow) => createJob(uow, input, randomUUID, new Date())),
  "jobs.list": (req, input) => withRead(req, "jobs.list", (uow) => listJobs(uow, input.state)),

  // item 6 — S6's first write, and the office's read of it.
  "serviceRequests.create": (req, input) => withUow(req, "serviceRequests.create", (uow, p) => createServiceRequest(uow, p.subjectId, input, randomUUID)),
  "serviceRequests.list": (req, input) => withRead(req, "serviceRequests.list", (uow) => listServiceRequests(uow, input)),

  // S3 — the one gated door, its dry run, and its release.
  "dispatch.assign": (req, input) => withUow(req, "dispatch.assign", (uow, p) => assignCrew(uow, p.subjectId, input, new Date())),
  "dispatch.candidates": (req, input) => withRead(req, "dispatch.candidates", (uow) => candidateCrews(uow, input, new Date())),
  "dispatch.release": (req, input) => withUow(req, "dispatch.release", (uow, p) => releaseAssignment(uow, p.subjectId, input, new Date())),

  // item 4 — D-2a's primitive: this device, this crew, this window.
  "devices.list": (req, input) => withRead(req, "devices.list", (uow) => listDevices(uow, input)),
  "devices.register": (req, input) => withUow(req, "devices.register", (uow) => registerDevice(uow, input, randomUUID)),
  "devices.grantShift": (req, input) => withUow(req, "devices.grantShift", (uow, p) => grantDeviceShift(uow, p.subjectId, input, randomUUID)),

  // S5 — what a technician reads before replaying a sync batch, and the replay itself.
  "jobs.mine": (req) => withRead(req, "jobs.mine", (uow, p) => {
    if (!p.shiftId) throw new HttpError(403, "jobs.mine is a device principal's operation");
    return listMyJobs(uow, p.shiftId);
  }),
  "sync.replay": (req, input) => withUow(req, "sync.replay", async (uow, p) => {
    if (!p.deviceId) throw new HttpError(403, "sync is a device principal's operation");
    return { outcomes: await ingestSync(uow, p.subjectId, { deviceId: p.deviceId, orgId: input.orgId, regionId: input.regionId, mutations: input.mutations }, new Date()) };
  }),

  // The SSE feed: one LISTEN client on the pool, fan-out per connected principal's region.
  "events.stream": async (req, _input, res) => {
    const caller = callerOf(req);
    const p = caller.principal;
    surfaceOf(req, "events.stream", caller);
    { const tx = await beginTx(pool, "ac_gateway"); try { await assertSessionLive(tx, p); } finally { await tx.rollback().catch(() => {}); } }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    // Headers are not on the wire until the first byte. A subscriber's fetch()
    // does not resolve — and the shell cannot report "open" — until then.
    res.write(`: connected ${p.regionId}\n\n`);
    const client = { res, regionId: p.regionId, orgScoped: p.namespace === "internal" && p.scopeTier === "parent" };
    sseClients.add(client);
    req.on("close", () => sseClients.delete(client));
    return STREAMING;
  },

  // S2 — store a tenant's white-label. Validated against the ink schedule before
  // it is a row; a theme that would break the portal is a 422 with the ratio.
  "brand.setTheme": (req, input) => withUow(req, "brand.setTheme", (uow, p) => setBrandTheme(uow, p.subjectId, input)),

  /**
   * The one read with no principal behind it, and the reason is the product's:
   * a customer portal is branded on its SIGN-IN screen. There is no token yet,
   * no session to assert live, and no scope to bind — so this opens its own
   * unscoped transaction the way login does, reads one indexed row by host, and
   * rolls back.
   *
   * It is safe to leave open because it answers the same shape for every host:
   * a known one gets its stylesheet, an unknown one gets Rankine's plate and
   * `tenant: false`. Nothing here distinguishes "not a customer" from "no theme
   * set", so the route cannot be walked to enumerate tenants. A theme is public
   * by construction anyway — it is the colours on a page anyone can load.
   */
  "brand.theme": async (req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    // The query wins so a surface can ask on behalf of the host it is served
    // from; the Host header is the fallback for a portal on its own domain.
    const host = url.searchParams.get("host") ?? req.headers.host;
    const tx = await beginTx(pool, "ac_gateway");
    try { return await brandStylesheetFor(tx, host ?? undefined); } finally { await tx.rollback().catch(() => {}); }
  },

  "system.health": async () => ({ ok: true, surfaces: Object.values(SURFACES).filter((s) => s.enabled).map((s) => s.id) }),
};

/** Sentinel: the handler owns the response and the dispatcher must not write one. */
const STREAMING = Symbol("streaming");

/** `METHOD /path` → operation id. Built from the catalogue; a route not in the catalogue does not exist. */
const ROUTES: ReadonlyMap<string, OperationId> = new Map(OPERATION_IDS.map((id) => [routeKey(OPERATIONS[id]), id]));

/** Read an operation's input from where the catalogue says it travels. */
const inputOf = async (req: IncomingMessage, url: URL, opId: OperationId): Promise<unknown> => {
  switch (OPERATIONS[opId].carrier) {
    case "body": return readJson(req);
    case "query": return Object.fromEntries(url.searchParams.entries());
    case "none": return undefined;
  }
};

const sseClients = new Set<{ res: ServerResponse; regionId: string; orgScoped: boolean }>();
await listenEvents(DATABASE_URL, (payload) => {
  const env = JSON.parse(payload) as { regionId: string };
  for (const c of sseClients) {
    if (c.orgScoped || c.regionId === env.regionId) c.res.write(`event: domain\ndata: ${payload}\n\n`);
  }
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  // CORS first, on every response including refusals and the stream: a browser
  // surface at a listed origin gets the credentialed allow-headers; anyone else
  // gets `Vary: Origin` and nothing, and the browser refuses on its side.
  const c = cors(req, ORIGINS);
  applyHeaders(res, c.headers);
  if (req.method === "OPTIONS") {
    res.writeHead(c.allowed ? 204 : 403);
    return res.end();
  }
  const opId = ROUTES.get(`${req.method} ${url.pathname}`);
  try {
    if (!opId) return send(res, 404, { error: "NoRoute", message: `no route ${req.method} ${url.pathname} — not in the operation catalogue` });
    const input = await inputOf(req, url, opId);
    const out = await (handlers[opId] as Handler<OperationId>)(req, input as never, res);
    if (out !== STREAMING) send(res, 200, out);
  } catch (e) {
    const d = describe(e);
    if (d.status === 500) console.error(e);
    send(res, d.status, { error: d.name, code: d.code, message: d.message });
  }
});

server.listen(PORT, () => console.log(`gateway listening on :${PORT} — the sole access path`));
