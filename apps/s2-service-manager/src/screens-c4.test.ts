import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToString as render } from "../../../packages/ui/src/testing.ts";
import { createApp, SCREEN_VIEWS } from "./app.ts";
import { SCREENS } from "./screens.ts";
import { NEXT_FIRM, STATUS_TONE, documentStatus, readableKinds, EXPIRING_WITHIN_DAYS } from "./screens/network.ts";
import { canSubmitFirm } from "./screens/network-new.ts";
import { coversToday } from "./screens/network-documents.ts";
import { readable, inEffect } from "./screens/network-rates.ts";
import type { FetchLike } from "../../../packages/sdk/src/runtime.ts";
import type { CredentialWire, CrewWire, FirmWire, HierarchyContext, Principal, RateCardWire } from "../../../packages/contracts/src/index.ts";
import { OPERATIONS } from "../../../packages/contracts/src/index.ts";
import { NEXT_FIRM_STATES } from "../../gateway/src/handlers/network.ts";
import { matchPath } from "../../../packages/ui/src/index.ts";

/**
 * C4's screens against a scripted gateway, through the REAL shell and the REAL
 * generated client. What this holds: the network lists firms with their filing
 * state and their crews' document standing; the ladder the screen offers is the
 * ladder the handler admits, edge for edge; the crew form offers a firm only
 * where the handler would accept one; and the document screen has no verified
 * field to submit — the record form cannot express verification at all, which
 * is the first of the three lines 0005's trigger closes. The wire is held in
 * test/integration/s2-c4.test.ts.
 */
