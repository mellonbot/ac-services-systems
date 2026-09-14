import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, randomUUID, scryptSync, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto";
import { NAMESPACES, type Claims, type Principal, type Namespace } from "../../../packages/contracts/src/scope.ts";
import { TIERS, type Tier } from "../../../packages/contracts/src/tiers.ts";
import { UNASSIGNED_REGION_ID, PROSPECT_ORG_ID } from "../../../packages/schema/src/tenancy.ts";

/**
 * AUTH — B4. Tier claims in the token, hierarchy context resolved at login.
 *
 * Tokens are Ed25519-signed, compact, and carry Claims and nothing else. No
 * library: node:crypto does Ed25519 natively, and a dependency in the auth
 * path is a dependency that must be patched on a Sunday.
 *
 * What a token is NOT: a bag of permissions. It says who (sub, ns), where in
 * the hierarchy (org, region, scope_tier, scope_id), and for what shift or
 * firm. What that MEANS — which rows, which writes — is decided by the gateway
 * against the registry and the hierarchy on every request. A token that
 * carried resolved permissions would be wrong the moment a contract is amended.
 */

const b64u = (b: Buffer | string): string => Buffer.from(b).toString("base64url");
const unb64u = (s: string): Buffer => Buffer.from(s, "base64url");

export type Keypair = { readonly privateKey: KeyObject; readonly publicKey: KeyObject; readonly kid: string };

export const generateKeypair = (kid: string = randomUUID()): Keypair => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey, kid };
};

export const keypairFromPem = (privatePem: string, kid: string): Keypair => {
  const privateKey = createPrivateKey(privatePem);
  return { privateKey, publicKey: createPublicKey(privateKey), kid };
};

export class AuthError extends Error {
  readonly code: "malformed" | "bad_signature" | "expired" | "unknown_key" | "bad_claims" | "revoked";
  constructor(message: string, code: AuthError["code"]) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

/** Mint. `now` is passed in — the gateway has a clock, but the function does not. */
export const mintToken = (kp: Keypair, claims: Omit<Claims, "iat" | "exp" | "sid"> & { readonly sid?: string }, nowMs: number, ttlSeconds: number): { token: string; claims: Claims } => {
  const full: Claims = {
    ...claims,
    sid: claims.sid ?? randomUUID(),
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + ttlSeconds,
  };
  validateClaims(full);
  const header = b64u(JSON.stringify({ alg: "EdDSA", kid: kp.kid, typ: "ac+jwt" }));
  const body = b64u(JSON.stringify(full));
  const sig = sign(null, Buffer.from(`${header}.${body}`), kp.privateKey);
  return { token: `${header}.${body}.${b64u(sig)}`, claims: full };
};

/** Verify. Every failure is a distinct code, because "401" tells an operator nothing at 2am. */
export const verifyToken = (token: string, keys: ReadonlyMap<string, KeyObject>, nowMs: number): Claims => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("token is not three segments", "malformed");
  const [h, b, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(unb64u(h).toString("utf8"));
  } catch {
    throw new AuthError("header is not JSON", "malformed");
  }
  if (header.alg !== "EdDSA" || !header.kid) throw new AuthError("unsupported alg or missing kid", "malformed");
  const key = keys.get(header.kid);
  if (!key) throw new AuthError(`no public key for kid ${header.kid}`, "unknown_key");
  if (!verify(null, Buffer.from(`${h}.${b}`), key, unb64u(s))) throw new AuthError("signature does not verify", "bad_signature");
  let claims: Claims;
  try {
    claims = JSON.parse(unb64u(b).toString("utf8"));
  } catch {
    throw new AuthError("claims are not JSON", "malformed");
  }
  validateClaims(claims);
  if (claims.exp * 1000 <= nowMs) throw new AuthError(`token expired at ${new Date(claims.exp * 1000).toISOString()}`, "expired");
  return claims;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validateClaims = (c: Claims): void => {
  const bad = (why: string) => new AuthError(`claims: ${why}`, "bad_claims");
  if (!(NAMESPACES as readonly string[]).includes(c.ns)) throw bad(`unknown namespace ${c.ns}`);
  if (!(TIERS as readonly string[]).includes(c.scope_tier)) throw bad(`unknown scope tier ${c.scope_tier}`);
  if (!UUID.test(c.org)) throw bad("org is not a uuid");
  if (!UUID.test(c.region)) throw bad("region is not a uuid — region is total, even in a token");
  if (!UUID.test(c.scope_id)) throw bad("scope_id is not a uuid");
  if (!Array.isArray(c.roles)) throw bad("roles must be an array");
  if (c.ns === "subcontractor" && !c.firm) throw bad("subcontractor principals carry a firm");
  if (c.ns === "device" && !(c.device && c.shift)) throw bad("device principals carry a device and a shift grant");
  if (c.ns === "anonymous" && (c.org !== PROSPECT_ORG_ID || c.region !== UNASSIGNED_REGION_ID)) throw bad("anonymous traffic lives in PROSPECT/UNASSIGNED and nowhere else");
  if (c.ns !== "anonymous" && c.region === UNASSIGNED_REGION_ID) throw bad("only anonymous principals may be UNASSIGNED");
};

/** Claims → Principal. Pure; the gateway attaches the resolved hierarchy context beside it. */
export const principalFromClaims = (c: Claims): Principal => ({
  namespace: c.ns as Namespace,
  subjectId: c.sub,
  orgId: c.org,
  regionId: c.region,
  scopeTier: c.scope_tier as Tier,
  scopeId: c.scope_id,
  roles: c.roles,
  firmId: c.firm ?? null,
  deviceId: c.device ?? null,
  shiftId: c.shift ?? null,
  tierClaim: c.tier_claim ?? null,
  sessionId: c.sid,
});

// ---------------------------------------------------------------------------
// Passwords, for internal and subcontractor users. scrypt, node:crypto.
// Customer users federate to their IdP and never have one.
// ---------------------------------------------------------------------------
export const hashPassword = (password: string): string => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${b64u(salt)}$${b64u(hash)}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = unb64u(hash);
  const actual = scryptSync(password, unb64u(salt), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
};
