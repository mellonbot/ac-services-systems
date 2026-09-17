import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createFirm, updateFirm, createCrew, recordCredential, verifyCredential, setRateCard, summarizeDocuments, NEXT_FIRM_STATES } from "./network.ts";
import { createOrganization } from "./hierarchy.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import type { CredentialWire } from "../../../../packages/contracts/src/operations.ts";
import { admissionAxis } from "../../../../packages/contracts/src/refusals.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";
import { REQUIRED } from "../../../../packages/domain/src/compliance/gate.ts";

/**
 * What the HANDLER decides for C4 — the firm's door, the ladder, a crew's
 * tenancy, that a document arrives unverified, and how a rate is closed —
 * against a scripted database. Whether ANY path can verify a document except
 * S2, and whether two rates can overlap, is the database's (0005 trigger,
 * EXCLUDE constraint) and is held over the wire in test/integration/s2-c4.test.ts.
 */
const U = (n: number) => `c4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REGION = U(2), FIRM = U(10), CREW = U(12), CRED = U(13), OPEN_RATE = U(14);

const scripted = (answers: Record<string, unknown[]>) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      for (const [needle, rows] of Object.entries(answers)) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  return { tx, queries };
};

const ops: Principal = {
  namespace: "internal", subjectId: U(1), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["ops_leadership"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
let seq = 0;
const uowFor = async (tx: Tx) =>
  createUnitOfWork({ surfaceId: "S2", principal: ops, requestId: "r", now: () => new Date("2026-09-16T15:00:00Z"), newId: () => U(200 + ++seq) }, tx);
const newId = () => U(300 + ++seq);

const region = { id: REGION, code: "SOUTH", name: "South", active: true };
const firmRow = (over: Record<string, unknown> = {}) => ({
  id: FIRM, org_id: FIRM, region_id: REGION, legal_name: "Firm A LLC", status: "onboarding", settlement_terms_days: 30,
  msa_signed_at: null, diagnostic_data_rights_reserved: true, w9_document_key: null, crew_count: "0", active_crew_count: "0", ...over,
});
const crewRow = { id: CREW, org_id: FIRM, region_id: REGION, label: "Crew A1", employment_type: "subcontracted", firm_id: FIRM, home_region_id: REGION, active: true };

// ---------------------------------------------------------------------------
// The firm's door
// ---------------------------------------------------------------------------
test("a firm is recorded WITH its tenant root — one id, two rows, one unit of work, one event", async () => {
  const s = scripted({ "FROM regions": [region] });
  const uow = await uowFor(s.tx);
  const out = await createFirm(uow, { legalName: "Firm A LLC", regionId: REGION, settlementTermsDays: 30, diagnosticDataRightsReserved: true }, newId);
  const writes = s.queries.filter((q) => q.sql.startsWith("INSERT"));
  assert.equal(writes.length, 2);
  assert.match(writes[0]!.sql, /INSERT INTO organizations/);
  assert.match(writes[0]!.sql, /'subcontractor'/, "the kind is not an input — a firm's root is a subcontractor by construction");
  assert.match(writes[1]!.sql, /INSERT INTO subcontractor_firms/);
  assert.equal(writes[0]!.params[0], writes[1]!.params[0], "the organization and the firm share an id");
  assert.equal(out.id, writes[1]!.params[0]);
  const pending = uow.pending();
  assert.equal(pending.events.length, 1);
  assert.equal(pending.events[0]!.topic, "firm.created");
  assert.equal(pending.events[0]!.orgId, out.id, "the firm's tenancy is its own organization");
  assert.equal(pending.audits[0]!.regionId, REGION);
  assert.equal((pending.audits[0]!.after as { status: string }).status, "onboarding", "a firm starts onboarding, not active");
});

test("OQ5 firm-side unstated is a 400; an inactive region refuses the firm and leaves no organization behind", async () => {
  const uow = await uowFor(scripted({ "FROM regions": [region] }).tx);
  await assert.rejects(
    createFirm(uow, { legalName: "Firm A LLC", regionId: REGION, settlementTermsDays: 30 } as never, newId),
    (e: unknown) => e instanceof BadInput && /OQ5 is answered in the MSA/.test(String(e)),
  );
  const s = scripted({ "FROM regions": [{ ...region, active: false }] });
  const uow2 = await uowFor(s.tx);
  await assert.rejects(
    createFirm(uow2, { legalName: "Firm A LLC", regionId: REGION, settlementTermsDays: 30, diagnosticDataRightsReserved: false }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "unknown_region",
  );
  assert.equal(s.queries.filter((q) => q.sql.startsWith("INSERT")).length, 0, "nothing was written");
});

test("organizations.create refuses a subcontractor and points at the firm's door", async () => {
  const uow = await uowFor(scripted({ "FROM regions": [region] }).tx);
  await assert.rejects(
    createOrganization(uow, { name: "Firm Z", kind: "subcontractor", firstRegionNode: { regionId: REGION, name: "Z / South" } }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "use_firms_create",
  );
  assert.equal(admissionAxis("use_firms_create"), "structural");
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------
test("the ladder is data: onboarding → active ⇄ suspended → terminated, and termination is final", () => {
  assert.deepEqual(NEXT_FIRM_STATES.onboarding, ["active", "terminated"]);
  assert.deepEqual(NEXT_FIRM_STATES.active, ["suspended", "terminated"]);
  assert.deepEqual(NEXT_FIRM_STATES.suspended, ["active", "terminated"]);
  assert.deepEqual(NEXT_FIRM_STATES.terminated, []);
});

test("activation needs a signed MSA — refused by name without one, admitted when it is signed in the same step", async () => {
  const uow = await uowFor(scripted({ "FROM subcontractor_firms": [firmRow()] }).tx);
  await assert.rejects(
    updateFirm(uow, { firmId: FIRM, status: "active" }),
    (e: unknown) => e instanceof InputRefused && e.code === "msa_unsigned",
  );
  const s = scripted({ "FROM subcontractor_firms": [firmRow()] });
  const uow2 = await uowFor(s.tx);
  const out = await updateFirm(uow2, { firmId: FIRM, status: "active", msaSignedAt: "2026-09-01" });
  assert.equal(out.status, "active");
  const ev = uow2.pending().events[0]!;
  assert.equal(ev.topic, "firm.status_changed");
  assert.deepEqual(ev.payload.from, "onboarding");
  assert.deepEqual(ev.payload.to, "active");
});

test("a step off the ladder is illegal_transition; an attribute change alone is firm.updated and renames the root too", async () => {
  const uow = await uowFor(scripted({ "FROM subcontractor_firms": [firmRow({ status: "terminated" })] }).tx);
  await assert.rejects(
    updateFirm(uow, { firmId: FIRM, status: "active", msaSignedAt: "2026-09-01" }),
    (e: unknown) => e instanceof InputRefused && e.code === "illegal_transition" && /does not move again/.test(e.message),
  );
  const s = scripted({ "FROM subcontractor_firms": [firmRow({ status: "active", msa_signed_at: "2026-01-01" })] });
  const uow2 = await uowFor(s.tx);
  await updateFirm(uow2, { firmId: FIRM, legalName: "Firm A Holdings LLC" });
  assert.equal(uow2.pending().events[0]!.topic, "firm.updated");
  assert.ok(s.queries.some((q) => /UPDATE organizations SET name/.test(q.sql)), "the tenant root says the same name as the operational row");
  await assert.rejects(updateFirm(uow2, { firmId: FIRM }), (e: unknown) => e instanceof BadInput);
});

// ---------------------------------------------------------------------------
// A crew's tenancy follows its employment
// ---------------------------------------------------------------------------
test("an employed crew is ours and names no firm; a subcontracted crew is its firm's and must name it", async () => {
  const s = scripted({ "FROM regions": [region], "FROM subcontractor_firms": [firmRow({ status: "active" })] });
  const uow = await uowFor(s.tx);
  await createCrew(uow, { label: "Crew W1", employmentType: "employed", homeRegionId: REGION }, newId);
  await createCrew(uow, { label: "Crew A1", employmentType: "subcontracted", firmId: FIRM, homeRegionId: REGION }, newId);
  const [ours, theirs] = uow.pending().events;
  assert.equal(ours!.orgId, INTERNAL_ORG_ID);
  assert.equal(theirs!.orgId, FIRM);
  assert.equal(ours!.topic, "crew.created");
  const inserts = s.queries.filter((q) => /INSERT INTO crews/.test(q.sql));
  assert.equal(inserts[0]!.params[5], null, "no firm on an employed crew");
  assert.equal(inserts[1]!.params[5], FIRM);

  await assert.rejects(
    createCrew(uow, { label: "Crew X", employmentType: "employed", firmId: FIRM, homeRegionId: REGION }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "firm_not_an_input",
  );
  await assert.rejects(
    createCrew(uow, { label: "Crew Y", employmentType: "subcontracted", homeRegionId: REGION }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "firm_required",
  );
});

test("a crew under a terminated firm is refused — nobody can dispatch it", async () => {
  const uow = await uowFor(scripted({ "FROM regions": [region], "FROM subcontractor_firms": [firmRow({ status: "terminated" })] }).tx);
  await assert.rejects(
    createCrew(uow, { label: "Crew Z", employmentType: "subcontracted", firmId: FIRM, homeRegionId: REGION }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "firm_ended",
  );
});

// ---------------------------------------------------------------------------
// A document arrives unverified; verification is once, by the acting principal
// ---------------------------------------------------------------------------
test("recordCredential writes no verified_at — not null, ABSENT — and refuses an inverted window by name", async () => {
  const s = scripted({ "FROM crews": [crewRow] });
  const uow = await uowFor(s.tx);
  await recordCredential(uow, { crewId: CREW, kind: "insurance", identifier: "COI-1", validFrom: "2026-01-01", validTo: "2026-12-31" }, newId);
  const ins = s.queries.find((q) => /INSERT INTO crew_credentials/.test(q.sql))!;
  assert.doesNotMatch(ins.sql, /verified/, "the handler cannot even spell the column");
  const ev = uow.pending().events[0]!;
  assert.equal(ev.topic, "credential.recorded");
  assert.equal(ev.orgId, FIRM, "the document is the crew's firm's row");
  await assert.rejects(
    recordCredential(uow, { crewId: CREW, kind: "license", identifier: "L-1", validFrom: "2026-12-31", validTo: "2026-01-01" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "empty_window",
  );
});

test("verifyCredential sets now and the acting principal, once; a second verification is refused by name", async () => {
  const unverified = { id: CRED, crew_id: CREW, kind: "insurance", identifier: "COI-1", valid_from: "2026-01-01", valid_to: "2026-12-31", document_key: null, verified_at: null, verified_by: null, org_id: FIRM, region_id: REGION };
  const s = scripted({ "FROM crew_credentials": [unverified] });
  const uow = await uowFor(s.tx);
  const now = new Date("2026-09-16T15:00:00Z");
  const out = await verifyCredential(uow, { credentialId: CRED }, ops.subjectId, now);
  assert.equal(out.verifiedBy, ops.subjectId);
  assert.equal(out.verifiedAt, now.toISOString());
  const upd = s.queries.find((q) => /UPDATE crew_credentials SET verified_at/.test(q.sql))!;
  assert.equal(upd.params[2], ops.subjectId, "verified_by is the principal, not an input");
  assert.equal(uow.pending().events[0]!.topic, "credential.verified");

  const uow2 = await uowFor(scripted({ "FROM crew_credentials": [{ ...unverified, verified_at: "2026-09-01T00:00:00+00", verified_by: U(9) }] }).tx);
  await assert.rejects(
    verifyCredential(uow2, { credentialId: CRED }, ops.subjectId, now),
    (e: unknown) => e instanceof InputRefused && e.code === "already_verified",
  );
  assert.equal(admissionAxis("already_verified"), "structural");
  assert.equal(admissionAxis("ac_credential_verification_is_earned"), "structural");
});

test("the document summary is the gate's question asked of today: required from the gate, verified AND in window to count", () => {
  const doc = (over: Partial<CredentialWire>): CredentialWire => ({
    id: U(50), crewId: CREW, kind: "insurance", identifier: "x", validFrom: "2026-01-01", validTo: "2026-12-31", documentKey: null, verifiedAt: "2026-02-01T00:00:00Z", verifiedBy: U(1), ...over,
  });
  const today = "2026-09-16";
  const s = summarizeDocuments("subcontracted", [
    doc({ kind: "insurance", validTo: "2026-09-20" }),
    doc({ kind: "license", verifiedAt: null }),
    doc({ kind: "background_check", validTo: "2026-09-01" }),
  ], today);
  assert.deepEqual(s.required, REQUIRED.subcontracted, "the set comes from the gate, not from here");
  assert.deepEqual(s.satisfied, ["insurance"]);
  assert.deepEqual(s.unverified, ["license"], "on file, never verified — the gate's 'unverified'");
  assert.deepEqual(s.expired, ["background_check"], "verified, but not covering today");
  assert.deepEqual(s.missing, []);
  assert.equal(s.earliestExpiry, "2026-09-20", "the one that matters");

  const e = summarizeDocuments("employed", [], today);
  assert.deepEqual(e.required, REQUIRED.employed);
  assert.deepEqual(e.missing, ["license", "background_check"]);
  assert.equal(e.earliestExpiry, null);
});

// ---------------------------------------------------------------------------
// A rate is set from a day forward
// ---------------------------------------------------------------------------
test("setRateCard closes the row in effect at the new first day and inserts — two mutations, both audited, one topic", async () => {
  const open = { id: OPEN_RATE, org_id: FIRM, region_id: REGION, firm_id: FIRM, service_code: "HVAC_REPAIR", rate_minor: "9500", currency: "USD", eff_from: "2026-01-01", eff_to: null };
  const s = scripted({ "FROM subcontractor_firms": [firmRow({ status: "active" })], "effective @>": [open] });
  const uow = await uowFor(s.tx);
  const out = await setRateCard(uow, { firmId: FIRM, serviceCode: "hvac_repair", rateMinor: "9900", currency: "usd", effectiveFrom: "2026-10-01" }, newId);
  assert.equal(out.closedId, OPEN_RATE);
  const close = s.queries.find((q) => /UPDATE rate_cards SET effective/.test(q.sql))!;
  assert.deepEqual(close.params, [OPEN_RATE, "2026-10-01"]);
  const ins = s.queries.find((q) => /INSERT INTO rate_cards/.test(q.sql))!;
  assert.equal(ins.params[4], "HVAC_REPAIR", "service codes are upper-cased so 'hvac_repair' and 'HVAC_REPAIR' are one price line");
  assert.equal(ins.params[5], "9900", "money crosses as a string of minor units");
  const { audits, events } = uow.pending();
  assert.equal(audits.length, 2);
  assert.equal(audits[0]!.action, "rate_card.close");
  assert.equal(audits[1]!.action, "rate_card.set");
  assert.ok(events.every((e) => e.topic === "rate_card.changed"));
});

test("a rate that begins on the same day as the row in effect is refused by name; a float is not money", async () => {
  const open = { id: OPEN_RATE, org_id: FIRM, region_id: REGION, firm_id: FIRM, service_code: "HVAC_REPAIR", rate_minor: "9500", currency: "USD", eff_from: "2026-10-01", eff_to: null };
  const uow = await uowFor(scripted({ "FROM subcontractor_firms": [firmRow({ status: "active" })], "effective @>": [open] }).tx);
  await assert.rejects(
    setRateCard(uow, { firmId: FIRM, serviceCode: "HVAC_REPAIR", rateMinor: "9900", currency: "USD", effectiveFrom: "2026-10-01" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "rate_begins_same_day",
  );
  await assert.rejects(
    // How a double actually arrives: off the wire, as JSON. The lint rule that
    // forbids a float literal in the money path is the same rule this refusal
    // is the runtime half of.
    setRateCard(uow, { firmId: FIRM, serviceCode: "HVAC_REPAIR", rateMinor: JSON.parse("99.5"), currency: "USD", effectiveFrom: "2026-11-01" } as never, newId),
    (e: unknown) => e instanceof BadInput && /not money/.test(String(e)),
  );
  await assert.rejects(
    setRateCard(uow, { firmId: FIRM, serviceCode: "HVAC_REPAIR", rateMinor: "9900", currency: "USD", effectiveFrom: "2026-11-01", effectiveTo: "2026-11-01" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "empty_window",
  );
  assert.equal(admissionAxis("rate_cards_no_overlap"), "structural", "the EXCLUDE constraint's refusal is a wrong row, not a negotiation");
});
