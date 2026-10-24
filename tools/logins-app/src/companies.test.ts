import assert from "node:assert/strict";
import { test } from "node:test";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";
import { buildCrewRow, buildFirmRows, crewKind, documentsLabel, sameName } from "./companies.ts";

const R = "00000000-0000-0000-0000-0000000000a1";
const firm = { legalName: "  Acme  HVAC ", regionId: R, paymentTermsDays: 30, dataRightsReserved: false, msaSignedAt: null };

test("buildCrewRow ours: employed, internal org, normalised label", () => {
  assert.deepEqual(buildCrewRow("  AC  Services DFW ", { type: "ours", regionId: R }), {
    org_id: INTERNAL_ORG_ID, region_id: R, home_region_id: R, label: "AC Services DFW",
    employment_type: "employed", firm_id: null, kind: "service",
  });
});

test("buildCrewRow contractor: firm org, firm id, firm region", () => {
  const row = buildCrewRow("Crew A", { type: "contractor", firmId: "f1", firmOrgId: "o1", firmRegionId: R });
  assert.deepEqual(row, {
    org_id: "o1", region_id: R, home_region_id: R, label: "Crew A", employment_type: "subcontracted", firm_id: "f1", kind: "service",
  });
});

test("buildCrewRow carries the kind (0024): absent is service, install is install, anything else refused", () => {
  assert.equal(buildCrewRow("Crew B", { type: "ours", regionId: R }, "install").kind, "install");
  assert.equal(buildCrewRow("Crew B", { type: "contractor", firmId: "f1", firmOrgId: "o1", firmRegionId: R }, "install").kind, "install");
  assert.equal(crewKind(undefined), "service");
  for (const bad of ["", "Install", "commissioning", null, 1]) assert.throws(() => crewKind(bad), /service unit or an install crew/);
});

test("buildCrewRow refuses an empty name", () => {
  assert.throws(() => buildCrewRow("   ", { type: "ours", regionId: R }), /name/);
});

test("buildFirmRows writes the organization and the firm", () => {
  assert.deepEqual(buildFirmRows("id1", firm), {
    organization: { id: "id1", name: "Acme HVAC" },
    firm: { id: "id1", region_id: R, legal_name: "Acme HVAC", settlement_terms_days: 30, msa_signed_at: null, diagnostic_data_rights_reserved: false },
  });
  assert.equal(buildFirmRows("id1", { ...firm, msaSignedAt: "2026-02-28" }).firm.msa_signed_at, "2026-02-28");
});

test("buildFirmRows requires data rights to be chosen", () => {
  assert.throws(() => buildFirmRows("id1", { ...firm, dataRightsReserved: undefined as never }), /data rights/);
});

test("buildFirmRows refuses bad payment terms, names and dates", () => {
  for (const days of [-1, 1.5]) assert.throws(() => buildFirmRows("id1", { ...firm, paymentTermsDays: days }), /payment terms/);
  assert.throws(() => buildFirmRows("id1", { ...firm, legalName: "  " }), /name/);
  for (const d of ["2026-13-40", "2026-02-30", "26-1-1"]) assert.throws(() => buildFirmRows("id1", { ...firm, msaSignedAt: d }), /date/);
});

test("sameName ignores case and spacing", () => {
  assert.equal(sameName("AC Services DFW", " ac  services dfw"), true);
  assert.equal(sameName("A", "B"), false);
});

test("documentsLabel", () => {
  const base = { required: ["insurance", "license", "background_check"], satisfied: [], unverified: [], expired: [], missing: [], earliestExpiry: null };
  assert.equal(documentsLabel({ ...base, satisfied: base.required }), "Ready");
  assert.equal(
    documentsLabel({ ...base, missing: ["insurance"], unverified: ["license"], expired: ["background_check"] }),
    "Missing: insurance · Unverified: license · Expired: background check",
  );
});
