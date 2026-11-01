import { test } from "node:test";
import assert from "node:assert/strict";
import { setBrandTheme, brandStylesheetFor, normaliseHost } from "./brand.ts";
import { createUnitOfWork, SurfaceWriteDenied, type Tx } from "../unit-of-work.ts";
import { InputRefused } from "../refusals.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import { TENANT_SCOPE } from "../../../../packages/tokens/src/index.ts";

/**
 * THE CALLER packages/tokens WAS WRITTEN FOR.
 *
 * `brandCss` and `validateBrandTheme` shipped with no call site, which made
 * "validation runs BEFORE storage, not at render, and not in a designer's head"
 * a claim about a path that did not exist. These tests are that path, in both
 * directions: what cannot become a row, and what a portal gets when it boots.
 */
const accountOwner: Principal = {
  namespace: "internal", subjectId: "u-ao", orgId: "org-internal", regionId: "reg-south",
  scopeTier: "parent", scopeId: "org-internal", roles: ["account_owner"],
  firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};

const fakeTx = (rows: readonly Record<string, unknown>[] = []) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) { queries.push({ sql, params }); return rows as never; },
    async insert(table, row) { inserted.push({ table, row }); },
    async commit() {},
    async rollback() {},
  };
  return { tx, queries, inserted };
};

const uowFor = (tx: Tx, surfaceId: "S2" | "S3" = "S2") =>
  createUnitOfWork(
    { surfaceId, principal: surfaceId === "S2" ? accountOwner : { ...accountOwner, roles: ["dispatcher"] }, requestId: "req-1", now: () => new Date("2026-09-16T12:00:00Z"), newId: () => "evt-1" },
    tx,
  );

/** Amped's navy: 6.67:1 on the panel ground, and their brand. */
const AMPED = { host: "portal.ampedfitness.com", orgId: "org-amped", regionId: "reg-south", accent: "#1A4FA0", overrides: { "color.action": "#1A4FA0", "color.action-ink": "#FFFFFF" } };

test("a theme that would break the portal never becomes a row, and the refusal carries the ratio", async () => {
  const f = fakeTx();
  const uow = await uowFor(f.tx);
  // #c8c8c8 body text is 1.63:1 on the panel ground. "Insufficient contrast"
  // starts an argument with a brand team; the number ends one.
  await assert.rejects(
    () => setBrandTheme(uow, "u-ao", { ...AMPED, overrides: { "color.text": "#c8c8c8" } }),
    (e: unknown) => {
      assert.ok(e instanceof InputRefused);
      assert.equal(e.code, "theme_rejected");
      assert.match(e.message, /needs 4\.5:1/);
      assert.match(e.message, /:1 on the light stock/, "the stock it was measured on is named");
      return true;
    },
  );
  assert.deepEqual(f.queries, [], "nothing was written");
});

test("a structural token is not a slot, whoever asks", async () => {
  const uow = await uowFor(fakeTx().tx);
  for (const [token, value] of [["color.focus-ring", "#ff00ff"], ["color.status-breached", "#e01b24"]] as const) {
    await assert.rejects(
      () => setBrandTheme(uow, "u-ao", { ...AMPED, overrides: { [token]: value } }),
      /not overridable/,
      token,
    );
  }
});

test("the accent must be measurable, and the host must be a host", async () => {
  const uow = await uowFor(fakeTx().tx);
  await assert.rejects(() => setBrandTheme(uow, "u-ao", { ...AMPED, accent: "brand red" }), /must be #rrggbb/);
  await assert.rejects(() => setBrandTheme(uow, "u-ao", { ...AMPED, host: "" }), /needs the host/);
  await assert.rejects(() => setBrandTheme(uow, "u-ao", { ...AMPED, host: "https://x.com/y" }), /is not a hostname/);
});

test("a valid theme is stored with the verdict it was saved under, not just the colours", async () => {
  const f = fakeTx();
  const uow = await uowFor(f.tx);
  const out = await setBrandTheme(uow, "u-ao", { ...AMPED, host: "  Portal.AmpedFitness.com:8443 " });
  assert.equal(out.host, "portal.ampedfitness.com", "normalised once, in the handler");
  // The gate's answer is stored because it is what an account manager was shown
  // when they saved. A recomputed verdict cannot be held against an argument.
  assert.equal(out.admission.stateSurfaces, true, "navy is 133.8 degrees from the nearest state hue");
  assert.deepEqual(out.admission.tiers.field, { text: false, fill: false }, "2.24:1 on the plate — barred from the tablet");
  const insert = f.queries[0]!;
  assert.match(insert.sql, /INSERT INTO brand_themes/);
  assert.match(insert.sql, /ON CONFLICT \(org_id\) DO UPDATE/, "a tenant has one theme, not one per save");
  assert.equal(insert.params[2], "portal.ampedfitness.com");
  assert.equal(JSON.parse(insert.params[5] as string).stateSurfaces, true);

  await uow.commit();
  const audit = f.inserted.find((i) => i.table === "audit_log")!;
  assert.equal(audit.row.entity, "brand_theme");
  assert.equal(audit.row.action, "brand_theme.set");
  assert.equal(f.inserted.find((i) => i.table === "outbox")!.row.topic, "brand.theme_set");
});

test("only the surface that authors account truth may author a tenant's livery", async () => {
  // S3 is a dispatch console. Its allowlist has no brand_theme, and the unit of
  // work says so without this handler having to know which surface it is on.
  const uow = await uowFor(fakeTx().tx, "S3");
  await assert.rejects(() => setBrandTheme(uow, "u-disp", AMPED), SurfaceWriteDenied);
});

test("a portal boots: a known host gets its block, scoped away from the plate", async () => {
  const f = fakeTx([{ overrides: { "color.action": "#1A4FA0", "color.action-ink": "#FFFFFF" }, accent_admission: { stateSurfaces: true } }]);
  const out = await brandStylesheetFor(f.tx, "PORTAL.ampedfitness.com");
  assert.equal(out.tenant, true);
  assert.equal(out.css, `${TENANT_SCOPE}{--color-action:#1A4FA0;--color-action-ink:#FFFFFF}`);
  assert.match(out.css, /:not\(\[data-density="field"\]\)/, "a tenant theme cannot reach the tablet");
  assert.equal(f.queries[0]!.params[0], "portal.ampedfitness.com");
});

test("an unknown host gets Rankine's plate and says nothing about who our customers are", async () => {
  // Not a 404. This route is reachable without a token, so a 404 would answer
  // "is X one of yours?" for anyone who asks. It is also the useful answer:
  // there is never an unstyled portal, only one we have not repainted.
  for (const host of ["nobody.example", "", undefined]) {
    const out = await brandStylesheetFor(fakeTx([]).tx, host);
    assert.deepEqual(out, { tenant: false, css: "", admission: null }, String(host));
  }
});

test("a host is normalised once, here, and never at a call site", () => {
  for (const [given, want] of [
    ["Portal.Amped.com", "portal.amped.com"],
    ["portal.amped.com.", "portal.amped.com"],
    ["  portal.amped.com:8443  ", "portal.amped.com"],
  ] as const) assert.equal(normaliseHost(given), want);
});
