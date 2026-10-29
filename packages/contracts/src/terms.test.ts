import { test } from "node:test";
import assert from "node:assert/strict";
import { TERMS, REQUIRED_AT_ACTIVATION, RESIDENTIAL_STANDARD_TERMS, checkTermValue } from "./terms.ts";

test("every activation-relevant term now has a fallback, so REQUIRED_AT_ACTIVATION is empty", () => {
  assert.deepEqual([...REQUIRED_AT_ACTIVATION], [], "defaults on the parent-authorable non-attach terms mean an MSA can activate without stating them");
});

test("the standard home agreement values are legal for their terms", () => {
  for (const [k, v] of Object.entries(RESIDENTIAL_STANDARD_TERMS)) assert.doesNotThrow(() => checkTermValue(TERMS[k]!, v), k);
});
