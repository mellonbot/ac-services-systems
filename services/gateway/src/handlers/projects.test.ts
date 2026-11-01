import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../db/unit-of-work.ts";
import { createProject, listProjects } from "./projects.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../../../packages/schema/src/tenancy.ts";

/**
 * 0024 — the project door, decisions only. Whether the database refuses a
 * seller who is not a foreman on a path that skips this handler is
 * test/integration/install-crews.test.ts.
 */
const U = (n: number) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), CONTRACT = U(3), SELLER = U(4);

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
const office: Principal = {
  namespace: "internal", subjectId: U(9), orgId: INTERNAL_ORG_ID, regionId: REGION, scopeTier: "parent", scopeId: INTERNAL_ORG_ID,
  roles: ["office_manager"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
let seq = 0;
const uowFor = async (tx: Tx) => createUnitOfWork({ surfaceId: "S2", principal: office, requestId: "r", now: () => new Date("2026-10-23T12:00:00Z"), newId: () => U(100 + ++seq) }, tx);
const newId = () => U(200 + ++seq);

const contract = { id: CONTRACT, org_id: ORG, region_id: REGION, state: "active" };
const foreman = { id: SELLER, display_name: "Blake Keating", namespace: "internal", active: true, roles: ["foreman"] };
const input = { contractId: CONTRACT, name: "Roof changeout", foremanId: SELLER, serviceWindowStart: "2026-11-02T13:00:00Z", serviceWindowEnd: "2026-11-06T23:00:00Z" };

test("a project is recorded under the agreement's customer and region, with the person who sold it as its foreman", async () => {
  const s = scripted({ "FROM contracts": [contract], "FROM users": [foreman] });
  const uow = await uowFor(s.tx);
  const out = await createProject(uow, input, newId);
  assert.equal(out.orgId, ORG);
  assert.equal(out.regionId, REGION);
  const insert = s.queries.find((q) => q.sql.includes("INSERT INTO projects"))!;
  assert.deepEqual(insert.params.slice(1, 6), [ORG, REGION, CONTRACT, "Roof changeout", SELLER]);
  assert.deepEqual(uow.pending().events.map((e) => e.topic), ["project.created"]);
});

test("nothing is sold by someone who is not an active foreman, or under an agreement not in force", async () => {
  const refused = async (answers: Record<string, unknown[]>, code: string) => {
    const s = scripted(answers);
    await assert.rejects(createProject(await uowFor(s.tx), input, newId), (e: unknown) => e instanceof InputRefused && e.code === code);
    assert.equal(s.queries.filter((q) => q.sql.startsWith("INSERT")).length, 0, `${code}: nothing written`);
  };
  await refused({ "FROM contracts": [contract], "FROM users": [{ ...foreman, roles: ["dispatcher"] }] }, "not_a_foreman");
  await refused({ "FROM contracts": [contract], "FROM users": [{ ...foreman, active: false }] }, "not_a_foreman");
  await refused({ "FROM contracts": [contract], "FROM users": [{ ...foreman, namespace: "customer" }] }, "unknown_foreman");
  await refused({ "FROM contracts": [contract], "FROM users": [] }, "unknown_foreman");
  await refused({ "FROM contracts": [{ ...contract, state: "draft" }], "FROM users": [foreman] }, "contract_not_in_force");
  await refused({ "FROM contracts": [] }, "unknown_contract");
  await assert.rejects(createProject(await uowFor(scripted({}).tx), { ...input, serviceWindowEnd: input.serviceWindowStart }, newId),
    (e: unknown) => e instanceof InputRefused && e.code === "bad_window");
  await assert.rejects(createProject(await uowFor(scripted({}).tx), { ...input, foremanId: "nobody" }, newId), (e: unknown) => e instanceof BadInput);
});

test("listProjects carries who sold each project and the foremen a new one may be sold by", async () => {
  const s = scripted({
    "FROM projects p": [{ id: U(50), org_id: ORG, region_id: REGION, contract_id: CONTRACT, customer: "Amped", name: "Roof changeout",
      foreman_id: SELLER, foreman_name: "Blake Keating", ws: "2026-11-02T13:00:00.000Z", we: "2026-11-06T23:00:00.000Z", state: "planned", install_jobs: 2 }],
    "roles ? 'foreman'": [{ id: SELLER, name: "Blake Keating" }],
  });
  const out = await listProjects(await uowFor(s.tx), {});
  assert.equal(out.projects[0]!.foremanName, "Blake Keating");
  assert.equal(out.projects[0]!.installJobs, 2);
  assert.deepEqual(out.foremen, [{ id: SELLER, name: "Blake Keating" }]);
});
