import { test } from "node:test";
import assert from "node:assert/strict";
import { TERMS, REQUIRED_AT_ACTIVATION, RESIDENTIAL_STANDARD_TERMS, checkTermValue } from "./terms.ts";

test("the standard home agreement states exactly the terms activation requires, each a value its term admits", () => {
  assert.deepEqual(Object.keys(RESIDENTIAL_STANDARD_TERMS).sort(), [...REQUIRED_AT_ACTIVATION].sort(), "a new no-default term needs a home value before a home can go live");
  for (const [k, v] of Object.entries(RESIDENTIAL_STANDARD_TERMS)) assert.doesNotThrow(() => checkTermValue(TERMS[k]!, v), k);
});
