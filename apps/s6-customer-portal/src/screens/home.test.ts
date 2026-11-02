import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountWire } from "../../../../packages/contracts/src/index.ts";
import { activeHomes } from "./home.ts";

const node = (id: string, tier: AccountWire["tier"], active = true): AccountWire => ({
  id, tier, name: id, parentId: null, regionId: "r", customerGroup: null, externalRef: null, timezone: null, active, path: [id], address: null,
});

test("a household with two residences has two homes; a removed home drops out", () => {
  const tree = [node("household", "location"), node("lake-house", "site"), node("town-house", "site"), node("old-place", "site", false)];
  assert.deepEqual(activeHomes(tree).map((n) => n.id), ["lake-house", "town-house"]);
});
