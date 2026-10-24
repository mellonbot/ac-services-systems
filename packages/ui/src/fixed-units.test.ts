import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatQuantity, parseMoney, parseQuantity } from "./fixed-units.ts";

test("fixed-unit helpers format and parse without floating-point arithmetic", () => {
  assert.equal(formatQuantity("10000"), "10");
  assert.equal(formatQuantity("2500"), "2.5");
  assert.equal(parseQuantity("2.5"), "2500");
  assert.throws(() => parseQuantity("1.2345"), /not a quantity/);

  assert.equal(formatMoney("123456"), "1,234.56 USD");
  assert.equal(parseMoney("42.5"), "4250");
  assert.throws(() => parseMoney("42.505"), /not an amount/);
  assert.throws(() => parseMoney("42.505", "custom message"), { message: "custom message" });
});

test("a negative formats as its sign and its magnitude — a credit is not \"0.-5\"", () => {
  assert.equal(formatMoney("-5"), "-0.05 USD");
  assert.equal(formatMoney("-150"), "-1.50 USD");
  assert.equal(formatMoney("-123456"), "-1,234.56 USD");
  assert.equal(formatQuantity("-5"), "-0.005");
  assert.equal(formatQuantity("-2500"), "-2.5");
  assert.equal(formatQuantity("-10000"), "-10");
});
