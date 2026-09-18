import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { createServiceRequest, listServiceRequests, DESCRIPTION_MAX } from "./service-requests.ts";
import { InputRefused, BadInput } from "../refusals.ts";
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
  roles: [], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-6",
};
/** An executive — parent tier — whose users row happens to be bound to WEST. The site is still served from SOUTH. */
const executive: Principal = { ...facility, subjectId: U(7), regionId: REGION_WEST, scopeTier: "parent", scopeId: ORG };
let seq = 0;
const uowFor = async (tx: Tx, principal: Principal = facility) => createUnitOfWork({ surfaceId: "S6", principal, requestId: "r", now: () => new Date("2026-09-17T12:00:00Z"), newId: () => U(600 + ++seq) }, tx);
const newId = () => U(700 + ++seq);
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
  const row = { id: U(50), site_id: SITE, site_name: "Austin — Roof", priority: "urgent", description: "d", requested_by: CONTACT, created_at: "2026-09-17T12:00:00.000Z", job_id: U(51), job_state: "assigned", org_id: ORG, region_id: REGION_SOUTH };
  const s = scripted([["FROM service_requests r", [row]]]);
  const out = await listServiceRequests(await uowFor(s.tx), { siteId: SITE });
  assert.equal(out.requests.length, 1);
  assert.equal(out.requests[0]!.siteName, "Austin — Roof");
  assert.equal(out.requests[0]!.jobState, "assigned");
  assert.equal(s.queries[0]!.params[0], SITE);
  const all = scripted([["FROM service_requests r", [{ ...row, job_id: null, job_state: null }]]]);
  const o2 = await listServiceRequests(await uowFor(all.tx), {});
  assert.equal(all.queries[0]!.params[0], null);
  assert.equal(o2.requests[0]!.jobId, null, "not yet acted on");
  await assert.rejects(listServiceRequests(await uowFor(scripted([]).tx), { siteId: "nope" }), BadInput);
});
