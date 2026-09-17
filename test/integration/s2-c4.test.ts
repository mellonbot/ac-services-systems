/**
 * C4 OVER THE WIRE — the subcontractor network S2 records, through the shell,
 * against a spawned gateway and a live PostgreSQL (09 §6 item 7).
 *
 *   DATABASE_URL=postgres://... npm run test:integration
 *
 * The sentence this suite holds is the one arc 5 of the actor map turns on:
 *
 *   "Only S2 verifies a credential. An unverified certificate is not a
 *    certificate."
 *
 * On the wire that is four refusals and one admission — a document inserted
 * verified is refused on EVERY path including the superuser's; a verification
 * from any surface but S2 is refused; a verified document is immutable to
 * everyone; a second verification is refused by name; and S2's one verification
 * sets now and the acting principal. Around it: the firm's door (one id, two
 * rows, one unit of work), the ladder with the MSA on the way to active, a
 * crew's tenancy following its employment, the rate that closes the one before
 * it and the EXCLUDE that refuses the one that overlaps, and a firm on S8
 * seeing its own rows and no other firm's — by RLS, not by a WHERE.
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
const skip = URL_ ? false : "DATABASE_URL not set — C4 was not verified over the wire";
if (!URL_) test("c4 over the wire", { skip }, () => {});

const PORT = 21080 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const U = (n: number) => `c4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const USER_OWNER = U(1), USER_DISP = U(2);
const PASSWORD = "correct horse battery staple";
const RUN = `c4-${Date.now().toString(36)}`;

let pool: Pool;
let gateway: ChildProcess;
const admin = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { return (await c.query(sql, params)).rows; } finally { c.release(); }
};
/** A statement inside one scope-bound transaction, as the gateway role — the database's view of "who is writing". */
const asBinding = async (binding: Record<string, string>, sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE ac_gateway");
    for (const [k, v] of Object.entries(binding)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
};

before(async () => {
  if (!URL_) return;
  pool = createPool(URL_, "ac-c4-test");
  await admin(`INSERT INTO regions (id, code, name) VALUES ($1,'WEST','West'), ($2,'SOUTH','South') ON CONFLICT (id) DO NOTHING`, [REGION_WEST, REGION_SOUTH]);
  await admin(`INSERT INTO currencies (code) VALUES ('USD') ON CONFLICT DO NOTHING`).catch(() => {});
  const hash = hashPassword(PASSWORD);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, password_hash, active)
    VALUES ($1,$2,$3,'internal','owner.c4@ac.test','Account Owner','["account_owner"]','parent',$2,$4,true),
           ($5,$2,$3,'internal','disp.c4@ac.test','Dispatcher','["dispatcher"]','region',$3,$4,true)
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

const owner = () => connectShell({ surfaceId: "S2", baseUrl: BASE, fetch, credentials: { email: "owner.c4@ac.test", password: PASSWORD } });
const dispatcher = () => connectShell({ surfaceId: "S3", baseUrl: BASE, fetch, credentials: { email: "disp.c4@ac.test", password: PASSWORD } });
const refusal = (s: ConnectedShell, e: unknown) => { const r = s.refusalOf(e); assert.ok(r, `not a refusal: ${String(e)}`); return r!; };
const pgCode = (e: unknown) => (e as { code?: string }).code;

// Shared across the tests below, in order. node:test runs them serially.
let s2: ConnectedShell;
let firmA = "", firmB = "", crewA = "", crewOurs = "", coi = "", rateJan = "", rateOct = "";

test("a firm enters through one door: the tenant root and the operational row share an id, in one unit of work", { skip }, async () => {
  s2 = await owner();
  const out = await s2.gateway.createFirm({ legalName: `Firm A ${RUN}`, regionId: REGION_SOUTH, settlementTermsDays: 30, diagnosticDataRightsReserved: true, externalRef: RUN });
  firmA = out.id;
  assert.equal(out.regionId, REGION_SOUTH);
  const org = (await admin(`SELECT kind, name FROM organizations WHERE id = $1`, [firmA]))[0]!;
  assert.equal(org.kind, "subcontractor");
  const firm = (await admin(`SELECT org_id, region_id, status, diagnostic_data_rights_reserved FROM subcontractor_firms WHERE id = $1`, [firmA]))[0]!;
  assert.equal(firm.org_id, firmA, "the firm IS its organization");
  assert.equal(firm.status, "onboarding");
  assert.equal(firm.diagnostic_data_rights_reserved, true);
  const audit = await admin(`SELECT action, entity, org_id, region_id FROM audit_log WHERE event_id = $1`, [out.eventId]);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.entity, "subcontractor_firm");
  assert.equal(audit[0]!.org_id, firmA, "the audit row is in the firm's own tenancy");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [out.eventId]))[0]!.topic, "firm.created");

  // The old door is closed for firms.
  await assert.rejects(
    s2.gateway.createOrganization({ name: `Firm Z ${RUN}`, kind: "subcontractor", firstRegionNode: { regionId: REGION_SOUTH, name: "Z / South" } }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "use_firms_create" && r.axis === "structural"; },
  );
  // OQ5 firm-side unstated is a 400, as it is for an agreement.
  await assert.rejects(
    s2.gateway.createFirm({ legalName: `Firm Q ${RUN}`, regionId: REGION_SOUTH, settlementTermsDays: 30 } as never),
    (e: unknown) => refusal(s2, e).kind === "bad_request",
  );
  assert.equal(s2.isDegraded(), false);

  // A second firm, for the isolation tests below.
  firmB = (await s2.gateway.createFirm({ legalName: `Firm B ${RUN}`, regionId: REGION_SOUTH, settlementTermsDays: 45, diagnosticDataRightsReserved: false, msaSignedAt: "2026-01-10" })).id;
});

