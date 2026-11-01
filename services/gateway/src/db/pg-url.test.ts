import { test } from "node:test";
import assert from "node:assert/strict";
import { forNodePg } from "./pg-url.ts";

const base = "postgres://ac_user:p%40ss%2Fword@gcp-us-central1-1.example.psdb.cloud:5432/postgres";

test("PlanetScale's string: sslrootcert=system is dropped, sslmode stays", () => {
  assert.equal(forNodePg(`${base}?sslmode=verify-full&sslrootcert=system`), `${base}?sslmode=verify-full`);
  assert.equal(forNodePg(`${base}?sslrootcert=system&sslmode=verify-full`), `${base}?sslmode=verify-full`);
});

test("alone, the parameter leaves no dangling '?'", () => {
  assert.equal(forNodePg(`${base}?sslrootcert=system`), base);
});

test("a real certificate path is a file and is kept", () => {
  const s = `${base}?sslmode=verify-full&sslrootcert=/etc/ssl/certs/ca.pem`;
  assert.equal(forNodePg(s), s);
});

test("no query, or no such parameter: returned unchanged, byte for byte", () => {
  assert.equal(forNodePg(base), base);
  const s = `${base}?sslmode=require&application_name=x`;
  assert.equal(forNodePg(s), s);
  assert.equal(forNodePg("postgres://postgres:postgres@localhost:5432/ac_ci"), "postgres://postgres:postgres@localhost:5432/ac_ci");
});

test("the password's percent-escapes are not re-encoded", () => {
  assert.ok(forNodePg(`${base}?sslrootcert=system`).includes("p%40ss%2Fword"));
});
