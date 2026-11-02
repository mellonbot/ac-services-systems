import type { IncomingMessage, ServerResponse } from "node:http";
import { beginTx, bindSystem, hierarchyReader } from "../db/pg-tx.ts";
import { mintToken, principalFromClaims, verifyPasswordAsync, AuthError } from "./auth.ts";
import { buildContext, scopeBinding } from "../http/context.ts";
import { SurfaceDisabled, SurfaceNotLive, type Tx } from "../db/unit-of-work.ts";
import { sessionCookie } from "./session.ts";
import { assertLive } from "../db/open-tx.ts";
import { HttpError } from "../http/http.ts";
import { SESSION, TOKEN_TTL, keypair, pool, signInAllowed, signInFailed, throttled } from "../env.ts";
import { resolveDeviceLogin } from "../handlers/devices.ts";
import { SURFACES, SURFACE_IDS, SURFACE_PATHS, admits, type SurfaceId } from "../../../../packages/contracts/src/surfaces.ts";
import type { OperationIO } from "../../../../packages/contracts/src/operations.ts";
import type { Claims, Namespace } from "../../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../../packages/contracts/src/tiers.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

type UserRow = {
  id: string; namespace: Namespace; org_id: string; region_id: string; scope_tier: Tier; scope_id: string;
  roles: string[]; firm_id: string | null; password_hash: string | null; active: boolean; crew_id: string | null;
};

/**
 * The one credential check every sign-in makes, run as the gateway itself (no
 * principal yet). A wrong password, an unknown address and a disabled login
 * all answer the same words, and all count against the address.
 */
const checkedUser = async (req: IncomingMessage, tx: Tx, email: string, password: string): Promise<UserRow> => {
  const who = email.toLowerCase();
  const u = (await tx.query<UserRow>(
    "SELECT id, namespace, org_id, region_id, scope_tier, scope_id, roles, firm_id, password_hash, active, crew_id FROM users WHERE email = $1", [email],
  ))[0];
  // OPEN-S6-IDP: federation, when a customer's IdP exists to test against,
  // replaces this password check and nothing downstream of the token.
  // users.external_idp_subject is the column that mapping lands in.
  if (!(await verifyPasswordAsync(password, u?.password_hash)) || !u?.active) {
    signInFailed(req, who);
    throw new AuthError("invalid credentials", "bad_claims");
  }
  return u;
};

/**
 * Why `surface` will not open a session for this login, or null when it will.
 * `login` throws the answer; `signIn` uses it to find where a person belongs.
 * One function, so the front door can never offer a surface the door behind
 * it would refuse.
 */
const refusalFor = (surface: SurfaceId, u: UserRow): Error | null => {
  if (!SURFACES[surface].enabled) return new SurfaceDisabled(surface);
  try { assertLive(surface); } catch (e) { return e as Error; }
  if (SURFACES[surface].namespace !== u.namespace) return new HttpError(403, `${surface} serves the ${SURFACES[surface].namespace} namespace`);
  // The role check the unit of work makes on every request, made at the door:
  // a login no request on this surface would admit is not given a session.
  if (!admits(surface, { namespace: u.namespace, roles: u.roles })) {
    return new HttpError(403, `${surface} admits [${SURFACES[surface].roles?.join(", ")}]; this login holds [${u.roles.join(", ") || "—"}]`);
  }
  // And the scope check: an org-wide surface is not given to a login scoped to one region.
  if (SURFACES[surface].scopeBinding === "org" && u.scope_tier !== "parent") {
    return new HttpError(403, `${surface} is org-wide; this login is scoped to one ${u.scope_tier}`);
  }
  return null;
};

/** Mint a password session on `surface` — the caller has already asked `refusalFor`. */
/** The session cookie a sign-in has minted, handed to the browser only after its row is committed. */
type Issue = (cookie: string) => void;

const mintUserSession = async (tx: Tx, u: UserRow, surface: SurfaceId, issue: Issue): Promise<OperationIO["auth.login"]["output"]> => {
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
  const expiresAt = new Date(minted.claims.exp * 1000);
  // The browser gets the token as an httpOnly cookie it cannot read; the body
  // carries it too, for devices and tests, and a browser surface ignores it.
  issue(sessionCookie(minted.token, expiresAt, SESSION));
  return { token: minted.token, expiresAt: expiresAt.toISOString(), context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId, segment: context.segment ?? null } };
};

/**
 * Mint a shift session on S5. The claims are not the user's own tier but the
 * shift grant's — `resolveDeviceLogin` is the one place that reads `devices`
 * and `device_grants` before authentication, exactly as `checkedUser` reads
 * `users` before it. No crew, no device, no live grant: "invalid credentials",
 * whichever it was.
 */
const mintDeviceSession = async (tx: Tx, u: UserRow, hardwareId: string, issue: Issue): Promise<OperationIO["auth.deviceLogin"]["output"]> => {
  assertLive("S5");
  if (!u.crew_id) throw new AuthError("invalid credentials", "bad_claims");
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
  const expiresAt = new Date(minted.claims.exp * 1000);
  issue(sessionCookie(minted.token, expiresAt, SESSION));
  return {
    token: minted.token, expiresAt: expiresAt.toISOString(), crewId: resolved.crewId, crewLabel: resolved.crewLabel,
    context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId, segment: context.segment ?? null },
  };
};

