import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createContract, transitionContract, listTermOverrides, termRegister } from "./contracts.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { admissionAxis } from "../../../../packages/contracts/src/refusals.ts";
import { TERM_KEYS } from "../../../../packages/contracts/src/terms.ts";

/**
 * What the HANDLER decides for C2 — the inputs and the agreement's own shape —
 * against a scripted database. Whether the scope exists AT its declared tier
 * is `ac_contract_scope_exists`'s to refuse and is held over the wire in
 * test/integration/s2-c2.test.ts; these are the refusals that never reach the
 * database at all.
 */
const U = (n: number) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), AUSTIN = U(4), OTHER_ORG = U(9), MSA = U(10);

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
  namespace: "internal", subjectId: "u-ops", orgId: "org-internal", regionId: REGION, scopeTier: "parent", scopeId: "org-internal",
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
let seq = 0;
const uowFor = async (tx: Tx) =>
  createUnitOfWork({ surfaceId: "S2", principal: ops, requestId: "r", now: () => new Date("2026-09-16T15:00:00Z"), newId: () => U(200 + ++seq) }, tx);
const newId = () => U(300 + ++seq);

const austinRow = { id: AUSTIN, region_id: REGION, org_id: ORG };
const msaRow = {
  id: MSA, org_id: ORG, region_id: REGION, scope_tier: "parent", scope_id: ORG, kind: "msa",
  parent_contract_id: null, billing_path: "enterprise_sla", signed_at: "2026-01-01T00:00:00+00",
  eff_from: "2026-01-01", eff_to: null, diagnostic_data_rights_reserved: true, document_key: null, state: "active",
};

const BASE = {
  orgId: ORG, scopeTier: "parent", scopeId: ORG, kind: "msa", billingPath: "enterprise_sla",
  signedAt: "2026-02-01", effectiveFrom: "2026-02-01", diagnosticDataRightsReserved: true, regionId: REGION,
} as const;

/** BASE without one field — what a caller who did not state it actually sends. */
const without = (key: keyof typeof BASE): Record<string, unknown> =>
  Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== key));

test("OQ5: a position not stated is a 400, not a refusal — nothing was judged, because nothing was said", async () => {
  const uow = await uowFor(scripted({}).tx);
  await assert.rejects(
    createContract(uow, without("diagnosticDataRightsReserved") as never, newId),
    (e: unknown) => e instanceof BadInput && /OQ5 is answered at signature/.test(String(e)),
  );
  await assert.rejects(
    createContract(uow, { ...BASE, diagnosticDataRightsReserved: "yes" } as never, newId),
    (e: unknown) => e instanceof BadInput,
    "a string is not a position either",
  );
  assert.equal(uow.pending().audits.length, 0, "an unstated position leaves no audit row");
});

