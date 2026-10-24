import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp } from "./app.ts";
import { owedMinor, INVOICE_STATE } from "./screens/billing.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { HierarchyContext, Principal, InvoiceWire, PaymentWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";

/**
 * 0030 — S2's billing screens against a scripted gateway, through the real
 * shell and client. What this holds: every invoice shows where it stands and
 * what is still owed; one invoice's history shows every payment in every
 * state, a returned one with when and why. Whether the status and the sums
 * are right is the gateway's and 0030's, held in
 * test/integration/s6-site-card.test.ts.
 */
const U = (n: number) => `e2300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INTERNAL = "00000000-0000-0000-0000-000000000003", SOUTH = U(1), ORG = U(2), INVOICE = U(3), PAID = U(4);
const finance: Principal = { namespace: "internal", subjectId: U(9), orgId: INTERNAL, regionId: SOUTH, scopeTier: "parent", scopeId: INTERNAL, roles: ["finance"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "s" };
const context: HierarchyContext = { principal: finance, path: [], parent: { tier: "parent", id: INTERNAL, name: "Rankine Operating Company", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH };
const base: InvoiceWire = {
  id: INVOICE, billToTier: "parent", billToId: ORG, contractId: U(5), billingPath: "enterprise_sla", periodStart: "2026-09-01", periodEnd: "2026-09-30",
  totalMinor: "128450", currency: "USD", issuedAt: "2026-10-03T15:00:00.000Z", dueAt: "2026-11-02T00:00:00.000Z",
  status: "partially_paid", paidMinor: "100000", voidedAt: null, voidReason: null, lines: [], subtotalMinor: "128450",
};
const invoices: InvoiceWire[] = [base, { ...base, id: PAID, status: "paid", paidMinor: "128450" }];
const payments: PaymentWire[] = [
  { id: U(10), invoiceId: INVOICE, amountMinor: "100000", currency: "USD", method: "check", reference: "CHK 4471", state: "succeeded", receivedAt: "2026-10-10T16:00:00.000Z", returnedAt: null, returnReason: null },
  { id: U(11), invoiceId: INVOICE, amountMinor: "28450", currency: "USD", method: "ach", reference: null, state: "returned", receivedAt: "2026-10-12T16:00:00.000Z", returnedAt: "2026-10-15T16:00:00.000Z", returnReason: "R01 insufficient funds" },
];

const gateway = () => {
  const calls: string[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url) => {
    const u = new URL(url);
    calls.push(`${u.pathname}${u.search}`);
    if (u.pathname === OPERATIONS["auth.login"].path) return reply(200, { token: "t", expiresAt: "2026-10-28T00:00:00Z", context: {} });
    if (u.pathname === OPERATIONS["session.me"].path) return reply(200, context);
    if (u.pathname === OPERATIONS["invoices.list"].path) return reply(200, { invoices });
    if (u.pathname === OPERATIONS["payments.list"].path) return reply(200, { payments: u.searchParams.get("invoiceId") === INVOICE ? payments : [] });
    if (u.pathname === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [{ id: ORG, name: "Amped Fitness", kind: "customer", segment: "commercial", externalRef: null, active: true, regionNodeCount: 1 }] });
    if (u.pathname === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: u.pathname });
  };
  return { fetch, calls };
};
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
const ready = async () => {
  const g = gateway();
  const app = createApp({ baseUrl: "https://api.ac.test", fetch: g.fetch });
  await app.login("finance@ac.test", "pw");
  render(app.view()); await settle();
  return { app, g };
};

test("what is still owed: the total less what was received; nothing on a draft or a void invoice", () => {
  assert.equal(owedMinor(base), "28450");
  assert.equal(owedMinor({ ...base, status: "paid", paidMinor: "128450" }), "0");
  assert.equal(owedMinor({ ...base, status: "void", paidMinor: "0", voidedAt: "2026-10-05T00:00:00.000Z", voidReason: "billed twice" }), "0");
  assert.equal(owedMinor({ ...base, status: "draft", issuedAt: null, paidMinor: "0" }), "0");
});

test("an invoice's standing is a filing mark with a word, never the status ramp", () => {
  for (const s of Object.values(INVOICE_STATE)) assert.ok(["pending", "held", "live", "settled", "ended"].includes(s.tone) && s.word.length > 0);
  assert.equal(INVOICE_STATE.void.tone, "ended", "a void invoice is struck through, as cancelled");
  assert.notEqual(INVOICE_STATE.paid.tone, "ended", "a paid one is not: struck through would read as cancelled");
});

test("/billing: every invoice with its customer, what is still owed and where it stands, linked to its history", async () => {
  const { app } = await ready();
  app.router.navigate("billing", {});
  render(app.view()); await settle();
  const out = render(app.view());
  assert.match(out, /Amped Fitness/);
  assert.match(out, /Part paid/);
  assert.match(out, /Paid in full/);
  assert.ok(out.includes("284.50"), "what is still owed on the part-paid invoice");
  assert.ok(out.includes(`/billing/invoices/${INVOICE}`), "each invoice links to its payment history");
});

test("/billing/invoices/:id: every payment in every state — a returned one says when and why — beside received and still owed", async () => {
  const { app, g } = await ready();
  app.router.navigate("billing.invoice", { invoiceId: INVOICE });
  render(app.view()); await settle();
  const out = render(app.view());
  assert.ok(g.calls.some((c) => c.startsWith(`${OPERATIONS["payments.list"].path}?`) && c.includes(INVOICE)), "the history is read for this invoice");
  const history = /id="payment-history"(.*?)<\/section>/s.exec(out)![1]!;
  assert.match(history, /CHK 4471/);
  assert.match(history, /Received/);
  assert.match(history, /Returned/);
  assert.match(history, /R01 insufficient funds/);
  const facts = /id="invoice-facts"(.*?)<\/dl>/s.exec(out)![1]!;
  assert.ok(facts.includes("1,000.00") && facts.includes("284.50"), facts);
});

test("an invoice that is not there says so, with the way back", async () => {
  const { app } = await ready();
  app.router.navigate("billing.invoice", { invoiceId: U(77) });
  render(app.view()); await settle();
  assert.match(render(app.view()), /Invoice not found/);
});
