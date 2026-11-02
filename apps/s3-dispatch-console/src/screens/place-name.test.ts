import { test } from "node:test";
import assert from "node:assert/strict";
import { placeName } from "./common.ts";

test("dispatch names a homeowner's job by the customer, since every house's site is just 'Home'", () => {
  assert.equal(placeName({ siteName: "Home", customerName: "Turner residence", customerSegment: "residential" }), "Turner residence");
});

test("a building's job is named by its site — that is where the crew goes", () => {
  assert.equal(placeName({ siteName: "Austin — Roof", customerName: "Amped Fitness Inc.", customerSegment: "commercial" }), "Austin — Roof");
});

test("a home whose customer row is not visible falls back to the site, and a missing site says so", () => {
  assert.equal(placeName({ siteName: "Home", customerName: null, customerSegment: "residential" }), "Home");
  assert.equal(placeName({ siteName: null, customerName: null, customerSegment: null }), "Site name unavailable");
});
