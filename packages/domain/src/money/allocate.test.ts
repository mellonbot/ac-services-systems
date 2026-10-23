import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, sumsExactly, lineAmount } from "./allocate.ts";

test("the cent that starts the invoice dispute never exists", () => {
  const lines = allocate(100_000n, [1n, 1n, 1n]);
  assert.ok(sumsExactly(100_000n, lines));
  assert.deepEqual(lines, [33334n, 33333n, 33333n]);
});

test("exact sum holds across adversarial splits", () => {
  for (const total of [1n, 7n, 99n, 100_000n, 987_654_321n]) {
    for (const n of [1, 2, 3, 7, 13, 50]) {
      const weights = Array.from({ length: n }, (_, i) => BigInt(i * 7 + 1));
      assert.ok(sumsExactly(total, allocate(total, weights)), `${total}/${n}`);
    }
  }
});

test("a 50-location parent allocates with no location losing more than one unit", () => {
  const weights = Array.from({ length: 50 }, () => 1n);
  const lines = allocate(1_000_00n, weights);
  const min = lines.reduce((a, b) => (a < b ? a : b));
  const max = lines.reduce((a, b) => (a > b ? a : b));
  assert.ok(max - min <= 1n);
  assert.ok(sumsExactly(1_000_00n, lines));
});

test("zero weights fall back to an even split, still exact", () => {
  assert.ok(sumsExactly(10n, allocate(10n, [0n, 0n, 0n])));
});

test("allocation is deterministic — the same invoice allocates the same way twice", () => {
  const weights = [5n, 5n, 5n, 5n, 5n, 5n, 5n];
  const a = allocate(1_000_003n, weights);
  const b = allocate(1_000_003n, weights);
  assert.deepEqual(a, b);
  // 1,000,003 / 7 leaves a remainder of 4 — the first four lines take one unit each.
  assert.deepEqual(a, [142858n, 142858n, 142858n, 142858n, 142857n, 142857n, 142857n]);
});

test("a credit allocates exactly, mirrored: -100 across three is -34, -33, -33", () => {
  const out = allocate(-100n, [1n, 1n, 1n]);
  assert.deepEqual(out, [-34n, -33n, -33n]);
  assert.ok(sumsExactly(-100n, out));
  assert.ok(sumsExactly(-1000n, allocate(-1000n, [3n, 3n, 3n, 1n])));
});

test("lineAmount: half away from zero, the same for a charge and its credit", () => {
  assert.equal(lineAmount(1500n, 333n), 500n); // 499.5 → 500
  assert.equal(lineAmount(1500n, -333n), -500n);
  assert.equal(lineAmount(1000n, 1999n), 1999n);
  assert.equal(lineAmount(1n, 499n), 0n);
});
