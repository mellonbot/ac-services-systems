import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { locateSite, locateSiteRead, locateSiteWrite, clearGeocodeCache, addressQuery, geocodeConfigFromEnv, type JsonFetcher } from "./imagery.ts";
import { InputRefused } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * Placing a site: the geocoder is asked only when the address has words and
 * no point, only a match AT the address is written, and the write is an
 * ordinary audited accounts.update.
 */
const U = (n: number) => `92000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SITE = U(1), ORG = U(2), REGION = U(3);
const ops: Principal = {
  namespace: "internal", subjectId: "u-ops", orgId: "org-internal", regionId: REGION, scopeTier: "parent", scopeId: "org-internal",
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "s",
};
const ADDRESS = { line1: "4012 Ridgeview Dr", city: "Fort Worth", state: "TX", postal: "76109" };
const siteRow = (address: unknown) => ({ id: SITE, tier: "site", name: "Home", parent_id: U(4), region_id: REGION, org_id: ORG, customer_group: null, external_ref: null, timezone: null, active: true, path: [SITE], address });
const db = (row: unknown) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = { async setLocal() {}, async query(sql, params = []) { queries.push({ sql, params }); return (sql.includes("FROM accounts") ? [row] : []) as never; }, async insert() {}, async commit() {}, async rollback() {} };
  return { tx, queries };
};
const uowFor = (tx: Tx) => createUnitOfWork({ surfaceId: "S2", principal: ops, requestId: "r", now: () => new Date(), newId: () => U(500) }, tx);
const geocoder = { urlTemplate: "https://geo.example/geocoding/{q}.json?key=K&limit=1" };
const answering = (calls: string[], body: unknown): JsonFetcher => async (url) => { calls.push(url); return { ok: true, json: async () => body }; };
beforeEach(() => clearGeocodeCache());
const feature = (place_type: string[], lng: number, lat: number) => ({ place_type, geometry: { type: "Point", coordinates: [lng, lat] } });

test("the address is asked for as one line of words; the geocoder template is read from the environment", () => {
  assert.equal(addressQuery(ADDRESS), "4012 Ridgeview Dr, Fort Worth, TX 76109");
  assert.equal(addressQuery({ city: "Fort Worth" }), null, "no street line is not an address to pin");
  assert.deepEqual(geocodeConfigFromEnv({}), { urlTemplate: null });
  assert.deepEqual(geocodeConfigFromEnv({ AC_MAPTILER_KEY: "k/1" }), { urlTemplate: "https://api.maptiler.com/geocoding/{q}.json?limit=1&country=us&key=k%2F1" }, "one key fills the geocoder");
  assert.deepEqual(geocodeConfigFromEnv({ AC_MAPTILER_KEY: "k", AC_GEOCODE_URL: "https://other/{q}" }), { urlTemplate: "https://other/{q}" }, "an explicit template wins");
});

test("an address-level match is written onto the address through accounts.update — audited, account.updated", async () => {
  const calls: string[] = [];
  const { tx, queries } = db(siteRow(ADDRESS));
  const uow = await uowFor(tx);
  const out = await locateSite(uow, { siteId: SITE }, geocoder, answering(calls, { features: [feature(["address"], -97.3812, 32.7101)] }));
  assert.deepEqual({ lat: out.lat, lng: out.lng, outcome: out.outcome }, { lat: 32.7101, lng: -97.3812, outcome: "located" });
  assert.equal(calls[0], `https://geo.example/geocoding/${encodeURIComponent("4012 Ridgeview Dr, Fort Worth, TX 76109")}.json?key=K&limit=1`);
  const upd = queries.find((q) => q.sql.startsWith("UPDATE accounts SET"))!;
  assert.deepEqual(JSON.parse(upd.params[1] as string), { ...ADDRESS, lat: 32.7101, lng: -97.3812 }, "the typed address is kept; the point is added");
  assert.equal(uow.pending().events[0]!.topic, "account.updated");
});

test("a street, town or postcode centroid is not_found and nothing is written; a site already placed is not asked about", async () => {
  const calls: string[] = [];
  const a = db(siteRow(ADDRESS));
  const vague = await locateSite(await uowFor(a.tx), { siteId: SITE }, geocoder, answering(calls, { features: [feature(["postal_code"], -97.3, 32.7), feature(["road"], -97.38, 32.71)] }));
  assert.equal(vague.outcome, "not_found");
  assert.equal(a.queries.some((q) => q.sql.startsWith("UPDATE")), false);
  const placed = await locateSite(await uowFor(db(siteRow({ ...ADDRESS, lat: 1, lng: 2 })).tx), { siteId: SITE }, geocoder, answering(calls, {}));
  assert.deepEqual([placed.outcome, placed.lat, placed.lng], ["recorded", 1, 2]);
  assert.equal(calls.length, 1, "only the vague one asked");
});

test("unconfigured, no street line, and a failing provider are answers; a location is not a site", async () => {
  const calls: string[] = [];
  assert.equal((await locateSite(await uowFor(db(siteRow(ADDRESS)).tx), { siteId: SITE }, { urlTemplate: null }, answering(calls, {}))).outcome, "not_configured");
  assert.equal((await locateSite(await uowFor(db(siteRow({ city: "Fort Worth" })).tx), { siteId: SITE }, geocoder, answering(calls, {}))).outcome, "no_address");
  assert.equal(calls.length, 0);
  const down: JsonFetcher = async () => { throw new Error("ECONNRESET"); };
  assert.equal((await locateSite(await uowFor(db(siteRow(ADDRESS)).tx), { siteId: SITE }, geocoder, down)).outcome, "provider_unreachable");
  const denied: JsonFetcher = async () => ({ ok: false, json: async () => ({}) });
  assert.equal((await locateSite(await uowFor(db(siteRow(ADDRESS)).tx), { siteId: SITE }, geocoder, denied)).outcome, "provider_unreachable");
  await assert.rejects(locateSite(await uowFor(db({ ...siteRow(null), tier: "location" }).tx), { siteId: SITE }, geocoder, down), (e: InputRefused) => e.code === "not_a_site");
});

test("the geocoder is asked between two transactions; the write re-reads the site and does not place an address that changed meanwhile", async () => {
  const plan = await locateSiteRead(await uowFor(db(siteRow(ADDRESS)).tx), { siteId: SITE }, geocoder);
  assert.ok("query" in plan);
  const edited = db(siteRow({ ...ADDRESS, line1: "9 Other St" }));
  const out = await locateSiteWrite(await uowFor(edited.tx), plan.siteId, plan.query, { lat: 32.7, lng: -97.3 });
  assert.equal(out.outcome, "not_found");
  assert.equal(edited.queries.some((q) => q.sql.startsWith("UPDATE")), false);
  const same = db(siteRow(ADDRESS));
  assert.equal((await locateSiteWrite(await uowFor(same.tx), plan.siteId, plan.query, { lat: 32.7, lng: -97.3 })).outcome, "located");
});

test("a geocoder failure is remembered for a minute", async () => {
  let asked = 0, t = 1_000;
  const down: JsonFetcher = async () => { asked++; throw new Error("ECONNRESET"); };
  for (let i = 0; i < 4; i++) assert.equal((await locateSite(await uowFor(db(siteRow(ADDRESS)).tx), { siteId: SITE }, geocoder, down, () => t)).outcome, "provider_unreachable");
  assert.equal(asked, 1);
  t += 61_000;
  await locateSite(await uowFor(db(siteRow(ADDRESS)).tx), { siteId: SITE }, geocoder, down, () => t);
  assert.equal(asked, 2);
});
