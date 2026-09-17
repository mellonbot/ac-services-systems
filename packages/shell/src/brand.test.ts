import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchBrand, installBrand, applyBrand, type BrandSlot } from "./brand.ts";
import { TENANT_SCOPE } from "../../tokens/src/index.ts";
import type { FetchLike } from "../../sdk/src/runtime.ts";

const CSS = `${TENANT_SCOPE}{--color-action:#1A4FA0}`;

const answering = (body: unknown, seen: { url?: string; headers?: Record<string, string> } = {}): FetchLike =>
  async (url, init) => {
    seen.url = url; seen.headers = init.headers;
    return { status: 200, ok: true, json: async () => body, text: async () => JSON.stringify(body) };
  };

const refusing = (): FetchLike => async () => { throw new Error("ECONNREFUSED"); };

const slot = (): BrandSlot & { value: () => string | null } => {
  const s: { textContent: string | null } = { textContent: null };
  return Object.assign(s, { value: () => s.textContent });
};

test("a surface the registry does not let a tenant repaint cannot ask for a theme", () => {
  // S5 is the field tablet. The refusal is here as well as at the gateway
  // because a technician reads the board the same way in every tenant or it is
  // not an instrument — and that argument should not depend on a network hop.
  assert.throws(
    () => fetchBrand({ surfaceId: "S5", baseUrl: "http://gw", fetch: refusing() }),
    /S5 \(Technician web fallback\) is not white-label/,
  );
  assert.throws(() => fetchBrand({ surfaceId: "S3", baseUrl: "http://gw", fetch: refusing() }), /not white-label/);
});

test("a tenant host fills the slot with a block that is already scoped", async () => {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  const s = slot();
  const out = await installBrand(
    { surfaceId: "S6", baseUrl: "http://gw", fetch: answering({ tenant: true, css: CSS, admission: null }, seen), host: "portal.amped.com" },
    s,
  );
  assert.equal(out.tenant, true);
  assert.equal(s.value(), CSS);
  assert.match(s.value()!, /:not\(\[data-density="field"\]\)/);
  assert.match(seen.url!, /\/brand\/theme\?host=portal\.amped\.com$/);
  assert.equal(seen.headers!["x-ac-surface"], "S6");
  assert.equal(seen.headers!["authorization"], undefined, "the sign-in screen has no token yet — that is the point");
});

test("no theme leaves the slot alone, because the frame already carries the plate", async () => {
  const s = slot();
  const out = await installBrand({ surfaceId: "S6", baseUrl: "http://gw", fetch: answering({ tenant: false, css: "", admission: null }) }, s);
  assert.equal(out.tenant, false);
  assert.equal(s.value(), null, "an empty block would be the same page, but writing one says we decided something");
});

test("an unreachable gateway is not a broken portal — branding cannot block a boot", async () => {
  const s = slot();
  const out = await installBrand({ surfaceId: "S6", baseUrl: "http://gw", fetch: refusing(), host: "portal.amped.com" }, s);
  assert.deepEqual(out, { tenant: false, css: "", unreachable: true });
  assert.equal(s.value(), null);
});

test("a surface with no slot in its frame is still safe to call", async () => {
  const out = await installBrand({ surfaceId: "S6", baseUrl: "http://gw", fetch: answering({ tenant: true, css: CSS, admission: null }) }, null);
  assert.equal(out.tenant, true);
});

test("applyBrand writes the block and nothing else", () => {
  const s = slot();
  applyBrand(s, CSS);
  assert.equal(s.value(), CSS);
});