test("regionId is an input at parent scope and REFUSED below it — the scope's edge decides", async () => {
  const below = await uowFor(scripted({ "FROM accounts WHERE id": [austinRow] }).tx);
  await assert.rejects(
    createContract(below, { ...BASE, scopeTier: "location", scopeId: AUSTIN, kind: "location_agreement", regionId: REGION }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "region_not_an_input" && admissionAxis(e.code) === "structural",
  );

  // Absent at parent scope is a 400: an organization meets several of our regions, so there is nothing to derive from.
  await assert.rejects(
    createContract(await uowFor(scripted({}).tx), without("regionId") as never, newId),
    (e: unknown) => e instanceof BadInput && /several of our regions/.test(String(e)),
  );
});

test("below parent scope the region comes from the scope node, and the node is read by id ALONE — the tier is the trigger's to judge", async () => {
  const db = scripted({ "FROM accounts WHERE id": [austinRow] });
  const uow = await uowFor(db.tx);
  // Austin is a location; this declares it a site. The handler passes it through.
  const out = await createContract(uow, { ...without("regionId"), scopeTier: "site", scopeId: AUSTIN, kind: "location_agreement" } as never, newId);
  assert.equal(out.regionId, REGION, "the region followed the node, not the input");
  const lookup = db.queries.find((q) => q.sql.includes("FROM accounts WHERE id"))!;
  assert.ok(!lookup.sql.includes("tier"), "the handler must not re-check the ladder — ac_contract_scope_exists owns those words");
  const ins = db.queries.find((q) => q.sql.includes("INSERT INTO contracts"))!;
  assert.equal(ins.params[3], "site", "the declared tier reaches the trigger unchanged");
  assert.equal(ins.params[2], REGION);
});

test("a window that ends on or before it starts is refused here, because Postgres would raise 22000 and 22000 is a 500", async () => {
  const uow = await uowFor(scripted({}).tx);
  for (const to of ["2026-02-01", "2026-01-15"]) {
    await assert.rejects(
      createContract(uow, { ...BASE, effectiveTo: to }, newId),
      (e: unknown) => e instanceof InputRefused && e.code === "empty_window" && /covers no day at all/.test(e.message),
      `effectiveTo ${to}`,
    );
  }
  assert.equal(uow.pending().audits.length, 0);
});

test("an amendment names its MSA, and a child of an agreement that has ended is refused", async () => {
  await assert.rejects(
    createContract(await uowFor(scripted({}).tx), { ...BASE, kind: "amendment" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "amendment_needs_parent",
  );

  for (const state of ["expired", "terminated"] as const) {
    await assert.rejects(
      createContract(await uowFor(scripted({ "FROM contracts WHERE id": [{ ...msaRow, state }] }).tx), { ...BASE, kind: "amendment", parentContractId: MSA }, newId),
      (e: unknown) => e instanceof InputRefused && e.code === "parent_contract_ended" && e.message.includes(state),
    );
  }

  await assert.rejects(
    createContract(await uowFor(scripted({ "FROM contracts WHERE id": [{ ...msaRow, org_id: OTHER_ORG }] }).tx), { ...BASE, kind: "amendment", parentContractId: MSA }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "tenancy_mismatch",
  );

  const ok = await uowFor(scripted({ "FROM contracts WHERE id": [msaRow] }).tx);
  const out = await createContract(ok, { ...BASE, kind: "amendment", parentContractId: MSA }, newId);
  assert.ok(out.id);
  assert.equal(ok.pending().events[0]!.topic, "contract.created");
});

test("the state ladder: draft → active → expired | terminated, and a step off it is refused BY NAME", async () => {
  const at = (state: string) => scripted({ "FROM contracts WHERE id": [{ ...msaRow, state }] }).tx;

  const activated = await uowFor(at("draft"));
  const a = await transitionContract(activated, { contractId: MSA, to: "active" });
  assert.equal(a.state, "active");
  assert.equal(activated.pending().events[0]!.topic, "contract.amended");

  for (const to of ["expired", "terminated"] as const) {
    const ended = await uowFor(at("active"));
    const r = await transitionContract(ended, { contractId: MSA, to });
    assert.equal(r.state, to);
    const ev = ended.pending().events[0]!;
    assert.equal(ev.topic, "contract.expired", "both endings are one topic — no subscriber acts differently on which");
    assert.equal((ev.payload as { to: string }).to, to, "which ending it was is in the payload");
  }

  await assert.rejects(
    transitionContract(await uowFor(at("draft")), { contractId: MSA, to: "expired" }),
    (e: unknown) => e instanceof InputRefused && e.code === "illegal_transition" && /can only become active/.test(e.message),
  );
  await assert.rejects(
    transitionContract(await uowFor(at("terminated")), { contractId: MSA, to: "active" }),
    (e: unknown) => e instanceof InputRefused && e.code === "illegal_transition" && /does not move again/.test(e.message),
  );
  await assert.rejects(
    transitionContract(await uowFor(scripted({}).tx), { contractId: MSA, to: "active" }),
    (e: unknown) => e instanceof InputRefused && e.code === "unknown_contract",
  );
});

test("terms.overrides.list narrows by term and by agreement, and refuses a term the register does not hold", async () => {
  const db = scripted({ "FROM contract_term_overrides": [] });
  await listTermOverrides(await uowFor(db.tx), { orgId: ORG, termKey: "sla_response", contractId: MSA });
  const q = db.queries.at(-1)!;
  assert.deepEqual(q.params, [ORG, "sla_response", MSA]);

  await assert.rejects(
    listTermOverrides(await uowFor(scripted({}).tx), { orgId: ORG, termKey: "sla_responce" }),
    (e: unknown) => e instanceof InputRefused && e.code === "unknown_term",
    "a typo is refused by name rather than returning an empty list that reads as 'no overrides'",
  );
});

test("terms.register hands over the register itself — the form is drawn from it, so a twelfth term needs no form diff", () => {
  const { terms } = termRegister();
  assert.deepEqual(terms.map((t) => t.key).sort(), [...TERM_KEYS].sort());
  const sla = terms.find((t) => t.key === "sla_response")!;
  assert.equal(sla.combine.kind, "ratchet");
  assert.ok(sla.values && sla.values.length > 0, "the enum's legal values travel, so the form renders a select and not a text box");
  assert.ok(terms.every((t) => t.rationale.length > 0), "the reason a term has its policy is what S2 shows when it refuses a row");
  const parentOnly = terms.find((t) => t.key === "payment_terms_days")!;
  assert.deepEqual(parentOnly.authoring, ["parent"], "the authoring tiers travel, so the form offers no tier the register would refuse");
});
