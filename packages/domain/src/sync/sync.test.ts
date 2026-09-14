import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMutation, replay, mayDeviceWrite, CONFLICT_POLICIES, type Mutation, type ServerState } from "./index.ts";

const m = (over: Partial<Mutation>): Mutation => ({
  mutationId: "m-1", deviceId: "d-1", deviceSeq: 1, entityTable: "jobs", entityId: "j-1", op: "transition",
  payload: { state: "en_route" }, clientObservedVersion: 1, deviceAt: "2026-09-14T08:00:00Z", ...over,
});
const none = new Set<string>();

test("THE LOAD-BEARING ONE: a device cannot create an assignment — server-authoritative, rejected, named as a gate bypass", () => {
  const r = resolveMutation(m({ entityTable: "assignments", op: "insert", payload: { crew_id: "c-9" } }), null, none);
  assert.equal(r.outcome, "rejected");
  assert.match((r as { note: string }).note, /compliance gate defeated by sync/);
  assert.equal(mayDeviceWrite("assignments"), false);
  assert.equal(mayDeviceWrite("job_media"), true);
});

test("replay is idempotent: the same mutation id twice is a duplicate, not a second row", () => {
  const first = resolveMutation(m({ entityTable: "job_media", op: "insert" }), null, none);
  assert.equal(first.outcome, "applied");
  const again = resolveMutation(m({ entityTable: "job_media", op: "insert" }), null, new Set(["m-1"]));
  assert.equal(again.outcome, "duplicate");
});

test("state machine: legal device transitions apply in device order, each seeing the previous", () => {
  const log = [
    m({ mutationId: "a", deviceSeq: 1, payload: { state: "en_route" } }),
    m({ mutationId: "b", deviceSeq: 2, payload: { state: "on_site" } }),
    m({ mutationId: "c", deviceSeq: 3, payload: { state: "in_progress" } }),
    m({ mutationId: "d", deviceSeq: 4, payload: { state: "complete" } }),
  ];
  // The caller threads state: server state after each applied transition.
  let state: ServerState = { version: 1, state: "assigned", fields: {} };
  const outcomes = replay(log, (mut, prior) => {
    const applied = prior.filter((o) => o.outcome === "applied").length;
    const states = ["assigned", "en_route", "on_site", "in_progress", "complete"];
    state = { version: 1 + applied, state: states[applied]!, fields: {} };
    return state;
  }, none);
  assert.deepEqual(outcomes.map((o) => o.outcome), ["applied", "applied", "applied", "applied"]);
});

test("state machine: arriving out of order is data — sorted by device_seq, not arrival", () => {
  const log = [
    m({ mutationId: "b", deviceSeq: 2, payload: { state: "on_site" } }),
    m({ mutationId: "a", deviceSeq: 1, payload: { state: "en_route" } }),
  ];
  const outcomes = replay(log, (_, prior) => ({ version: 1, state: prior.length === 0 ? "assigned" : "en_route", fields: {} }), none);
  assert.deepEqual(outcomes.map((o) => o.mutationId), ["a", "b"]);
  assert.deepEqual(outcomes.map((o) => o.outcome), ["applied", "applied"]);
});

test("the office cancelled it, the crew completed it: queued for a human, never auto-resolved", () => {
  const r = resolveMutation(m({ payload: { state: "complete" } }), { version: 3, state: "cancelled", fields: {} }, none);
  assert.equal(r.outcome, "queued_for_human");
  assert.match((r as { note: string }).note, /drove to a site for nothing|will not bill/);
});

test("an illegal-but-harmless transition is superseded: the device adopts the server state", () => {
  const r = resolveMutation(m({ payload: { state: "en_route" } }), { version: 3, state: "in_progress", fields: {} }, none);
  assert.equal(r.outcome, "superseded");
});

test("a device may not cancel or assign — those transitions belong to dispatch", () => {
  for (const state of ["cancelled", "assigned", "invoiced", "reassigned"]) {
    const r = resolveMutation(m({ payload: { state } }), { version: 1, state: "en_route", fields: {} }, none);
    assert.equal(r.outcome, "rejected", state);
  }
});

test("an entity with no declared policy is rejected — an undeclared policy is an undiscussed business decision", () => {
  const r = resolveMutation(m({ entityTable: "invoices", op: "update", payload: { total_minor: "1" } }), null, none);
  assert.equal(r.outcome, "rejected");
  assert.match((r as { note: string }).note, /undiscussed business decision/);
});

test("signatures carry legal weight: always a human", () => {
  const r = resolveMutation(m({ entityTable: "signatures", op: "insert", payload: {} }), null, none);
  assert.equal(r.outcome, "queued_for_human");
});

test("every server-authoritative table in the policy is one the gate or the contract engine owns", () => {
  const sa = Object.entries(CONFLICT_POLICIES).filter(([, p]) => p === "server_authoritative").map(([t]) => t).sort();
  assert.deepEqual(sa, ["assignments", "compliance_clearances", "contract_term_overrides", "crew_credentials", "rate_cards"]);
});
