import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveDueAt, evaluateCascade, UnknownSlaTermError, type TimerState } from "./index.ts";

const opened = new Date("2026-06-01T08:00:00Z");
const timer = (o: Partial<TimerState> = {}): TimerState => ({
  opened_at: opened, due_at: deriveDueAt(opened, { response: "4_hour" }),
  satisfied_at: null, breached_at: null, escalation_stage: 0, shadow_mode: true, ...o,
});

test("the window comes from the resolved term, not from a default", () => {
  assert.equal(deriveDueAt(opened, { response: "4_hour" }).toISOString(), "2026-06-01T12:00:00.000Z");
  assert.throws(() => deriveDueAt(opened, { response: "whenever" }), UnknownSlaTermError);
});

test("the cascade climbs one stage at a time and does not re-fire", () => {
  const t = timer();
  const at = (h: number) => new Date(opened.getTime() + h * 3_600_000);
  assert.equal(evaluateCascade(t, at(1), { response: "4_hour" }), null);
  assert.equal(evaluateCascade(t, at(2.1), { response: "4_hour" })!.stage, 1);
  assert.equal(evaluateCascade({ ...t, escalation_stage: 1 }, at(2.5), { response: "4_hour" }), null);
  assert.equal(evaluateCascade({ ...t, escalation_stage: 1 }, at(3.3), { response: "4_hour" })!.stage, 2);
  assert.equal(evaluateCascade({ ...t, escalation_stage: 2 }, at(4.1), { response: "4_hour" })!.stage, 3);
});

test("a satisfied timer is silent", () => {
  const t = timer({ satisfied_at: new Date(opened.getTime() + 60_000) });
  assert.equal(evaluateCascade(t, new Date(opened.getTime() + 99_999_999), { response: "4_hour" }), null);
});

test("shadow mode runs the same evaluation and just marks it", () => {
  const at = new Date(opened.getTime() + 3.5 * 3_600_000);
  const shadow = evaluateCascade(timer({ shadow_mode: true }), at, { response: "4_hour" })!;
  const live = evaluateCascade(timer({ shadow_mode: false }), at, { response: "4_hour" })!;
  assert.equal(shadow.stage, live.stage);
  assert.equal(shadow.shadow, true);
  assert.equal(live.shadow, false);
});

test("a breach says plainly that the credit is ours", () => {
  const a = evaluateCascade(timer({ escalation_stage: 2 }), new Date(opened.getTime() + 5 * 3_600_000), { response: "4_hour" })!;
  assert.match(a.reason, /no counterparty/);
});
