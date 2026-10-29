import { test } from "node:test";
import assert from "node:assert/strict";
import { mergedPunches, spansOf, runningSince, weekOf, daysOf, hoursText, clockAction, type Punch } from "./punches.ts";
import type { QueueEntry } from "./offline.ts";

const p = (kind: "in" | "out", at: string, queued = false): Punch => ({ kind, at, queued });

test("spans pair each in with the next out; a double tap or a stray out changes nothing; an open in is running", () => {
  const spans = spansOf([
    p("out", "2026-10-26T07:00:00Z"),
    p("in", "2026-10-26T08:00:00Z"), p("in", "2026-10-26T08:01:00Z"), p("out", "2026-10-26T16:30:00Z"),
    p("in", "2026-10-27T08:00:00Z", true),
  ]);
  assert.deepEqual(spans, [
    { start: "2026-10-26T08:00:00Z", end: "2026-10-26T16:30:00Z", queued: false },
    { start: "2026-10-27T08:00:00Z", end: null, queued: true },
  ]);
  assert.equal(runningSince(spans), "2026-10-27T08:00:00Z");
});

test("a punch queued on the device counts before the server has it, in time order with the server's", () => {
  const pending = [{ mutation: { entityTable: "shift_punches", payload: { kind: "out", at: "2026-10-27T12:00:00Z" } } }] as unknown as QueueEntry[];
  const merged = mergedPunches([{ id: "a", kind: "in", at: "2026-10-27T08:00:00Z" }], pending);
  assert.deepEqual(merged.map((x) => [x.kind, x.queued]), [["in", false], ["out", true]]);
});

test("clock in whenever the clock is stopped; clock out once every job is finished or on hold", () => {
  assert.equal(clockAction(false, []), "in", "no jobs yet");
  assert.equal(clockAction(false, ["assigned", "assigned"]), "in", "before the first job");
  assert.equal(clockAction(false, ["awaiting_parts", "assigned"]), "in", "back on the clock to resume a held job");
  assert.equal(clockAction(false, ["en_route"]), "in", "a job moved before the gate, or by the office, is never a dead end");
  assert.equal(clockAction(true, ["complete", "in_progress"]), null, "a job still under way keeps clock-out closed");
  assert.equal(clockAction(true, ["assigned"]), null, "a job not yet started keeps clock-out closed");
  assert.equal(clockAction(true, ["awaiting_parts", "awaiting_customer", "complete"]), "out", "on hold lets the crew clock out");
  assert.equal(clockAction(true, []), "out", "finished work has left the list");
});

test("the week runs Monday to Monday, a span counts on the day it started, and minutes are floored", () => {
  const now = Date.parse("2026-10-28T12:00:00"); // a Wednesday, local
  const week = weekOf(now);
  assert.deepEqual([week.from.getDay(), week.from.getDate(), week.from.getHours()], [1, 26, 0]);
  assert.deepEqual([week.to.getDay(), week.to.getDate(), week.to.getHours()], [1, 2, 0], "calendar days, not 168 hours — this week crosses the end of US daylight time");
  const days = daysOf(spansOf([
    p("in", new Date("2026-10-26T22:00:00").toISOString()), p("out", new Date("2026-10-27T02:30:00").toISOString()),
    p("in", new Date("2026-10-28T08:00:00").toISOString()),
  ]), week, now);
  assert.equal(hoursText(days[0]!.ms), "4h 30m", "Monday's night shift is Monday's");
  assert.equal(days[1]!.ms, 0);
  assert.equal(hoursText(days[2]!.ms), "4h 00m", "a running span counts to now");
  assert.equal(hoursText(59_999), "0h 00m");
});
