/**
 * C2 OVER THE WIRE — the agreements and term overrides S2 authors, through the
 * shell, against a spawned gateway and a live PostgreSQL (09 §6 item 5).
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The check 09 named: finding 1 and finding 2 rendered as the two cards, which
 * on the wire means the two refusals those cards are built from —
 *
 *   finding 1  a location setting a parent-only term → 422 `illegal_tier`,
 *              STRUCTURAL. Nothing to escalate; the row is wrong.
 *   finding 2  Reno relaxing an SLA the parent MSA carries → 422
 *              `ratchet_loosened`, COMMERCIAL, and the resolver agreeing —
 *              the same value, reached the same way, from the other end.
 *
 * Plus the three that make this the one door: OQ5 unstated is a 400 and not a
 * 422 (nothing was judged); the overlap-then-orphan chain, where the EXCLUDE
 * constraint refuses a second row in effect at once and the trigger refuses an
 * override whose agreement does not exist; and the state ladder.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPool, type Pool } from "../../apps/gateway/src/pg-tx.ts";
import { hashPassword } from "../../apps/gateway/src/auth.ts";
import { connectShell, type ConnectedShell } from "../../packages/shell/src/index.ts";
import { INTERNAL_ORG_ID } from "../../packages/schema/src/tenancy.ts";
import { REGION_WEST, REGION_SOUTH } from "../../packages/domain/src/inheritance/fixtures/amped.ts";

const URL_ = process.env.DATABASE_URL;
const skip = URL_ ? false : "DATABASE_URL not set — C2 was not verified over the wire";
if (!URL_) test("c2 over the wire", { skip }, () => {});

const PORT = 20080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `c2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP = U(2);
const PASSWORD = "correct horse battery staple";
const RUN = `c2-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-c2-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  await admin(`UPDATE regions SET min_crew_density = 0 WHERE id IN ($1,$2)`, [REGION_WEST, REGION_SOUTH]);
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.c2@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.c2@ac.test','Dispatcher','["dispatcher"]','region',$3,$4,true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, active = true`, [USER_OWNER, INTERNAL_ORG_ID, REGION_SOUTH, hash, USER_DISP]);

  gateway = spawn(process.execPath, [fileURLToPath(new URL("../../apps/gateway/src/main.ts", import.meta.url))], {
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

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.c2@ac.test", password: PASSWORD } });
const dispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.c2@ac.test", password: PASSWORD } });

const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };

// Shared across the tests below, in order. node:test runs them serially.
let s2: ConnectedShell;
let orgId = "", southNode = "", reno = "", msa = "";

test("a tree to hang agreements on, and the register that the override form is drawn from", { skip }, async () => {
  s2 = await owner();
  const org = await s2.gateway.createOrganization({ name: `Amped C2 ${RUN}`, externalRef: RUN, firstRegionNode: { regionId: REGION_SOUTH, name: `Amped C2 / South` } });
  orgId = org.orgId; southNode = org.regionNodeId;
  reno = (await s2.gateway.createAccount({ orgId, tier: "location", parentId: southNode, name: `Reno ${RUN}` })).id;

  const { terms } = await s2.gateway.termRegister();
  assert.ok(terms.length >= 11);
  const payment = terms.find((t) => t.key === "payment_terms_days")!;
  assert.deepEqual(payment.authoring, ["parent"], "the register travels, so the form offers no tier the trigger would refuse");
  const sla = terms.find((t) => t.key === "sla_response")!;
  assert.equal(sla.combine.kind, "ratchet");

  // The register is served to S2 and S6 alike, and to nobody else.
  const s3 = await dispatcher();
  await assert.rejects(s3.gateway.termRegister(), (e: unknown) => refusal(s3, e).kind === "scope");
});

test("an agreement is recorded against the parent, and regionId is an input THERE and refused below it", { skip }, async () => {
  const out = await s2.gateway.createContract({
    orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "msa", billingPath: "enterprise_sla",
    signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true,
  });
  msa = out.id;
  assert.equal(out.regionId, REGION_SOUTH);

  const row = (await admin(`SELECT state, region_id, diagnostic_data_rights_reserved FROM contracts WHERE id = $1`, [msa]))[0]!;
  assert.equal(row.state, "draft", "an agreement starts as a draft; activation is its own step");
  assert.equal(row.region_id, REGION_SOUTH);
  assert.equal(row.diagnostic_data_rights_reserved, true);

  // Below parent scope the region follows the node's edge, and naming it is refused.
  await assert.rejects(
    s2.gateway.createContract({
      orgId, regionId: REGION_WEST, scopeTier: "location", scopeId: reno, kind: "location_agreement",
      billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: false,
    }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "region_not_an_input" && r.axis === "structural"; },
  );

  const local = await s2.gateway.createContract({
    orgId, scopeTier: "location", scopeId: reno, kind: "location_agreement", parentContractId: msa,
    billingPath: "enterprise_sla", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: false,
  });
  assert.equal(local.regionId, REGION_SOUTH, "derived from the node, not typed");
});

test("OQ5 unstated is a 400, not a 422 — nothing was refused on its merits, because no position was stated", { skip }, async () => {
  await assert.rejects(
    s2.gateway.createContract({
      orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "msa", billingPath: "project",
      signedAt: "2026-01-05", effectiveFrom: "2026-01-01",
    } as never),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "bad_request", JSON.stringify(r));
      assert.match(r.message, /OQ5 is answered at signature/);
      return true;
    },
  );
  assert.equal(s2.isDegraded(), false, "a 400 is not an outage");
});

test("the scope's existence at its declared tier is the TRIGGER's to refuse, in its own words", { skip }, async () => {
  // Reno is a location. Declaring it a site reaches ac_contract_scope_exists.
  await assert.rejects(
    s2.gateway.createContract({
      orgId, scopeTier: "site", scopeId: reno, kind: "location_agreement",
      billingPath: "one_time", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true,
    }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.equal(r.code, "ac_contract_scope_exists", "the code is the trigger's name");
      assert.equal(r.axis, "structural");
      assert.match(r.message, /contract scope site:.* does not exist in org/);
      return true;
    },
  );
  assert.equal(s2.isDegraded(), false);
});

test("the agreement's own shape: an amendment names its MSA, a window that ends before it starts covers nothing", { skip }, async () => {
  await assert.rejects(
    s2.gateway.createContract({
      orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "amendment",
      billingPath: "enterprise_sla", signedAt: "2026-02-01", effectiveFrom: "2026-02-01", diagnosticDataRightsReserved: true,
    }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "amendment_needs_parent"; },
  );
  await assert.rejects(
    s2.gateway.createContract({
      orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "msa",
      billingPath: "enterprise_sla", signedAt: "2026-02-01", effectiveFrom: "2026-03-01", effectiveTo: "2026-02-01", diagnosticDataRightsReserved: true,
    }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.equal(r.code, "empty_window", "said by the handler — Postgres raises 22000 here, which is not a refusal code");
      return true;
    },
  );
  assert.equal(s2.isDegraded(), false, "the inverted range never reached the driver, so nothing was a 500");
});

test("the state ladder over the wire: draft → active → ended, and a step off it is refused by name", { skip }, async () => {
  const activated = await s2.gateway.transitionContract({ contractId: msa, to: "active" });
  assert.equal(activated.state, "active");
  const audit = (await admin(`SELECT action, before, after FROM audit_log WHERE event_id = $1`, [activated.eventId]))[0]!;
  assert.equal(audit.action, "contract.active");
  assert.equal(audit.before.state, "draft");
  assert.equal(audit.after.state, "active");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [activated.eventId]))[0]!.topic, "contract.amended");

  await assert.rejects(
    s2.gateway.transitionContract({ contractId: msa, to: "active" }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "illegal_transition"; },
  );

  // A separate agreement, ended, to show both endings carry one topic with the ending in the payload.
  const throwaway = await s2.gateway.createContract({
    orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "one_time",
    billingPath: "one_time", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: false,
  });
  await s2.gateway.transitionContract({ contractId: throwaway.id, to: "active" });
  const ended = await s2.gateway.transitionContract({ contractId: throwaway.id, to: "terminated" });
  const out = (await admin(`SELECT topic, payload FROM outbox WHERE event_id = $1`, [ended.eventId]))[0]!;
  assert.equal(out.topic, "contract.expired");
  assert.equal(out.payload.to, "terminated", "which ending it was is in the payload, not in a second topic");

  await assert.rejects(
    s2.gateway.createContract({
      orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "amendment", parentContractId: throwaway.id,
      billingPath: "one_time", signedAt: "2026-03-01", effectiveFrom: "2026-03-01", diagnosticDataRightsReserved: true,
    }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "parent_contract_ended"; },
  );
});

test("FINDING 1 — a location setting a parent-only term is 422 STRUCTURAL: nothing to escalate, the row is wrong", { skip }, async () => {
  await assert.rejects(
    s2.gateway.authorTermOverride({
      contractId: msa, scopeTier: "location", scopeId: reno, termKey: "payment_terms_days", termValue: 30,
      effectiveFrom: "2026-01-01", orgId, regionId: REGION_SOUTH,
    }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.equal(r.code, "illegal_tier");
      assert.equal(r.axis, "structural", "the card says: this row can never be valid here");
      assert.match(r.message, /payment_terms_days/);
      return true;
    },
  );
  assert.equal(String((await admin(`SELECT count(*) FROM contract_term_overrides WHERE org_id = $1 AND term_key = 'payment_terms_days'`, [orgId]))[0]!.count), "0");
});

test("FINDING 2 — Reno relaxing an SLA the parent carries is 422 COMMERCIAL, and the resolver agrees from the other end", { skip }, async () => {
  // The parent carries 4-hour. That is the exposure the MSA priced.
  await s2.gateway.authorTermOverride({
    contractId: msa, scopeTier: "parent", scopeId: orgId, termKey: "sla_response", termValue: "4_hour",
    effectiveFrom: "2026-01-01", orgId, regionId: REGION_SOUTH,
  });

  // Tightening is correct and is admitted.
  const tightened = await s2.gateway.authorTermOverride({
    contractId: msa, scopeTier: "location", scopeId: reno, termKey: "sla_response", termValue: "2_hour",
    effectiveFrom: "2026-01-01", effectiveTo: "2026-06-01", orgId, regionId: REGION_SOUTH,
  });
  assert.ok(tightened.id);

  // Relaxing is not. Someone has to agree to it and price it.
  await assert.rejects(
    s2.gateway.authorTermOverride({
      contractId: msa, scopeTier: "location", scopeId: reno, termKey: "sla_response", termValue: "48_hour",
      effectiveFrom: "2026-07-01", orgId, regionId: REGION_SOUTH,
    }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.equal(r.code, "ratchet_loosened");
      assert.equal(r.axis, "commercial", "the card says: someone has to agree to this and price it");
      return true;
    },
  );

  // THE RESOLVER AGREEING. The same answer reached from the other end, with the
  // trace naming every rung — which is what makes the refusal checkable rather
  // than merely authoritative.
  const resolved = await s2.gateway.resolvedTerms({ orgId, tier: "location", nodeId: reno, asOf: "2026-03-01", termKeys: "sla_response,payment_terms_days" });
  const sla = resolved.resolved.sla_response!;
  assert.equal(sla.value, "2_hour", "the tightened row won at the location");
  assert.notEqual(sla.wonAt, "fallback");
  if (sla.wonAt !== "fallback") assert.equal(sla.wonAt.tier, "location");
  assert.ok(sla.trace.some((t) => t.tier === "parent" && t.value === "4_hour"), "the parent rung is in the trace, with what it carried");

  const payment = resolved.resolved.payment_terms_days;
  const refusedPayment = resolved.refused.payment_terms_days;
  assert.ok(payment || refusedPayment, "the term was asked for and answered one way or the other");
  if (payment) {
    assert.ok(
      payment.trace.some((t) => t.tier === "location" && t.outcome === "not_walked"),
      "the rung the register does not let this term be authored at is marked not_walked — which is the sentence finding 1 is the other face of",
    );
  }
});

test("the overlap-then-orphan chain: a second row in effect at once is refused, and so is an override with no agreement", { skip }, async () => {
  // Overlap. The EXCLUDE constraint is the layer under domain admission, and the
  // state it prevents is unrepresentable rather than tie-broken: every tie-break
  // available produces an invoice that is wrong in a way nobody can see.
  await assert.rejects(
    s2.gateway.authorTermOverride({
      contractId: msa, scopeTier: "location", scopeId: reno, termKey: "sla_response", termValue: "1_hour",
      effectiveFrom: "2026-02-01", effectiveTo: "2026-04-01", orgId, regionId: REGION_SOUTH,
    }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.ok(r.code === "overlap" || r.code === "term_override_no_overlap", `overlap, by either layer: ${r.code}`);
      assert.equal(r.axis, "structural");
      return true;
    },
  );

  // Orphan. An override belongs to a document; naming one that does not exist
  // is refused by the foreign key, as a 422 and not a 500.
  await assert.rejects(
    s2.gateway.authorTermOverride({
      contractId: U(999), scopeTier: "parent", scopeId: orgId, termKey: "invoice_delivery", termValue: "edi",
      effectiveFrom: "2026-01-01", orgId, regionId: REGION_SOUTH,
    }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.axis === "structural"; },
  );
  assert.equal(s2.isDegraded(), false, "two refusals in a row, and the surface is still up");
});

test("the agreements and overrides come back as the screens list them, narrowed by term and by agreement", { skip }, async () => {
  const all = await s2.gateway.listContracts({ orgId });
  assert.ok(all.contracts.length >= 3);
  const mine = all.contracts.find((c) => c.id === msa)!;
  assert.equal(mine.state, "active");
  assert.equal(mine.regionId, REGION_SOUTH, "the region is on the wire, because the override screen authors against this row");
  assert.equal(mine.diagnosticDataRightsReserved, true);
  assert.ok(all.contracts.some((c) => c.diagnosticDataRightsReserved === false), "an agreement signed without the reservation is visible as one");

  const byScope = await s2.gateway.listContracts({ orgId, scopeId: reno });
  assert.ok(byScope.contracts.every((c) => c.scopeId === reno));

  const overrides = await s2.gateway.listTermOverrides({ orgId, termKey: "sla_response" });
  assert.ok(overrides.overrides.length >= 2);
  assert.ok(overrides.overrides.every((o) => o.termKey === "sla_response"));
  const byContract = await s2.gateway.listTermOverrides({ orgId, contractId: msa });
  assert.ok(byContract.overrides.every((o) => o.contractId === msa));

  await assert.rejects(
    s2.gateway.listTermOverrides({ orgId, termKey: "sla_responce" }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "unknown_term"; },
    "a typo is refused by name rather than answered with an empty list that reads as 'nothing overridden'",
  );
});

test("C2 is S2's: S3 may read the register and nothing else here", { skip }, async () => {
  const s3 = await dispatcher();
  for (const call of [
    () => s3.gateway.listContracts({ orgId }),
    () => s3.gateway.createContract({ orgId, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: orgId, kind: "msa", billingPath: "one_time", signedAt: "2026-01-05", effectiveFrom: "2026-01-01", diagnosticDataRightsReserved: true }),
    () => s3.gateway.transitionContract({ contractId: msa, to: "terminated" }),
    () => s3.gateway.listTermOverrides({ orgId }),
  ]) {
    await assert.rejects(call(), (e: unknown) => refusal(s3, e).kind === "scope");
  }
  assert.equal((await admin(`SELECT state FROM contracts WHERE id = $1`, [msa]))[0]!.state, "active", "nothing S3 attempted took effect");
});
