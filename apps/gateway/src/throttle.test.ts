import { test } from "node:test";
import assert from "node:assert/strict";
import { createThrottle } from "./throttle.ts";

test("a key is admitted up to its limit in a window, refused after, and admitted again in the next window", () => {
  const t = createThrottle({ limit: 3, windowMs: 1000 });
  assert.deepEqual([1, 2, 3, 4].map(() => t.hit("a", 0)), [true, true, true, false]);
  assert.equal(t.hit("b", 0), true);
  assert.equal(t.hit("a", 1000), true);
});

test("the table does not grow without bound: expired windows are swept, live ones refuse a new key", () => {
  const t = createThrottle({ limit: 1, windowMs: 1000, maxKeys: 2 });
  t.hit("a", 0); t.hit("b", 0);
  assert.equal(t.hit("c", 10), false);
  assert.equal(t.hit("c", 1000), true);
  assert.ok(t.size() <= 2);
});

test("sweep drops ended windows and keeps live ones", () => {
  const t = createThrottle({ limit: 1, windowMs: 1000 });
  t.hit("old", 0); t.hit("new", 900);
  t.sweep(1500);
  assert.equal(t.size(), 1);
  assert.equal(t.spent("new", 1500), true);
});

test("spent looks without counting: a key that has failed its limit is spent until the window turns", () => {
  const t = createThrottle({ limit: 2, windowMs: 1000 });
  assert.equal(t.spent("a", 0), false);
  t.hit("a", 0); t.hit("a", 0);
  assert.equal(t.spent("a", 0), true);
  assert.equal(t.spent("a", 1000), false);
});
