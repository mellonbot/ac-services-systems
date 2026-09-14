import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, isRefusal, type Crew, type Credential } from "./gate.ts";
import { buildAssignment } from "./assignment.ts";

const day = 86_400_000;
const T0 = Date.UTC(2026, 8, 14);

const cred = (kind: string, toDay: number, verified = true): Credential => ({
  id: `${kind}-${toDay}`, kind, validFrom: T0 - 30 * day, validTo: T0 + toDay * day,
  verifiedAt: verified ? T0 - 30 * day : null,
});

const sub: Crew = { id: "crew-1", active: true, employmentType: "subcontracted" };
const emp: Crew = { id: "crew-2", active: true, employmentType: "employed" };
const full = [cred("insurance", 400), cred("license", 400), cred("background_check", 400)];

test("a clearance can only come from the evaluator", () => {
  const c = evaluate(sub, full, { start: T0, end: T0 + day }, T0);
  assert.equal(isRefusal(c), false);
  // There is no exported constructor, no flag, and no value to fake. The only
  // way a caller gets here is by having called evaluate().
  const a = buildAssignment("job-1", "crew-1", c as never, "dispatcher-9");
  assert.equal(a.crewId, "crew-1");
});

test("THE ONE THAT MATTERS: a certificate expiring mid-window does not clear the job", () => {
  // Valid today. Expires in 3 days. Job is scheduled 5 days out.
  const creds = [cred("insurance", 3), cred("license", 400), cred("background_check", 400)];
  const r = evaluate(sub, creds, { start: T0 + 5 * day, end: T0 + 5 * day + 4 * 3600_000 }, T0);
  assert.equal(isRefusal(r), true);
  assert.equal((r as { reason: string }).reason, "expired_in_window");
  // And the same crew clears a job inside the covered window — the gate is
  // time-aware, not simply strict.
  assert.equal(isRefusal(evaluate(sub, creds, { start: T0, end: T0 + 3600_000 }, T0)), false);
});

test("an unverified certificate is not a certificate", () => {
  const creds = [cred("insurance", 400, false), cred("license", 400), cred("background_check", 400)];
  const r = evaluate(sub, creds, { start: T0, end: T0 + day }, T0);
  assert.equal((r as { reason: string }).reason, "unverified");
});

test("subcontracted crews need insurance; employed crews are covered by ours", () => {
  const noIns = [cred("license", 400), cred("background_check", 400)];
  assert.equal(isRefusal(evaluate(sub, noIns, { start: T0, end: T0 + day }, T0)), true);
  assert.equal(isRefusal(evaluate(emp, noIns, { start: T0, end: T0 + day }, T0)), false);
});

test("a clearance minted for one crew cannot be spent on another", () => {
  const c = evaluate(sub, full, { start: T0, end: T0 + day }, T0);
  assert.throws(() => buildAssignment("job-1", "crew-999", c as never, "dispatcher-9"), /minted for crew/);
});

test("the refusal says what a dispatcher needs to hear, not a code", () => {
  const creds = [cred("insurance", 3), cred("license", 400), cred("background_check", 400)];
  const r = evaluate(sub, creds, { start: T0 + 5 * day, end: T0 + 6 * day }, T0);
  assert.match((r as { detail: string }).detail, /insurance expires 2026-09-17/);
});
