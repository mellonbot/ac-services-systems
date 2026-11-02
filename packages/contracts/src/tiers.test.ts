import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNT_TIERS, TIER_WORD, tierWord } from "./tiers.ts";

test("a home's tiers read customer → address → house; a building's keep the ladder's words", () => {
  assert.deepEqual(ACCOUNT_TIERS.map((t) => TIER_WORD.residential[t]), ["Customer", "Address", "House"]);
  assert.deepEqual(ACCOUNT_TIERS.map((t) => TIER_WORD.commercial[t]), ["Region node", "Location", "Site"]);
});

test("an unknown segment reads as commercial — the multi-node door is the default", () => {
  assert.equal(tierWord("site", null), "Site");
  assert.equal(tierWord("site", undefined), "Site");
  assert.equal(tierWord("site", "residential"), "House");
});