/**
 * One transaction for a sign-in: begun as the gateway, committed on success,
 * rolled back on anything else. The cookie goes on the response only AFTER the
 * commit: a cookie for a session row that never landed would replace whatever
 * good session the browser held and sign the person out of everything.
 */
const inSignInTx = async <T>(res: ServerResponse, fn: (tx: Tx, issue: Issue) => Promise<T>): Promise<T> => {
  const tx = await beginTx(pool, "ac_gateway");
  let cookie: string | null = null;
  try {
    await bindSystem(tx);
    const out = await fn(tx, (c) => { cookie = c; });
    await tx.commit();
    if (cookie) res.setHeader("set-cookie", cookie);
    return out;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

export const login = async (req: IncomingMessage, body: Partial<OperationIO["auth.login"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.login"]["output"]> => {
  const { email, password, surface } = body;
  if (!email || !password || !surface || !SURFACES[surface]) throw new HttpError(400, "email, password and surface are required");
  // The per-address count was taken before the body was read (beforeBody).
  throttled(signInAllowed(req, String(email).toLowerCase()), "sign-in attempts");
  return inSignInTx(res, async (tx, issue) => {
    const u = await checkedUser(req, tx, String(email), password);
    const refusal = refusalFor(surface, u);
    if (refusal) throw refusal;
    return mintUserSession(tx, u, surface, issue);
  });
};

/** S5 → gateway: a technician's own credential plus the hardware in their hands. */
export const deviceLogin = async (req: IncomingMessage, body: Partial<OperationIO["auth.deviceLogin"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.deviceLogin"]["output"]> => {
  const { hardwareId, email, password } = body;
  if (!hardwareId || !email || !password) throw new HttpError(400, "hardwareId, email and password are required");
  // The per-address count was taken before the body was read (beforeBody).
  throttled(signInAllowed(req, String(email).toLowerCase()), "sign-in attempts");
  return inSignInTx(res, async (tx, issue) => mintDeviceSession(tx, await checkedUser(req, tx, String(email), password), hardwareId, issue));
};

/** Where a surface lives on the site, as a link the browser follows. */
const destination = (id: SurfaceId) => ({ surface: id, name: SURFACES[id].name, path: `${SURFACE_PATHS[id]}/` });

/**
 * S1 → gateway: THE FRONT DOOR. One form for everyone, and the gateway, not
 * the page, decides where the person belongs — because the gateway is the
 * only party that knows which surfaces a login may open, and it already
 * answers that question at every other door (`refusalFor`).
 *
 *   hardwareId given     → S5, exactly as `auth.deviceLogin`
 *   `surface` given      → that surface, if it is one this login may open
 *   one surface opens    → that one
 *   several open         → `choose`, with no session minted; the page asks,
 *                          then signs in again naming one
 *   none open            → a refusal that says why in the person's words
 *
 * The answers that say more than "invalid credentials" are given only after
 * the password has been checked, so they tell a stranger nothing.
 */
export const signIn = async (req: IncomingMessage, body: Partial<OperationIO["auth.signIn"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.signIn"]["output"]> => {
  const { email, password, hardwareId, surface } = body;
  if (!email || !password) throw new HttpError(400, "email and password are required");
  if (surface !== undefined && (typeof surface !== "string" || !SURFACES[surface] || surface === "S1")) throw new HttpError(400, `${String(surface)} is not a surface a person signs in to`);
  // The per-address count was taken before the body was read (beforeBody).
  throttled(signInAllowed(req, String(email).toLowerCase()), "sign-in attempts");
  return inSignInTx(res, async (tx, issue): Promise<OperationIO["auth.signIn"]["output"]> => {
    const u = await checkedUser(req, tx, String(email), password);
    if (hardwareId) {
      const out = await mintDeviceSession(tx, u, hardwareId, issue);
      return { kind: "signed_in", ...pathTo("S5"), token: out.token, expiresAt: out.expiresAt };
    }
    const open = SURFACE_IDS.filter((id) => id !== "S1" && refusalFor(id, u) === null);
    if (surface) {
      const refusal = refusalFor(surface, u);
      if (refusal) throw refusal;
    }
    const target = surface ?? (open.length === 1 ? open[0] : undefined);
    if (target) {
      const out = await mintUserSession(tx, u, target, issue);
      return { kind: "signed_in", ...pathTo(target), token: out.token, expiresAt: out.expiresAt };
    }
    if (open.length > 1) return { kind: "choose", choices: open.map(destination) };
    // A technician — on a crew, or holding the role before the office has put them on one — signs in on a device.
    if (u.crew_id || u.roles.includes("technician")) throw new HttpError(403, "This login signs in on a field device. Choose “Signing in on a field device” and enter the device ID.");
    // "Not open yet" only when the ONE thing standing between this login and a surface is the rollout — never for a scope that will not change.
    const notYet = SURFACE_IDS.some((id) => id !== "S1" && refusalFor(id, u) instanceof SurfaceNotLive);
    throw new HttpError(403, notYet ? "Your portal is not open yet." : "No portal is set up for this login yet. Ask the office.");
  });
};

const pathTo = (id: SurfaceId) => ({ surface: id, path: `${SURFACE_PATHS[id]}/` });
