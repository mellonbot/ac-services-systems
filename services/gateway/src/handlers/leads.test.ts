import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, SurfaceWriteDenied, TenancyMismatch, type Tx } from "../unit-of-work.ts";
import { submitLead, recordCall, listCoverage, NOTE_MAX } from "./leads.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { ANONYMOUS_PRINCIPAL } from "../../../../packages/contracts/src/scope.ts";
import { PROSPECT_ORG_ID, UNASSIGNED_REGION_ID } from "../../../../packages/schema/src/tenancy.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * ITEM 8 at the handler: which inputs are admissible, and that tenancy is a
 * constant rather than a field. What an anonymous principal may SEE — which
 * is nothing — is the database's (0008) and is test/integration/s1.test.ts.
 */
const U = (n: number) => `10000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

const scripted = (answers: readonly (readonly [string, unknown[]])[] = []) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      for (const [needle, rows] of answers) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  return { tx, queries };
};

let seq = 0;
const uowFor = async (tx: Tx, principal: Principal = ANONYMOUS_PRINCIPAL, surfaceId: "S1" | "S6" = "S1") =>
  createUnitOfWork({ surfaceId, principal, requestId: "r", now: () => new Date("2026-09-18T12:00:00Z"), newId: () => U(100 + ++seq) }, tx);
const newId = () => U(200 + ++seq);
const SUB = U(9);
const ok = { submissionId: SUB, source: "web_form" as const, contact: { name: "Dana Reyes", phone: "555 0101" } };

test("submitLead: the row lands in PROSPECT/UNASSIGNED — tenancy is a constant, not an input", async () => {
  const s = scripted();
  const out = await submitLead(await uowFor(s.tx), ok, newId);
  const insert = s.queries.find((q) => q.sql.includes("INSERT INTO leads"))!;
  assert.ok(insert, "the row is written");
  assert.equal(insert.params[1], PROSPECT_ORG_ID);
  assert.equal(insert.params[2], UNASSIGNED_REGION_ID);
  assert.equal(insert.params[6], SUB, "the submission id is what the buffer will replay under");
  assert.ok(out.id && out.eventId);
});

test("submitLead trims, and keeps only the fields the form has — an unknown key does not become part of the contact", async () => {
  const s = scripted();
  await submitLead(await uowFor(s.tx), {
    ...ok,
    contact: { name: "  Dana Reyes  ", email: "  dana@example.com ", note: " Roof unit short-cycling. ", ...({ role: "owner" } as object) },
    requestedMetro: "  Dallas  ",
  }, newId);
  const insert = s.queries.find((q) => q.sql.includes("INSERT INTO leads"))!;
  const contact = JSON.parse(String(insert.params[4])) as Record<string, string>;
  assert.deepEqual(Object.keys(contact).sort(), ["email", "name", "note"]);
  assert.equal(contact.name, "Dana Reyes");
  assert.equal(contact.email, "dana@example.com");
  assert.equal(insert.params[5], "Dallas");
});

test("submitLead refuses a lead nobody can answer, by name, before it writes anything", async () => {
  const s = scripted();
  const uow = await uowFor(s.tx);
  await assert.rejects(
    () => submitLead(uow, { ...ok, contact: { name: "Dana Reyes" } }, newId),
    (e: unknown) => e instanceof InputRefused && (e as InputRefused).code === "no_way_to_answer",
  );
  assert.equal(s.queries.filter((q) => q.sql.includes("INSERT INTO leads")).length, 0);
});

test("submitLead refuses a source off the list and a submission id that is not a uuid", async () => {
  const s = scripted();
  const a = await uowFor(s.tx);
  const b = await uowFor(s.tx);
  await assert.rejects(() => submitLead(a, { ...ok, source: "billboard" as never }, newId), BadInput);
  await assert.rejects(() => submitLead(b, { ...ok, submissionId: "not-a-uuid" }, newId), BadInput);
});

test("submitLead bounds what a form can carry — a pasted log is refused rather than stored", async () => {
  const s = scripted();
  const uow = await uowFor(s.tx);
  await assert.rejects(
    () => submitLead(uow, { ...ok, contact: { name: "Dana Reyes", phone: "555 0101", note: "x".repeat(NOTE_MAX + 1) } }, newId),
    (e: unknown) => e instanceof InputRefused && (e as InputRefused).code === "note_too_long",
  );
});

test("the event envelope carries no contact details — a name and a phone number are not broadcast on the bus", async () => {
  const s = scripted();
  const uow = await uowFor(s.tx);
  await submitLead(uow, { ...ok, contact: { name: "Dana Reyes", phone: "555 0101", note: "Roof unit." } }, newId);
  const { events, audits } = uow.pending();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.topic, "lead.captured");
  assert.deepEqual(Object.keys(events[0]!.payload).sort(), ["requestedMetro", "source"]);
  assert.equal(JSON.stringify(events[0]!.payload).includes("555 0101"), false);
  // The audit row is the record of what the stranger actually typed.
  assert.equal(JSON.stringify(audits[0]!.after).includes("555 0101"), true);
});

test("recordCall takes the gateway's clock, not the browser's", async () => {
  const s = scripted();
  await recordCall(await uowFor(s.tx), { direction: "inbound", occurredAt: "1999-01-01T00:00:00.000Z" }, newId, () => new Date("2026-09-18T12:00:00Z"));
  const insert = s.queries.find((q) => q.sql.includes("INSERT INTO call_records"))!;
  assert.equal(insert.params[5], "2026-09-18T12:00:00.000Z");
});

test("recordCall takes a call with no lead behind it — someone who dialled without filling anything in", async () => {
  const s = scripted();
  const out = await recordCall(await uowFor(s.tx), { direction: "inbound", occurredAt: "" }, newId, () => new Date());
  assert.ok(out.id);
  assert.equal(s.queries.find((q) => q.sql.includes("INSERT INTO call_records"))!.params[3], null);
});

test("THE ALLOWLIST IS THE WHOLE OF WHAT THIS PRINCIPAL MAY DO: the same handler on another surface is refused", async () => {
  const s = scripted();
  // S6 does not write `lead`. The refusal comes from the unit of work, not from this file.
  const uow = await uowFor(s.tx, { ...ANONYMOUS_PRINCIPAL, namespace: "customer" }, "S6");
  await assert.rejects(() => submitLead(uow, ok, newId), SurfaceWriteDenied);
});

test("an anonymous principal outside PROSPECT/UNASSIGNED cannot write at all — the unit of work refuses the tenancy", async () => {
  const s = scripted();
  const elsewhere: Principal = { ...ANONYMOUS_PRINCIPAL, orgId: U(42), regionId: U(43) };
  const uow = await uowFor(s.tx, elsewhere);
  await assert.rejects(() => submitLead(uow, ok, newId), TenancyMismatch);
});

test("listCoverage asks the function and shapes nothing — the claim has one definition and it is in 0008", async () => {
  const s = scripted([["ac_public_coverage", [{ code: "DFW", name: "Dallas–Fort Worth" }, { code: "AUS", name: "Austin" }]]]);
  const out = await listCoverage(s.tx);
  assert.deepEqual(out.metros, [{ code: "DFW", name: "Dallas–Fort Worth" }, { code: "AUS", name: "Austin" }]);
  const q = s.queries[0]!.sql;
  assert.match(q, /ac_public_coverage\(\)/);
  assert.equal(/\bWHERE\b/i.test(q), false, "no second copy of the claim on this side");
  assert.equal(/min_crew_density/.test(q), false);
});