test("the ladder: activation needs the MSA; suspension is reversible; termination is final", { skip }, async () => {
  await assert.rejects(
    s2.gateway.updateFirm({ firmId: firmA, status: "active" }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "msa_unsigned" && r.axis === "structural"; },
  );
  const active = await s2.gateway.updateFirm({ firmId: firmA, status: "active", msaSignedAt: "2026-09-01" });
  assert.equal(active.status, "active");
  const out = (await admin(`SELECT topic, payload FROM outbox WHERE event_id = $1`, [active.eventId]))[0]!;
  assert.equal(out.topic, "firm.status_changed");
  assert.equal(out.payload.from, "onboarding");
  assert.equal(out.payload.to, "active");

  const renamed = await s2.gateway.updateFirm({ firmId: firmA, legalName: `Firm A Holdings ${RUN}` });
  assert.equal(renamed.status, "active", "an attribute change is not a step");
  assert.equal((await admin(`SELECT name FROM organizations WHERE id = $1`, [firmA]))[0]!.name, `Firm A Holdings ${RUN}`, "the root is renamed with the row");
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [renamed.eventId]))[0]!.topic, "firm.updated");

  await s2.gateway.updateFirm({ firmId: firmB, status: "active" });
  await s2.gateway.updateFirm({ firmId: firmB, status: "suspended" });
  assert.equal((await s2.gateway.updateFirm({ firmId: firmB, status: "active" })).status, "active", "suspension is reversible");
  await assert.rejects(
    s2.gateway.updateFirm({ firmId: firmA, status: "onboarding" as never }),
    (e: unknown) => refusal(s2, e).kind === "bad_request",
    "onboarding is where a firm starts, not a step it can take",
  );
});

test("a crew's tenancy follows its employment: ours is ours, theirs is the firm's, and the CHECK never gets to speak", { skip }, async () => {
  crewOurs = (await s2.gateway.createCrew({ label: `Crew W1 ${RUN}`, employmentType: "employed", homeRegionId: REGION_WEST })).id;
  crewA = (await s2.gateway.createCrew({ label: `Crew A1 ${RUN}`, employmentType: "subcontracted", firmId: firmA, homeRegionId: REGION_SOUTH })).id;
  const rows = await admin(`SELECT id, org_id, region_id, home_region_id, firm_id FROM crews WHERE id IN ($1, $2)`, [crewOurs, crewA]);
  const ours = rows.find((r) => r.id === crewOurs)!, theirs = rows.find((r) => r.id === crewA)!;
  assert.equal(ours.org_id, INTERNAL_ORG_ID);
  assert.equal(ours.firm_id, null);
  assert.equal(theirs.org_id, firmA);
  assert.equal(theirs.region_id, REGION_SOUTH);
  assert.equal(theirs.region_id, theirs.home_region_id, "tenancy region equals home region on insert");

  await assert.rejects(
    s2.gateway.createCrew({ label: "x", employmentType: "subcontracted", homeRegionId: REGION_SOUTH }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "firm_required"; },
  );
  await assert.rejects(
    s2.gateway.createCrew({ label: "x", employmentType: "employed", firmId: firmA, homeRegionId: REGION_SOUTH }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "firm_not_an_input"; },
  );

  const listed = await s2.gateway.listCrews({ firmId: firmA });
  assert.equal(listed.crews.length, 1);
  assert.deepEqual(listed.crews[0]!.documents.missing, ["insurance", "license", "background_check"], "the gate's whole set, missing — the summary is the gate's question asked of today");
  assert.equal(listed.crews[0]!.documents.earliestExpiry, null);
});

