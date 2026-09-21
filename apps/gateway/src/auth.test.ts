import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair, mintToken, verifyToken, principalFromClaims, validateClaims, AuthError, hashPassword, verifyPassword } from "./auth.ts";
import { buildContext, scopeBinding, ScopeResolutionError, type HierarchyReader } from "./context.ts";
import { PROSPECT_ORG_ID, UNASSIGNED_REGION_ID, INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";
import { ANONYMOUS_PRINCIPAL, ANONYMOUS_PRINCIPAL_IDS, type Claims } from "../../../packages/contracts/src/scope.ts";

const kp = generateKeypair("k1");
const keys = new Map([[kp.kid, kp.publicKey]]);
const T0 = Date.UTC(2026, 8, 14, 15);
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const base: Omit<Claims, "iat" | "exp" | "sid"> = {
  sub: U(100), ns: "internal", org: U(3), region: U(20), scope_tier: "region", scope_id: U(30), roles: ["dispatcher"],
};

test("mint → verify round-trips; the principal carries tier claims and nothing resolved", () => {
  const { token } = mintToken(kp, base, T0, 3600);
  const claims = verifyToken(token, keys, T0 + 1000);
  const p = principalFromClaims(claims);
  assert.equal(p.regionId, U(20));
  assert.equal(p.scopeTier, "region");
  assert.equal(p.firmId, null);
  assert.ok(!("writes" in p) && !("permissions" in p));
});

test("expired, tampered, unknown key, malformed — four distinct codes", () => {
  const { token } = mintToken(kp, base, T0, 60);
  assert.throws(() => verifyToken(token, keys, T0 + 61_000), (e: unknown) => e instanceof AuthError && e.code === "expired");
  const [h, b, s] = token.split(".");
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b!, "base64url").toString()), region: U(99) })).toString("base64url");
  assert.throws(() => verifyToken(`${h}.${tampered}.${s}`, keys, T0), (e: unknown) => e instanceof AuthError && e.code === "bad_signature");
  assert.throws(() => verifyToken(token, new Map(), T0), (e: unknown) => e instanceof AuthError && e.code === "unknown_key");
  assert.throws(() => verifyToken("nope", keys, T0), (e: unknown) => e instanceof AuthError && e.code === "malformed");
});

test("region is total even in a token: only anonymous may be UNASSIGNED, and anonymous may be nothing else", () => {
  assert.throws(() => mintToken(kp, { ...base, region: UNASSIGNED_REGION_ID }, T0, 60), (e: unknown) => e instanceof AuthError && e.code === "bad_claims");
  assert.throws(() => mintToken(kp, { ...base, ns: "anonymous" }, T0, 60), (e: unknown) => e instanceof AuthError && e.code === "bad_claims");
  const ok = mintToken(kp, { sub: U(1), ns: "anonymous", org: PROSPECT_ORG_ID, region: UNASSIGNED_REGION_ID, scope_tier: "parent", scope_id: PROSPECT_ORG_ID, roles: [] }, T0, 60);
  assert.equal(verifyToken(ok.token, keys, T0).ns, "anonymous");
});

test("a subcontractor principal must carry a firm; a device principal must carry a device and a shift", () => {
  assert.throws(() => mintToken(kp, { ...base, ns: "subcontractor" }, T0, 60), /carry a firm/);
  assert.throws(() => mintToken(kp, { ...base, ns: "device", device: U(7) }, T0, 60), /shift grant/);
  assert.doesNotThrow(() => mintToken(kp, { ...base, ns: "device", device: U(7), shift: U(8) }, T0, 60));
});

test("passwords: scrypt, constant-time compare, wrong password false", () => {
  const h = hashPassword("correct horse");
  assert.ok(verifyPassword("correct horse", h));
  assert.equal(verifyPassword("wrong", h), false);
  assert.equal(verifyPassword("x", "garbage"), false);
});

// ---------------------------------------------------------------------------
// Hierarchy context
// ---------------------------------------------------------------------------
const db: HierarchyReader = {
  async organization(id) { return id === U(3) ? { id, name: "Amped" } : null; },
  async region(id) { return id === U(20) ? { id, code: "SOUTH", name: "South" } : null; },
  async account(id) {
    const nodes: Record<string, Awaited<ReturnType<HierarchyReader["account"]>>> = {
      [U(30)]: { id: U(30), tier: "region", name: "Amped / South", parentId: null, regionId: U(20), orgId: U(3), customerGroup: null },
      [U(31)]: { id: U(31), tier: "location", name: "Amped El Paso", parentId: U(30), regionId: U(20), orgId: U(3), customerGroup: "Mountain" },
      [U(32)]: { id: U(32), tier: "site", name: "El Paso — Roof", parentId: U(31), regionId: U(20), orgId: U(3), customerGroup: null },
    };
    return nodes[id] ?? null;
  },
  async regionNodesOf() { return [{ id: U(30), name: "Amped / South", regionId: U(20) }]; },
};

