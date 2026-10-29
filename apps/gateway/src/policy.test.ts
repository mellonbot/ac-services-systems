import { test } from "node:test";
import assert from "node:assert/strict";
import { namedOrg, optionalOrg, withCallerOrg } from "./policy.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const parse = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new Error(`${field} must be a uuid`);
  return v;
};

test("namedOrg leaves an internal caller's omitted org omitted", () => {
  assert.equal(namedOrg(true, undefined, ORG), undefined);
  assert.equal(namedOrg(true, "named", ORG), "named");
  assert.equal(namedOrg(false, undefined, ORG), ORG);
  assert.equal(namedOrg(false, "named", ORG), ORG);
});

test("optionalOrg parses a named internal org and otherwise uses the token", () => {
  assert.equal(optionalOrg(true, ORG, "token", parse), ORG);
  assert.equal(optionalOrg(true, undefined, "token", parse), "token");
  assert.equal(optionalOrg(false, ORG, "token", parse), "token");
  assert.equal(optionalOrg(false, "nope", "token", parse), "token");
  assert.throws(() => optionalOrg(true, "nope", "token", parse), /orgId must be a uuid/);
});

test("withCallerOrg replaces orgId only for a caller who is not internal", () => {
  const input = { orgId: "typed", scopeId: "s" };
  assert.equal(withCallerOrg(true, input, "token"), input);
  assert.deepEqual(withCallerOrg(false, input, "token"), { orgId: "token", scopeId: "s" });
});