test("A DOCUMENT ARRIVES UNVERIFIED — on every path. The superuser's INSERT with verified_at set is refused by the trigger", { skip }, async () => {
  coi = (await s2.gateway.recordCredential({ crewId: crewA, kind: "insurance", identifier: `COI ${RUN}`, validFrom: "2026-01-01", validTo: "2027-06-30" })).id;
  const row = (await admin(`SELECT verified_at, verified_by FROM crew_credentials WHERE id = $1`, [coi]))[0]!;
  assert.equal(row.verified_at, null);
  assert.equal(row.verified_by, null);

  // The raw path, as superuser, with the verification typed in.
  await assert.rejects(
    admin(`INSERT INTO crew_credentials (org_id, region_id, crew_id, kind, identifier, valid_from, valid_to, verified_at, verified_by)
           VALUES ($1, $2, $3, 'license', 'forged', '2026-01-01', '2027-01-01', now(), $4)`, [firmA, REGION_SOUTH, crewA, USER_OWNER]),
    (e: unknown) => pgCode(e) === "AC422" && /recorded unverified/.test(String(e)),
  );

  const listed = await s2.gateway.listCrews({ firmId: firmA });
  assert.deepEqual(listed.crews[0]!.documents.unverified, ["insurance"], "on file, on the list, AS unverified — and clearing nothing");
  assert.deepEqual(listed.crews[0]!.documents.satisfied, []);
});

test("ONLY S2 VERIFIES. A verification from S3's binding is refused; by a principal other than the actor is refused; S2's sets now and the principal, once", { skip }, async () => {
  // The database's view: an internal principal, acting as S3. Not a 403 at the gateway — the TRIGGER says no.
  await assert.rejects(
    asBinding({ "ac.namespace": "internal", "ac.surface_id": "S3", "ac.actor_id": USER_DISP, "ac.scope_tier": "region", "ac.region_id": REGION_SOUTH },
      `UPDATE crew_credentials SET verified_at = now(), verified_by = $2 WHERE id = $1`, [coi, USER_DISP]),
    (e: unknown) => pgCode(e) === "AC403" && /only the Service Manager/.test(String(e)),
  );
  // S2, but naming somebody else as the verifier.
  await assert.rejects(
    asBinding({ "ac.namespace": "internal", "ac.surface_id": "S2", "ac.actor_id": USER_OWNER, "ac.scope_tier": "parent" },
      `UPDATE crew_credentials SET verified_at = now(), verified_by = $2 WHERE id = $1`, [coi, USER_DISP]),
    (e: unknown) => pgCode(e) === "AC422" && /verified_by must be the acting principal/.test(String(e)),
  );
  // The dispatcher's surface cannot even reach the operation.
  const s3 = await dispatcher();
  await assert.rejects(s3.gateway.verifyCredential({ credentialId: coi }), (e: unknown) => refusal(s3, e).kind === "scope");
  assert.equal((await admin(`SELECT verified_at FROM crew_credentials WHERE id = $1`, [coi]))[0]!.verified_at, null, "three attempts, still unverified");

  // The one path.
  const v = await s2.gateway.verifyCredential({ credentialId: coi });
  assert.equal(v.verifiedBy, USER_OWNER, "the principal who did it, from the token — not an input");
  const row = (await admin(`SELECT verified_at, verified_by FROM crew_credentials WHERE id = $1`, [coi]))[0]!;
  assert.ok(row.verified_at);
  assert.equal(row.verified_by, USER_OWNER);
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [v.eventId]))[0]!.topic, "credential.verified");

  // Once.
  await assert.rejects(
    s2.gateway.verifyCredential({ credentialId: coi }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "already_verified" && r.axis === "structural"; },
  );
  // And immutable afterwards — to the superuser too. A clearance may cite it by id.
  await assert.rejects(
    admin(`UPDATE crew_credentials SET valid_to = '2030-01-01' WHERE id = $1`, [coi]),
    (e: unknown) => pgCode(e) === "AC403" && /immutable/.test(String(e)),
  );
  await assert.rejects(
    admin(`UPDATE crew_credentials SET verified_at = NULL, verified_by = NULL WHERE id = $1`, [coi]),
    (e: unknown) => pgCode(e) === "AC403",
    "un-verifying is a rewrite of history, not a correction",
  );

  const listed = await s2.gateway.listCrews({ firmId: firmA });
  assert.deepEqual(listed.crews[0]!.documents.satisfied, ["insurance"]);
  assert.deepEqual(listed.crews[0]!.documents.missing, ["license", "background_check"]);
  assert.equal(listed.crews[0]!.documents.earliestExpiry, "2027-06-30");
  assert.equal(s2.isDegraded(), false, "every refusal above was a refusal, not an outage");
});

