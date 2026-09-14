import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTerm, resolveAll, ResolutionError, type Override } from "./resolve.ts";
import { admitOverride, AdmissionRefused } from "./admit.ts";
import { TERM_KEYS } from "../../../contracts/src/terms.ts";
import { OVERRIDES, ILLEGAL, NODES, N, ORG, pathOf } from "./fixtures/amped.ts";

const strip = (o: Override): Omit<Override, "id"> => ({
  contractId: o.contractId, scopeTier: o.scopeTier, scopeId: o.scopeId, termKey: o.termKey,
  termValue: o.termValue, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo,
});

// ---------------------------------------------------------------------------
// The tier count holds
// ---------------------------------------------------------------------------
test("four tiers: every node's path is parent → region → location → site, prefix-closed", () => {
  for (const n of NODES) {
    const p = pathOf(n.tier, n.id);
    const tiers = p.map((x) => x.tier);
    assert.deepEqual(tiers, ["parent", "region", "location", "site"].slice(0, tiers.length));
    assert.equal(p.at(-1)!.id, n.id);
  }
});

test("finding 5: El Paso is dispatched from OUR South region while the customer files it under Mountain — both true, neither structural", () => {
  const elPaso = NODES.find((n) => n.id === N.elPaso)!;
  const boulder = NODES.find((n) => n.id === N.boulder)!;
  assert.equal(elPaso.customerGroup, "Mountain");
  assert.equal(boulder.customerGroup, "Mountain");
  assert.notEqual(elPaso.serviceRegion, boulder.serviceRegion);
  // The path — what the resolver walks and what the shard key derives from — goes through OUR region node.
  assert.equal(pathOf("location", N.elPaso)[1]!.id, N.south);
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------
test("nearest: a site inherits the MSA's payment terms from the parent, and the trace shows every empty rung", () => {
  const r = resolveTerm(OVERRIDES, pathOf("site", N.sanJoseRoof), "payment_terms_days", "2026-06-01");
  assert.equal(r.value, 45);
  assert.deepEqual(r.wonAt, { tier: "parent", id: ORG });
  assert.deepEqual(r.trace.map((s) => s.outcome), ["won", "no_override", "no_override", "no_override"]);
});

test("finding 2, legal direction: San Jose's 4-hour beats the parent's same-day because it is stricter", () => {
  const r = resolveTerm(OVERRIDES, pathOf("site", N.sanJoseRoof), "sla_response", "2026-06-01");
  assert.equal(r.value, "4_hour");
  assert.deepEqual(r.wonAt, { tier: "location", id: N.sanJose });
});

test("finding 2, illegal direction: a looser row found on the path RAISES at resolve, even if it somehow got stored", () => {
  const rows = [...OVERRIDES, ILLEGAL.renoLoosensSla];
  assert.throws(
    () => resolveTerm(rows, pathOf("location", N.reno), "sla_response", "2026-06-01"),
    (e: unknown) => e instanceof ResolutionError && e.code === "ratchet_loosened" && /LOOSER/.test(e.message),
  );
});

test("finding 1: a location-tier payment_terms row is an illegal row, not a preference — resolution refuses", () => {
  const rows = [...OVERRIDES, ILLEGAL.locationPaymentTerms];
  assert.throws(
    () => resolveTerm(rows, pathOf("location", N.elPaso), "payment_terms_days", "2026-06-01"),
    (e: unknown) => e instanceof ResolutionError && e.code === "illegal_tier",
  );
});

test("finding 3: the Carrier warranty is on the roof units and NOT on the basement AHU twenty feet away", () => {
  const roof = resolveTerm(OVERRIDES, pathOf("site", N.boulderRoof), "vendor_warranty", "2026-06-01");
  assert.match(String(roof.value), /Carrier/);
  assert.throws(
    () => resolveTerm(OVERRIDES, pathOf("site", N.boulderAhu), "vendor_warranty", "2026-06-01"),
    (e: unknown) => e instanceof ResolutionError && e.code === "no_value",
  );
  // and the trace says why nothing above was consulted
  assert.equal(roof.trace.filter((s) => s.outcome === "not_walked").length, 3);
});

test("finding 4: two rows in effect at one node is ambiguity — RAISE, never tie-break", () => {
  const rows = [...OVERRIDES, ILLEGAL.boulderCreditA, ILLEGAL.boulderCreditB];
  assert.throws(
    () => resolveTerm(rows, pathOf("location", N.boulder), "sla_credit_pct", "2026-08-01"),
    (e: unknown) => e instanceof ResolutionError && e.code === "ambiguous",
  );
  // Outside the overlap, it resolves cleanly to whichever is in effect.
  assert.equal(resolveTerm(rows, pathOf("location", N.boulder), "sla_credit_pct", "2026-06-01").value, 8);
});

test("not-a-finding: time already works — Austin reprices at 1.5x in February and 1.75x in August", () => {
  const feb = resolveTerm(OVERRIDES, pathOf("location", N.austin), "after_hours_multiplier_milli", "2026-02-10");
  const aug = resolveTerm(OVERRIDES, pathOf("location", N.austin), "after_hours_multiplier_milli", "2026-08-10");
  assert.equal(feb.value, 1500);
  assert.equal(aug.value, 1750);
  // and on the boundary day itself the new row is in effect (half-open ranges)
  assert.equal(resolveTerm(OVERRIDES, pathOf("location", N.austin), "after_hours_multiplier_milli", "2026-07-01").value, 1750);
});

test("register default: a term nobody set falls back only when the register says it may", () => {
  const r = resolveTerm(OVERRIDES, pathOf("location", N.reno), "invoice_delivery", "2026-06-01");
  assert.equal(r.value, "portal");
  assert.equal(r.wonAt, "fallback");
});

test("OQ5: diagnostic_data_rights_reserved has NO default — an org that never stated it cannot resolve it", () => {
  const withoutMsa = OVERRIDES.filter((o) => o.termKey !== "diagnostic_data_rights_reserved");
  assert.throws(
    () => resolveTerm(withoutMsa, pathOf("location", N.reno), "diagnostic_data_rights_reserved", "2026-06-01"),
    (e: unknown) => e instanceof ResolutionError && e.code === "no_value",
  );
});

test("an unregistered term raises rather than defaulting to cascade", () => {
  assert.throws(() => resolveTerm(OVERRIDES, pathOf("location", N.reno), "free_coffee", "2026-06-01"), /not in the term policy register/);
});

test("money crosses jsonb as a string; a number is refused", () => {
  const rows = [...OVERRIDES, ILLEGAL.laborRateAsNumber];
  assert.throws(
    () => resolveTerm(rows, pathOf("location", N.austin), "labor_rate_minor", "2026-06-01"),
    (e: unknown) => e instanceof ResolutionError && e.code === "bad_value",
  );
  assert.equal(resolveTerm(OVERRIDES, pathOf("location", N.austin), "labor_rate_minor", "2026-06-01").value, "14500");
});

test("resolveAll: every registered term at Boulder roof, refusals separated from results", () => {
  const { resolved, refused } = resolveAll(OVERRIDES, pathOf("site", N.boulderRoof), "2026-06-01", TERM_KEYS);
  assert.equal(resolved.pm_visits_per_year!.value, 4);
  assert.equal(resolved.sla_response!.value, "same_day");
  assert.ok(refused.equipment_service_window instanceof ResolutionError); // attach, never set → no_value
  assert.equal(Object.keys(resolved).length + Object.keys(refused).length, TERM_KEYS.length);
});

// ---------------------------------------------------------------------------
// Admission — refused at the point of authoring, where a human can act
// ---------------------------------------------------------------------------
test("every legal fixture row admits against the others", () => {
  for (const o of OVERRIDES) {
    const others = OVERRIDES.filter((x) => x.id !== o.id);
    assert.doesNotThrow(() => admitOverride(strip(o), others, pathOf), o.id);
  }
});

test("admission refuses finding 1 (tier), 2 (ratchet), 3 (attach at location), 4 (overlap), and money-as-number", () => {
  const refuse = (row: Override, code: AdmissionRefused["code"], extra: readonly Override[] = []) =>
    assert.throws(
      () => admitOverride(strip(row), [...OVERRIDES, ...extra], pathOf),
      (e: unknown) => e instanceof AdmissionRefused && e.code === code,
      `${row.id} should refuse with ${code}`,
    );
  refuse(ILLEGAL.locationPaymentTerms, "illegal_tier");
  refuse(ILLEGAL.renoLoosensSla, "ratchet_loosened");
  refuse(ILLEGAL.warrantyAtLocation, "illegal_tier");
  refuse(ILLEGAL.boulderCreditB, "overlap", [ILLEGAL.boulderCreditA]);
  refuse(ILLEGAL.laborRateAsNumber, "bad_value");
});

test("admission refuses tightening ABOVE an existing looser row — it names the rows the customer believes they have", () => {
  // The MSA's own pm_visits row is ended the day the new one starts, so the only objection left is Boulder's existing 4.
  const rows = OVERRIDES.map((o) => (o.id === "o-005" ? { ...o, effectiveTo: "2026-09-01" } : o));
  assert.throws(
    () => admitOverride(strip(ILLEGAL.parentPmVisitsAbove), rows, pathOf),
    (e: unknown) => e instanceof AdmissionRefused && e.code === "would_orphan_descendants" && e.message.includes(N.boulder),
  );
  // Without ending it first, the refusal is the overlap — the earlier, simpler objection.
  assert.throws(() => admitOverride(strip(ILLEGAL.parentPmVisitsAbove), OVERRIDES, pathOf), (e: unknown) => e instanceof AdmissionRefused && e.code === "overlap");
});

test("the refusal message is written for a contract administrator, not a stack trace", () => {
  try {
    admitOverride(strip(ILLEGAL.locationPaymentTerms), OVERRIDES, pathOf);
    assert.fail("should refuse");
  } catch (e) {
    assert.match((e as Error).message, /consolidated invoice/i);
    assert.match((e as Error).message, /may be authored at \[parent\]/);
  }
});

test("ratchet against a mid-window change point: a location row must be stricter at EVERY instant it is in effect", () => {
  // Parent tightens SLA to 2_hour from October. A location row of 4_hour from June is legal in June, illegal in October.
  const parentTightens: Override = { id: "o-090", contractId: "c-x", scopeTier: "parent", scopeId: ORG, termKey: "sla_response", termValue: "2_hour", effectiveFrom: "2026-10-01", effectiveTo: null };
  const base = OVERRIDES.map((o) => (o.id === "o-003" ? { ...o, effectiveTo: "2026-10-01" } : o));
  const rows = [...base, parentTightens];
  const renoFourHour = { contractId: "c-y", scopeTier: "location" as const, scopeId: N.reno, termKey: "sla_response", termValue: "4_hour", effectiveFrom: "2026-06-01", effectiveTo: null };
  assert.throws(() => admitOverride(renoFourHour, rows, pathOf), (e: unknown) => e instanceof AdmissionRefused && e.code === "ratchet_loosened" && /2026-10-01/.test(e.message));
  // Bounded to before October, it admits.
  assert.doesNotThrow(() => admitOverride({ ...renoFourHour, effectiveTo: "2026-10-01" }, rows, pathOf));
});
