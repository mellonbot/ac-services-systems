import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createResidential, convertLead, listLeads } from "./residential.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * Residential customers at the handler: what it refuses before anything is
 * written. The one-step tree, the segment and the conversion are over the
 * wire in test/integration/s2-residential.test.ts.
 */
const U = (n: number) => `62000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const scripted = (answers: readonly (readonly [string, unknown[]])[]) => {
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
const owner: Principal = {
  namespace: "internal", subjectId: U(1), orgId: U(2), regionId: U(3), scopeTier: "parent", scopeId: U(2),
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "s",
};
let seq = 0;
const uowFor = async (tx: Tx) => createUnitOfWork({ surfaceId: "S2", principal: owner, requestId: "r", now: () => new Date("2026-10-21T12:00:00Z"), newId: () => U(600 + ++seq) }, tx);
const newId = () => U(700 + ++seq);
const address = { line1: "905 Hidden Creek Pkwy", city: "Burleson", state: "TX", postal: "76028" };

test("createResidential: a home is somewhere — no address, no write", async () => {
  const s = scripted([]);
  await assert.rejects(createResidential(await uowFor(s.tx), { name: "Turner residence", regionId: U(3), address: { line1: "  " } }, newId), BadInput);
  await assert.rejects(createResidential(await uowFor(s.tx), { name: "", regionId: U(3), address }, newId), BadInput);
  assert.equal(s.queries.length, 0);
});

test("convertLead: locks the lead, and refuses one it cannot see or one already converted — naming the home — before any customer is made", async () => {
  const input = { leadId: U(10), regionId: U(3), address };
  const none = scripted([]);
  await assert.rejects(convertLead(await uowFor(none.tx), input, newId), (e: InputRefused) => e.code === "unknown_lead");
  assert.match(none.queries[0]!.sql, /FOR UPDATE/, "two people converting one lead make one customer");
  const done = scripted([["FROM leads WHERE id", [{ contact: { name: "Pat Turner" }, converted_account_id: U(11), org_id: U(4), region_id: U(5) }]]]);
  await assert.rejects(convertLead(await uowFor(done.tx), input, newId), (e: InputRefused) => e.code === "already_converted" && e.message.includes(U(11)));
  assert.ok(!done.queries.some((q) => q.sql.includes("INSERT INTO organizations")));
});

test("listLeads: waiting by default, all when asked, nothing else", async () => {
  const s = scripted([["FROM leads", [{ id: U(10), source: "web_form", contact: { name: "Pat" }, requested_metro: "DFW", created_at: "2026-10-21T12:00:00.000Z", converted_account_id: null }]]]);
  const out = await listLeads(await uowFor(s.tx), {});
  assert.equal(out.leads[0]!.contact.name, "Pat");
  assert.equal(s.queries[0]!.params[0], "waiting");
  await assert.rejects(listLeads(await uowFor(s.tx), { include: "converted" as never }), BadInput);
});
