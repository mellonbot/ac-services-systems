import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { beginTx, bindSystem } from "./pg-tx.ts";
import { verifyToken, principalFromClaims, AuthError } from "./auth.ts";
import { createUnitOfWork, SurfaceNotLive, type Tx } from "./unit-of-work.ts";
import { cookieToken } from "./session.ts";
import { keys, pool, ROLLOUT_ENFORCED } from "./env.ts";
import { HttpError } from "./http.ts";
import type { AccountActor } from "./handlers/account.ts";
import { SURFACES, isLive, type SurfaceId } from "../../../packages/contracts/src/surfaces.ts";
import { OPERATIONS, surfacesFor, type OperationId } from "../../../packages/contracts/src/operations.ts";
import type { Principal } from "../../../packages/contracts/src/scope.ts";

type Unit = Awaited<ReturnType<typeof createUnitOfWork>>;

/**
 * Who is calling, and how they proved it. A bearer header wins; otherwise the
 * `ac_session` cookie. `viaCookie` is remembered because a cookie principal
 * must name its surface (surfaceOf) — that requirement is the CSRF line.
 */
export type Caller = { readonly principal: Principal; readonly viaCookie: boolean };
export const callerOf = (req: IncomingMessage): Caller => {
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
 *
 * The session is also only as good as what it was minted FROM. A user who is
 * deactivated, or whose roles or scope change, holds claims the database no
 * longer agrees with; a device grant that is revoked, a device that is retired,
 * or a technician who is deactivated ends the shift. Any of these refuses the
 * token now, not at its expiry up to TOKEN_TTL later.
 */
export const assertSessionLive = async (tx: Tx, p: Principal): Promise<void> => {
  await bindSystem(tx);
  const row = (await tx.query<{ revoked_at: string | null; expires_at: string; standing: boolean | null }>(
    `SELECT s.revoked_at, s.expires_at,
            CASE s.principal_kind
              WHEN 'user' THEN (SELECT u.active AND u.roles @> $2::jsonb AND $2::jsonb @> u.roles
                                       AND u.scope_tier = $3 AND u.scope_id::text = $4 AND u.firm_id IS NOT DISTINCT FROM $5::uuid
                                  FROM users u WHERE u.id = s.principal_id)
              WHEN 'device_grant' THEN (SELECT g.revoked_at IS NULL AND d.active AND u.active
                                          FROM device_grants g JOIN devices d ON d.id = g.device_id JOIN users u ON u.id = g.technician_id
                                         WHERE g.id = s.principal_id)
              ELSE true
            END AS standing
       FROM sessions s WHERE s.id = $1`,
    [p.sessionId, JSON.stringify(p.roles), p.scopeTier, p.scopeId, p.firmId],
  ))[0];
  if (!row) throw new AuthError(`session ${p.sessionId} is unknown to this gateway`, "revoked");
  if (row.revoked_at) throw new AuthError(`session was ended at ${new Date(row.revoked_at).toISOString()} — sign in again`, "revoked");
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new AuthError("session has expired — sign in again", "revoked");
  if (!row.standing) throw new AuthError("this sign-in's access has changed or ended — sign in again", "revoked");
};

/**
 * Which surface is this request made AS? The client sends `x-ac-surface`; it
 * must be one the operation admits and one that serves the principal's
 * namespace. Absent, and exactly one of the operation's surfaces serves the
 * namespace, that one is used. The header selects; the token authorizes —
 * the unit of work still checks the surface's roles and write allowlist.
 */
/** A surface outside the production ROLLOUT is refused at every door when the gateway enforces it. */
export const assertLive = (id: SurfaceId): SurfaceId => {
  if (ROLLOUT_ENFORCED && !isLive(id)) throw new SurfaceNotLive(id);
  return id;
};

export const surfaceOf = (req: IncomingMessage, opId: OperationId, caller: Caller): SurfaceId => assertLive(claimedSurface(req, opId, caller));

const claimedSurface = (req: IncomingMessage, opId: OperationId, { principal, viaCookie }: Caller): SurfaceId => {
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

const requestOf = (req: IncomingMessage, opId: OperationId) => {
  const caller = callerOf(req);
  const surfaceId = surfaceOf(req, opId, caller);
  return { principal: caller.principal, surfaceId, requestId: String(req.headers["x-request-id"] ?? randomUUID()) };
};

const openUnit = async (req: IncomingMessage, opId: OperationId) => {
  const scope = requestOf(req, opId);
  const tx = await beginTx(pool, "ac_gateway");
  return { ...scope, tx };
};

/**
 * One opener for the three transactions a catalogue row runs in.
 *
 * `uow` commits on the way out and rolls back only when something threw
 * (a commit that throws is rolled back too). `read` never commits: the
 * transaction always rolls back, including when the read threw. `self` is
 * not this function — identity writes are not a unit of work. See `openSelf`.
 */
export const openTx = async <T>(
  req: IncomingMessage,
  opId: OperationId,
  mode: "uow" | "read",
  fn: (uow: Unit, principal: Principal, surfaceId: SurfaceId) => Promise<T>,
): Promise<T> => {
  const { principal, surfaceId, requestId, tx } = await openUnit(req, opId);
  const run = async () => {
    await assertSessionLive(tx, principal);
    const uow = await createUnitOfWork({ surfaceId, principal, requestId, now: () => new Date(), newId: randomUUID }, tx);
    const out = await fn(uow, principal, surfaceId);
    if (mode === "uow") await uow.commit();
    return out;
  };
  // A read rolls back on the way out, success or throw, and does not also
  // roll back in a catch — one rollback, as the read opener always did.
  if (mode === "read") {
    try { return await run(); } finally { await tx.rollback().catch(() => {}); }
  }
  try {
    return await run();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
};

/**
 * The caller's own account (0032) and a company message (0035): the same
 * session check and surface admission as every route, then the gateway's own
 * transaction — bound to `system` by the session check, as logout's is —
 * because the row is the caller's identity, which no surface's write allowlist
 * owns. Every statement the handler runs names the token's subject.
 *
 * A write commits, and then the trailing rollback is a no-op. A read never
 * commits. Either way the connection is released.
 */
export const openSelf = async <T>(
  req: IncomingMessage,
  opId: OperationId,
  write: boolean,
  fn: (tx: Tx, actor: AccountActor) => Promise<T>,
): Promise<T> => {
  const { principal, surfaceId, requestId, tx } = await openUnit(req, opId);
  try {
    await assertSessionLive(tx, principal);
    const out = await fn(tx, { principal, surfaceId, requestId });
    if (write) await tx.commit();
    return out;
  } finally { await tx.rollback().catch(() => {}); }
};
