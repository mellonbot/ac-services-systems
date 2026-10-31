import type { IncomingMessage, ServerResponse } from "node:http";
import { beginTx, bindSystem, hierarchyReader } from "./pg-tx.ts";
import { mintToken, verifyToken, principalFromClaims, verifyPasswordAsync, AuthError } from "./auth.ts";
import { buildContext, scopeBinding } from "./context.ts";
import { SurfaceDisabled } from "./unit-of-work.ts";
import { cookieToken, sessionCookie } from "./session.ts";
import { assertLive, assertSessionLive } from "./open-tx.ts";
import { HttpError } from "./http.ts";
import {
  ANONYMOUS_ACTOR, ANONYMOUS_TTL, SESSION, TOKEN_TTL, keypair, keys, pool, signInAllowed, signInFailed, throttled,
} from "./env.ts";
import { resolveDeviceLogin } from "./handlers/devices.ts";
import { SURFACES, admits } from "../../../packages/contracts/src/surfaces.ts";
import type { OperationIO } from "../../../packages/contracts/src/operations.ts";
import type { Claims, Namespace, Principal } from "../../../packages/contracts/src/scope.ts";
import type { Tier } from "../../../packages/contracts/src/tiers.ts";
import { INTERNAL_ORG_ID, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../../packages/schema/src/tenancy.ts";

export const login = async (req: IncomingMessage, body: Partial<OperationIO["auth.login"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.login"]["output"]> => {
  const { email, password, surface } = body;
  if (!email || !password || !surface || !SURFACES[surface]) throw new HttpError(400, "email, password and surface are required");
  const who = String(email).toLowerCase();
  // The per-address count was taken before the body was read (beforeBody).
  throttled(signInAllowed(req, who), "sign-in attempts");
  // Login runs as the gateway itself (no principal yet), then binds the principal's own scope.
  const tx = await beginTx(pool, "ac_gateway");
  try {
    await bindSystem(tx);
    const u = (await tx.query<{ id: string; namespace: Namespace; org_id: string; region_id: string; scope_tier: Tier; scope_id: string; roles: string[]; firm_id: string | null; password_hash: string | null; active: boolean }>(
      "SELECT id, namespace, org_id, region_id, scope_tier, scope_id, roles, firm_id, password_hash, active FROM users WHERE email = $1", [email],
    ))[0];
    // OPEN-S6-IDP: federation, when a customer's IdP exists to test against,
    // replaces this password check and nothing downstream of the token.
    // users.external_idp_subject is the column that mapping lands in.
    if (!(await verifyPasswordAsync(password, u?.password_hash)) || !u?.active) {
      signInFailed(req, who);
      throw new AuthError("invalid credentials", "bad_claims");
    }
    if (!SURFACES[surface].enabled) throw new SurfaceDisabled(surface);
    assertLive(surface);
    if (SURFACES[surface].namespace !== u.namespace) throw new HttpError(403, `${surface} serves the ${SURFACES[surface].namespace} namespace`);
    // The role check the unit of work makes on every request, made at the door:
    // a login no request on this surface would admit is not given a session.
    if (!admits(surface, { namespace: u.namespace, roles: u.roles })) {
      throw new HttpError(403, `${surface} admits [${SURFACES[surface].roles?.join(", ")}]; this login holds [${u.roles.join(", ") || "—"}]`);
    }
    // And the scope check: an org-wide surface is not given to a login scoped to one region.
    if (SURFACES[surface].scopeBinding === "org" && u.scope_tier !== "parent") {
      throw new HttpError(403, `${surface} is org-wide; this login is scoped to one ${u.scope_tier}`);
    }
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
    return { token: minted.token, expiresAt: expiresAt.toISOString(), context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId, segment: context.segment ?? null } };
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
export const deviceLogin = async (req: IncomingMessage, body: Partial<OperationIO["auth.deviceLogin"]["input"]>, res: ServerResponse): Promise<OperationIO["auth.deviceLogin"]["output"]> => {
  const { hardwareId, email, password } = body;
  if (!hardwareId || !email || !password) throw new HttpError(400, "hardwareId, email and password are required");
  const who = String(email).toLowerCase();
  // The per-address count was taken before the body was read (beforeBody).
  throttled(signInAllowed(req, who), "sign-in attempts");
  const tx = await beginTx(pool, "ac_gateway");
  try {
    await bindSystem(tx);
    const u = (await tx.query<{ id: string; password_hash: string | null; active: boolean; crew_id: string | null }>(
      "SELECT id, password_hash, active, crew_id FROM users WHERE email = $1", [email],
    ))[0];
    if (!(await verifyPasswordAsync(password, u?.password_hash)) || !u?.active || !u.crew_id) {
      signInFailed(req, who);
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
      context: { path: context.path, parent: context.parent, regions: context.regions, activeRegionId: context.activeRegionId, segment: context.segment ?? null },
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

/**
 * ITEM 8 — a visitor becomes a principal, for fifteen minutes, to say one thing.
 *
 * There is no credential to check, so what is left of a login is the part
 * that matters downstream: a `sessions` row and a signed token. That is not
 * ceremony. It is what makes an anonymous write arrive at the unit of work
 * the same way every other write does — a verified token, a live session
 * asserted per request, a scope binding RLS can read, and an audit row with a
 * real session id on it. The alternative, an unauthenticated POST straight
 * onto `leads`, would have been the only mutation in the system with no
 * principal behind it, and the only one an operator could not revoke.
 *
 * The claims are the narrowest the validator will accept: PROSPECT/UNASSIGNED
 * (auth.ts refuses an anonymous token that says anything else), scope tier
 * `parent` at the prospect root, and NO ROLES. The roles array is empty and
 * that is load-bearing — S1 declares no `roles` in the registry, so the unit
 * of work's role check does not run for it, and the write allowlist is the
 * whole of what this principal may do: `lead` and `call_record`.
 *
 * `principal_kind = 'anonymous'` has been a legal value in `sessions` since
 * the bootstrap migration. This is the row that finally writes it.
 */
/**
 * A browser already signed in — to a portal, the console, a shift — keeps that
 * session. The anonymous cookie would replace it (one cookie name, one site),
 * signing the person out of everything for a visit to the marketing page. A
 * cookie that is no longer good (expired, revoked, unverifiable) is replaced
 * as before; so is an anonymous one.
 */
const refuseOverSignedInCookie = async (req: IncomingMessage): Promise<void> => {
  const held = cookieToken(req.headers.cookie);
  if (!held) return;
  let principal: Principal;
  try { principal = principalFromClaims(verifyToken(held, keys, Date.now())); } catch { return; }
  if (principal.namespace === "anonymous") return;
  const tx = await beginTx(pool, "ac_gateway");
  try { await assertSessionLive(tx, principal); } catch (e) { if (e instanceof AuthError) return; throw e; } finally { await tx.rollback().catch(() => {}); }
  throw new HttpError(403, "this browser is signed in — sign out first to send this as a visitor");
};

export const anonymousSession = async (req: IncomingMessage, res: ServerResponse): Promise<OperationIO["auth.anonymousSession"]["output"]> => {
  assertLive("S1");
  await refuseOverSignedInCookie(req);
  const claims: Omit<Claims, "iat" | "exp" | "sid"> = {
    sub: ANONYMOUS_ACTOR, ns: "anonymous", org: PROSPECT_ORG_ID, region: UNASSIGNED_REGION_ID,
    scope_tier: "parent", scope_id: PROSPECT_ORG_ID, roles: [],
  };
  const minted = mintToken(keypair, claims, Date.now(), ANONYMOUS_TTL);
  const tx = await beginTx(pool, "ac_gateway");
  try {
    await bindSystem(tx);
    await tx.query(
      "INSERT INTO sessions (id, org_id, region_id, principal_kind, principal_id, expires_at, surface_id) VALUES ($1,$2,$3,'anonymous',$4,to_timestamp($5),'S1')",
      [minted.claims.sid, PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, ANONYMOUS_ACTOR, minted.claims.exp],
    );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  const expiresAt = new Date(minted.claims.exp * 1000);
  res.setHeader("set-cookie", sessionCookie(minted.token, expiresAt, SESSION));
  return { token: minted.token, expiresAt: expiresAt.toISOString() };
};
