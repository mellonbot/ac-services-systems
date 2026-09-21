import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { siteImagery, coordinatesOf, renderTemplate, imageryConfigFromEnv, clearImageryCache, type Fetcher } from "./imagery.ts";
import { InputRefused } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * The gateway fetches the roof; the browser never does. Everything the
 * handler can answer without a provider is answered without one, and every
 * way a provider can fail is an `unavailable`, never a 500.
 */
const U = (n: number) => `91000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SITE = U(1);
const scripted = (rows: unknown[]) => {
  const tx: Tx = { async setLocal() {}, async query(sql) { return (sql.includes("FROM accounts") ? rows : []) as never; }, async insert() {}, async commit() {}, async rollback() {} };
  return tx;
};
const customer: Principal = {
  namespace: "customer", subjectId: U(9), orgId: U(2), regionId: U(3), scopeTier: "location", scopeId: U(4),
  roles: [], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "s",
};
const uowFor = (tx: Tx) => createUnitOfWork({ surfaceId: "S6", principal: customer, requestId: "r", now: () => new Date(), newId: () => U(500) }, tx);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const okFetch = (calls: string[]): Fetcher => async (url) => { calls.push(url); return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) }; };
const configured = { urlTemplate: "https://tiles.example/static?c={lat},{lng}&z={zoom}&s={w}x{h}&key=K", attribution: "© Provider" };
const withCoords = [{ id: SITE, tier: "site", address: { line1: "1 Main", lat: 30.2672, lng: -97.7431 } }];

beforeEach(clearImageryCache);

test("coordinates are read off the address and validated; the template names lat, lng, zoom and size", () => {
  assert.deepEqual(coordinatesOf({ lat: 30.5, lng: -97.1 }), { lat: 30.5, lng: -97.1 });
  assert.equal(coordinatesOf({ lat: 91, lng: 0 }), null);
  assert.equal(coordinatesOf({ line1: "no coords" }), null);
  assert.equal(coordinatesOf(null), null);
  assert.equal(renderTemplate(configured.urlTemplate, { lat: 1.5, lng: -2 }), "https://tiles.example/static?c=1.5,-2&z=18&s=640x360&key=K");
  assert.deepEqual(imageryConfigFromEnv({}), { urlTemplate: null, attribution: null });
  assert.deepEqual(imageryConfigFromEnv({ AC_IMAGERY_URL: " x ", AC_IMAGERY_ATTRIBUTION: "" }), { urlTemplate: "x", attribution: null });
});

test("not configured → the address alone, and the provider is never asked; no coordinates → says so", async () => {
  const calls: string[] = [];
  const a = await siteImagery(await uowFor(scripted(withCoords)), { siteId: SITE }, { urlTemplate: null, attribution: null }, okFetch(calls));
  assert.equal(a.unavailable, "not_configured"); assert.equal(a.image, null); assert.equal(a.lat, 30.2672);
  assert.equal(calls.length, 0);
  const b = await siteImagery(await uowFor(scripted([{ id: SITE, tier: "site", address: { line1: "1 Main" } }])), { siteId: SITE }, configured, okFetch(calls));
  assert.equal(b.unavailable, "no_coordinates"); assert.equal(calls.length, 0);
});

test("configured → the gateway fetches once, returns a data: URL with the provider's credit, and serves the second read from cache", async () => {
  const calls: string[] = [];
  let t = 1_000_000;
  const first = await siteImagery(await uowFor(scripted(withCoords)), { siteId: SITE }, configured, okFetch(calls), () => t);
  assert.equal(first.unavailable, null);
  assert.match(first.image!, /^data:image\/png;base64,iVBORw0KGgo/);
  assert.equal(first.attribution, "© Provider");
  assert.equal(calls[0], "https://tiles.example/static?c=30.2672,-97.7431&z=18&s=640x360&key=K");
  t += 60_000;
  await siteImagery(await uowFor(scripted(withCoords)), { siteId: SITE }, configured, okFetch(calls), () => t);
  assert.equal(calls.length, 1, "a roof does not move; the provider bills per fetch");
});

test("a provider that errors, times out, or answers with something that is not an image is 'provider_unreachable', not a 500", async () => {
  const failing: Fetcher = async () => { throw new Error("ECONNREFUSED"); };
  const a = await siteImagery(await uowFor(scripted(withCoords)), { siteId: SITE }, configured, failing);
  assert.equal(a.unavailable, "provider_unreachable");
  const html: Fetcher = async () => ({ ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal((await siteImagery(await uowFor(scripted(withCoords)), { siteId: SITE }, configured, html)).unavailable, "provider_unreachable");
  const denied: Fetcher = async () => ({ ok: false, status: 403, headers: { get: () => "image/png" }, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal((await siteImagery(await uowFor(scripted(withCoords)), { siteId: SITE }, configured, denied)).unavailable, "provider_unreachable");
});

test("an invisible site is unknown_site; a location is not_a_site", async () => {
  await assert.rejects(siteImagery(await uowFor(scripted([])), { siteId: SITE }, configured, okFetch([])), (e: InputRefused) => e.code === "unknown_site");
  await assert.rejects(siteImagery(await uowFor(scripted([{ id: SITE, tier: "location", address: null }])), { siteId: SITE }, configured, okFetch([])), (e: InputRefused) => e.code === "not_a_site");
});
