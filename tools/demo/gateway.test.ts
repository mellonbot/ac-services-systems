/** The demo gateway keeps the real one's tenancy: per-principal event streams, and S1's writes need an anonymous session. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventEnvelope } from "../../packages/contracts/src/events.ts";
import { REGION_WEST, REGION_SOUTH, ORG as AMPED } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { eventFor, handle, signInAs, subscribe } from "./gateway.ts";

const env = (orgId: string, regionId: string): EventEnvelope =>
  ({ eventId: "ev-1", topic: "account.updated", entity: "account", entityId: "a-1", orgId, regionId, occurredAt: new Date().toISOString() }) as EventEnvelope;
const BASE = "http://demo.invalid";

test("events: a region login hears its own region; an org-wide login hears every region", () => {
  signInAs("S3", "dispatch.south@rankine.demo");
  assert.ok(eventFor("S3", env(AMPED, REGION_SOUTH)));
  assert.equal(eventFor("S3", env(AMPED, REGION_WEST)), null, "the South dispatcher does not hear West");
  signInAs("S2", "office@rankine.demo");
  assert.deepEqual(eventFor("S2", env(AMPED, REGION_WEST)), env(AMPED, REGION_WEST), "internal hears the whole envelope");
});

test("events: a customer hears only its own org, and blind — no entity, no org", () => {
  signInAs("S6", "exec@amped.demo");
  assert.equal(eventFor("S6", env("someone-else", REGION_SOUTH)), null);
  const heard = eventFor("S6", env(AMPED, REGION_SOUTH));
  assert.ok(heard);
  assert.equal((heard as { entityId?: string }).entityId, undefined);
  assert.equal((heard as { orgId?: string }).orgId, undefined);
});

test("events: S1 has no stream", () => {
  assert.equal(eventFor("S1", env(AMPED, REGION_SOUTH)), null);
});

test("S1: a lead without an anonymous session is refused; with one it is taken", async () => {
  const lead = { method: "POST", url: `${BASE}/s1/leads`, body: JSON.stringify({}) };
  const bare = await handle({ surface: "S1", ...lead, headers: { authorization: "Bearer made-up" } });
  assert.notEqual(bare, "offline");
  assert.equal((bare as { status: number }).status, 401);
  const s = await handle({ surface: "S1", method: "POST", url: `${BASE}/auth/anonymous`, headers: {} });
  assert.equal((s as { status: number }).status, 200, JSON.stringify(s));
  const token = ((s as { body: { token: string } }).body).token;
  const ok = await handle({ surface: "S1", ...lead, headers: { authorization: `Bearer ${token}` } });
  assert.notEqual((ok as { status: number }).status, 401, JSON.stringify(ok));
});

const POOL = "j0000000-0000-0000-0000-000000000005";
const COMPRESSOR = "j0000000-0000-0000-0000-000000000007";
const INVOICED = "j0000000-0000-0000-0000-000000000009";

test("sync.replay decides with the domain rules and writes a job only when the outcome is applied", async () => {
  const logged = await handle({
    surface: "S5", method: "POST", url: `${BASE}/auth/device-login`, headers: {},
    body: JSON.stringify({ email: "tech.south1@rankine.demo", password: "demo", hardwareId: "RK-TAB-0042" }),
  });
  assert.equal((logged as { status: number }).status, 200, JSON.stringify(logged));
  const token = (logged as { body: { token: string } }).body.token;
  const heard: string[] = [];
  const stop = subscribe("S5", (e) => { heard.push(e.topic); });
  const mut = (mutationId: string, deviceSeq: number, entityId: string, entityTable: string, payload: Record<string, unknown>) =>
    ({ mutationId, deviceId: "dev", deviceSeq, entityTable, entityId, op: "transition" as const, payload, clientObservedVersion: 0, deviceAt: "2026-01-01T00:00:00.000Z" });
  const sent = [
    mut("m-progress", 2, POOL, "jobs", { state: "in_progress" }),
    mut("m-site", 1, POOL, "jobs", { to: "on_site" }),
    mut("m-site", 4, POOL, "jobs", { state: "on_site" }),
    mut("m-done", 3, POOL, "jobs", { state: "complete" }),
    mut("m-missing", 5, "j-missing", "jobs", { state: "on_site" }),
    mut("m-unknown", 6, POOL, "not_a_table", { state: "on_site" }),
    mut("m-human", 7, INVOICED, "jobs", { state: "en_route" }),
    mut("m-wrap", 8, COMPRESSOR, "jobs", { state: "complete" }),
  ];
  const replayed = await handle({
    surface: "S5", method: "POST", url: `${BASE}/s5/sync`, headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ orgId: "o", regionId: "r", mutations: sent }),
  });
  stop();
  assert.equal((replayed as { status: number }).status, 200, JSON.stringify(replayed));
  const outcomes = (replayed as { body: { outcomes: { mutationId: string; outcome: string; newVersion?: number; note?: string }[] } }).body.outcomes;
  assert.deepEqual(outcomes.map((o) => o.mutationId), ["m-site", "m-progress", "m-done", "m-site", "m-missing", "m-unknown", "m-human", "m-wrap"]);
  assert.deepEqual(outcomes.map((o) => o.outcome), ["applied", "applied", "rejected", "duplicate", "rejected", "rejected", "queued_for_human", "rejected"]);
  assert.equal(outcomes[0]!.newVersion, 4);
  assert.equal(outcomes[1]!.newVersion, 5);
  assert.match(outcomes[2]!.note ?? "", /wrap-up/);
  assert.match(outcomes[4]!.note ?? "", /not one this crew/);
  assert.match(outcomes[5]!.note ?? "", /no conflict policy/);
  assert.match(outcomes[6]!.note ?? "", /A person resolves this/);
  assert.deepEqual(heard, ["job.transitioned", "job.transitioned"]);

  const again = await handle({
    surface: "S5", method: "POST", url: `${BASE}/s5/sync`, headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ orgId: "o", regionId: "r", mutations: [mut("m-site", 1, POOL, "jobs", { state: "on_site" })] }),
  });
  const second = (again as { body: { outcomes: { outcome: string }[] } }).body.outcomes;
  assert.deepEqual(second.map((o) => o.outcome), ["duplicate"]);

  const mine = await handle({ surface: "S5", method: "GET", url: `${BASE}/s5/jobs/mine`, headers: { authorization: `Bearer ${token}` } });
  const pool = (mine as { body: { jobs: { id: string; state: string; version: number }[] } }).body.jobs.find((j) => j.id === POOL);
  assert.equal(pool?.state, "in_progress");
  assert.equal(pool?.version, 5);

  signInAs("S2", "office@rankine.demo");
  const list = await handle({ surface: "S2", method: "GET", url: `${BASE}/jobs`, headers: {} });
  assert.equal((list as { status: number }).status, 200, JSON.stringify(list));
  const rows = (list as { body: { jobs: { id: string; state: string; version: number }[] } }).body.jobs;
  assert.equal(rows.find((j) => j.id === POOL)?.state, "in_progress");
  assert.equal(rows.find((j) => j.id === POOL)?.version, 5);
  assert.equal(rows.find((j) => j.id === COMPRESSOR)?.state, "in_progress");
  assert.equal(rows.find((j) => j.id === COMPRESSOR)?.version, 3);
  assert.equal(rows.find((j) => j.id === INVOICED)?.state, "invoiced");
  assert.equal(rows.find((j) => j.id === INVOICED)?.version, 3);

  const missing = await handle({ surface: "S2", method: "POST", url: `${BASE}/s2/customers/residential`, headers: {}, body: "{}" });
  assert.equal((missing as { status: number }).status, 404);
  assert.equal((missing as { body: { message: string } }).body.message, "customers.createResidential is not in the demo gateway");
});
