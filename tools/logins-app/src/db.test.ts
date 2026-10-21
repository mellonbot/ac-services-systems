import { test } from "node:test";
import assert from "node:assert/strict";
import { failure, LoginsDbError } from "./db.ts";

test("failure: a refused connect's empty AggregateError names its inner errors", () => {
  const e = Object.assign(new AggregateError([new Error("connect ECONNREFUSED ::1:5433"), new Error("connect ECONNREFUSED 127.0.0.1:5433")], ""), { code: "ECONNREFUSED" });
  const f = failure(e);
  assert.ok(f instanceof LoginsDbError);
  assert.equal(f.message, "connect ECONNREFUSED ::1:5433; connect ECONNREFUSED 127.0.0.1:5433");
});

test("failure: never an empty message", () => {
  assert.equal(failure(Object.assign(new AggregateError([], ""), { code: "ECONNRESET" })).message, "ECONNRESET");
  assert.equal(failure(new Error("")).message, "Lost the connection to the database.");
});
