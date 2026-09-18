import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, SurfaceWriteDenied, type Tx } from "../unit-of-work.ts";
import { acknowledgeSettlement, disputeSettlement, listSettlements, listSettlementLines } from "./settlements.ts";
import { enrollCrew, retireCrew, submitCredential } from "./network.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * What the HANDLER decides for item 7 — the firm's inputs, the refusals a
 * click can produce with a name, and that firm, type and region are the
 * PRINCIPAL's rather than inputs — against a scripted database. Whether any
 * path can change a statement's total, roster a crew under another firm, or
 * verify a document from S8 is the database's (0007's two triggers, 0005's
 * one) and is held over the wire in test/integration/s8.test.ts.
 */
const U = (n: number) => `a8000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REGION = U(2), FIRM = U(10), CREW = U(12), STMT = U(20), OTHER_FIRM = U(11);

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

const coordinator: Principal = {
  namespace: "subcontractor", subjectId: U(1), orgId: FIRM, regionId: REGION, scopeTier: "parent", scopeId: FIRM,
  roles: [], firmId: FIRM, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-8",
};
let seq = 0;
const NOW = new Date("2026-09-18T15:00:00Z");
const uowFor = async (tx: Tx, principal: Principal = coordinator) =>
  createUnitOfWork({ surfaceId: "S8", principal, requestId: "r", now: () => NOW, newId: () => U(200 + ++seq) }, tx);
const newId = () => U(300 + ++seq);

const stmt = (over: Record<string, unknown> = {}) => ({
  id: STMT, firm_id: FIRM, region_id: REGION, org_id: FIRM, period_from: "2026-08-01", period_to: "2026-08-31", total_minor: "125000", currency: "USD",
  state: "issued", issued_at: "2026-09-02T09:00:00.000Z", acknowledged_at: null, disputed_at: null, dispute_reason: null, line_count: "3", ...over,
});
const firmRow = (over: Record<string, unknown> = {}) => ({
  id: FIRM, org_id: FIRM, region_id: REGION, legal_name: "Firm A LLC", status: "active", settlement_terms_days: 30,
  msa_signed_at: "2026-01-05", diagnostic_data_rights_reserved: true, w9_document_key: null, crew_count: "1", active_crew_count: "1", ...over,
});
const crewRow = (over: Record<string, unknown> = {}) => ({ id: CREW, org_id: FIRM, region_id: REGION, label: "Crew A1", employment_type: "subcontracted", firm_id: FIRM, home_region_id: REGION, active: true, ...over });

// ---------------------------------------------------------------------------
// The statement's position
// ---------------------------------------------------------------------------
test("acknowledge: issued → acknowledged, stamped, under the settlement_ack entity, in the statement's own tenancy", async () => {
  const s = scripted({ "FROM settlements s WHERE s.id": [stmt()] });
  const uow = await uowFor(s.tx);
  const out = await acknowledgeSettlement(uow, { settlementId: STMT }, NOW);
  assert.equal(out.state, "acknowledged");
  assert.equal(out.acknowledgedAt, NOW.toISOString());
  const w = s.queries.find((q) => q.sql.startsWith("UPDATE settlements"))!;
  assert.match(w.sql, /state = 'acknowledged', acknowledged_at = \$2/);
  assert.doesNotMatch(w.sql, /total_minor|period|firm_id/, "the handler touches the position and nothing else on the row");
  const p = uow.pending();
  assert.equal(p.events.length, 1);
  assert.equal(p.events[0]!.topic, "settlement.acknowledged");
  assert.equal(p.audits[0]!.entity, "settlement_ack");
  assert.equal(p.audits[0]!.orgId, FIRM, "a statement's tenancy is the firm's — the firm is a root");
});

test("acknowledge refuses by name: already acknowledged; not issued (draft, disputed, paid); unknown (invisible) statement", async () => {
  for (const [state, code] of [["acknowledged", "already_acknowledged"], ["disputed", "not_issued"], ["paid", "not_issued"], ["draft", "not_issued"]] as const) {
    const s = scripted({ "FROM settlements s WHERE s.id": [stmt({ state, acknowledged_at: state === "acknowledged" ? "2026-09-03T00:00:00.000Z" : null })] });
    await assert.rejects(acknowledgeSettlement(await uowFor(s.tx), { settlementId: STMT }, NOW), (e: unknown) => e instanceof InputRefused && e.code === code, `${state} → ${code}`);
    assert.equal(s.queries.filter((q) => q.sql.startsWith("UPDATE")).length, 0, "nothing written on a refusal");
  }
  const s = scripted({});
  await assert.rejects(acknowledgeSettlement(await uowFor(s.tx), { settlementId: STMT }, NOW), (e: unknown) => e instanceof InputRefused && e.code === "unknown_settlement");
  await assert.rejects(acknowledgeSettlement(await uowFor(s.tx), { settlementId: "nope" }, NOW), BadInput);
});

test("dispute: issued or acknowledged → disputed WITH the reason on the row; an empty reason is refused before the row is read", async () => {
  for (const from of ["issued", "acknowledged"] as const) {
    const s = scripted({ "FROM settlements s WHERE s.id": [stmt({ state: from })] });
    const uow = await uowFor(s.tx);
    const out = await disputeSettlement(uow, { settlementId: STMT, reason: "  Line 2 bills 6h; the ticket shows 4h.  " }, NOW);
    assert.equal(out.state, "disputed");
    const w = s.queries.find((q) => q.sql.startsWith("UPDATE settlements"))!;
    assert.match(w.sql, /state = 'disputed', disputed_at = \$2::timestamptz, dispute_reason = \$3/);
    assert.equal(w.params[2], "Line 2 bills 6h; the ticket shows 4h.", "trimmed");
    const p = uow.pending();
    assert.equal(p.events[0]!.topic, "settlement.disputed");
    assert.equal(p.audits[0]!.entity, "dispute");
    assert.equal((p.events[0]!.payload as { from: string }).from, from);
  }
  const s = scripted({ "FROM settlements s WHERE s.id": [stmt()] });
  await assert.rejects(disputeSettlement(await uowFor(s.tx), { settlementId: STMT, reason: "   " }, NOW), (e: unknown) => e instanceof InputRefused && e.code === "empty_reason");
  assert.equal(s.queries.length, 0, "an empty reason is refused before any read");
});

test("dispute refuses by name: already in dispute; a draft or paid statement", async () => {
  for (const [state, code] of [["disputed", "already_disputed"], ["draft", "not_issued"], ["paid", "not_issued"]] as const) {
    const s = scripted({ "FROM settlements s WHERE s.id": [stmt({ state, disputed_at: state === "disputed" ? "2026-09-04T00:00:00.000Z" : null, dispute_reason: state === "disputed" ? "rate" : null })] });
    await assert.rejects(disputeSettlement(await uowFor(s.tx), { settlementId: STMT, reason: "x" }, NOW), (e: unknown) => e instanceof InputRefused && e.code === code, `${state} → ${code}`);
  }
});

test("the reads: list carries the position and the line count; lines refuse an invisible statement as unknown, and read the job and rate through LEFT JOINs", async () => {
  const s = scripted({ "FROM settlements s": [stmt({ state: "acknowledged", acknowledged_at: "2026-09-03T00:00:00.000Z" })] });
  const out = await listSettlements(await uowFor(s.tx), {});
  assert.equal(out.settlements.length, 1);
  assert.equal(out.settlements[0]!.periodTo, "2026-08-31");
  assert.equal(out.settlements[0]!.acknowledgedAt, "2026-09-03T00:00:00.000Z");
  assert.equal(out.settlements[0]!.lineCount, 3);
  assert.equal(typeof out.settlements[0]!.totalMinor, "string", "money is a string on the wire");
  await assert.rejects(listSettlements(await uowFor(s.tx), { state: "open" as never }), BadInput);

  const none = scripted({});
  await assert.rejects(listSettlementLines(await uowFor(none.tx), { settlementId: STMT }), (e: unknown) => e instanceof InputRefused && e.code === "unknown_settlement");
  const some = scripted({
    "SELECT id FROM settlements": [{ id: STMT }],
    "FROM settlement_lines l": [{ id: U(31), settlement_id: STMT, job_id: U(40), service_code: "HVAC-REPAIR", site_name: "Austin — Roof", rate_card_id: U(50), rate_minor: "9500", quantity_milli: "4000", amount_minor: "38000" }],
  });
  const lines = await listSettlementLines(await uowFor(some.tx), { settlementId: STMT });
  assert.equal(lines.lines.length, 1);
  assert.equal(lines.lines[0]!.quantityMilli, "4000");
  assert.match(some.queries[1]!.sql, /LEFT JOIN jobs j/);
  assert.match(some.queries[1]!.sql, /LEFT JOIN rate_cards r/);
});

// ---------------------------------------------------------------------------
// The roster and the document — firm, type and region are the principal's
// ---------------------------------------------------------------------------
test("enroll: label is the only input — the crew is subcontracted, under the principal's firm, in the firm's region, under the crew_roster entity", async () => {
  const s = scripted({ "FROM subcontractor_firms f WHERE f.id": [firmRow()] });
  const uow = await uowFor(s.tx);
  const out = await enrollCrew(uow, { label: "Crew A2" }, coordinator.firmId, newId);
  assert.equal(out.firmId, FIRM);
  assert.equal(out.regionId, REGION);
  const w = s.queries.find((q) => q.sql.startsWith("INSERT INTO crews"))!;
  assert.match(w.sql, /'subcontracted'/, "the type is not an input");
  assert.equal(w.params[4], FIRM, "the firm is the principal's");
  assert.equal(w.params[2], REGION, "the region is the firm's");
  assert.equal(uow.pending().audits[0]!.entity, "crew_roster");
  assert.equal(uow.pending().events[0]!.topic, "crew.created");
});

test("enroll refuses a suspended or terminated firm by name, an onboarding firm rosters, and a principal with no firm cannot roster", async () => {
  for (const status of ["suspended", "terminated"]) {
    const s = scripted({ "FROM subcontractor_firms f WHERE f.id": [firmRow({ status })] });
    await assert.rejects(enrollCrew(await uowFor(s.tx), { label: "x" }, FIRM, newId), (e: unknown) => e instanceof InputRefused && e.code === "firm_ended", status);
  }
  const ok = scripted({ "FROM subcontractor_firms f WHERE f.id": [firmRow({ status: "onboarding", msa_signed_at: null })] });
  await enrollCrew(await uowFor(ok.tx), { label: "x" }, FIRM, newId);
  const none = scripted({});
  await assert.rejects(enrollCrew(await uowFor(none.tx), { label: "x" }, null, newId), (e: unknown) => e instanceof InputRefused && e.code === "no_firm");
  await assert.rejects(enrollCrew(await uowFor(none.tx), { label: "x" }, FIRM, newId), (e: unknown) => e instanceof InputRefused && e.code === "unknown_firm", "a firm RLS does not show is unknown, not forbidden");
});

test("retire: active=false is refused while the crew holds a live assignment; label and active are the only columns; an invisible crew is unknown", async () => {
  const busy = scripted({ "FROM crews WHERE id": [crewRow()], "FROM assignments WHERE crew_id": [{ n: "1" }] });
  await assert.rejects(retireCrew(await uowFor(busy.tx), { crewId: CREW, active: false }), (e: unknown) => e instanceof InputRefused && e.code === "crew_assigned");
  assert.equal(busy.queries.filter((q) => q.sql.startsWith("UPDATE")).length, 0);

  const free = scripted({ "FROM crews WHERE id": [crewRow()], "FROM assignments WHERE crew_id": [{ n: "0" }] });
  const uow = await uowFor(free.tx);
  await retireCrew(uow, { crewId: CREW, active: false, label: "Crew A1 (left 9/2026)" });
  const w = free.queries.find((q) => q.sql.startsWith("UPDATE crews"))!;
  assert.match(w.sql, /^UPDATE crews SET label = \$2, active = \$3 WHERE id = \$1$/);
  assert.equal(uow.pending().audits[0]!.action, "crew.retire");
  assert.equal(uow.pending().audits[0]!.entity, "crew_roster");

  const rename = scripted({ "FROM crews WHERE id": [crewRow()] });
  await retireCrew(await uowFor(rename.tx), { crewId: CREW, label: "Crew A1 — nights" });
  assert.equal(rename.queries.filter((q) => q.sql.includes("FROM assignments")).length, 0, "a rename does not ask about assignments");

  await assert.rejects(retireCrew(await uowFor(scripted({ "FROM crews WHERE id": [crewRow()] }).tx), { crewId: CREW }), BadInput);
  await assert.rejects(retireCrew(await uowFor(scripted({}).tx), { crewId: CREW, active: false }), (e: unknown) => e instanceof InputRefused && e.code === "unknown_crew");
});

test("submit: the firm's document lands unverified — no verified column in the INSERT — under the compliance_doc entity; another firm's crew is unknown, not forbidden", async () => {
  const s = scripted({ "FROM crews WHERE id": [crewRow()] });
  const uow = await uowFor(s.tx);
  const out = await submitCredential(uow, { crewId: CREW, kind: "insurance", identifier: "COI-2026-A1", validFrom: "2026-01-01", validTo: "2026-12-31", documentKey: "docs/coi-a1.pdf" }, newId);
  assert.equal(out.crewId, CREW);
  const w = s.queries.find((q) => q.sql.startsWith("INSERT INTO crew_credentials"))!;
  assert.doesNotMatch(w.sql, /verified/, "the handler has no way to say verified");
  assert.equal(uow.pending().audits[0]!.entity, "compliance_doc");
  assert.equal(uow.pending().events[0]!.topic, "credential.recorded", "the office's OFC block subscribes: a document to verify");

  // The other firm's crew: RLS hides it, so the scripted answer is empty.
  await assert.rejects(submitCredential(await uowFor(scripted({}).tx), { crewId: OTHER_FIRM, kind: "license", identifier: "x", validFrom: "2026-01-01", validTo: "2026-12-31" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "unknown_crew");
  await assert.rejects(submitCredential(await uowFor(s.tx), { crewId: CREW, kind: "license", identifier: "x", validFrom: "2026-12-31", validTo: "2026-01-01" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "empty_window");
});

test("the allowlist is checked by entity: S8 may write compliance_doc but not crew_credential — the same table, two doors, one of them the firm's", async () => {
  // recordCredential (S2's door) from an S8 unit of work is refused by the registry, not by the handler.
  const { recordCredential } = await import("./network.ts");
  const s = scripted({ "FROM crews WHERE id": [crewRow()] });
  await assert.rejects(recordCredential(await uowFor(s.tx), { crewId: CREW, kind: "license", identifier: "x", validFrom: "2026-01-01", validTo: "2026-12-31" }, newId), SurfaceWriteDenied);
  // And the settlement writes are S8's alone: an S2 unit of work may not acknowledge on a firm's behalf.
  const ops: Principal = { ...coordinator, namespace: "internal", orgId: "00000000-0000-0000-0000-000000000001", scopeId: "00000000-0000-0000-0000-000000000001", roles: ["ops_leadership"], firmId: null };
  const s2 = await createUnitOfWork({ surfaceId: "S2", principal: ops, requestId: "r", now: () => NOW, newId }, scripted({ "FROM settlements s WHERE s.id": [stmt()] }).tx);
  await assert.rejects(acknowledgeSettlement(s2, { settlementId: STMT }, NOW), SurfaceWriteDenied);
});
