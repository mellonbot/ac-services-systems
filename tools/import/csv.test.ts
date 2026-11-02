import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, CsvError } from "./csv.ts";

test("quoted commas, doubled quotes and a line break inside a field; each row keeps the line it started on", () => {
  const f = parseCsv('﻿Name, City \r\n"Acme, Inc.","Fort ""Worth"""\r\n\r\n"Two\nLines",Dallas\n');
  assert.deepEqual(f.headers, ["name", "city"]);
  assert.deepEqual(f.rows.map((r) => [r.line, r.values.name, r.values.city]), [
    [2, "Acme, Inc.", 'Fort "Worth"'],
    [4, "Two\nLines", "Dallas"],
  ]);
});

test("a short row reads its missing fields as empty; a long row, a duplicate header and an open quote are refused by line", () => {
  assert.equal(parseCsv("a,b\nx\n").rows[0]!.values.b, "");
  assert.throws(() => parseCsv("a,b\n1,2,3\n"), (e: unknown) => e instanceof CsvError && e.line === 2);
  assert.throws(() => parseCsv("a,A\n"), /twice/);
  assert.throws(() => parseCsv('a\n"open\n'), (e: unknown) => e instanceof CsvError && e.line === 2);
});
