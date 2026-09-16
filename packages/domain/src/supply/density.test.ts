import { test } from "node:test";
import assert from "node:assert/strict";
import { admitLocationSupply, D14_RULE_NOT_SET } from "./density.ts";

test("rule not set (0): admitted with the caveat that names the region — never a silent pass", () => {
  const d = admitLocationSupply({ regionName: "South", minCrewDensity: 0, activeCrews: 0 });
  assert.equal(d.kind, "admitted");
  if (d.kind === "admitted") assert.deepEqual(d.caveats, [D14_RULE_NOT_SET("South")]);
});

test("rule set and met: admitted, no caveat", () => {
  assert.deepEqual(admitLocationSupply({ regionName: "South", minCrewDensity: 3, activeCrews: 3 }), { kind: "admitted", caveats: [] });
});

test("rule set and unmet: refused, commercial code, the numbers in the message", () => {
  const d = admitLocationSupply({ regionName: "Mountain", minCrewDensity: 4, activeCrews: 1 });
  assert.equal(d.kind, "refused");
  if (d.kind === "refused") {
    assert.equal(d.code, "supply_below_density");
    assert.match(d.message, /Mountain has 1 active crew;/);
    assert.match(d.message, /rule for the region is 4/);
  }
});

test("a rule that is not a non-negative integer is a bug in the data, not a decision", () => {
  assert.throws(() => admitLocationSupply({ regionName: "X", minCrewDensity: -1, activeCrews: 0 }), RangeError);
  assert.throws(() => admitLocationSupply({ regionName: "X", minCrewDensity: 1.5, activeCrews: 0 }), RangeError);
});
