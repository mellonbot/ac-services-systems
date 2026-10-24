/** The demo gateway keeps the real one's tenancy: per-principal event streams, and S1's writes need an anonymous session. */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventEnvelope } from "../../packages/contracts/src/events.ts";
import { REGION_WEST, REGION_SOUTH, ORG as AMPED } from "../../packages/domain/src/inheritance/fixtures/amped.ts";
import { eventFor, handle, signInAs } from "./gateway.ts";

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
