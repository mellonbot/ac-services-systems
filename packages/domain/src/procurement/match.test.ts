import { test } from "node:test";
import assert from "node:assert/strict";
import { threeWayMatch, type OrderedLine } from "./match.ts";

const line = (id: string, lineNo: number, price: bigint, received: bigint, invoiced = 0n): OrderedLine => ({ poLineId: id, lineNo, unitPriceMinor: price, receivedMilli: received, invoicedMilli: invoiced });
const PO = [line("a", 1, 4250n, 10_000n), line("b", 2, 199n, 2_500n)];

test("price and quantity agree with the order and the receipt: matched, no notes", () => {
  assert.deepEqual(threeWayMatch(PO, [{ poLineId: "a", quantityMilli: 10_000n, unitPriceMinor: 4250n }, { poLineId: "b", quantityMilli: 2_500n, unitPriceMinor: 199n }]), { state: "matched", notes: [] });
});

test("billing part of what was received matches; the rest can be billed later", () => {
  assert.equal(threeWayMatch(PO, [{ poLineId: "a", quantityMilli: 4_000n, unitPriceMinor: 4250n }]).state, "matched");
});

test("a price off by one cent is held, in the office's words", () => {
  const v = threeWayMatch(PO, [{ poLineId: "a", quantityMilli: 1_000n, unitPriceMinor: 4251n }]);
  assert.equal(v.state, "held");
  assert.deepEqual(v.notes.map((n) => n.message), ["line 1: billed at 42.51, ordered at 42.50"]);
});

test("billing more than was received — counting earlier invoices — is held", () => {
  const v = threeWayMatch([line("a", 1, 4250n, 10_000n, 8_000n)], [{ poLineId: "a", quantityMilli: 2_500n, unitPriceMinor: 4250n }]);
  assert.deepEqual(v.notes.map((n) => n.code), ["over_received"]);
  assert.match(v.notes[0]!.message, /10\.5 billed in all, 10 received/);
});

test("a line not on the order, a line billed twice and an empty invoice are each named", () => {
  assert.deepEqual(threeWayMatch(PO, [{ poLineId: "zz", quantityMilli: 1n, unitPriceMinor: 1n }]).notes.map((n) => n.code), ["unknown_line"]);
  assert.deepEqual(threeWayMatch(PO, [{ poLineId: "a", quantityMilli: 1_000n, unitPriceMinor: 4250n }, { poLineId: "a", quantityMilli: 1_000n, unitPriceMinor: 4250n }]).notes.map((n) => n.code), ["duplicate_line"]);
  assert.deepEqual(threeWayMatch(PO, []).notes.map((n) => n.code), ["empty"]);
});

test("nothing received yet: any quantity is held", () => {
  assert.equal(threeWayMatch([line("a", 1, 100n, 0n)], [{ poLineId: "a", quantityMilli: 1n, unitPriceMinor: 100n }]).state, "held");
});