test("a rate is set from a day forward: the row in effect is closed at it; an overlap is the EXCLUDE's to refuse, and the close rolls back with it", { skip }, async () => {
  const jan = await s2.gateway.setRateCard({ firmId: firmA, serviceCode: "hvac_repair", rateMinor: "9500", currency: "USD", effectiveFrom: "2026-01-01" });
  rateJan = jan.id;
  assert.equal(jan.closedId, null);
  const oct = await s2.gateway.setRateCard({ firmId: firmA, serviceCode: "HVAC_REPAIR", rateMinor: "9900", currency: "USD", effectiveFrom: "2026-10-01" });
  rateOct = oct.id;
  assert.equal(oct.closedId, rateJan, "the January row was the one in effect on 1 October");
  let cards = (await s2.gateway.listRateCards({ firmId: firmA })).rateCards;
  assert.deepEqual(cards.map((c) => [c.rateMinor, c.effectiveFrom, c.effectiveTo]), [["9500", "2026-01-01", "2026-10-01"], ["9900", "2026-10-01", null]]);
  const audits = await admin(`SELECT action FROM audit_log WHERE entity = 'rate_card' AND entity_id IN ($1, $2) ORDER BY occurred_at, action`, [rateJan, rateOct]);
  assert.deepEqual(audits.map((a) => a.action).sort(), ["rate_card.close", "rate_card.set", "rate_card.set"], "the close is its own audited mutation");

  // Overlap: a bounded rate from September to December. The handler closes
  // January at 1 September and inserts; the insert collides with October's
  // row; the EXCLUDE refuses; the whole unit of work — the close included — is
  // rolled back. Two prices on one day is unrepresentable, not tie-broken.
  await assert.rejects(
    s2.gateway.setRateCard({ firmId: firmA, serviceCode: "HVAC_REPAIR", rateMinor: "9700", currency: "USD", effectiveFrom: "2026-09-01", effectiveTo: "2026-12-01" }),
    (e: unknown) => {
      const r = refusal(s2, e);
      assert.equal(r.kind, "admission", JSON.stringify(r));
      if (r.kind !== "admission") return false;
      assert.equal(r.code, "rate_cards_no_overlap", "the constraint's name is the code");
      assert.equal(r.axis, "structural");
      return true;
    },
  );
  cards = (await s2.gateway.listRateCards({ firmId: firmA })).rateCards;
  assert.deepEqual(cards.map((c) => c.effectiveTo), ["2026-10-01", null], "the refused unit of work left January exactly as it was");

  await assert.rejects(
    s2.gateway.setRateCard({ firmId: firmA, serviceCode: "HVAC_REPAIR", rateMinor: "9999", currency: "USD", effectiveFrom: "2026-10-01" }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "rate_begins_same_day"; },
  );
  await assert.rejects(
    s2.gateway.setRateCard({ firmId: firmA, serviceCode: "HVAC_REPAIR", rateMinor: JSON.parse("99.5") as never, currency: "USD", effectiveFrom: "2027-01-01" }),
    (e: unknown) => refusal(s2, e).kind === "bad_request",
    "a JSON number is a double, not money",
  );
  assert.equal(s2.isDegraded(), false);
});

