import { test } from "node:test";
import assert from "node:assert/strict";
import { dbRefusal, InputRefused } from "./refusals.ts";

/**
 * The map from what the database says to what the shell hears. Pure; the
 * wire tests in test/integration/s0-shell.test.ts prove the same thing end
 * to end against a live Postgres and a spawned gateway.
 */
test("a 0004 trigger refusal (AC422) is a 422 named after the trigger, with the trigger's message verbatim", () => {
  const r = dbRefusal({ code: "AC422", message: "accounts: a site must hang off a location, not a region", where: "PL/pgSQL function ac_accounts_derive_region() line 24 at RAISE" });
  assert.deepEqual(r, { status: 422, name: "TriggerRefused", code: "ac_accounts_derive_region", message: "accounts: a site must hang off a location, not a region" });
});

test("a policy refusal (AC403) is a 403", () => {
  const r = dbRefusal({ code: "AC403", message: "audit_log is append-only (attempted UPDATE)", where: "PL/pgSQL function ac_audit_is_immutable() line 3 at RAISE" });
  assert.equal(r?.status, 403);
  assert.equal(r?.code, "ac_audit_is_immutable");
});

test("exclusion, foreign-key, unique, check and not-null violations are 422s named after the constraint, with detail appended", () => {
  assert.deepEqual(dbRefusal({ code: "23P01", message: "conflicting key value violates exclusion constraint \"term_override_no_overlap\"", detail: "Key (...) conflicts with existing key (...).", constraint: "term_override_no_overlap" }),
    { status: 422, name: "OverlapRefused", code: "term_override_no_overlap", message: "conflicting key value violates exclusion constraint \"term_override_no_overlap\" — Key (...) conflicts with existing key (...)." });
  assert.equal(dbRefusal({ code: "23503", message: "insert or update on table \"contract_term_overrides\" violates foreign key constraint \"contract_term_overrides_contract_id_fkey\"", constraint: "contract_term_overrides_contract_id_fkey" })?.code, "contract_term_overrides_contract_id_fkey");
  assert.equal(dbRefusal({ code: "23505", message: "dup", constraint: "users_email_key" })?.status, 422);
  assert.equal(dbRefusal({ code: "23514", message: "chk", constraint: "accounts_region_has_no_parent" })?.name, "CheckRefused");
  assert.equal(dbRefusal({ code: "23502", message: "null value in column \"diagnostic_data_rights_reserved\"" })?.name, "RequiredRefused");
});

test("anything else stays a 500 — a bug is a bug, and the shell is right to go degraded on it", () => {
  assert.equal(dbRefusal(new Error("Cannot read properties of undefined")), null);
  assert.equal(dbRefusal({ code: "42P01", message: "relation does not exist" }), null, "undefined_table is a deploy bug, not a refusal");
  assert.equal(dbRefusal({ code: "P0001", message: "a RAISE with no ERRCODE" }), null, "P0001 is what 0004 exists to eliminate; if one appears the guard missed it");
  assert.equal(dbRefusal(null), null);
  assert.equal(dbRefusal("string"), null);
});

test("InputRefused carries a code and a human message", () => {
  const e = new InputRefused("no site node x in org y", "unknown_scope");
  assert.equal(e.name, "InputRefused");
  assert.equal(e.code, "unknown_scope");
  assert.match(e.message, /no site node/);
});
