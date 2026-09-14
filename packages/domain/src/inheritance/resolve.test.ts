import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTerm, type Override, type ScopePath } from "./resolve.ts";

const path: ScopePath = [
  { tier: "parent", id: "amped" },
  { tier: "region", id: "amped-southwest" },
  { tier: "location", id: "amped-phx-04" },
];

test("most specific wins, and says where it won", () => {
  const overrides: Override[] = [
    { scopeTier: "parent", scopeId: "amped", termKey: "response_hours", termValue: 24 },
    { scopeTier: "location", scopeId: "amped-phx-04", termKey: "response_hours", termValue: 4 },
  ];
  const r = resolveTerm(overrides, path, "response_hours");
  assert.equal(r.value, 4);
  assert.deepEqual(r.wonAt, { tier: "location", id: "amped-phx-04" });
});

test("a term set only at the parent reaches every location — M2 in one assertion", () => {
  const overrides: Override[] = [
    { scopeTier: "parent", scopeId: "amped", termKey: "response_hours", termValue: 24 },
  ];
  assert.equal(resolveTerm(overrides, path, "response_hours").value, 24);
});

test("ambiguity throws rather than letting a sort order price the contract", () => {
  const overrides: Override[] = [
    { scopeTier: "location", scopeId: "amped-phx-04", termKey: "rate", termValue: 100 },
    { scopeTier: "location", scopeId: "amped-phx-04", termKey: "rate", termValue: 120 },
  ];
  assert.throws(() => resolveTerm(overrides, path, "rate"), /ambiguous/);
});

test("the trace answers 'why is this site billed at that rate' without reading code", () => {
  const overrides: Override[] = [
    { scopeTier: "parent", scopeId: "amped", termKey: "rate", termValue: 100 },
    { scopeTier: "region", scopeId: "amped-southwest", termKey: "rate", termValue: 115 },
  ];
  const r = resolveTerm(overrides, path, "rate");
  assert.deepEqual(r.trace, [
    'parent:amped — override 100',
    'region:amped-southwest — override 115',
    'location:amped-phx-04 — no override',
    'resolved at region:amped-southwest',
  ]);
});
