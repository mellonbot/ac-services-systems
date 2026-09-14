import { test } from "node:test";
import assert from "node:assert/strict";
import { BILLING_PATHS } from "./index.ts";
import { sumsExactly } from "../money/allocate.ts";
import type { BillableEvent } from "./path.ts";

const ev = (account: string, qty: bigint, price: bigint): BillableEvent => ({
  jobId: `job-${account}-${qty}`, accountId: account, serviceCode: "PM-QTR",
  quantityMilli: qty, unitPriceMinor: price,
});

test("all four paths exist and none is a flag on another", () => {
  assert.deepEqual(Object.keys(BILLING_PATHS).sort(),
    ["enterprise_sla", "one_time", "project", "residential_membership"]);
});

test("enterprise: ONE header at the parent, EVERY line carrying its location", () => {
  const events = [ev("phx-04", 1000n, 45_000n), ev("phx-07", 3000n, 45_000n), ev("tus-01", 2000n, 45_000n)];
  const inv = BILLING_PATHS.enterprise_sla.build(events, {
    billToAccountId: "amped", billToTier: "parent",
    resolvedTerms: { platform_fee_minor: "100000" },
    periodStart: "2026-09-01", periodEnd: "2026-09-30",
  });
  assert.equal(inv.billToAccountId, "amped");
  assert.ok(sumsExactly(inv.totalMinor, inv.lines.map((l) => l.amountMinor)));
  // Every line is attributable to a location — a facilities director can cost-code it.
  assert.ok(inv.lines.every((l) => l.accountId !== "amped" || l.jobId === null));
  const feeLines = inv.lines.filter((l) => l.jobId === null);
  assert.equal(feeLines.reduce((a, l) => a + l.amountMinor, 0n), 100_000n);
});

test("enterprise refuses to bill a location — the fifty-invoice failure mode", () => {
  assert.throws(
    () => BILLING_PATHS.enterprise_sla.build([ev("phx-04", 1000n, 1n)], {
      billToAccountId: "phx-04", billToTier: "location", resolvedTerms: {},
    }),
    /bills to parent or region/,
  );
});

test("project retainage nets out of the same invoice, in integers", () => {
  const inv = BILLING_PATHS.project.build([ev("site-a", 1000n, 1_000_000n)], {
    billToAccountId: "site-a", billToTier: "location", resolvedTerms: { retainage_bps: "1000" },
  });
  assert.equal(inv.totalMinor, 900_000n);
});
