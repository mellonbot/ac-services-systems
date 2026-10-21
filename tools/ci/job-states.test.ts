import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATES } from "../../packages/schema/src/tables/work.ts";
import { JOB_TRANSITIONS } from "../../packages/domain/src/sync/index.ts";

// The CHECK on jobs.state (schema) and the state machine (domain) name the same
// states. A state the machine can reach but the column refuses is a 500 at the
// first transition into it; one the column admits but the machine never names
// is a job nothing can move.
test("the jobs.state CHECK and JOB_TRANSITIONS name the same states — reassigned aside, which is a wire word the column never holds", () => {
  const machine = new Set([...Object.keys(JOB_TRANSITIONS), ...Object.values(JOB_TRANSITIONS).flat()]);
  machine.delete("reassigned");
  assert.deepEqual([...machine].sort(), [...JOB_STATES].sort());
});
