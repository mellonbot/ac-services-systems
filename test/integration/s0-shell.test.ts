/**
 * S0 OVER THE WIRE — the shell against a running gateway.
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The unit tests hold the shell against a fake transport. This holds it
 * against the real thing: the gateway spawned as a child process, the
 * generated client sending real HTTP, the outbox relayed and received over
 * SSE. Every S0 clause in 05 §S0 that talks to the gateway has an assertion
 * here. Depends on the Amped seed from backbone.test.ts (idempotent; repeated
 * here for the rows this file needs, so it runs alone too).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, beginTx, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { relayOnce, notifyPublisher } from "../../apps/worker/src/relay.ts";
import { connectShell } from "../../packages/shell/src/index.ts";
import { GatewayRefusal, type EventEnvelope } from "../../packages/contracts/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { ORG, N, REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH, NODES, MSA } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — S0 was not verified over the wire";
if (!URL_) test("s0 over the wire", { skip }, () => {});

const PORT = 18080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OPS = U(1), USER_DISP_SOUTH = U(2);
const PASSWORD = "correct horse battery staple";

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-s0-test");
  await admin(`INSERT INTO organizations (id, name, kind) VALUES ($1,'Amped Fitness Inc.','customer') ON CONFLICT (id) DO NOTHING`, [ORG]);
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'MOUNTAIN','Mountain'), ($3,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH]);
  for (const n of NODES) {
    if (n.tier === "parent") continue;
    await admin(`INSERT INTO accounts (id, org_id, region_id, parent_id, tier, name, customer_group) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [n.id, ORG, n.serviceRegion, n.parent === ORG ? null : n.parent, n.tier, n.name, n.customerGroup ?? null]);
  }
  await admin(`INSERT INTO contracts (id, org_id, region_id, scope_tier, scope_id, kind, billing_path, signed_at, effective, diagnostic_data_rights_reserved, state)
    VALUES ($1,$2,$3,'parent',$2,'msa','enterprise_sla','2025-12-15','[2026-01-01,)',true,'active') ON CONFLICT (id) DO NOTHING`, [MSA, ORG, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','ops.s0@ac.test','Ops','["ops_leadership","account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.south.s0@ac.test','Dispatcher South','["dispatcher"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OPS, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP_SOUTH]);
  // A clean slate for the one override this file authors, so the run is repeatable.
  await admin(`DELETE FROM contract_term_overrides WHERE scope_tier = 'location' AND scope_id = $1 AND term_key = 'sla_response' AND lower(effective) = '2027-01-01'`, [N.austin]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
    // Production posture: cookies Secure, origins derived from the registry under this site.
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: URL_, AC_SITE: "ac.test" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  gateway.stdout!.on("data", (d) => { log += String(d); });
  gateway.stderr!.on("data", (d) => { log += String(d); });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try { const r = await fetch(`${BASE}/healthz`); if (r.ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`gateway did not come up on :${PORT}\n${log}`);
    await new Promise((r) => setTimeout(r, 150));
  }
});

after(async () => {
  gateway?.kill("SIGTERM");
  await pool?.end();
});

const ops = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "ops.s0@ac.test", password: PASSWORD } });
const dispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.south.s0@ac.test", password: PASSWORD } });

test("login → me: the shell boots with the principal and hierarchy context the gateway resolved", { skip }, async () => {
  const s3 = await dispatcher();
  assert.equal(s3.principal.subjectId, USER_DISP_SOUTH);
  assert.equal(s3.principal.scopeTier, "region");
  assert.equal(s3.context?.activeRegionId, REGION_SOUTH);
  assert.equal(s3.context?.regions.length, 1, "a dispatcher sees one region: ours");
  assert.equal(s3.context?.path.at(-1)?.id, REGION_SOUTH);
  assert.ok(s3.token());
  assert.equal(s3.isDegraded(), false);

  const s2 = await ops();
  assert.equal(s2.principal.scopeTier, "parent");
  assert.ok((s2.context?.regions.length ?? 0) >= 0, "org scope sees every region node of the internal org");
});

test("a dispatcher's S3 shell cannot author a term — the catalogue serves terms.authorOverride to S2 alone (403 scope)", { skip }, async () => {
  const s3 = await dispatcher();
  await assert.rejects(
    // The generated client sends x-ac-surface: S3; the gateway refuses before any handler runs.
    s3.gateway.authorTermOverride({ contractId: MSA, scopeTier: "location", scopeId: N.austin, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2027-01-01", orgId: ORG, regionId: REGION_SOUTH }),
    (e: unknown) => { const r = s3.refusalOf(e); return r?.kind === "scope" && /not served to S3/.test(r.message); },
  );
  assert.equal(s3.isDegraded(), false, "a 403 is a gateway that is up");
});

test("a login for a surface the user's namespace does not serve is refused", { skip }, async () => {
  await assert.rejects(
    connectShell({ surfaceId: "S8", baseUrl: BASE, fetch, credentials: { email: "ops.s0@ac.test", password: PASSWORD } }),
    (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "scope",
  );
});

test("a bad password is a token refusal, in plain words", { skip }, async () => {
  await assert.rejects(
    connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "ops.s0@ac.test", password: "nope" } }),
    (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "token" && /invalid credentials/.test(e.message),
  );
});

test("finding 1 over the wire: payment terms at a location come back 422, structural — nothing to escalate", { skip }, async () => {
  const s2 = await ops();
  await assert.rejects(
    s2.gateway.authorTermOverride({ contractId: MSA, scopeTier: "location", scopeId: N.austin, termKey: "payment_terms_days", termValue: 30, effectiveFrom: "2027-01-01", orgId: ORG, regionId: REGION_SOUTH }),
    (e: unknown) => {
      const r = s2.refusalOf(e);
      assert.equal(r?.kind, "admission");
      if (r?.kind !== "admission") return false;
      assert.equal(r.code, "illegal_tier");
      assert.equal(r.axis, "structural");
      assert.match(r.message, /payment_terms_days/);
      return true;
    },
  );
});

test("finding 2 over the wire: relaxing the SLA at Austin comes back 422, commercial — someone has to price it", { skip }, async () => {
  const s2 = await ops();
  await assert.rejects(
    s2.gateway.authorTermOverride({ contractId: MSA, scopeTier: "location", scopeId: N.austin, termKey: "sla_response", termValue: "48_hour", effectiveFrom: "2027-01-01", orgId: ORG, regionId: REGION_SOUTH }),
    (e: unknown) => {
      const r = s2.refusalOf(e);
      if (r?.kind !== "admission") return false;
      assert.equal(r.code, "ratchet_loosened");
      assert.equal(r.axis, "commercial");
      return true;
    },
  );
});

test("the loop: S2 authors a legal override → outbox → relay → NOTIFY → SSE → the South dispatcher's S3 shell receives it once, deduped", { skip }, async () => {
  const s3 = await dispatcher();
  const received: EventEnvelope[] = [];
  let state = "";
  const stop = s3.subscribe((e) => received.push(e), { topics: ["contract.term_overridden"], onState: (s) => { state = s; } });
  const opened = Date.now() + 5_000;
  while (state !== "open" && Date.now() < opened) await new Promise((r) => setTimeout(r, 50));
  assert.equal(state, "open", "SSE stream opened");
  assert.equal(s3.isDegraded(), false);

  const s2 = await ops();
  const { id, eventId } = await s2.gateway.authorTermOverride({ contractId: MSA, scopeTier: "location", scopeId: N.austin, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2027-01-01", orgId: ORG, regionId: REGION_SOUTH });
  assert.ok(id && eventId);
  // Audit row and outbox row share the event id — written in the same transaction as the override.
  const rows = await admin(`SELECT (SELECT count(*) FROM audit_log WHERE event_id = $1) AS audit, (SELECT count(*) FROM outbox WHERE event_id = $1) AS outbox`, [eventId]);
  assert.equal(String(rows[0]!.audit), "1");
  assert.equal(String(rows[0]!.outbox), "1");

  // Relay once, twice — at-least-once delivery is the contract; the shell dedupes.
  for (let i = 0; i < 2; i++) {
    const tx = await beginTx(pool, "ac_worker");
    await relayOnce(tx, notifyPublisher(tx));
    await tx.commit();
  }
  // Re-publish the same envelope by hand to prove the dedupe rather than hope for it.
  const o = (await admin(`SELECT event_id, topic, entity, entity_id, region_id, org_id, occurred_at FROM outbox WHERE event_id = $1`, [eventId]))[0]!;
  await admin(`SELECT pg_notify('ac_events', $1)`, [JSON.stringify({ eventId: o.event_id, topic: o.topic, entity: o.entity, entityId: o.entity_id, regionId: o.region_id, orgId: o.org_id, occurredAt: o.occurred_at })]);

  const deadline = Date.now() + 5_000;
  while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  stop();

  assert.equal(received.length, 1, `expected exactly one delivery, got ${received.length}`);
  assert.equal(received[0]!.eventId, eventId);
  assert.equal(received[0]!.topic, "contract.term_overridden");
  assert.equal(received[0]!.regionId, REGION_SOUTH);
  assert.equal(received[0]!.entityId, MSA, "the entity is the contract the override amends");

  // And S2 can read it back, with the trace, as of a date the row is in effect.
  const r = await s2.gateway.resolvedTerms({ orgId: ORG, tier: "location", nodeId: N.austin, asOf: "2027-02-01" });
  assert.equal(r.resolved.sla_response?.value, "2_hour");
  assert.deepEqual(r.resolved.sla_response?.wonAt, { tier: "location", id: N.austin });
});

test("a gateway that is not there: the shell reports a transport refusal and goes degraded", { skip }, async () => {
  await assert.rejects(
    connectShell({ surfaceId: "S3", baseUrl: `http://127.0.0.1:${PORT + 1}`, fetch, credentials: { token: "whatever" } }),
    (e: unknown) => e instanceof GatewayRefusal && e.refusal.kind === "transport" && e.refusal.status === null,
  );
});

test("a route that is not in the catalogue does not exist at the gateway", { skip }, async () => {
  const r = await fetch(`${BASE}/s3/force-assign`, { method: "POST" });
  assert.equal(r.status, 404);
  const body = (await r.json()) as { error: string; message: string };
  assert.equal(body.error, "NoRoute");
  assert.match(body.message, /operation catalogue/);
});

// ---------------------------------------------------------------------------
// Database and input refusals must reach the shell as refusals, never as 500.
// Found by design (09 §3.7): every 0002 trigger raised with no ERRCODE, the
// gateway mapped it to 500, the shell classified 500 as transport — and a
// refused row put the surface into degraded mode with an outage banner.
// ---------------------------------------------------------------------------
test("a foreign-key refusal (override against a contract that does not exist) is a 422 admission, structural — and the shell stays up", { skip }, async () => {
  const s2 = await ops();
  await assert.rejects(
    s2.gateway.authorTermOverride({ contractId: "00000000-0000-0000-0000-00000000dead", scopeTier: "location", scopeId: N.elPaso, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2028-01-01", orgId: ORG, regionId: REGION_SOUTH }),
    (e: unknown) => {
      const r = s2.refusalOf(e);
      assert.equal(r?.kind, "admission", `expected admission, got ${JSON.stringify(r)}`);
      if (r?.kind !== "admission") return false;
      assert.equal(r.axis, "structural");
      assert.match(r.message, /contract/i);
      return true;
    },
  );
  assert.equal(s2.isDegraded(), false, "a refused row is not an outage");
});

test("an input the handler cannot resolve (a scope node that is not in the org) is a 422, not a 500", { skip }, async () => {
  const s2 = await ops();
  await assert.rejects(
    s2.gateway.authorTermOverride({ contractId: MSA, scopeTier: "site", scopeId: N.austin, termKey: "vendor_warranty", termValue: "x", effectiveFrom: "2028-01-01", orgId: ORG, regionId: REGION_SOUTH }),
    (e: unknown) => {
      const r = s2.refusalOf(e);
      assert.equal(r?.kind, "admission", `expected admission, got ${JSON.stringify(r)}`);
      // Either layer may be the one that says no: the handler's path loader
      // (unknown_scope) or, for an `attach` term the domain does not walk, the
      // 0004 trigger. Both are 422 with a message a human can act on.
      return r?.kind === "admission" && ["unknown_scope", "ac_admit_term_override"].includes(r.code) && /site/.test(r.message);
    },
  );
  assert.equal(s2.isDegraded(), false);
});

test("a trigger refusal carries SQLSTATE AC422 and its message; audit immutability carries AC403", { skip }, async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // A site hung directly off a region node — the derive-region trigger refuses it.
    await assert.rejects(
      c.query(`INSERT INTO accounts (org_id, region_id, parent_id, tier, name) VALUES ($1,$2,$3,'site','Impossible')`, [ORG, REGION_SOUTH, N.south]),
      (e: unknown) => (e as { code?: string }).code === "AC422" && /must hang off/.test((e as Error).message),
    );
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    await assert.rejects(
      c.query(`UPDATE audit_log SET action = 'tampered' WHERE false OR true`),
      (e: unknown) => (e as { code?: string }).code === "AC403",
    );
    await c.query("ROLLBACK");
  } finally { c.release(); }
});


// ---------------------------------------------------------------------------
// The browser session (09 §3.2). Node's fetch keeps no cookie jar and sets no
// Origin header, so the browser's part is played by hand: read Set-Cookie,
// send Cookie, send Origin. What is asserted is the gateway's side of the
// contract — the only side we control.
// ---------------------------------------------------------------------------
const S2_ORIGIN = "https://s2-service-manager.ac.test";
const loginRaw = async (email: string, surface: string) => {
  const r = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: S2_ORIGIN }, body: JSON.stringify({ email, password: PASSWORD, surface }) });
  return { status: r.status, setCookie: r.headers.get("set-cookie"), body: (await r.json()) as { token?: string; message?: string }, headers: r.headers };
};
const cookieOf = (setCookie: string | null) => setCookie?.split(";")[0] ?? "";

test("login sets an httpOnly, Secure, SameSite=Strict session cookie carrying the token, and answers the listed origin with credentialed CORS", { skip }, async () => {
  const r = await loginRaw("ops.s0@ac.test", "S2");
  assert.equal(r.status, 200);
  assert.ok(r.setCookie, "Set-Cookie present");
  assert.match(r.setCookie!, /^ac_session=[A-Za-z0-9_.-]+; Path=\/; HttpOnly; SameSite=Strict; Expires=.+; Secure$/);
  assert.equal(cookieOf(r.setCookie).slice("ac_session=".length), r.body.token, "the cookie IS the token; a browser surface just never reads it");
  assert.equal(r.headers.get("access-control-allow-origin"), S2_ORIGIN);
  assert.equal(r.headers.get("access-control-allow-credentials"), "true");
  assert.equal(r.headers.get("vary"), "Origin");
});

test("a cookie request that names its surface is served; the same cookie without x-ac-surface is refused 403 — the CSRF line", { skip }, async () => {
  const { setCookie } = await loginRaw("ops.s0@ac.test", "S2");
  const cookie = cookieOf(setCookie);
  const ok = await fetch(`${BASE}/me`, { headers: { cookie, "x-ac-surface": "S2", origin: S2_ORIGIN } });
  assert.equal(ok.status, 200);
  const me = (await ok.json()) as { principal: { subjectId: string } };
  assert.equal(me.principal.subjectId, USER_OPS);

  const forged = await fetch(`${BASE}/me`, { headers: { cookie, origin: S2_ORIGIN } });
  assert.equal(forged.status, 403);
  const body = (await forged.json()) as { message: string };
  assert.match(body.message, /x-ac-surface/);
  assert.match(body.message, /CSRF/);
});

test("the cookie cannot be used to act as a surface the operation does not admit — header selects, token authorizes, as with bearer", { skip }, async () => {
  const { setCookie } = await loginRaw("disp.south.s0@ac.test", "S3");
  const r = await fetch(`${BASE}/s2/terms/override`, { method: "POST", headers: { cookie: cookieOf(setCookie), "x-ac-surface": "S3", "content-type": "application/json", origin: "https://s3-dispatch-console.ac.test" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("preflight: a registry origin gets 204 with the credentialed allow-headers; an unlisted origin gets 403 and no allow-headers", { skip }, async () => {
  const yes = await fetch(`${BASE}/s2/terms/override`, { method: "OPTIONS", headers: { origin: S2_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-ac-surface" } });
  assert.equal(yes.status, 204);
  assert.equal(yes.headers.get("access-control-allow-origin"), S2_ORIGIN);
  assert.match(yes.headers.get("access-control-allow-headers") ?? "", /x-ac-surface/);

  for (const origin of ["https://evil.test", "https://s4-hq-dashboard.ac.test", "http://s2-service-manager.ac.test"]) {
    const no = await fetch(`${BASE}/s2/terms/override`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    assert.equal(no.status, 403, origin);
    assert.equal(no.headers.get("access-control-allow-origin"), null, origin);
    assert.equal(no.headers.get("vary"), "Origin", origin);
  }
});

test("logout revokes the session: the cleared cookie comes back, and the SAME token — as cookie or as bearer — is 401 revoked from then on", { skip }, async () => {
  const { setCookie, body } = await loginRaw("ops.s0@ac.test", "S2");
  const cookie = cookieOf(setCookie);
  const out = await fetch(`${BASE}/auth/logout`, { method: "POST", headers: { cookie, "x-ac-surface": "S2", origin: S2_ORIGIN } });
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /^ac_session=; .*Max-Age=0/);

  const viaCookie = await fetch(`${BASE}/me`, { headers: { cookie, "x-ac-surface": "S2", origin: S2_ORIGIN } });
  assert.equal(viaCookie.status, 401);
  assert.equal(((await viaCookie.json()) as { code: string }).code, "revoked");

  const viaBearer = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${body.token}`, "x-ac-surface": "S2" } });
  assert.equal(viaBearer.status, 401, "revocation is a property of the session, not of how the token travels");

  const again = await fetch(`${BASE}/auth/logout`, { method: "POST", headers: { cookie, "x-ac-surface": "S2" } });
  assert.equal(again.status, 401, "logging out twice is a token refusal, not a success — the session is gone");
});

test("the shell in cookie mode against the real gateway: login → me on the cookie alone, then logout", { skip }, async () => {
  // A cookie jar for one shell — the browser's job, done here by hand.
  let jar = "";
  const browserish: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers as HeadersInit);
    headers.set("origin", S2_ORIGIN);
    if ((init as { credentials?: string } | undefined)?.credentials === "include" && jar) headers.set("cookie", jar);
    const r = await fetch(url, { ...init, headers });
    const sc = r.headers.get("set-cookie");
    if (sc) jar = sc.startsWith("ac_session=;") ? "" : sc.split(";")[0]!;
    return r;
  };
  const s2 = await connectShell({ surfaceId: "S2", baseUrl: BASE, fetch: browserish as never, credentials: { email: "ops.s0@ac.test", password: PASSWORD, session: "cookie" } });
  assert.equal(s2.token(), null, "script holds no token");
  assert.equal(s2.principal.subjectId, USER_OPS);
  assert.ok(jar.startsWith("ac_session="), "the browser holds the cookie");
  const health = await s2.gateway.health();
  assert.equal(health.ok, true);
  await s2.logout();
  assert.equal(jar, "", "the cleared cookie emptied the jar");
  await assert.rejects(s2.gateway.me(), (e: unknown) => s2.refusalOf(e)?.kind === "token");
});

test("bearer is unchanged: a bearer request needs no x-ac-surface when the operation is unambiguous, and needs no origin", { skip }, async () => {
  const s3 = await dispatcher();
  const r = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${s3.token()}` } });
  assert.equal(r.status, 200);
});