const U = (n: number) => `c4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SOUTH = U(2), FIRM_A = U(10), FIRM_B = U(11), CREW_A = U(12), CREW_OURS = U(13), COI = U(20), LIC = U(21), RATE_JAN = U(30), RATE_OCT = U(31);
const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const owner: Principal = {
  namespace: "internal", subjectId: "u-owner", orgId: "org-internal", regionId: SOUTH, scopeTier: "parent", scopeId: "org-internal",
  roles: ["account_owner"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-1",
};
const context: HierarchyContext = {
  principal: owner, path: [{ tier: "parent", id: "org-internal", name: "AC Services" }],
  parent: { tier: "parent", id: "org-internal", name: "AC Services", regionId: null, customerGroup: null }, regions: [], activeRegionId: SOUTH,
};

const FIRMS: FirmWire[] = [
  { id: FIRM_A, legalName: "Firm A LLC", status: "active", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-09-01", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 1, activeCrewCount: 1 },
  { id: FIRM_B, legalName: "Firm B LLC", status: "onboarding", regionId: SOUTH, settlementTermsDays: 45, msaSignedAt: null, diagnosticDataRightsReserved: false, w9DocumentKey: null, crewCount: 0, activeCrewCount: 0 },
  { id: U(12345), legalName: "Firm C LLC", status: "terminated", regionId: SOUTH, settlementTermsDays: 30, msaSignedAt: "2025-01-01", diagnosticDataRightsReserved: true, w9DocumentKey: null, crewCount: 0, activeCrewCount: 0 },
];
const CREWS: CrewWire[] = [
  {
    id: CREW_A, label: "Crew A1", employmentType: "subcontracted", firmId: FIRM_A, homeRegionId: SOUTH, active: true,
    documents: { required: ["insurance", "license", "background_check"], satisfied: ["insurance", "license"], unverified: [], expired: [], missing: ["background_check"], earliestExpiry: "2027-06-30" },
  },
  {
    id: CREW_OURS, label: "Crew W1", employmentType: "employed", firmId: null, homeRegionId: SOUTH, active: true,
    documents: { required: ["license", "background_check"], satisfied: ["license", "background_check"], unverified: [], expired: [], missing: [], earliestExpiry: "2028-01-01" },
  },
];
const DOCS: CredentialWire[] = [
  { id: COI, crewId: CREW_A, kind: "insurance", identifier: "COI-1", validFrom: "2026-01-01", validTo: "2027-06-30", documentKey: null, verifiedAt: "2026-09-02T10:00:00+00", verifiedBy: U(1) },
  { id: LIC, crewId: CREW_A, kind: "license", identifier: "LIC-1", validFrom: "2026-01-01", validTo: "2027-01-01", documentKey: null, verifiedAt: null, verifiedBy: null },
];
const RATES: RateCardWire[] = [
  { id: RATE_JAN, firmId: FIRM_A, serviceCode: "HVAC_REPAIR", rateMinor: "9500", currency: "USD", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-01" },
  { id: RATE_OCT, firmId: FIRM_A, serviceCode: "HVAC_REPAIR", rateMinor: "9900", currency: "USD", effectiveFrom: "2026-10-01", effectiveTo: null },
];

type Reply = { status: number; body: unknown };
const fakeGateway = (overrides: Partial<Record<string, Reply>> = {}) => {
  let session = false;
  const calls: { path: string; init: Parameters<FetchLike>[1] }[] = [];
  const reply = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body), body: null });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, init });
    if (path === OPERATIONS["auth.login"].path) { session = true; return reply(200, { token: "never-held", expiresAt: "2026-09-17T00:00:00Z", context: {} }); }
    if (!session) return reply(401, { error: "AuthError", code: "malformed", message: "no session" });
    const o = overrides[path];
    if (o) return reply(o.status, o.body);
    if (path === OPERATIONS["session.me"].path) return reply(200, context);
    if (path === OPERATIONS["regions.list"].path) return reply(200, { regions: [{ id: SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 0, active: true }] });
    if (path === OPERATIONS["firms.list"].path) return reply(200, { firms: FIRMS });
    if (path === OPERATIONS["crews.list"].path) return reply(200, { crews: CREWS });
    if (path === OPERATIONS["credentials.list"].path) return reply(200, { credentials: DOCS });
    if (path === OPERATIONS["rateCards.list"].path) return reply(200, { rateCards: RATES });
    if (path === OPERATIONS["organizations.list"].path) return reply(200, { organizations: [] });
    if (path === OPERATIONS["events.stream"].path) return { status: 200, ok: true, json: async () => ({}), text: async () => "", body: null };
    return reply(404, { error: "NoRoute", message: `no route ${path}` });
  };
  return { fetch, calls };
};

const settle = () => new Promise((r) => setTimeout(r, 0));

const ready = async (overrides?: Partial<Record<string, Reply>>) => {
  const g = fakeGateway(overrides);
  const app = createApp({ baseUrl: "http://gw.test", fetch: g.fetch });
  await app.boot();
  await app.login("owner@ac.test", "pw");
  await settle();
  return { app, gateway: g };
};

const paint = async (app: ReturnType<typeof createApp>, screen: keyof typeof SCREENS, params: Record<string, string>) => {
  app.router.navigate(screen, params);
  render(app.view());
  await settle();
  await settle();
  return render(app.view());
};

test("every C4 screen is registered, has a view, and names only operations S2 may call", () => {
  for (const id of ["network", "network.firm.new", "network.crew.new", "network.crew.documents", "network.rates"] as const) {
    assert.ok(id in SCREENS, `${id} is not in SCREENS`);
    assert.ok(id in SCREEN_VIEWS, `${id} has no view`);
    for (const op of SCREENS[id].uses) {
      assert.ok(OPERATIONS[op].surfaces.includes("S2"), `${id} uses ${op}, which S2 may not call`);
    }
  }
});

test("route order: the network's specific paths are not swallowed by /network/:firmId?", () => {
  const order = Object.entries(SCREENS);
  const hit = (path: string) => order.find(([, spec]) => matchPath(spec.path, path) !== null)![0];
  assert.equal(hit("/network/firms/new"), "network.firm.new");
  assert.equal(hit("/network/crews/new"), "network.crew.new");
  assert.equal(hit(`/network/crews/${CREW_A}/documents`), "network.crew.documents");
  assert.equal(hit(`/network/rates/${FIRM_A}`), "network.rates");
  assert.equal(hit(`/network/${FIRM_A}`), "network");
});

test("the ladder the screen offers is the ladder the handler admits — edge for edge, from both files", () => {
  for (const status of ["onboarding", "active", "suspended", "terminated"] as const) {
    assert.deepEqual(
      [...NEXT_FIRM[status]].sort(),
      [...NEXT_FIRM_STATES[status]].sort(),
      `${status}: the screen would offer a step the handler refuses, or hide one it admits`,
    );
  }
  // Filing state is not operational health: none of the four tones is a status word.
  assert.deepEqual(Object.values(STATUS_TONE).sort(), ["ended", "held", "live", "pending"]);
});

test("the network lists firms with their filing state and offers only admitted steps", async () => {
  const { app } = await ready();
  const html = await paint(app, "network", { firmId: FIRM_A });
  assert.match(html, /Firm A LLC/);
  assert.match(html, /Firm B LLC/);
  assert.match(html, /data-tone="live">active/);
  assert.match(html, /data-tone="pending">onboarding/);
  assert.match(html, /data-tone="ended">terminated/);
  // Firm A is active → suspend | terminate, and NOT activate.
  assert.match(html, /id="step-suspended"/);
  assert.match(html, /id="step-terminated"/);
  assert.doesNotMatch(html, /id="step-active"/, "an active firm is not offered activation");
  assert.match(html, /30 days \(D13\)/);
  assert.match(html, /Reserved/);
});

test("an unsigned MSA is shown as the thing standing between the firm and activation, with the way to fix it", async () => {
  const { app } = await ready();
  const html = await paint(app, "network", { firmId: FIRM_B });
  assert.match(html, /not signed — a firm is not activated without one/);
  assert.match(html, /Record signature/);
  assert.match(html, /id="step-active"/, "onboarding → active is offered; the refusal it would meet is the missing MSA, and the form to fix it is right here");
});

test("a crew's document standing is the gate's question asked of today, and it is a pill because that IS health", () => {
  const base = { required: ["insurance", "license"], satisfied: ["insurance", "license"], unverified: [], expired: [], missing: [], earliestExpiry: null };
  assert.deepEqual(documentStatus({ ...base }, TODAY), { status: "ok", label: "cleared" });
  assert.equal(documentStatus({ ...base, missing: ["license"], satisfied: ["insurance"] }, TODAY).status, "blocked");
  assert.match(documentStatus({ ...base, missing: ["license"], satisfied: ["insurance"] }, TODAY).label, /missing license/, "the pill's next word is the kind, not a click");
  assert.equal(
    documentStatus({ ...base, missing: ["background_check"], satisfied: [] }, TODAY).label,
    "missing background check",
    "the wire's snake_case is not a person's word — the pill reads like the chips beside it",
  );
  // One helper, so the pill and the chips on the document screen cannot drift
  // apart. The browser drive is what found them disagreeing.
  assert.equal(readableKinds(["background_check", "license"]), "background check, license");
  assert.equal(documentStatus({ ...base, expired: ["license"], satisfied: ["insurance"] }, TODAY).status, "blocked");
  assert.equal(documentStatus({ ...base, unverified: ["license"], satisfied: ["insurance"] }, TODAY).status, "at_risk", "on file and unchecked is not the same as missing, and not the same as cleared");
  // The expiry horizon is the worker's: the screen warns on exactly the days the sweep emits credential.expiring for.
  assert.equal(documentStatus({ ...base, earliestExpiry: plusDays(EXPIRING_WITHIN_DAYS - 1) }, TODAY).status, "at_risk");
  assert.equal(documentStatus({ ...base, earliestExpiry: plusDays(EXPIRING_WITHIN_DAYS + 5) }, TODAY).status, "ok");
});

test("the crew form offers a firm only when the shape is subcontracted, and never a terminated one", async () => {
  const { app } = await ready();
  let html = await paint(app, "network.crew.new", { firmId: FIRM_A });
  assert.match(html, /Firm A LLC \(active\)/);
  assert.doesNotMatch(html, /Firm C LLC/, "a terminated firm is not offered — that refusal is one the form can simply not produce");

  // With no firm in the path the form starts employed, and offers no firm at all.
  html = await paint(app, "network.crew.new", {});
  assert.match(html, /An employed crew is ours — no firm is named, and none is offered/);
  assert.doesNotMatch(html, /<select name="firmId"/);
});

test("THE RECORD FORM HAS NO VERIFIED FIELD — the first of the three lines, and the only one a user can see", async () => {
  const { app, gateway } = await ready();
  const html = await paint(app, "network.crew.documents", { crewId: CREW_A });
  assert.match(html, /id="credential-form"/);
  assert.doesNotMatch(html, /name="verifiedAt"/);
  assert.doesNotMatch(html, /name="verifiedBy"/);
  assert.doesNotMatch(html, /type="checkbox"/, "not a checkbox, not a disabled one — there is no control for it");
  assert.match(html, /There is no verified box on this form/);

  // The verified document says who and when and offers no edit; the unverified one offers Verify.
  assert.match(html, new RegExp(`id="verify-${LIC}"`), "the unverified licence can be verified");
  assert.doesNotMatch(html, new RegExp(`id="verify-${COI}"`), "the verified COI cannot be verified again from the screen");
  assert.match(html, /a correction is a new document/);
  assert.match(html, /on file, never checked — it clears nothing/);

  // Nothing was written by rendering.
  const posts = gateway.calls.filter((c) => (c.init.method ?? "GET").toUpperCase() === "POST" && c.path !== OPERATIONS["auth.login"].path);
  assert.equal(posts.length, 0);
});

test("a document counts only when it is verified AND today is inside its window", () => {
  const c = (over: Partial<CredentialWire>): CredentialWire => ({ ...DOCS[0]!, ...over });
  assert.equal(coversToday(c({ verifiedAt: null }), "2026-09-16"), false, "on file is not checked");
  assert.equal(coversToday(c({ validTo: "2026-09-15" }), "2026-09-16"), false, "checked is not current");
  assert.equal(coversToday(c({ validFrom: "2026-10-01" }), "2026-09-16"), false, "not yet in force");
  assert.equal(coversToday(c({}), "2026-09-16"), true);
});

test("OQ5 firm-side blocks the firm form with ZERO gateway calls while it is unstated", async () => {
  const { app, gateway } = await ready();
  const html = await paint(app, "network.firm.new", {});
  assert.match(html, /Diagnostic data rights \(OQ5, firm side\)/);
  assert.match(html, /Not stated\./);
  assert.match(html, /id="record-firm"[^>]*disabled/);
  const posts = gateway.calls.filter((c) => c.path === OPERATIONS["firms.create"].path && (c.init.method ?? "GET").toUpperCase() === "POST").length;
  assert.equal(posts, 0);
  assert.equal(canSubmitFirm({ oq5: "unset", busy: false }, false), false);
  assert.equal(canSubmitFirm({ oq5: "reserved", busy: false }, false), true);
  assert.equal(canSubmitFirm({ oq5: "not_reserved", busy: false }, false), true);
  assert.equal(canSubmitFirm({ oq5: "reserved", busy: false }, true), false, "degraded is read-only from last server state");
});

test("the rate card is a timeline: every row with its window, the one in effect marked, money never a number input", async () => {
  const { app } = await ready();
  const html = await paint(app, "network.rates", { firmId: FIRM_A });
  assert.match(html, /2026-01-01 → 2026-10-01/);
  assert.match(html, /2026-10-01 → open/);
  assert.match(html, /inputmode="numeric"/);
  assert.doesNotMatch(html, /name="rateMinor"[^>]*type="number"/, "a JSON number is an IEEE-754 double — money is a digits-only string");
  assert.match(html, /Integer minor units/);

  assert.equal(readable("9500", "USD"), "USD 95.00");
  assert.equal(inEffect(RATES[1]!, "2026-11-01"), true);
  assert.equal(inEffect(RATES[0]!, "2026-11-01"), false);
  assert.equal(inEffect(RATES[0]!, "2026-10-01"), false, "the close is exclusive — the day a rate ends is the day the next one starts, and exactly one applies");
  assert.equal(inEffect(RATES[1]!, "2026-10-01"), true);
});

test("a refusal on a ladder step renders as a decision, not as an error", async () => {
  const { app } = await ready({
    [OPERATIONS["firms.update"].path]: { status: 422, body: { error: "InputRefused", code: "msa_unsigned", message: "firm Firm B LLC has no MSA signed" } },
  });
  const html = await paint(app, "network", { firmId: FIRM_B });
  assert.doesNotMatch(html, /Refused —/, "nothing is refused before anything is attempted");
  const { admissionAxis } = await import("../../../packages/contracts/src/refusals.ts");
  assert.equal(admissionAxis("msa_unsigned"), "structural");
  assert.equal(admissionAxis("firm_required"), "structural");
  assert.equal(admissionAxis("already_verified"), "structural");
});