test("context resolves the full path at login — the resolver's ScopePath, parent first", async () => {
  const p = principalFromClaims(verifyToken(mintToken(kp, { ...base, ns: "customer", scope_tier: "site", scope_id: U(32) }, T0, 60).token, keys, T0));
  const c = await buildContext(p, db);
  assert.deepEqual(c.path.map((n) => n.tier), ["parent", "region", "location", "site"]);
  assert.equal(c.path[0]!.id, U(3));
  assert.equal(c.regions[0]!.regionId, U(20));
});

test("a stale token whose region disagrees with the node's parent edge is refused — region derives from the edge", async () => {
  const p = principalFromClaims(verifyToken(mintToken(kp, { ...base, ns: "customer", region: U(21), scope_tier: "location", scope_id: U(31) }, T0, 60).token, keys, T0));
  await assert.rejects(buildContext(p, db), ScopeResolutionError);
});

test("an internal dispatcher is scoped to OUR region, not a customer's node — the path is parent → region and the region is a regions row", async () => {
  const p = principalFromClaims(verifyToken(mintToken(kp, { ...base, scope_tier: "region", scope_id: U(20) }, T0, 60).token, keys, T0));
  const c = await buildContext(p, db);
  assert.deepEqual(c.path.map((n) => n.tier), ["parent", "region"]);
  assert.equal(c.regions[0]!.id, U(20));
  // scoped to a region that is not the token's region: refused
  const bad = principalFromClaims(verifyToken(mintToken(kp, { ...base, scope_tier: "region", scope_id: U(20), region: U(21) }, T0, 60).token, keys, T0));
  await assert.rejects(buildContext(bad, db), ScopeResolutionError);
});

test("the scope binding is built from the principal alone and names every setting RLS reads", () => {
  const p = principalFromClaims(verifyToken(mintToken(kp, base, T0, 60).token, keys, T0));
  const b = scopeBinding(p, "S3");
  assert.deepEqual(Object.keys(b).sort(), ["ac.actor_id", "ac.device_id", "ac.firm_id", "ac.namespace", "ac.org_id", "ac.region_id", "ac.scope_id", "ac.scope_tier", "ac.surface_id"]);
});

/**
 * ITEM 8 — the two spellings of the anonymous principal, held together.
 *
 * `ANONYMOUS_PRINCIPAL_IDS` lives in packages/contracts because the shell
 * needs it and the shell may not import packages/schema — dependencies point
 * one way and the guard enforces it. So the ids are written twice, and this
 * is the test that makes changing one and not the other a failure here rather
 * than a lead that lands nowhere.
 */
test("the anonymous principal's ids are PROSPECT and UNASSIGNED, in both places that spell them", () => {
  assert.equal(ANONYMOUS_PRINCIPAL_IDS.org, PROSPECT_ORG_ID);
  assert.equal(ANONYMOUS_PRINCIPAL_IDS.region, UNASSIGNED_REGION_ID);
  assert.equal(ANONYMOUS_PRINCIPAL.orgId, PROSPECT_ORG_ID);
  assert.equal(ANONYMOUS_PRINCIPAL.regionId, UNASSIGNED_REGION_ID);
  assert.equal(ANONYMOUS_PRINCIPAL.scopeId, PROSPECT_ORG_ID, "an anonymous principal is scoped to the prospect root and no further");
  assert.deepEqual([...ANONYMOUS_PRINCIPAL.roles], [], "no roles: the write allowlist is the whole of what it may do");
});

test("claims validation is what actually holds the anonymous principal in PROSPECT/UNASSIGNED", () => {
  const base = {
    sub: ANONYMOUS_PRINCIPAL_IDS.actor, ns: "anonymous" as const, org: PROSPECT_ORG_ID, region: UNASSIGNED_REGION_ID,
    scope_tier: "parent" as const, scope_id: PROSPECT_ORG_ID, roles: [] as string[],
    iat: 0, exp: 1, sid: "00000000-0000-0000-0000-0000000000ff",
  };
  assert.doesNotThrow(() => validateClaims(base));
  assert.throws(() => validateClaims({ ...base, org: INTERNAL_ORG_ID }), /PROSPECT\/UNASSIGNED/);
  assert.throws(() => validateClaims({ ...base, ns: "customer", region: UNASSIGNED_REGION_ID }), /only anonymous/);
});