test("a firm on S8 sees its own firm, crews, documents and price and no other firm's — RLS, not a WHERE — and cannot write", { skip }, async () => {
  const USER_FIRM_A = U(5);
  await admin(`INSERT INTO users (id, org_id, region_id, namespace, email, display_name, roles, scope_tier, scope_id, firm_id, password_hash, active)
    VALUES ($1,$2,$3,'subcontractor',$4,'Firm A Coordinator','[]','parent',$2,$2,$5,true)
    ON CONFLICT (id) DO UPDATE SET org_id = EXCLUDED.org_id, scope_id = EXCLUDED.scope_id, firm_id = EXCLUDED.firm_id, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, active = true`,
    [USER_FIRM_A, firmA, REGION_SOUTH, `coord.${RUN}@firma.test`, hashPassword(PASSWORD)]);
  // Firm B has a crew and a rate too, so "nothing else" is a real statement.
  const crewB = (await s2.gateway.createCrew({ label: `Crew B1 ${RUN}`, employmentType: "subcontracted", firmId: firmB, homeRegionId: REGION_SOUTH })).id;
  await s2.gateway.recordCredential({ crewId: crewB, kind: "license", identifier: `LIC-B ${RUN}`, validFrom: "2026-01-01", validTo: "2027-01-01" });
  await s2.gateway.setRateCard({ firmId: firmB, serviceCode: "HVAC_REPAIR", rateMinor: "8800", currency: "USD", effectiveFrom: "2026-01-01" });

  const s8 = await connectShell({ surfaceId: "S8", baseUrl: BASE, fetch, credentials: { email: `coord.${RUN}@firma.test`, password: PASSWORD } });
  const firms = (await s8.gateway.listFirms({})).firms;
  assert.deepEqual(firms.map((f) => f.id), [firmA], "one row: itself");
  const crews = (await s8.gateway.listCrews({})).crews;
  assert.deepEqual(crews.map((c) => c.id), [crewA], "its own crews, not the region's");
  const docs = (await s8.gateway.listCredentials({ firmId: firmA })).credentials;
  assert.deepEqual(docs.map((d) => d.id), [coi]);
  assert.equal((await s8.gateway.listCredentials({ firmId: firmB })).credentials.length, 0, "asking for the other firm's documents by id returns nothing, not a 403 that confirms they exist");
  assert.equal((await s8.gateway.listRateCards({ firmId: firmA })).rateCards.length, 2);
  assert.equal((await s8.gateway.listRateCards({ firmId: firmB })).rateCards.length, 0, "the other firm's pricing: zero rows");

  // Writes are S2's. The firm proposes; it does not record.
  for (const call of [
    () => s8.gateway.recordCredential({ crewId: crewA, kind: "license", identifier: "x", validFrom: "2026-01-01", validTo: "2027-01-01" }),
    () => s8.gateway.verifyCredential({ credentialId: coi }),
    () => s8.gateway.setRateCard({ firmId: firmA, serviceCode: "HVAC_REPAIR", rateMinor: "1", currency: "USD", effectiveFrom: "2027-01-01" }),
    () => s8.gateway.updateFirm({ firmId: firmA, status: "terminated" }),
  ]) await assert.rejects(call(), (e: unknown) => refusal(s8, e).kind === "scope");
  assert.equal((await admin(`SELECT status FROM subcontractor_firms WHERE id = $1`, [firmA]))[0]!.status, "active", "nothing S8 attempted took effect");

  // And S3 reads none of the registry: the network is S2's and the firm's.
  const s3 = await dispatcher();
  await assert.rejects(s3.gateway.listFirms({}), (e: unknown) => refusal(s3, e).kind === "scope");
});

test("a terminated firm takes no new crew, and a crew's active flag is the only thing S2 changes about it", { skip }, async () => {
  await s2.gateway.updateFirm({ firmId: firmB, status: "terminated" });
  await assert.rejects(
    s2.gateway.createCrew({ label: "late", employmentType: "subcontracted", firmId: firmB, homeRegionId: REGION_SOUTH }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "firm_ended"; },
  );
  await assert.rejects(
    s2.gateway.updateFirm({ firmId: firmB, status: "active" }),
    (e: unknown) => { const r = refusal(s2, e); return r.kind === "admission" && r.code === "illegal_transition"; },
  );
  const off = await s2.gateway.updateCrew({ crewId: crewA, active: false });
  assert.equal((await admin(`SELECT active FROM crews WHERE id = $1`, [crewA]))[0]!.active, false);
  assert.equal((await admin(`SELECT topic FROM outbox WHERE event_id = $1`, [off.eventId]))[0]!.topic, "crew.updated");
  const firm = (await s2.gateway.listFirms({ status: "active" })).firms.find((f) => f.id === firmA)!;
  assert.equal(firm.crewCount, 1);
  assert.equal(firm.activeCrewCount, 0);
});
