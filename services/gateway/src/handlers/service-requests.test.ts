import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../db/unit-of-work.ts";
import { createServiceRequest, listServiceRequests, openJobFromRequest, DESCRIPTION_MAX } from "./service-requests.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * S6's first write, at the handler: which inputs are admissible, and that
 * tenancy follows the site rather than the token. Whether a customer can see
 * the site at all is the database's (0006) and is test/integration/s6.test.ts.
 */
const U = (n: number) => `60000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION_SOUTH = U(2), REGION_WEST = U(3), SITE = U(4), LOCATION = U(5), CONTACT = U(6);

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

/** A facility manager at a SOUTH location; the site below is served from SOUTH, as derivation guarantees. */
const facility: Principal = {
  namespace: "customer", subjectId: CONTACT, orgId: ORG, regionId: REGION_SOUTH, scopeTier: "location", scopeId: LOCATION,
  roles: ["payer", "requester"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-6",
};
/** An executive — parent tier — whose users row happens to be bound to WEST. The site is still served from SOUTH. */
const executive: Principal = { ...facility, subjectId: U(7), regionId: REGION_WEST, scopeTier: "parent", scopeId: ORG };
let seq = 0;
const uowFor = async (tx: Tx, principal: Principal = facility) => createUnitOfWork({ surfaceId: "S6", principal, requestId: "r", now: () => new Date("2026-09-17T12:00:00Z"), newId: () => U(600 + ++seq) }, tx);
const newId = () => U(700 + ++seq);
const NOW = new Date("2026-09-17T12:00:00Z");
const siteRow = { id: SITE, tier: "site", org_id: ORG, region_id: REGION_SOUTH, active: true };

test("createServiceRequest: tenancy is the SITE's — the request lands in the region the site is served from, not the one the token was bound to", async () => {
  const s = scripted([["FROM accounts WHERE id", [siteRow]]]);
  const out = await createServiceRequest(await uowFor(s.tx, executive), executive.subjectId, { siteId: SITE, priority: "urgent", description: "  Roof unit 2 short-cycling since Tuesday.  " }, newId);
  assert.equal(out.orgId, ORG);
  assert.equal(out.regionId, REGION_SOUTH, "derived from the site");
  const insert = s.queries.find((q) => q.sql.includes("INSERT INTO service_requests"))!;
  assert.ok(insert, "the row is written");
  assert.equal(insert.params[2], REGION_SOUTH);
  assert.equal(insert.params[4], executive.subjectId, "requested_by is the acting principal");
  assert.equal(insert.params[5], "urgent");
  assert.equal(insert.params[6], "Roof unit 2 short-cycling since Tuesday.", "trimmed");
});

test("createServiceRequest defaults priority to routine and refuses one off the list before any read", async () => {
  const s = scripted([["FROM accounts WHERE id", [siteRow]]]);
  await createServiceRequest(await uowFor(s.tx), CONTACT, { siteId: SITE, description: "Filter change due." }, newId);
  assert.equal(s.queries.find((q) => q.sql.includes("INSERT INTO service_requests"))!.params[5], "routine");
  const t = scripted([["FROM accounts WHERE id", [siteRow]]]);
  await assert.rejects(createServiceRequest(await uowFor(t.tx), CONTACT, { siteId: SITE, priority: "pm", description: "x" } as never, newId), BadInput);
  assert.equal(t.queries.length, 0, "refused before the database is asked anything");
});

test("createServiceRequest: an invisible site is unknown_site (from inside the scope the row is not there); a location is not a site; an inactive site is refused", async () => {
  await assert.rejects(
    createServiceRequest(await uowFor(scripted([]).tx), CONTACT, { siteId: SITE, description: "x" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "unknown_site",
  );
  await assert.rejects(
    createServiceRequest(await uowFor(scripted([["FROM accounts WHERE id", [{ ...siteRow, id: LOCATION, tier: "location" }]]]).tx), CONTACT, { siteId: LOCATION, description: "x" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "not_a_site",
  );
  await assert.rejects(
    createServiceRequest(await uowFor(scripted([["FROM accounts WHERE id", [{ ...siteRow, active: false }]]]).tx), CONTACT, { siteId: SITE, description: "x" }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "site_inactive",
  );
});

test("createServiceRequest: a request says what is wrong — empty is refused by name, and so is a pasted log file", async () => {
  const uow = await uowFor(scripted([["FROM accounts WHERE id", [siteRow]]]).tx);
  await assert.rejects(createServiceRequest(uow, CONTACT, { siteId: SITE, description: "   " }, newId), (e: unknown) => e instanceof InputRefused && e.code === "empty_description");
  await assert.rejects(createServiceRequest(uow, CONTACT, { siteId: SITE, description: "x".repeat(DESCRIPTION_MAX + 1) }, newId), (e: unknown) => e instanceof InputRefused && e.code === "description_too_long");
  await assert.rejects(createServiceRequest(uow, CONTACT, { siteId: "not-a-uuid", description: "x" }, newId), BadInput);
  await assert.rejects(createServiceRequest(uow, CONTACT, { siteId: SITE } as never, newId), BadInput);
});

test("listServiceRequests carries the site's name and the job's state, and filters by site when asked", async () => {
  const row = { id: U(50), site_id: SITE, site_name: "Austin — Roof", priority: "urgent", description: "d", requested_by: CONTACT, created_at: "2026-09-17T12:00:00.000Z", job_id: U(51), job_state: "assigned", org_id: ORG, region_id: REGION_SOUTH, photos: [{ id: U(52), contentType: "image/jpeg", bytes: 2048 }] };
  const s = scripted([["FROM service_requests r", [row]]]);
  const out = await listServiceRequests(await uowFor(s.tx), { siteId: SITE }, NOW, false);
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0]!.siteName, "Austin — Roof");
  assert.equal(out.requests[0]!.jobState, "assigned");
  assert.deepEqual(out.requests[0]!.photos, [{ id: U(52), contentType: "image/jpeg", bytes: 2048 }], "the photos sent with it — what they are, never where they are stored");
  assert.equal(s.queries[0]!.params[0], SITE);
  const all = scripted([["FROM service_requests r", [{ ...row, job_id: null, job_state: null }]]]);
  const o2 = await listServiceRequests(await uowFor(all.tx), {}, NOW, false);
  assert.equal(all.queries[0]!.params[0], null);
  assert.equal(o2.requests[0]!.jobId, null, "not yet acted on");
  assert.equal(o2.requests[0]!.waitingOnTerm, null, "a customer's portal reads no contract terms");
  assert.ok(!all.queries.some((q) => q.sql.includes("contract_term_overrides")), "…so S6 never asks");
  await assert.rejects(listServiceRequests(await uowFor(scripted([]).tx), { siteId: "nope" }, NOW, false), BadInput);
});

test("listServiceRequests (office): a waiting request at a site whose agreement has no response time uses the register default; an answered one does not", async () => {
  const office: Principal = {
    namespace: "internal", subjectId: U(9), orgId: U(90), regionId: REGION_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH,
    roles: ["dispatcher"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-3",
  };
  const row = { id: U(50), site_id: SITE, site_name: "Austin — Roof", priority: "urgent", description: "d", requested_by: office.subjectId, created_at: "2026-09-17T12:00:00.000Z", job_id: null, job_state: null, org_id: ORG, region_id: REGION_SOUTH, photos: [] };
  const answers = (overrides: unknown[]): [string, unknown[]][] => [
    ["FROM service_requests r", [row, { ...row, id: U(53), job_id: U(54), job_state: "created" }]],
    ["FROM organizations WHERE id = $1", [{ id: ORG, name: "Amped" }]],
    ["FROM accounts WHERE org_id = $1", [{ id: SITE, tier: "site", name: "Austin — Roof", parent_id: null }]],
    ["FROM contract_term_overrides", overrides],
  ];
  const uowS3 = async (tx: Tx) => createUnitOfWork({ surfaceId: "S3", principal: office, requestId: "r", now: () => NOW, newId: () => U(600 + ++seq) }, tx);

  const missing = await listServiceRequests(await uowS3(scripted(answers([])).tx), {}, NOW, true);
  assert.deepEqual(missing.requests.map((r) => r.waitingOnTerm), [null, null], "register default means no waitingOnTerm");

  const set = { id: U(20), contract_id: U(21), scope_tier: "site", scope_id: SITE, term_key: "sla_response", term_value: "4_hour", eff_from: "2026-01-01", eff_to: null };
  const ok = await listServiceRequests(await uowS3(scripted(answers([set])).tx), {}, NOW, true);
  assert.deepEqual(ok.requests.map((r) => r.waitingOnTerm), [null, null], "derived on every read — it clears the moment the term exists");
});

test("openJobFromRequest: locks the request first, and refuses one it cannot see or one already answered — before any job is opened", async () => {
  const input = { requestId: U(60), serviceCode: "HVAC-REPAIR", serviceWindowStart: "2026-10-22T13:00:00Z", serviceWindowEnd: "2026-10-22T17:00:00Z" };
  const none = scripted([]);
  await assert.rejects(openJobFromRequest(await uowFor(none.tx), input, newId, new Date()), (e: InputRefused) => e.code === "unknown_request");
  assert.match(none.queries[0]!.sql, /FOR UPDATE/, "two dispatchers pressing at once open one job");
  const answered = scripted([["FROM service_requests WHERE id", [{ site_id: SITE, job_id: U(61), priority: "urgent" }]]]);
  await assert.rejects(openJobFromRequest(await uowFor(answered.tx), input, newId, new Date()), (e: InputRefused) => e.code === "already_opened" && e.message.includes(U(61)));
  assert.ok(!answered.queries.some((q) => q.sql.includes("INSERT INTO jobs")), "no job opened for a request already answered");
  await assert.rejects(openJobFromRequest(await uowFor(scripted([]).tx), { ...input, requestId: "nope" }, newId, new Date()), BadInput);
});
