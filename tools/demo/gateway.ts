/**
 * THE DEMO GATEWAY — an in-memory stand-in for apps/gateway, for the clickable
 * demo only (tools/demo/build.ts). It answers the same catalogue
 * (packages/contracts/src/operations.ts) with the same wire shapes, so the
 * surfaces it serves are the real bundles, unmodified.
 *
 * What it is NOT: the product. Visibility here is a hand-written filter per
 * principal that imitates what migrations 0005–0009 enforce with RLS; the
 * real system never filters in a handler. Where a rule is the domain's own
 * (term resolution, override admission, the compliance gate, context
 * resolution) the real module is imported and run.
 */
import { OPERATIONS, routeKey, type OperationId } from "../../packages/contracts/src/operations.ts";
import type * as W from "../../packages/contracts/src/operations.ts";
import { SURFACES, type SurfaceId } from "../../packages/contracts/src/surfaces.ts";
import type { Principal } from "../../packages/contracts/src/scope.ts";
import { ANONYMOUS_PRINCIPAL_IDS } from "../../packages/contracts/src/scope.ts";
import type { EventEnvelope, Topic } from "../../packages/contracts/src/events.ts";
import type { Tier } from "../../packages/contracts/src/tiers.ts";
import { TERMS, TERM_KEYS } from "../../packages/contracts/src/terms.ts";
import { resolveAll, type Override, type ScopePath } from "../../packages/domain/src/inheritance/resolve.ts";
import { admitOverride, AdmissionRefused } from "../../packages/domain/src/inheritance/admit.ts";
import { evaluate, REQUIRED, isRefusal } from "../../packages/domain/src/compliance/gate.ts";
import { threeWayMatch } from "../../packages/domain/src/procurement/match.ts";
import { buildContext, type HierarchyReader } from "../../apps/gateway/src/context.ts";
import { INTERNAL_ORG_ID, UNASSIGNED_REGION_ID } from "../../packages/schema/src/tenancy.ts";
import { HQ_METRICS, HQ_METRIC_KEYS, HQ_REFRESH_MINUTES, isHqMetricKey, type HqMetricKey } from "../../packages/contracts/src/hq.ts";
import {
  ORG as AMPED, REGION_WEST, REGION_MOUNTAIN, REGION_SOUTH, N,
  MSA, AMEND_SJ, AMEND_AUSTIN_JULY, BOULDER_WARRANTY, OVERRIDES,
} from "../../packages/domain/src/inheritance/fixtures/amped.ts";

// ---------------------------------------------------------------------------
// Time. Everything is seeded relative to the moment the page loads, so SLA
// clocks, expiries and statement periods read as live.
// ---------------------------------------------------------------------------
const NOW = Date.now();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const day = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const uid = (prefix: string) => `${prefix}${(++seq).toString(16).padStart(8, "0")}-demo-4000-8000-${Date.now().toString(16).slice(-12).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Refusals, shaped as the real gateway's describe() shapes them.
// ---------------------------------------------------------------------------
class Refused extends Error {
  readonly status: number; readonly name2: string; readonly code: string | undefined;
  constructor(status: number, name2: string, message: string, code?: string) { super(message); this.status = status; this.name2 = name2; this.code = code; }
}
const input422 = (message: string, code: string) => new Refused(422, "InputRefused", message, code);

// ---------------------------------------------------------------------------
// Seed — Rankine's own tree, Amped Fitness (the fixture the D2 findings were
// found against), a second customer, two subcontractor firms, the crews, the
// work, and the money.
// ---------------------------------------------------------------------------
/** The demo's rows are mutable; the wire types they are shaped from are not. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Region = W.RegionWire;
type Org = { id: string; name: string; kind: "customer" | "subcontractor" | "internal" | "vendor"; externalRef: string | null; active: boolean; createdAt?: string };
type Account = { id: string; orgId: string; tier: W.AccountTierWire; name: string; parentId: string | null; regionId: string; customerGroup: string | null; externalRef: string | null; timezone: string | null; active: boolean; address: W.AddressWire | null };
type Firm = Mutable<Omit<W.FirmWire, "crewCount" | "activeCrewCount">>;
type Crew = Mutable<Omit<W.CrewWire, "documents">>;
type Credential = Mutable<W.CredentialWire>;
type Job = { id: string; siteId: string; orgId: string; regionId: string; contractId: string | null; serviceCode: string; priority: W.JobPriority; state: W.JobStateWire; serviceWindowStart: string; serviceWindowEnd: string; version: number; openedAt: string; slaDueAt: string | null; slaEscalationStage: number | null; slaSatisfiedAt: string | null; equipmentIds: string[] };
type Assignment = { id: string; jobId: string; crewId: string; assignedAt: string; releasedAt: string | null };
type Settlement = Mutable<Omit<W.SettlementWire, "lineCount">>;
type User = { id: string; email: string; password: string; name: string; principal: Omit<Principal, "sessionId">; surfaces: SurfaceId[]; crewId?: string };

const REGIONS: Region[] = [
  { id: REGION_WEST, code: "WEST", name: "West", timezone: "America/Los_Angeles", minCrewDensity: 2, active: true },
  { id: REGION_MOUNTAIN, code: "MOUNTAIN", name: "Mountain", timezone: "America/Denver", minCrewDensity: 1, active: true },
  { id: REGION_SOUTH, code: "SOUTH", name: "South", timezone: "America/Chicago", minCrewDensity: 3, active: true },
];

const CEDAR = "b0000000-0000-0000-0000-000000000001";
const FIRM_A = "f0000000-0000-0000-0000-00000000000a";
const FIRM_B = "f0000000-0000-0000-0000-00000000000b";
const FIRM_C = "f0000000-0000-0000-0000-00000000000c";

const orgs: Org[] = [
  { id: INTERNAL_ORG_ID, name: "Rankine Operating Company", kind: "internal", externalRef: null, active: true },
  { id: AMPED, name: "Amped Fitness Inc.", kind: "customer", externalRef: "AMP-MSA-2026", active: true },
  { id: CEDAR, name: "Cedar Lane Clinics", kind: "customer", externalRef: "CLC-0042", active: true },
  { id: FIRM_A, name: "Lone Star Mechanical LLC", kind: "subcontractor", externalRef: null, active: true },
  { id: FIRM_B, name: "Gulf Coast Air Partners", kind: "subcontractor", externalRef: null, active: true },
  { id: FIRM_C, name: "Front Range Refrigeration Co.", kind: "subcontractor", externalRef: null, active: true },
];

const S = {
  renoRoof: "a0000000-0000-0000-0000-000000000033",
  elPasoFloor: "a0000000-0000-0000-0000-000000000034",
  austinRoof: "a0000000-0000-0000-0000-000000000035",
  austinPool: "a0000000-0000-0000-0000-000000000036",
  cedarSouth: "b0000000-0000-0000-0000-000000000010",
  cedarHouston: "b0000000-0000-0000-0000-000000000020",
  cedarHoustonMain: "b0000000-0000-0000-0000-000000000030",
} as const;

const addr = (line1: string, city: string, state: string, postal: string, lat?: number, lng?: number): W.AddressWire =>
  ({ line1, city, state, postal, country: "US", ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}) });

const accounts: Account[] = [
  { id: N.west, orgId: AMPED, tier: "region", name: "Amped / West", parentId: null, regionId: REGION_WEST, customerGroup: null, externalRef: null, timezone: "America/Los_Angeles", active: true, address: null },
  { id: N.mountain, orgId: AMPED, tier: "region", name: "Amped / Mountain", parentId: null, regionId: REGION_MOUNTAIN, customerGroup: null, externalRef: null, timezone: "America/Denver", active: true, address: null },
  { id: N.south, orgId: AMPED, tier: "region", name: "Amped / South", parentId: null, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: "America/Chicago", active: true, address: null },
  { id: N.sanJose, orgId: AMPED, tier: "location", name: "Amped San Jose", parentId: N.west, regionId: REGION_WEST, customerGroup: "Pacific", externalRef: "AMP-117", timezone: "America/Los_Angeles", active: true, address: addr("1840 Coleman Ave", "San Jose", "CA", "95110") },
  { id: N.reno, orgId: AMPED, tier: "location", name: "Amped Reno", parentId: N.west, regionId: REGION_WEST, customerGroup: "Pacific", externalRef: "AMP-121", timezone: "America/Los_Angeles", active: true, address: addr("6770 S McCarran Blvd", "Reno", "NV", "89509") },
  { id: N.boulder, orgId: AMPED, tier: "location", name: "Amped Boulder", parentId: N.mountain, regionId: REGION_MOUNTAIN, customerGroup: "Mountain", externalRef: "AMP-204", timezone: "America/Denver", active: true, address: addr("2525 Arapahoe Ave", "Boulder", "CO", "80302") },
  { id: N.elPaso, orgId: AMPED, tier: "location", name: "Amped El Paso", parentId: N.south, regionId: REGION_SOUTH, customerGroup: "Mountain", externalRef: "AMP-310", timezone: "America/Denver", active: true, address: addr("7500 N Mesa St", "El Paso", "TX", "79912") },
  { id: N.austin, orgId: AMPED, tier: "location", name: "Amped Austin", parentId: N.south, regionId: REGION_SOUTH, customerGroup: "Texas", externalRef: "AMP-322", timezone: "America/Chicago", active: true, address: addr("4001 S Lamar Blvd", "Austin", "TX", "78704") },
  { id: N.sanJoseRoof, orgId: AMPED, tier: "site", name: "San Jose — Roof Units", parentId: N.sanJose, regionId: REGION_WEST, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("1840 Coleman Ave", "San Jose", "CA", "95110", 37.3496, -121.9254) },
  { id: S.renoRoof, orgId: AMPED, tier: "site", name: "Reno — Rooftop", parentId: N.reno, regionId: REGION_WEST, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("6770 S McCarran Blvd", "Reno", "NV", "89509") },
  { id: N.boulderRoof, orgId: AMPED, tier: "site", name: "Boulder — Roof Units", parentId: N.boulder, regionId: REGION_MOUNTAIN, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("2525 Arapahoe Ave", "Boulder", "CO", "80302", 40.0149, -105.2626) },
  { id: N.boulderAhu, orgId: AMPED, tier: "site", name: "Boulder — Basement AHU", parentId: N.boulder, regionId: REGION_MOUNTAIN, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("2525 Arapahoe Ave", "Boulder", "CO", "80302") },
  { id: S.elPasoFloor, orgId: AMPED, tier: "site", name: "El Paso — Main Floor", parentId: N.elPaso, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("7500 N Mesa St", "El Paso", "TX", "79912") },
  { id: S.austinRoof, orgId: AMPED, tier: "site", name: "Austin — Rooftop RTUs", parentId: N.austin, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("4001 S Lamar Blvd", "Austin", "TX", "78704", 30.2396, -97.7866) },
  { id: S.austinPool, orgId: AMPED, tier: "site", name: "Austin — Pool Hall Dehumidifier", parentId: N.austin, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("4001 S Lamar Blvd", "Austin", "TX", "78704") },
  { id: S.cedarSouth, orgId: CEDAR, tier: "region", name: "Cedar Lane / South", parentId: null, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: "America/Chicago", active: true, address: null },
  { id: S.cedarHouston, orgId: CEDAR, tier: "location", name: "Cedar Lane Houston", parentId: S.cedarSouth, regionId: REGION_SOUTH, customerGroup: null, externalRef: "CLC-H1", timezone: "America/Chicago", active: true, address: addr("2100 W Loop S", "Houston", "TX", "77027") },
  { id: S.cedarHoustonMain, orgId: CEDAR, tier: "site", name: "Houston — Clinic Main", parentId: S.cedarHouston, regionId: REGION_SOUTH, customerGroup: null, externalRef: null, timezone: null, active: true, address: addr("2100 W Loop S", "Houston", "TX", "77027") },
];

const CEDAR_MSA = "c0000000-0000-0000-0000-000000000020";
const contracts: (Mutable<W.ContractWire> & { orgId: string })[] = [
  { id: MSA, orgId: AMPED, scopeTier: "parent", scopeId: AMPED, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: REGION_SOUTH, signedAt: "2025-12-12", effectiveFrom: "2026-01-01", effectiveTo: "2028-12-31", diagnosticDataRightsReserved: true, documentKey: "contracts/amped/msa-2026.pdf", state: "active" },
  { id: AMEND_SJ, orgId: AMPED, scopeTier: "location", scopeId: N.sanJose, kind: "amendment", parentContractId: MSA, billingPath: "enterprise_sla", regionId: REGION_WEST, signedAt: "2026-02-20", effectiveFrom: "2026-03-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: "contracts/amped/amend-sj-4h.pdf", state: "active" },
  { id: AMEND_AUSTIN_JULY, orgId: AMPED, scopeTier: "location", scopeId: N.austin, kind: "amendment", parentContractId: MSA, billingPath: "enterprise_sla", regionId: REGION_SOUTH, signedAt: "2026-06-10", effectiveFrom: "2026-07-01", effectiveTo: null, diagnosticDataRightsReserved: true, documentKey: null, state: "active" },
  { id: BOULDER_WARRANTY, orgId: AMPED, scopeTier: "site", scopeId: N.boulderRoof, kind: "location_agreement", parentContractId: null, billingPath: "enterprise_sla", regionId: REGION_MOUNTAIN, signedAt: "2026-02-10", effectiveFrom: "2026-02-15", effectiveTo: null, diagnosticDataRightsReserved: false, documentKey: "contracts/amped/boulder-carrier-warranty.pdf", state: "active" },
  { id: CEDAR_MSA, orgId: CEDAR, scopeTier: "parent", scopeId: CEDAR, kind: "msa", parentContractId: null, billingPath: "enterprise_sla", regionId: REGION_SOUTH, signedAt: "2026-04-02", effectiveFrom: "2026-05-01", effectiveTo: null, diagnosticDataRightsReserved: false, documentKey: null, state: "active" },
];
const overrides: (Override & { orgId: string; regionId: string })[] = [
  ...OVERRIDES.map((o) => ({ ...o, orgId: AMPED, regionId: REGION_SOUTH })),
  { id: "o-100", contractId: CEDAR_MSA, scopeTier: "parent", scopeId: CEDAR, termKey: "sla_response", termValue: "next_day", effectiveFrom: "2026-05-01", effectiveTo: null, orgId: CEDAR, regionId: REGION_SOUTH },
  { id: "o-101", contractId: CEDAR_MSA, scopeTier: "parent", scopeId: CEDAR, termKey: "payment_terms_days", termValue: 30, effectiveFrom: "2026-05-01", effectiveTo: null, orgId: CEDAR, regionId: REGION_SOUTH },
];

const firms: Firm[] = [
  { id: FIRM_A, legalName: "Lone Star Mechanical LLC", status: "active", regionId: REGION_SOUTH, settlementTermsDays: 30, msaSignedAt: "2026-03-02", diagnosticDataRightsReserved: true, w9DocumentKey: "network/lonestar/w9.pdf" },
  { id: FIRM_B, legalName: "Gulf Coast Air Partners", status: "active", regionId: REGION_SOUTH, settlementTermsDays: 45, msaSignedAt: "2026-05-18", diagnosticDataRightsReserved: false, w9DocumentKey: "network/gulfcoast/w9.pdf" },
  { id: FIRM_C, legalName: "Front Range Refrigeration Co.", status: "onboarding", regionId: REGION_MOUNTAIN, settlementTermsDays: 30, msaSignedAt: null, diagnosticDataRightsReserved: true, w9DocumentKey: null },
];

const C = {
  south1: "e0000000-0000-0000-0000-000000000001",
  south2: "e0000000-0000-0000-0000-000000000002",
  west1: "e0000000-0000-0000-0000-000000000003",
  mountain1: "e0000000-0000-0000-0000-000000000004",
  lsA: "e0000000-0000-0000-0000-0000000000a1",
  lsB: "e0000000-0000-0000-0000-0000000000a2",
  gc1: "e0000000-0000-0000-0000-0000000000b1",
  fr1: "e0000000-0000-0000-0000-0000000000c1",
} as const;
const crews: Crew[] = [
  { id: C.south1, label: "South Crew 1", employmentType: "employed", firmId: null, homeRegionId: REGION_SOUTH, active: true },
  { id: C.south2, label: "South Crew 2", employmentType: "employed", firmId: null, homeRegionId: REGION_SOUTH, active: true },
  { id: C.west1, label: "West Crew 1", employmentType: "employed", firmId: null, homeRegionId: REGION_WEST, active: true },
  { id: C.mountain1, label: "Mountain Crew 1", employmentType: "employed", firmId: null, homeRegionId: REGION_MOUNTAIN, active: true },
  { id: C.lsA, label: "Lone Star — Crew A", employmentType: "subcontracted", firmId: FIRM_A, homeRegionId: REGION_SOUTH, active: true },
  { id: C.lsB, label: "Lone Star — Crew B", employmentType: "subcontracted", firmId: FIRM_A, homeRegionId: REGION_SOUTH, active: true },
  { id: C.gc1, label: "Gulf Coast — Crew 1", employmentType: "subcontracted", firmId: FIRM_B, homeRegionId: REGION_SOUTH, active: true },
  { id: C.fr1, label: "Front Range — Crew 1", employmentType: "subcontracted", firmId: FIRM_C, homeRegionId: REGION_MOUNTAIN, active: true },
];

const verifiedBy = "u0000000-0000-0000-0000-000000000001";
const cred = (crewId: string, kind: W.CredentialKind, identifier: string, from: number, to: number, verified: boolean): Credential =>
  ({ id: uid("d"), crewId, kind, identifier, validFrom: day(from), validTo: day(to), documentKey: `network/docs/${identifier.toLowerCase()}.pdf`, verifiedAt: verified ? at(from * DAY + 2 * DAY) : null, verifiedBy: verified ? verifiedBy : null });
const credentials: Credential[] = [
  cred(C.south1, "license", "TX-ACR-88213", -300, 400, true), cred(C.south1, "background_check", "BG-S1-2026", -200, 165, true),
  cred(C.south2, "license", "TX-ACR-90177", -250, 420, true), cred(C.south2, "background_check", "BG-S2-2026", -180, 185, true),
  cred(C.west1, "license", "CA-C20-771402", -400, 300, true), cred(C.west1, "background_check", "BG-W1-2026", -100, 265, true),
  cred(C.mountain1, "license", "CO-HVAC-5521", -320, 11, true), cred(C.mountain1, "background_check", "BG-M1-2026", -90, 275, true),
  // Lone Star Crew A: fully cleared.
  cred(C.lsA, "insurance", "TXL-GL-440921", -120, 245, true), cred(C.lsA, "license", "TX-ACR-61550", -500, 230, true), cred(C.lsA, "background_check", "BG-LSA-2026", -60, 305, true),
  // Lone Star Crew B: insurance filed through S8 and not yet verified — the gate refuses it.
  cred(C.lsB, "insurance", "TXL-GL-440977", -3, 362, false), cred(C.lsB, "license", "TX-ACR-61602", -410, 320, true), cred(C.lsB, "background_check", "BG-LSB-2026", -40, 325, true),
  // Gulf Coast Crew 1: insurance lapses tonight — cleared for today's work, refused for tomorrow's.
  cred(C.gc1, "insurance", "GC-GL-2025-118", -360, 0, true), cred(C.gc1, "license", "TX-ACR-70331", -200, 500, true), cred(C.gc1, "background_check", "BG-GC1-2026", -30, 335, true),
  // Front Range: onboarding, license only.
  cred(C.fr1, "license", "CO-HVAC-7788", -20, 700, false),
];

const rateCards: Mutable<W.RateCardWire>[] = [
  { id: uid("r"), firmId: FIRM_A, serviceCode: "PM-RTU", rateMinor: "18500", currency: "USD", effectiveFrom: "2026-03-01", effectiveTo: "2026-08-01" },
  { id: uid("r"), firmId: FIRM_A, serviceCode: "PM-RTU", rateMinor: "19500", currency: "USD", effectiveFrom: "2026-08-01", effectiveTo: null },
  { id: uid("r"), firmId: FIRM_A, serviceCode: "REPAIR-HVAC", rateMinor: "12500", currency: "USD", effectiveFrom: "2026-03-01", effectiveTo: null },
  { id: uid("r"), firmId: FIRM_A, serviceCode: "EMERG-CALL", rateMinor: "29500", currency: "USD", effectiveFrom: "2026-03-01", effectiveTo: null },
  { id: uid("r"), firmId: FIRM_B, serviceCode: "PM-RTU", rateMinor: "17200", currency: "USD", effectiveFrom: "2026-05-20", effectiveTo: null },
  { id: uid("r"), firmId: FIRM_B, serviceCode: "REPAIR-HVAC", rateMinor: "11800", currency: "USD", effectiveFrom: "2026-05-20", effectiveTo: null },
];

const job = (id: string, siteId: string, serviceCode: string, priority: W.JobPriority, state: W.JobStateWire, startMs: number, hours: number, sla: { dueMs: number; stage: number; satisfiedMs?: number } | null, equipmentIds: string[] = []): Job => {
  const site = accounts.find((a) => a.id === siteId)!;
  const contractId = site.orgId === AMPED ? MSA : CEDAR_MSA;
  return {
    id, siteId, orgId: site.orgId, regionId: site.regionId, contractId, serviceCode, priority, state,
    serviceWindowStart: at(startMs), serviceWindowEnd: at(startMs + hours * HOUR), version: state === "created" ? 1 : 3,
    openedAt: at(Math.min(startMs, 0) - 2 * HOUR),
    slaDueAt: sla ? at(sla.dueMs) : null, slaEscalationStage: sla ? sla.stage : null, slaSatisfiedAt: sla?.satisfiedMs !== undefined ? at(sla.satisfiedMs) : null,
    equipmentIds,
  };
};

const E = {
  austinRtu1: "q0000000-0000-0000-0000-000000000001", austinRtu2: "q0000000-0000-0000-0000-000000000002", austinRtu3: "q0000000-0000-0000-0000-000000000003",
  austinDehu: "q0000000-0000-0000-0000-000000000004", elPasoSplit: "q0000000-0000-0000-0000-000000000005", boulderRtu: "q0000000-0000-0000-0000-000000000006",
  sjRtu: "q0000000-0000-0000-0000-000000000007", houstonRtu: "q0000000-0000-0000-0000-000000000008",
} as const;

const J = {
  austinLeak: "j0000000-0000-0000-0000-000000000001", elPasoNoCool: "j0000000-0000-0000-0000-000000000002",
  austinPm: "j0000000-0000-0000-0000-000000000003", houstonRepair: "j0000000-0000-0000-0000-000000000004",
  austinPoolPm: "j0000000-0000-0000-0000-000000000005", elPasoPm: "j0000000-0000-0000-0000-000000000006",
  sjCompressor: "j0000000-0000-0000-0000-000000000007", boulderPm: "j0000000-0000-0000-0000-000000000008",
  austinAugPm: "j0000000-0000-0000-0000-000000000009", houstonAug: "j0000000-0000-0000-0000-00000000000a",
  elPasoAug: "j0000000-0000-0000-0000-00000000000b", austinJulyPm: "j0000000-0000-0000-0000-00000000000c",
} as const;
const jobs: Job[] = [
  // Unassigned and on the clock.
  job(J.austinLeak, S.austinRoof, "EMERG-CALL", "emergency", "created", 20 * MIN, 4, { dueMs: 38 * MIN, stage: 1 }, [E.austinRtu2]),
  job(J.elPasoNoCool, S.elPasoFloor, "REPAIR-HVAC", "urgent", "created", 3 * HOUR, 4, { dueMs: 5 * HOUR, stage: 0 }, [E.elPasoSplit]),
  job(J.houstonRepair, S.cedarHoustonMain, "REPAIR-HVAC", "routine", "created", DAY, 4, { dueMs: 20 * HOUR, stage: 0 }, [E.houstonRtu]),
  job(J.boulderPm, N.boulderRoof, "PM-RTU", "pm", "created", 2 * DAY, 6, { dueMs: 2 * DAY, stage: 0 }, [E.boulderRtu]),
  // Assigned and moving.
  job(J.austinPm, S.austinRoof, "PM-RTU", "pm", "assigned", 2 * HOUR, 5, { dueMs: -1 * HOUR, stage: 0, satisfiedMs: -3 * HOUR }, [E.austinRtu1, E.austinRtu3]),
  job(J.austinPoolPm, S.austinPool, "PM-RTU", "pm", "en_route", 30 * MIN, 3, { dueMs: -2 * HOUR, stage: 0, satisfiedMs: -5 * HOUR }, [E.austinDehu]),
  job(J.elPasoPm, S.elPasoFloor, "PM-RTU", "pm", "assigned", DAY + 2 * HOUR, 5, { dueMs: -DAY, stage: 0, satisfiedMs: -DAY - HOUR }),
  job(J.sjCompressor, N.sanJoseRoof, "REPAIR-HVAC", "urgent", "in_progress", -HOUR, 4, { dueMs: -2 * HOUR, stage: 0, satisfiedMs: -3 * HOUR }, [E.sjRtu]),
  // Done — the work behind the statements.
  job(J.austinAugPm, S.austinRoof, "PM-RTU", "pm", "invoiced", -30 * DAY, 5, null, [E.austinRtu1, E.austinRtu2, E.austinRtu3]),
  job(J.houstonAug, S.cedarHoustonMain, "REPAIR-HVAC", "routine", "complete", -26 * DAY, 3, null, [E.houstonRtu]),
  job(J.elPasoAug, S.elPasoFloor, "REPAIR-HVAC", "urgent", "invoiced", -22 * DAY, 4, null, [E.elPasoSplit]),
  job(J.austinJulyPm, S.austinPool, "PM-RTU", "pm", "invoiced", -60 * DAY, 3, null, [E.austinDehu]),
];
const assignments: Assignment[] = [
  { id: uid("x"), jobId: J.austinPm, crewId: C.lsA, assignedAt: at(-3 * HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.austinPoolPm, crewId: C.south1, assignedAt: at(-5 * HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.elPasoPm, crewId: C.south2, assignedAt: at(-DAY - HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.sjCompressor, crewId: C.west1, assignedAt: at(-3 * HOUR), releasedAt: null },
  { id: uid("x"), jobId: J.austinAugPm, crewId: C.lsA, assignedAt: at(-31 * DAY), releasedAt: null },
  { id: uid("x"), jobId: J.houstonAug, crewId: C.gc1, assignedAt: at(-27 * DAY), releasedAt: null },
  { id: uid("x"), jobId: J.elPasoAug, crewId: C.lsB, assignedAt: at(-23 * DAY), releasedAt: null },
  { id: uid("x"), jobId: J.austinJulyPm, crewId: C.lsA, assignedAt: at(-61 * DAY), releasedAt: null },
];

const month = (offset: number) => {
  const d = new Date(NOW); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + offset);
  const from = d.toISOString().slice(0, 10);
  const end = new Date(d); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { from, to: end.toISOString().slice(0, 10) };
};
const ST = { lsAug: "s0000000-0000-0000-0000-000000000001", lsJul: "s0000000-0000-0000-0000-000000000002", lsSep: "s0000000-0000-0000-0000-000000000003", gcAug: "s0000000-0000-0000-0000-000000000004" } as const;
const settlements: Settlement[] = [
  { id: ST.lsJul, firmId: FIRM_A, regionId: REGION_SOUTH, periodFrom: month(-2).from, periodTo: month(-2).to, totalMinor: "18500", currency: "USD", state: "acknowledged", issuedAt: at(-50 * DAY), acknowledgedAt: at(-47 * DAY), disputedAt: null, disputeReason: null },
  { id: ST.lsAug, firmId: FIRM_A, regionId: REGION_SOUTH, periodFrom: month(-1).from, periodTo: month(-1).to, totalMinor: "108000", currency: "USD", state: "issued", issuedAt: at(-4 * DAY), acknowledgedAt: null, disputedAt: null, disputeReason: null },
  { id: ST.lsSep, firmId: FIRM_A, regionId: REGION_SOUTH, periodFrom: month(0).from, periodTo: month(0).to, totalMinor: "58500", currency: "USD", state: "draft", issuedAt: null, acknowledgedAt: null, disputedAt: null, disputeReason: null },
  { id: ST.gcAug, firmId: FIRM_B, regionId: REGION_SOUTH, periodFrom: month(-1).from, periodTo: month(-1).to, totalMinor: "35400", currency: "USD", state: "issued", issuedAt: at(-4 * DAY), acknowledgedAt: null, disputedAt: null, disputeReason: null },
];
const rateOf = (firmId: string, code: string) => rateCards.find((r) => r.firmId === firmId && r.serviceCode === code && r.effectiveTo === null)!;
const settlementLines: W.SettlementLineWire[] = [
  { id: uid("l"), settlementId: ST.lsJul, jobId: J.austinJulyPm, serviceCode: "PM-RTU", siteName: "Austin — Pool Hall Dehumidifier", rateCardId: rateCards[0]!.id, rateMinor: "18500", quantityMilli: "1000", amountMinor: "18500" },
  { id: uid("l"), settlementId: ST.lsAug, jobId: J.austinAugPm, serviceCode: "PM-RTU", siteName: "Austin — Rooftop RTUs", rateCardId: rateOf(FIRM_A, "PM-RTU").id, rateMinor: "19500", quantityMilli: "3000", amountMinor: "58500" },
  { id: uid("l"), settlementId: ST.lsAug, jobId: J.elPasoAug, serviceCode: "REPAIR-HVAC", siteName: "El Paso — Main Floor", rateCardId: rateOf(FIRM_A, "REPAIR-HVAC").id, rateMinor: "12500", quantityMilli: "3960", amountMinor: "49500" },
  { id: uid("l"), settlementId: ST.lsSep, jobId: J.austinPm, serviceCode: "PM-RTU", siteName: "Austin — Rooftop RTUs", rateCardId: rateOf(FIRM_A, "PM-RTU").id, rateMinor: "19500", quantityMilli: "3000", amountMinor: "58500" },
  { id: uid("l"), settlementId: ST.gcAug, jobId: J.houstonAug, serviceCode: "REPAIR-HVAC", siteName: "Houston — Clinic Main", rateCardId: rateOf(FIRM_B, "REPAIR-HVAC").id, rateMinor: "11800", quantityMilli: "3000", amountMinor: "35400" },
];

const equipment: (Omit<W.EquipmentWire, "lastServicedAt" | "lastServicedJobId" | "lastServicedServiceCode" | "jobCount">)[] = [
  { id: E.austinRtu1, siteId: S.austinRoof, kind: "rtu", label: "RTU-1 (studio A)", manufacturer: "Carrier", model: "48FC-D08", serial: "4719G20331", installedOn: "2019-05-14", tonnageMilli: "7500", active: true },
  { id: E.austinRtu2, siteId: S.austinRoof, kind: "rtu", label: "RTU-2 (weights floor)", manufacturer: "Carrier", model: "48FC-D12", serial: "4719G20332", installedOn: "2019-05-14", tonnageMilli: "10000", active: true },
  { id: E.austinRtu3, siteId: S.austinRoof, kind: "rtu", label: "RTU-3 (lobby)", manufacturer: "Trane", model: "YSC060", serial: "21081NP7Y", installedOn: "2021-03-02", tonnageMilli: "5000", active: true },
  { id: E.austinDehu, siteId: S.austinPool, kind: "package", label: "Pool dehumidifier", manufacturer: "Desert Aire", model: "LV35", serial: "DA-88120", installedOn: "2020-08-19", tonnageMilli: null, active: true },
  { id: E.elPasoSplit, siteId: S.elPasoFloor, kind: "split", label: "Main floor split", manufacturer: "Lennox", model: "XC21-060", serial: "5818K04421", installedOn: "2018-06-01", tonnageMilli: "5000", active: true },
  { id: E.boulderRtu, siteId: N.boulderRoof, kind: "rtu", label: "RTU-A", manufacturer: "Carrier", model: "50XC-A10", serial: "0920V11209", installedOn: "2020-10-11", tonnageMilli: "8500", active: true },
  { id: E.sjRtu, siteId: N.sanJoseRoof, kind: "rtu", label: "RTU-North", manufacturer: "Daikin", model: "DPS015", serial: "FBOU210300441", installedOn: "2021-01-20", tonnageMilli: "15000", active: true },
  { id: E.houstonRtu, siteId: S.cedarHoustonMain, kind: "rtu", label: "Clinic RTU", manufacturer: "York", model: "ZF090", serial: "N1K8120339", installedOn: "2017-04-22", tonnageMilli: "7500", active: true },
];

const contacts: W.ContactWire[] = [
  { id: uid("k"), accountId: N.austin, accountName: "Amped Austin", accountTier: "location", role: "site_manager", name: "Priya Castellanos", phone: "512-555-0142", email: "austin.gm@ampedfitness.example", note: "Roof access through the loading dock; call ahead.", isPrimary: true, active: true },
  { id: uid("k"), accountId: S.austinRoof, accountName: "Austin — Rooftop RTUs", accountTier: "site", role: "security", name: "Front desk", phone: "512-555-0100", email: null, note: "Badge in at the desk before 6am.", isPrimary: false, active: true },
  { id: uid("k"), accountId: N.south, accountName: "Amped / South", accountTier: "region", role: "facilities", name: "Marcus Oyelaran", phone: "214-555-0199", email: "facilities.south@ampedfitness.example", note: null, isPrimary: true, active: true },
  { id: uid("k"), accountId: N.elPaso, accountName: "Amped El Paso", accountTier: "location", role: "site_manager", name: "Tomás Villareal", phone: "915-555-0107", email: "elpaso.gm@ampedfitness.example", note: null, isPrimary: true, active: true },
];

const invoices: W.InvoiceWire[] = [
  {
    id: "i0000000-0000-0000-0000-000000000001", billToTier: "parent", billToId: AMPED, contractId: MSA, billingPath: "enterprise_sla",
    periodStart: month(-1).from, periodEnd: month(-1).to, totalMinor: "412600", currency: "USD", issuedAt: at(-3 * DAY), dueAt: at(42 * DAY),
    lines: [
      { id: uid("n"), locationId: N.austin, jobId: J.austinAugPm, description: "Preventive maintenance — 3 rooftop units", quantityMilli: "3000", unitPriceMinor: "29000", amountMinor: "87000" },
      { id: uid("n"), locationId: N.elPaso, jobId: J.elPasoAug, description: "Repair — main floor split, labor", quantityMilli: "3960", unitPriceMinor: "14500", amountMinor: "57420" },
    ],
    subtotalMinor: "0",
  },
];

// A month of billing across the regions, so leadership's money figures read like a working company.
const bill = (id: string, orgId: string, contractId: string, issuedDaysAgo: number, dueInDays: number, lines: [string, string, number][]): W.InvoiceWire => {
  const ls = lines.map(([locationId, description, amount]) => ({ id: uid("n"), locationId, jobId: null, description, quantityMilli: "1000", unitPriceMinor: String(amount), amountMinor: String(amount) }));
  const total = String(ls.reduce((t, l) => t + Number(l.amountMinor), 0));
  return { id, billToTier: "parent", billToId: orgId, contractId, billingPath: "enterprise_sla", periodStart: month(-1).from, periodEnd: month(-1).to, totalMinor: total, currency: "USD", issuedAt: at(-issuedDaysAgo * DAY), dueAt: at((dueInDays - issuedDaysAgo) * DAY), lines: ls, subtotalMinor: total };
};
invoices.push(
  bill("i0000000-0000-0000-0000-000000000002", AMPED, MSA, 6, 45, [[N.sanJose, "Enterprise SLA — San Jose, monthly", 1840000], [N.reno, "Enterprise SLA — Reno, monthly", 1215000], [N.sanJose, "Compressor replacement, RTU-North", 2960000]]),
  bill("i0000000-0000-0000-0000-000000000003", AMPED, MSA, 12, 45, [[N.boulder, "Enterprise SLA — Boulder, monthly", 1390000], [N.boulder, "PM visit x2, roof units", 780000]]),
  bill("i0000000-0000-0000-0000-000000000004", AMPED, MSA, 9, 45, [[N.austin, "Enterprise SLA — Austin, monthly", 2410000], [N.elPaso, "Enterprise SLA — El Paso, monthly", 1650000]]),
  bill("i0000000-0000-0000-0000-000000000005", CEDAR, CEDAR_MSA, 38, 30, [[S.cedarHouston, "Clinic HVAC program, monthly", 985000], [S.cedarHouston, "Emergency call-out, after hours", 312000]]),
  bill("i0000000-0000-0000-0000-000000000006", CEDAR, CEDAR_MSA, 8, 30, [[S.cedarHouston, "Clinic HVAC program, monthly", 985000]]),
);

const devices: W.DeviceWire[] = [
  { id: "v0000000-0000-0000-0000-000000000001", hardwareId: "RK-TAB-0042", kind: "web_fallback", firmId: null, active: true, orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH },
];

const serviceRequests: Mutable<W.ServiceRequestWire>[] = [
  { id: uid("q"), siteId: S.austinRoof, siteName: "Austin — Rooftop RTUs", priority: "emergency", description: "Water coming through the ceiling tiles under RTU-2 on the weights floor. Towels down, area coned off.", requestedBy: "Priya Castellanos", createdAt: at(-25 * MIN), jobId: J.austinLeak, jobState: "created", orgId: AMPED, regionId: REGION_SOUTH },
  { id: uid("q"), siteId: S.elPasoFloor, siteName: "El Paso — Main Floor", priority: "urgent", description: "Main floor is 81°F at 2pm and climbing. Split is running but blowing warm.", requestedBy: "Tomás Villareal", createdAt: at(-2 * HOUR), jobId: J.elPasoNoCool, jobState: "created", orgId: AMPED, regionId: REGION_SOUTH },
  { id: uid("q"), siteId: S.austinPool, siteName: "Austin — Pool Hall Dehumidifier", priority: "routine", description: "Condensation on the pool hall windows most mornings. Could the next PM check the dehumidifier setpoint?", requestedBy: "Priya Castellanos", createdAt: at(-3 * DAY), jobId: null, jobState: null, orgId: AMPED, regionId: REGION_SOUTH },
];

// Leads and calls from the past month, so S4's growth figures have a history before anyone uses S1.
const leads: { id: string; submissionId: string; name: string; metro: string | null; source: string; at: string }[] =
  ([[-2, "web_form", "Austin"], [-4, "web_form", "Dallas"], [-6, "call_button", "Houston"], [-9, "web_form", "Reno"], [-11, "referral", "Boulder"],
    [-15, "web_form", "San Antonio"], [-18, "call_button", "El Paso"], [-22, "web_form", "Austin"], [-27, "web_form", "Denver"]] as const)
    .map(([d, source, metro], i) => ({ id: uid("L"), submissionId: uid("S"), name: `Prospect ${i + 1}`, metro, source, at: at(d * DAY) }));
const callRecords: { id: string; leadId: string | null; at: string }[] = [-1, -3, -6, -8, -13, -18, -24].map((d) => ({ id: uid("R"), leadId: null, at: at(d * DAY) }));
// The latest working-capital position per region, minor units.
const workingCapital: Record<string, { receivable: number; payable: number }> = {
  [REGION_SOUTH]: { receivable: 14460000, payable: 1974000 }, [REGION_WEST]: { receivable: 6210000, payable: 0 }, [REGION_MOUNTAIN]: { receivable: 2385000, payable: 0 },
};

// ---------------------------------------------------------------------------
// People. One password for everyone, printed on the demo's own sign-in help.
// ---------------------------------------------------------------------------
export const DEMO_PASSWORD = "demo";
const P = (p: Partial<Omit<Principal, "sessionId">> & Pick<Principal, "namespace" | "subjectId" | "orgId" | "regionId" | "scopeTier" | "scopeId" | "roles">): Omit<Principal, "sessionId"> =>
  ({ firmId: null, deviceId: null, shiftId: null, tierClaim: null, ...p });
const users: User[] = [
  { id: verifiedBy, email: "office@rankine.demo", password: DEMO_PASSWORD, name: "Office manager", surfaces: ["S2"],
    principal: P({ namespace: "internal", subjectId: verifiedBy, orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID, roles: ["office_manager", "account_owner"] }) },
  { id: "u0000000-0000-0000-0000-00000000000a", email: "ceo@rankine.demo", password: DEMO_PASSWORD, name: "Chief executive", surfaces: ["S4"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-00000000000a", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID, roles: ["principal"] }) },
  { id: "u0000000-0000-0000-0000-00000000000b", email: "cfo@rankine.demo", password: DEMO_PASSWORD, name: "Finance lead (read only)", surfaces: ["S4"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-00000000000b", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: INTERNAL_ORG_ID, roles: ["readonly"] }) },
  { id: "u0000000-0000-0000-0000-0000000000c1", email: "orders@coolair.demo", password: DEMO_PASSWORD, name: "Coolair Supply order desk", surfaces: ["S7"],
    principal: P({ namespace: "vendor", subjectId: "u0000000-0000-0000-0000-0000000000c1", orgId: "v0000000-0000-0000-0000-000000000001", regionId: REGION_SOUTH, scopeTier: "parent", scopeId: "v0000000-0000-0000-0000-000000000001", roles: [] }) },
  { id: "u0000000-0000-0000-0000-0000000000c2", email: "sales@lonestarparts.demo", password: DEMO_PASSWORD, name: "Lone Star Parts Depot", surfaces: ["S7"],
    principal: P({ namespace: "vendor", subjectId: "u0000000-0000-0000-0000-0000000000c2", orgId: "v0000000-0000-0000-0000-000000000002", regionId: REGION_SOUTH, scopeTier: "parent", scopeId: "v0000000-0000-0000-0000-000000000002", roles: [] }) },
  { id: "u0000000-0000-0000-0000-000000000002", email: "dispatch.south@rankine.demo", password: DEMO_PASSWORD, name: "South dispatcher", surfaces: ["S3"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-000000000002", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH, roles: ["dispatcher"] }) },
  { id: "u0000000-0000-0000-0000-000000000003", email: "dispatch.west@rankine.demo", password: DEMO_PASSWORD, name: "West dispatcher", surfaces: ["S3"],
    principal: P({ namespace: "internal", subjectId: "u0000000-0000-0000-0000-000000000003", orgId: INTERNAL_ORG_ID, regionId: REGION_WEST, scopeTier: "region", scopeId: REGION_WEST, roles: ["dispatcher"] }) },
  { id: "u0000000-0000-0000-0000-000000000004", email: "tech.south1@rankine.demo", password: DEMO_PASSWORD, name: "Technician, South Crew 1", surfaces: ["S5"], crewId: C.south1,
    principal: P({ namespace: "device", subjectId: "u0000000-0000-0000-0000-000000000004", orgId: INTERNAL_ORG_ID, regionId: REGION_SOUTH, scopeTier: "region", scopeId: REGION_SOUTH, roles: ["technician"], deviceId: devices[0]!.id, shiftId: "g0000000-0000-0000-0000-000000000001" }) },
  { id: "u0000000-0000-0000-0000-000000000005", email: "exec@amped.demo", password: DEMO_PASSWORD, name: "Amped VP Facilities", surfaces: ["S6"],
    principal: P({ namespace: "customer", subjectId: "u0000000-0000-0000-0000-000000000005", orgId: AMPED, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: AMPED, roles: ["account_owner"], tierClaim: "parent" }) },
  { id: "u0000000-0000-0000-0000-000000000006", email: "austin@amped.demo", password: DEMO_PASSWORD, name: "Amped Austin manager", surfaces: ["S6"],
    principal: P({ namespace: "customer", subjectId: "u0000000-0000-0000-0000-000000000006", orgId: AMPED, regionId: REGION_SOUTH, scopeTier: "location", scopeId: N.austin, roles: ["office_manager"], tierClaim: "location" }) },
  { id: "u0000000-0000-0000-0000-000000000007", email: "houston@cedarlane.demo", password: DEMO_PASSWORD, name: "Cedar Lane Houston manager", surfaces: ["S6"],
    principal: P({ namespace: "customer", subjectId: "u0000000-0000-0000-0000-000000000007", orgId: CEDAR, regionId: REGION_SOUTH, scopeTier: "location", scopeId: S.cedarHouston, roles: ["office_manager"], tierClaim: "location" }) },
  { id: "u0000000-0000-0000-0000-000000000008", email: "coord@lonestar.demo", password: DEMO_PASSWORD, name: "Lone Star coordinator", surfaces: ["S8"],
    principal: P({ namespace: "subcontractor", subjectId: "u0000000-0000-0000-0000-000000000008", orgId: FIRM_A, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: FIRM_A, roles: ["office_manager"], firmId: FIRM_A }) },
  { id: "u0000000-0000-0000-0000-000000000009", email: "coord@gulfcoast.demo", password: DEMO_PASSWORD, name: "Gulf Coast coordinator", surfaces: ["S8"],
    principal: P({ namespace: "subcontractor", subjectId: "u0000000-0000-0000-0000-000000000009", orgId: FIRM_B, regionId: REGION_SOUTH, scopeTier: "parent", scopeId: FIRM_B, roles: ["office_manager"], firmId: FIRM_B }) },
];
export const PERSONAS = users.map((u) => ({ surface: u.surfaces[0]!, email: u.email, name: u.name, ...(u.surfaces[0] === "S5" ? { hardwareId: devices[0]!.hardwareId } : {}) }));

// ---------------------------------------------------------------------------
// Sessions. The browser surfaces hold a cookie session; the demo keeps one
// per surface, pre-signed-in as the first persona so every surface opens on
// its working screen. S5 is bearer-only, as it is in the product.
// ---------------------------------------------------------------------------
type Session = { id: string; user: User; token: string };
const cookieSessions = new Map<SurfaceId, Session>();
const bearerSessions = new Map<string, Session>();
const principalOf = (s: Session): Principal => ({ ...s.user.principal, sessionId: s.id });
const mint = (user: User): Session => ({ id: uid("z"), user, token: `demo.${uid("t")}` });
for (const sid of ["S2", "S3", "S4", "S6", "S7", "S8"] as SurfaceId[]) cookieSessions.set(sid, mint(users.find((u) => u.surfaces.includes(sid))!));

const reader: HierarchyReader = {
  organization: async (id) => { const o = orgs.find((x) => x.id === id); return o ? { id: o.id, name: o.name } : null; },
  region: async (id) => { const r = REGIONS.find((x) => x.id === id); return r ? { id: r.id, code: r.code, name: r.name } : null; },
  account: async (id) => { const a = accounts.find((x) => x.id === id); return a ? { id: a.id, tier: a.tier, name: a.name, parentId: a.parentId, regionId: a.regionId, orgId: a.orgId, customerGroup: a.customerGroup } : null; },
  regionNodesOf: async (orgId) => orgId === INTERNAL_ORG_ID
    ? REGIONS.map((r) => ({ id: r.id, name: r.name, regionId: r.id }))
    : accounts.filter((a) => a.orgId === orgId && a.tier === "region").map((a) => ({ id: a.id, name: a.name, regionId: a.regionId })),
};

// ---------------------------------------------------------------------------
// Events. Every write publishes an envelope to every open stream, the way the
// relay fans NOTIFY out over SSE; the shell filters by topic.
// ---------------------------------------------------------------------------
type Listener = { surface: SurfaceId; push: (e: EventEnvelope) => void };
const listeners = new Set<Listener>();
export type ActivityEntry = { at: string; surface: SurfaceId; op: string; status: number; note: string; kind: "read" | "write" | "refused" | "event" | "offline" };
const activity: ((a: ActivityEntry) => void)[] = [];
export const onActivity = (cb: (a: ActivityEntry) => void) => { activity.push(cb); };
const log = (a: Omit<ActivityEntry, "at">) => { const e = { ...a, at: new Date().toISOString() }; for (const cb of activity) cb(e); };

const publish = (surface: SurfaceId, topic: Topic, entity: string, entityId: string, orgId: string, regionId: string): string => {
  const eventId = uid("ev");
  const env: EventEnvelope = { eventId, topic, entity, entityId, regionId, orgId, occurredAt: new Date().toISOString() };
  for (const l of listeners) l.push(env);
  log({ surface, op: topic, status: 0, note: `${entity} ${entityId.slice(0, 8)}`, kind: "event" });
  return eventId;
};

// ---------------------------------------------------------------------------
// Visibility — the demo's imitation of RLS.
// ---------------------------------------------------------------------------
const descendantsOf = (id: string): Set<string> => {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const a of accounts) if (a.parentId && out.has(a.parentId) && !out.has(a.id)) { out.add(a.id); grew = true; } }
  return out;
};
const ancestorsOf = (id: string): Set<string> => {
  const out = new Set<string>();
  let cur = accounts.find((a) => a.id === id);
  while (cur) { out.add(cur.id); cur = cur.parentId ? accounts.find((a) => a.id === cur!.parentId) : undefined; }
  return out;
};
const everAssignedTo = (jobId: string, firmId: string) =>
  assignments.some((a) => a.jobId === jobId && crews.find((c) => c.id === a.crewId)?.firmId === firmId);

const visibleAccounts = (p: Principal): Account[] => {
  if (p.namespace === "internal") return accounts;
  if (p.namespace === "customer") {
    const mine = accounts.filter((a) => a.orgId === p.orgId);
    if (p.scopeTier === "parent") return mine;
    const down = descendantsOf(p.scopeId), up = ancestorsOf(p.scopeId);
    return mine.filter((a) => down.has(a.id) || up.has(a.id));
  }
  if (p.namespace === "subcontractor") {
    const sites = new Set(jobs.filter((j) => everAssignedTo(j.id, p.firmId!)).map((j) => j.siteId));
    return accounts.filter((a) => sites.has(a.id));
  }
  return [];
};
const siteVisibleToCustomer = (p: Principal, siteId: string) => {
  const site = accounts.find((a) => a.id === siteId);
  if (!site || site.orgId !== p.orgId) return false;
  return p.scopeTier === "parent" || descendantsOf(p.scopeId).has(siteId);
};
const visibleJobs = (p: Principal, surface: SurfaceId): Job[] => {
  if (p.namespace === "internal") return surface === "S3" ? jobs.filter((j) => j.regionId === p.regionId) : jobs;
  if (p.namespace === "customer") return jobs.filter((j) => siteVisibleToCustomer(p, j.siteId));
  if (p.namespace === "subcontractor") return jobs.filter((j) => everAssignedTo(j.id, p.firmId!));
  return [];
};
const visibleCrews = (p: Principal): Crew[] =>
  p.namespace === "internal" ? crews : p.namespace === "subcontractor" ? crews.filter((c) => c.firmId === p.firmId) : [];

// ---------------------------------------------------------------------------
// Wire shaping.
// ---------------------------------------------------------------------------
const liveAssignment = (jobId: string) => assignments.filter((a) => a.jobId === jobId && a.releasedAt === null).at(-1) ?? null;
const jobWire = (j: Job, p: Principal): W.JobWire => {
  const site = accounts.find((a) => a.id === j.siteId)!;
  let a = liveAssignment(j.id);
  // A customer sees no crew (0006); a firm sees only its own crew on the row (0007).
  if (p.namespace === "customer") a = null;
  if (a && p.namespace === "subcontractor" && crews.find((c) => c.id === a!.crewId)?.firmId !== p.firmId) a = null;
  const crew = a ? crews.find((c) => c.id === a!.crewId) ?? null : null;
  const open = j.slaDueAt !== null && j.slaSatisfiedAt === null;
  return {
    id: j.id, siteId: j.siteId, siteName: site.name, contractId: j.contractId, projectId: null, serviceCode: j.serviceCode, priority: j.priority, state: j.state,
    serviceWindowStart: j.serviceWindowStart, serviceWindowEnd: j.serviceWindowEnd, version: j.version, openedAt: j.openedAt, regionId: j.regionId, orgId: j.orgId,
    currentCrewId: crew?.id ?? null, currentCrewLabel: crew?.label ?? null, currentAssignmentId: a?.id ?? null,
    slaDueAt: open ? j.slaDueAt : null, slaEscalationStage: open ? j.slaEscalationStage : null, slaSatisfiedAt: j.slaSatisfiedAt,
  };
};
const docSummary = (crew: Crew): W.CrewDocumentSummary => {
  const t = today();
  const required = REQUIRED[crew.employmentType];
  const mine = credentials.filter((c) => c.crewId === crew.id);
  const satisfied: string[] = [], unverified: string[] = [], expired: string[] = [], missing: string[] = [];
  let earliest: string | null = null;
  for (const kind of required) {
    const held = mine.filter((c) => c.kind === kind);
    const verified = held.filter((c) => c.verifiedAt !== null);
    const covering = verified.filter((c) => c.validFrom <= t && c.validTo >= t);
    if (held.length === 0) missing.push(kind);
    else if (verified.length === 0) unverified.push(kind);
    else if (covering.length === 0) expired.push(kind);
    else {
      satisfied.push(kind);
      const e = covering.map((c) => c.validTo).sort().at(-1)!;
      if (earliest === null || e < earliest) earliest = e;
    }
  }
  return { required, satisfied, unverified, expired, missing, earliestExpiry: earliest };
};
const crewWire = (c: Crew): W.CrewWire => ({ ...c, documents: docSummary(c) });
const firmWire = (f: Firm): W.FirmWire => ({ ...f, crewCount: crews.filter((c) => c.firmId === f.id).length, activeCrewCount: crews.filter((c) => c.firmId === f.id && c.active).length });
const accountWire = (a: Account): W.AccountWire => ({
  id: a.id, tier: a.tier, name: a.name, parentId: a.parentId, regionId: a.regionId, customerGroup: a.customerGroup, externalRef: a.externalRef,
  timezone: a.timezone, active: a.active, path: [...ancestorsOf(a.id)].reverse(), address: a.address,
});
const settlementWire = (s: Settlement): W.SettlementWire => ({ ...s, lineCount: settlementLines.filter((l) => l.settlementId === s.id).length });

const pathOf = (orgId: string) => (tier: Tier, id: string): ScopePath => {
  const org = orgs.find((o) => o.id === orgId);
  if (tier === "parent") return [{ tier: "parent", id: orgId, name: org?.name ?? "" }];
  const a = accounts.find((x) => x.id === id && x.orgId === orgId);
  if (!a || a.tier !== tier) throw input422(`no ${tier} node ${id} in org ${orgId}`, "unknown_scope");
  const chain = [...ancestorsOf(id)].reverse().map((nid) => { const n = accounts.find((x) => x.id === nid)!; return { tier: n.tier as Tier, id: n.id, name: n.name }; });
  return [{ tier: "parent", id: orgId, name: org?.name ?? "" }, ...chain];
};

const need = (cond: unknown, message: string, code: string) => { if (!cond) throw input422(message, code); };
const bad = (message: string) => new Refused(400, "BadInput", message);

// ---------------------------------------------------------------------------
// Handlers — one per operation the surfaces call. `p` is null for S1.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// S4 — the rollup's figures, the same definitions as apps/worker/src/rollup.ts,
// evaluated over this gateway's rows. Past days are not stored in the demo, so
// the trend behind a figure is a steady synthetic history ending at today's value.
// ---------------------------------------------------------------------------
const hqRegions = (): W.HqRegionWire[] => [
  ...REGIONS.map((r) => ({ id: r.id, code: r.code, name: r.name, active: r.active, placed: true })),
  { id: UNASSIGNED_REGION_ID, code: "UNASSIGNED", name: "Unassigned (pre-account)", active: true, placed: false },
];
const CLOSED = ["complete", "invoiced", "cancelled", "aborted"];
const hqFigures = (regionId: string, now: number): Record<HqMetricKey, number> => {
  const in30 = (iso: string | null | undefined) => !!iso && Date.parse(iso) > now - 30 * DAY && Date.parse(iso) <= now;
  const t = new Date(now).toISOString().slice(0, 10);
  const rj = jobs.filter((j) => j.regionId === regionId);
  const open = rj.filter((j) => !CLOSED.includes(j.state));
  const clocks = rj.filter((j) => j.slaDueAt && in30(j.openedAt));
  const closed = clocks.filter((j) => j.slaSatisfiedAt || Date.parse(j.slaDueAt!) < now);
  const met = clocks.filter((j) => j.slaSatisfiedAt && j.slaSatisfiedAt <= j.slaDueAt!);
  const rc = crews.filter((c) => c.homeRegionId === regionId && c.active);
  const rcIds = new Set(rc.map((c) => c.id));
  const rcreds = credentials.filter((c) => rcIds.has(c.crewId));
  const rs = settlements.filter((s) => s.regionId === regionId && ["issued", "acknowledged", "disputed"].includes(s.state));
  const locIds = new Set(accounts.filter((a) => a.regionId === regionId && a.tier === "location").map((a) => a.id));
  const inv = regionId === UNASSIGNED_REGION_ID ? [] : invoices.flatMap((i) => i.lines.filter((l) => locIds.has(l.locationId)).map((l) => ({ ...i, amount: Number(l.amountMinor) })));
  const customerOrgs = new Set(accounts.filter((a) => a.regionId === regionId && a.active && orgs.find((o) => o.id === a.orgId)?.kind === "customer").map((a) => a.orgId));
  const rl = regionId === UNASSIGNED_REGION_ID ? leads.filter((l) => in30(l.at)) : [];
  const wc = workingCapital[regionId];
  return {
    jobs_opened_30d: rj.filter((j) => in30(j.openedAt)).length,
    jobs_completed_30d: rj.filter((j) => in30(j.openedAt) && ["complete", "invoiced"].includes(j.state)).length,
    jobs_open_now: open.length,
    jobs_unassigned_now: open.filter((j) => !liveAssignment(j.id)).length,
    jobs_at_risk_now: open.filter((j) => j.slaDueAt && !j.slaSatisfiedAt && ((j.slaEscalationStage ?? 0) > 0 || Date.parse(j.slaDueAt) <= now + HOUR)).length,
    sla_closed_30d: closed.length,
    sla_met_30d: met.length,
    sla_breached_30d: closed.length - met.length,
    sla_escalated_30d: clocks.filter((j) => (j.slaEscalationStage ?? 0) > 0).length,
    invoiced_minor_30d: inv.filter((i) => in30(i.issuedAt)).reduce((s, i) => s + i.amount, 0),
    invoices_past_due_minor: inv.filter((i) => i.issuedAt && i.dueAt && Date.parse(i.dueAt) < now).reduce((s, i) => s + i.amount, 0),
    receivable_minor: wc?.receivable ?? 0,
    subcontractor_payable_minor: wc?.payable ?? 0,
    settlements_open_minor: rs.reduce((s, x) => s + Number(x.totalMinor), 0),
    settlements_overdue: rs.filter((x) => x.issuedAt && Date.parse(x.issuedAt) + (firms.find((f) => f.id === x.firmId)?.settlementTermsDays ?? 30) * DAY < now).length,
    settlements_disputed: rs.filter((x) => x.state === "disputed").length,
    crews_active: rc.length,
    crews_subcontracted_active: rc.filter((c) => c.employmentType === "subcontracted").length,
    crews_cleared_now: rc.filter((c) => { const d = docSummary(c); return d.satisfied.length === d.required.length; }).length,
    min_crew_density: REGIONS.find((r) => r.id === regionId)?.minCrewDensity ?? 0,
    locations_active: accounts.filter((a) => a.regionId === regionId && a.tier === "location" && a.active).length,
    firms_active: firms.filter((f) => f.regionId === regionId && f.status === "active").length,
    firms_onboarding: firms.filter((f) => f.regionId === regionId && f.status === "onboarding").length,
    credentials_unverified: rcreds.filter((c) => !c.verifiedAt).length,
    credentials_expiring_30d: rcreds.filter((c) => c.verifiedAt && c.validTo >= t && c.validTo <= day(30)).length,
    leads_30d: rl.length,
    leads_web_form_30d: rl.filter((l) => l.source === "web_form").length,
    leads_call_button_30d: rl.filter((l) => l.source === "call_button").length,
    leads_referral_30d: rl.filter((l) => l.source === "referral").length,
    calls_inbound_30d: regionId === UNASSIGNED_REGION_ID ? callRecords.filter((c) => in30(c.at)).length : 0,
    service_requests_30d: serviceRequests.filter((r) => r.regionId === regionId && in30(r.createdAt)).length,
    customers_active: customerOrgs.size,
    customers_new_30d: [...customerOrgs].filter((id) => in30(orgs.find((o) => o.id === id)?.createdAt)).length,
    sites_active: accounts.filter((a) => a.regionId === regionId && a.tier === "site" && a.active).length,
    // Company-wide distinct figures live on the unplaced row alone, as in the rollup.
    customers_total: regionId === UNASSIGNED_REGION_ID ? new Set(accounts.filter((a) => a.active && orgs.find((o) => o.id === a.orgId)?.kind === "customer").map((a) => a.orgId)).size : 0,
    customers_new_total_30d: regionId === UNASSIGNED_REGION_ID ? orgs.filter((o) => o.kind === "customer" && in30(o.createdAt)).length : 0,
  };
};
/** A deterministic wobble around today's value, older days a little lower for flows (30d) and near-flat for states (now). */
const pastValue = (metric: HqMetricKey, regionId: string, today: number, daysAgo: number): number => {
  let h = 0;
  for (const ch of metric + regionId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const wave = Math.sin(daysAgo / 3.5 + (h % 17)) * 0.12 + Math.sin(daysAgo / 1.3 + (h % 5)) * 0.05;
  const drift = HQ_METRICS[metric].window === "30d" ? -daysAgo * 0.006 : 0;
  return Math.max(0, Math.round(today * (1 + wave + drift)));
};

type Ctx = { surface: SurfaceId; p: Principal; session: Session | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler names its own wire input type
type Handler = (input: any, ctx: Ctx) => unknown | Promise<unknown>;

const H: Partial<Record<OperationId, Handler>> = {
  // ---- S4: the HQ rollup, computed from this gateway's own rows at the moment of the read ----
  "hq.metrics": () => {
    const asOf = new Date().toISOString();
    const values: W.HqValueWire[] = [];
    for (const r of hqRegions()) { const f = hqFigures(r.id, Date.now()); for (const k of HQ_METRIC_KEYS) values.push({ regionId: r.id, metric: k, value: String(f[k]) }); }
    return { day: asOf.slice(0, 10), asOf, refreshMinutes: HQ_REFRESH_MINUTES, regions: hqRegions(), values };
  },
  "hq.history": (i: W.HqHistoryInput) => {
    if (!i.metric || !isHqMetricKey(i.metric)) throw bad("metric must be a key in the HQ register (packages/contracts/src/hq.ts)");
    const days = i.days === undefined ? 30 : Number(i.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw bad("days must be a whole number from 1 to 90");
    const points: W.HqHistoryPointWire[] = [];
    for (const r of hqRegions()) {
      const today = hqFigures(r.id, Date.now())[i.metric];
      for (let d = days - 1; d >= 0; d--) points.push({ day: day(-d), regionId: r.id, value: String(d === 0 ? today : pastValue(i.metric, r.id, today, d)) });
    }
    return { metric: i.metric, days, points };
  },
  "system.health": () => ({ ok: true, surfaces: Object.values(SURFACES).filter((s) => s.enabled).map((s) => s.id) }),
  "session.me": async (_i, { p }) => buildContext(p, reader),
  "brand.theme": () => ({ tenant: false, css: "", admission: null }),

  // ---- S1 ----
  "coverage.list": () => ({ metros: REGIONS.filter((r) => r.active).map((r) => ({ code: r.code, name: r.name })) }),
  "leads.submit": (i: W.SubmitLeadInput, { surface }) => {
    const name = (i.contact?.name ?? "").trim();
    need(name, "name is empty", "empty_name");
    const dup = leads.find((l) => l.submissionId === i.submissionId);
    if (dup) throw new Refused(422, "DuplicateRefused", "duplicate key value violates unique constraint \"leads_submission_id_key\"", "leads_submission_id_key");
    const id = uid("L");
    leads.push({ id, submissionId: i.submissionId, name, metro: i.requestedMetro ?? null, source: i.source, at: new Date().toISOString() });
    return { id, eventId: publish(surface, "lead.captured", "lead", id, ANONYMOUS_PRINCIPAL_IDS.org, ANONYMOUS_PRINCIPAL_IDS.region) };
  },
  "callRecords.record": (i: W.RecordCallInput, { surface }) => {
    const id = uid("R");
    callRecords.push({ id, leadId: i.leadId ?? null, at: i.occurredAt });
    return { id, eventId: publish(surface, "call_record.logged", "call_record", id, ANONYMOUS_PRINCIPAL_IDS.org, ANONYMOUS_PRINCIPAL_IDS.region) };
  },

  // ---- hierarchy ----
  "regions.list": () => ({ regions: REGIONS }),
  "organizations.list": (i: W.ListOrganizationsInput) => ({
    organizations: orgs.filter((o) => o.kind !== "internal" && (!i.kind || o.kind === i.kind)).map((o) => ({
      id: o.id, name: o.name, kind: o.kind as W.OrganizationKind, externalRef: o.externalRef, active: o.active,
      regionNodeCount: accounts.filter((a) => a.orgId === o.id && a.tier === "region").length,
    })),
  }),
  "organizations.create": (i: W.CreateOrganizationInput, { surface }) => {
    need(i.name?.trim(), "name is empty", "empty_name");
    need(REGIONS.some((r) => r.id === i.firstRegionNode?.regionId), `no service region ${i.firstRegionNode?.regionId}`, "unknown_region");
    const orgId = uid("o"), regionNodeId = uid("a");
    orgs.push({ id: orgId, name: i.name.trim(), kind: i.kind ?? "customer", externalRef: i.externalRef ?? null, active: true, createdAt: new Date().toISOString() });
    accounts.push({ id: regionNodeId, orgId, tier: "region", name: i.firstRegionNode.name, parentId: null, regionId: i.firstRegionNode.regionId, customerGroup: null, externalRef: null, timezone: null, active: true, address: null });
    return { orgId, regionNodeId, eventId: publish(surface, "account.created", "account", regionNodeId, orgId, i.firstRegionNode.regionId) };
  },
  "accounts.list": (i: W.ListAccountsInput, { p }) => {
    const orgId = p.namespace === "internal" ? i.orgId : p.orgId;
    return { nodes: visibleAccounts(p).filter((a) => a.orgId === orgId).map(accountWire) };
  },
  "accounts.create": (i: W.CreateAccountInput, { surface }) => {
    need(i.name?.trim(), "name is empty", "empty_name");
    let regionId: string;
    const caveats: string[] = [];
    if (i.tier === "region") {
      need(i.regionId && REGIONS.some((r) => r.id === i.regionId), "a region node binds to one of our regions — regionId is required", "unknown_region");
      regionId = i.regionId!;
    } else {
      const parent = accounts.find((a) => a.id === i.parentId && a.orgId === i.orgId);
      need(parent, `no parent node ${i.parentId} in this organization`, "unknown_parent");
      if (i.regionId) throw new Refused(422, "TriggerRefused", `region_id derives from the parent edge below a region node; "${i.regionId}" was supplied as an input`, "ac_accounts_derive_region");
      const legal: Record<string, string> = { location: "region", site: "location" };
      if (legal[i.tier] !== parent!.tier) throw new Refused(422, "TriggerRefused", `a ${i.tier} sits under a ${legal[i.tier]}, not a ${parent!.tier}`, "ac_accounts_tier_edge");
      regionId = parent!.regionId;
      if (i.tier === "location") {
        const r = REGIONS.find((x) => x.id === regionId)!;
        const have = crews.filter((c) => c.homeRegionId === regionId && c.active).length;
        if (have < r.minCrewDensity) caveats.push(`D14: ${r.name} fields ${have} active crews against a density rule of ${r.minCrewDensity}.`);
      }
    }
    const id = uid("a");
    accounts.push({ id, orgId: i.orgId, tier: i.tier, name: i.name.trim(), parentId: i.tier === "region" ? null : i.parentId!, regionId, customerGroup: i.customerGroup ?? null, externalRef: i.externalRef ?? null, timezone: i.timezone ?? null, active: true, address: (i.address as W.AddressWire | undefined) ?? null });
    return { id, regionId, eventId: publish(surface, "account.created", "account", id, i.orgId, regionId), caveats };
  },
  "accounts.move": (i: W.MoveAccountInput, { surface }) => {
    const node = accounts.find((a) => a.id === i.accountId);
    const parent = accounts.find((a) => a.id === i.newParentId);
    need(node && parent, "no such node", "unknown_node");
    need(parent!.orgId === node!.orgId, "a node moves within its own organization", "cross_org_move");
    need(!descendantsOf(node!.id).has(parent!.id), "a node cannot move under its own descendant", "cycle");
    const legal: Record<string, string> = { location: "region", site: "location" };
    if (legal[node!.tier] !== parent!.tier) throw new Refused(422, "TriggerRefused", `a ${node!.tier} sits under a ${legal[node!.tier]}, not a ${parent!.tier}`, "ac_accounts_tier_edge");
    node!.parentId = parent!.id;
    const moved = descendantsOf(node!.id);
    for (const a of accounts) if (moved.has(a.id)) a.regionId = parent!.regionId;
    return { id: node!.id, regionId: parent!.regionId, movedDescendants: moved.size - 1, eventId: publish(surface, "account.updated", "account", node!.id, node!.orgId, parent!.regionId) };
  },
  "accounts.update": (i: W.UpdateAccountInput, { surface }) => {
    const node = accounts.find((a) => a.id === i.accountId);
    need(node, `no node ${i.accountId}`, "unknown_node");
    Object.assign(node!, Object.fromEntries(Object.entries(i).filter(([k, v]) => k !== "accountId" && v !== undefined)));
    return { id: node!.id, eventId: publish(surface, "account.updated", "account", node!.id, node!.orgId, node!.regionId) };
  },

  // ---- site record (item 9) ----
  "equipment.list": (i: W.ListEquipmentInput, { p }) => {
    if (!visibleAccounts(p).some((a) => a.id === i.siteId)) return { equipment: [] };
    return {
      equipment: equipment.filter((e) => e.siteId === i.siteId).map((e) => {
        const done = jobs.filter((j) => j.equipmentIds.includes(e.id) && (j.state === "complete" || j.state === "invoiced")).sort((a, b) => a.serviceWindowEnd.localeCompare(b.serviceWindowEnd)).at(-1);
        return { ...e, lastServicedAt: done?.serviceWindowEnd ?? null, lastServicedJobId: done?.id ?? null, lastServicedServiceCode: done?.serviceCode ?? null, jobCount: jobs.filter((j) => j.equipmentIds.includes(e.id)).length };
      }),
    };
  },
  "contacts.list": (i: W.ListContactsInput, { p }) => {
    const vis = new Set(visibleAccounts(p).map((a) => a.id));
    const up = ancestorsOf(i.accountId);
    return { contacts: contacts.filter((c) => up.has(c.accountId) && vis.has(c.accountId)) };
  },
  "invoices.list": (i: W.ListInvoicesInput, { p }) => {
    const node = i.siteId ?? i.locationId ?? "";
    if (!visibleAccounts(p).some((a) => a.id === node)) return { invoices: [] };
    const nodeAcc = accounts.find((a) => a.id === node)!;
    const locationId = nodeAcc.tier === "site" ? nodeAcc.parentId : nodeAcc.id;
    const siteJobs = new Set(jobs.filter((j) => j.siteId === node).map((j) => j.id));
    return {
      invoices: invoices.map((inv) => {
        const lines = inv.lines.filter((l) => l.locationId === locationId && (nodeAcc.tier !== "site" || (l.jobId !== null && siteJobs.has(l.jobId))));
        return { ...inv, lines, subtotalMinor: String(lines.reduce((s, l) => s + Number(l.amountMinor), 0)) };
      }).filter((inv) => inv.lines.length > 0),
    };
  },
  "sites.imagery": (i: W.SiteImageryInput) => {
    const a = accounts.find((x) => x.id === i.siteId);
    return { siteId: i.siteId, lat: a?.address?.lat ?? null, lng: a?.address?.lng ?? null, image: null, attribution: null, unavailable: a?.address?.lat !== undefined ? "not_configured" : "no_coordinates" };
  },

  // ---- agreements & terms ----
  "contracts.list": (i: W.ListContractsInput, { p }) => {
    const orgId = p.namespace === "internal" ? i.orgId : p.orgId;
    if (p.namespace !== "internal" && p.namespace !== "customer") return { contracts: [] };
    return { contracts: contracts.filter((c) => c.orgId === orgId && (!i.scopeId || c.scopeId === i.scopeId)).map((c) => { const { orgId, ...wire } = c; void orgId; return wire; }) };
  },
  "contracts.create": (i: W.CreateContractInput, { surface }) => {
    if (typeof i.diagnosticDataRightsReserved !== "boolean") throw bad("diagnosticDataRightsReserved is required — OQ5 has no default; state a position");
    if (i.kind === "amendment") {
      need(i.parentContractId, "an amendment names the MSA it amends", "amendment_needs_parent");
      const parent = contracts.find((c) => c.id === i.parentContractId);
      need(parent && parent.state !== "expired" && parent.state !== "terminated", "the named agreement has already ended", "amendment_parent_ended");
    }
    let regionId = i.regionId;
    if (i.scopeTier !== "parent") {
      const node = accounts.find((a) => a.id === i.scopeId && a.orgId === i.orgId);
      if (!node || node.tier !== i.scopeTier) throw new Refused(422, "TriggerRefused", `no ${i.scopeTier} ${i.scopeId} in this organization — an agreement is signed against a node that exists at the tier it names`, "ac_contract_scope_exists");
      regionId = node.regionId;
    }
    need(regionId, "a parent-scope agreement names the region that administers it", "region_required");
    const id = uid("c");
    contracts.push({ id, orgId: i.orgId, scopeTier: i.scopeTier, scopeId: i.scopeId, kind: i.kind, parentContractId: i.parentContractId ?? null, billingPath: i.billingPath, regionId: regionId!, signedAt: i.signedAt, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null, diagnosticDataRightsReserved: i.diagnosticDataRightsReserved, documentKey: i.documentKey ?? null, state: "draft" });
    return { id, regionId: regionId!, eventId: publish(surface, "contract.created", "contract", id, i.orgId, regionId!) };
  },
  "contracts.transition": (i: W.TransitionContractInput, { surface }) => {
    const c = contracts.find((x) => x.id === i.contractId);
    need(c, `no agreement ${i.contractId}`, "unknown_contract");
    const ladder: Record<string, string[]> = { draft: ["active"], active: ["expired", "terminated"] };
    need((ladder[c!.state] ?? []).includes(i.to), `${c!.state} → ${i.to} is not a step on the ladder (draft → active → expired | terminated)`, "off_ladder");
    c!.state = i.to;
    return { id: c!.id, state: c!.state, eventId: publish(surface, i.to === "active" ? "contract.amended" : "contract.expired", "contract", c!.id, c!.orgId, c!.regionId) };
  },
  "terms.register": () => ({ terms: Object.values(TERMS) }),
  "terms.overrides.list": (i: W.ListTermOverridesInput) => ({
    overrides: overrides.filter((o) => o.orgId === i.orgId && (!i.termKey || o.termKey === i.termKey) && (!i.contractId || o.contractId === i.contractId))
      .map((o) => ({ id: o.id, contractId: o.contractId, scopeTier: o.scopeTier, scopeId: o.scopeId, termKey: o.termKey, termValue: o.termValue, effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo })),
  }),
  "terms.resolved": (i: W.ResolvedTermsInput, { p }) => {
    const orgId = p.namespace === "internal" ? (i.orgId ?? p.orgId) : p.orgId;
    const keys = i.termKeys ? i.termKeys.split(",").map((k) => k.trim()).filter(Boolean) : TERM_KEYS;
    for (const k of keys) need((TERM_KEYS as readonly string[]).includes(k), `"${k}" is not a registered term`, "unknown_term");
    const r = resolveAll(overrides.filter((o) => o.orgId === orgId), pathOf(orgId)(i.tier ?? "site", i.nodeId ?? ""), i.asOf ?? today(), keys);
    return { resolved: r.resolved, refused: Object.fromEntries(Object.entries(r.refused).map(([k, e]) => [k, { code: e.code, message: e.message }])) };
  },
  "terms.authorOverride": (i: W.AuthorOverrideInput, { surface }) => {
    const existing = overrides.filter((o) => o.orgId === i.orgId && o.termKey === i.termKey);
    admitOverride({ contractId: i.contractId, scopeTier: i.scopeTier, scopeId: i.scopeId, termKey: i.termKey, termValue: i.termValue, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null }, existing, pathOf(i.orgId));
    const id = uid("o");
    overrides.push({ id, contractId: i.contractId, scopeTier: i.scopeTier, scopeId: i.scopeId, termKey: i.termKey, termValue: i.termValue, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null, orgId: i.orgId, regionId: i.regionId });
    return { id, eventId: publish(surface, "contract.term_overridden", "contract", i.contractId, i.orgId, i.regionId) };
  },

  // ---- network ----
  "firms.list": (i: W.ListFirmsInput, { p }) => ({
    firms: firms.filter((f) => (p.namespace === "internal" || f.id === p.firmId) && (!i.status || f.status === i.status)).map(firmWire),
  }),
  "firms.create": (i: W.CreateFirmInput, { surface }) => {
    need(i.legalName?.trim(), "legal name is empty", "empty_legal_name");
    if (typeof i.diagnosticDataRightsReserved !== "boolean") throw bad("diagnosticDataRightsReserved is required — OQ5 has no default; state a position");
    need(REGIONS.some((r) => r.id === i.regionId), `no service region ${i.regionId}`, "unknown_region");
    const id = uid("f");
    orgs.push({ id, name: i.legalName.trim(), kind: "subcontractor", externalRef: i.externalRef ?? null, active: true });
    firms.push({ id, legalName: i.legalName.trim(), status: "onboarding", regionId: i.regionId, settlementTermsDays: i.settlementTermsDays, msaSignedAt: i.msaSignedAt ?? null, diagnosticDataRightsReserved: i.diagnosticDataRightsReserved, w9DocumentKey: i.w9DocumentKey ?? null });
    return { id, regionId: i.regionId, eventId: publish(surface, "firm.created", "subcontractor_firm", id, id, i.regionId) };
  },
  "firms.update": (i: W.UpdateFirmInput, { surface }) => {
    const f = firms.find((x) => x.id === i.firmId);
    need(f, `no firm ${i.firmId} visible in this scope`, "unknown_firm");
    if (i.legalName !== undefined) f!.legalName = i.legalName;
    if (i.settlementTermsDays !== undefined) f!.settlementTermsDays = i.settlementTermsDays;
    if (i.msaSignedAt !== undefined) f!.msaSignedAt = i.msaSignedAt;
    if (i.w9DocumentKey !== undefined) f!.w9DocumentKey = i.w9DocumentKey;
    if (i.status) {
      const ladder: Record<string, string[]> = { onboarding: ["active", "terminated"], active: ["suspended", "terminated"], suspended: ["active", "terminated"] };
      if (f!.status === "terminated") throw input422(`firm ${f!.legalName} is terminated — a terminated firm is not reinstated`, "firm_ended");
      need((ladder[f!.status] ?? []).includes(i.status), `${f!.status} → ${i.status} is not a step on the ladder`, "off_ladder");
      if (i.status === "active" && !f!.msaSignedAt) throw new Refused(422, "TriggerRefused", `firm ${f!.legalName} has no signed MSA — activation needs one`, "msa_unsigned");
      f!.status = i.status;
    }
    return { id: f!.id, status: f!.status, eventId: publish(surface, i.status ? "firm.status_changed" : "firm.updated", "subcontractor_firm", f!.id, f!.id, f!.regionId) };
  },
  "crews.list": (i: W.ListCrewsInput, { p }) => ({
    crews: visibleCrews(p).filter((c) => (!i.firmId || c.firmId === i.firmId) && (!i.regionId || c.homeRegionId === i.regionId)).map(crewWire),
  }),
  "crews.create": (i: W.CreateCrewInput, { surface }) => {
    need(i.label?.trim(), "label is empty", "empty_label");
    if (i.employmentType === "employed" && i.firmId) throw input422(`an employed crew is ours and names no firm — "${i.label}" declares firmId. Record it as subcontracted, or drop the firm.`, "firm_not_an_input");
    if (i.employmentType === "subcontracted" && !i.firmId) throw input422(`a subcontracted crew belongs to a firm — "${i.label}" names none. A crew with no employer is a crew nobody settles with.`, "firm_required");
    const firm = i.firmId ? firms.find((f) => f.id === i.firmId) : null;
    if (firm?.status === "terminated") throw input422(`firm ${firm.legalName} is terminated — a crew rostered under it is a crew nobody can dispatch`, "firm_ended");
    const id = uid("e");
    crews.push({ id, label: i.label.trim(), employmentType: i.employmentType, firmId: i.firmId ?? null, homeRegionId: i.homeRegionId, active: true });
    return { id, regionId: i.homeRegionId, eventId: publish(surface, "crew.created", "crew", id, i.firmId ?? INTERNAL_ORG_ID, i.homeRegionId) };
  },
  "credentials.list": (i: W.ListCredentialsInput, { p }) => {
    const vis = new Set(visibleCrews(p).map((c) => c.id));
    const firmCrews = i.firmId ? new Set(crews.filter((c) => c.firmId === i.firmId).map((c) => c.id)) : null;
    return { credentials: credentials.filter((c) => vis.has(c.crewId) && (!i.crewId || c.crewId === i.crewId) && (!firmCrews || firmCrews.has(c.crewId))) };
  },
  "credentials.record": (i: W.RecordCredentialInput, { surface }) => recordCredential(i, surface),
  "credentials.submit": (i: W.SubmitCredentialInput, { surface, p }) => {
    const crew = crews.find((c) => c.id === i.crewId && c.firmId === p.firmId);
    need(crew, `no crew ${i.crewId} visible in this scope`, "unknown_crew");
    const out = recordCredential(i, surface);
    return { id: out.id, crewId: i.crewId, eventId: out.eventId };
  },
  "credentials.verify": (i: W.VerifyCredentialInput, { surface, p }) => {
    const c = credentials.find((x) => x.id === i.credentialId);
    need(c, `no credential ${i.credentialId} visible in this scope`, "unknown_credential");
    if (c!.verifiedAt) throw new Refused(422, "TriggerRefused", `${c!.kind} ${c!.identifier} was verified at ${c!.verifiedAt} — a verified document is immutable; a correction is a new document`, "ac_credential_verified_once");
    c!.verifiedAt = new Date().toISOString(); c!.verifiedBy = p.subjectId;
    const crew = crews.find((x) => x.id === c!.crewId)!;
    return { id: c!.id, verifiedAt: c!.verifiedAt, verifiedBy: c!.verifiedBy, eventId: publish(surface, "credential.verified", "crew_credential", c!.id, crew.firmId ?? INTERNAL_ORG_ID, crew.homeRegionId) };
  },
  "rateCards.list": (i: W.ListRateCardsInput, { p }) => {
    if (p.namespace === "subcontractor" && i.firmId !== p.firmId) return { rateCards: [] };
    return { rateCards: rateCards.filter((r) => r.firmId === i.firmId && (!i.serviceCode || r.serviceCode === i.serviceCode)) };
  },
  "rateCards.set": (i: W.SetRateCardInput, { surface }) => {
    need(/^\d+$/.test(i.rateMinor ?? ""), "rateMinor is integer minor units as a string of digits", "bad_money");
    const firm = firms.find((f) => f.id === i.firmId);
    need(firm, `no firm ${i.firmId} visible in this scope`, "unknown_firm");
    const open = rateCards.find((r) => r.firmId === i.firmId && r.serviceCode === i.serviceCode && r.effectiveFrom <= i.effectiveFrom && (r.effectiveTo === null || r.effectiveTo > i.effectiveFrom));
    const later = rateCards.find((r) => r.firmId === i.firmId && r.serviceCode === i.serviceCode && r.effectiveFrom > i.effectiveFrom);
    if (later || (open && open.effectiveFrom === i.effectiveFrom)) throw new Refused(422, "OverlapRefused", `conflicting key value violates exclusion constraint "rate_cards_no_overlap" — ${i.serviceCode} already has a rate from ${(later ?? open)!.effectiveFrom}`, "rate_cards_no_overlap");
    if (open) open.effectiveTo = i.effectiveFrom;
    const id = uid("r");
    rateCards.push({ id, firmId: i.firmId, serviceCode: i.serviceCode, rateMinor: i.rateMinor, currency: i.currency, effectiveFrom: i.effectiveFrom, effectiveTo: i.effectiveTo ?? null });
    return { id, closedId: open?.id ?? null, eventId: publish(surface, "rate_card.changed", "rate_card", id, i.firmId, firm!.regionId) };
  },

  // ---- S8, the firm's own writes ----
  "crews.enroll": (i: W.EnrollCrewInput, { surface, p }) => {
    need(i.label?.trim(), "label is empty", "empty_label");
    const firm = firms.find((f) => f.id === p.firmId)!;
    if (firm.status === "suspended" || firm.status === "terminated") throw input422(`firm ${firm.legalName} is ${firm.status} — a crew rostered under it is a crew nobody can dispatch.`, "firm_ended");
    const id = uid("e");
    crews.push({ id, label: i.label.trim(), employmentType: "subcontracted", firmId: firm.id, homeRegionId: firm.regionId, active: true });
    return { id, firmId: firm.id, regionId: firm.regionId, eventId: publish(surface, "crew.created", "crew", id, firm.id, firm.regionId) };
  },
  "crews.retire": (i: W.RetireCrewInput, { surface, p }) => {
    const crew = crews.find((c) => c.id === i.crewId && c.firmId === p.firmId);
    need(crew, `no crew ${i.crewId} visible in this scope`, "unknown_crew");
    if (i.active === false) {
      const live = assignments.filter((a) => a.crewId === crew!.id && a.releasedAt === null && ["assigned", "en_route", "on_site", "in_progress"].includes(jobs.find((j) => j.id === a.jobId)?.state ?? ""));
      if (live.length) throw input422(`crew ${crew!.label} holds ${live.length} live assignment${live.length === 1 ? "" : "s"} — ask the office to release the work before retiring the crew`, "crew_assigned");
      crew!.active = false;
    }
    if (i.label) crew!.label = i.label;
    return { id: crew!.id, eventId: publish(surface, "crew.updated", "crew", crew!.id, crew!.firmId!, crew!.homeRegionId) };
  },
  "settlements.list": (i: W.ListSettlementsInput, { p }) => ({
    settlements: settlements.filter((s) => (p.namespace === "internal" || (s.firmId === p.firmId && s.state !== "draft")) && (!i.firmId || s.firmId === i.firmId) && (!i.state || s.state === i.state)).map(settlementWire),
  }),
  "settlements.lines": (i: W.ListSettlementLinesInput, { p }) => {
    const s = settlements.find((x) => x.id === i.settlementId && (p.namespace === "internal" || (x.firmId === p.firmId && x.state !== "draft")));
    need(s, `no statement ${i.settlementId} visible in this scope`, "unknown_settlement");
    return { settlementId: s!.id, lines: settlementLines.filter((l) => l.settlementId === s!.id) };
  },
  "settlements.acknowledge": (i: W.AcknowledgeSettlementInput, { surface, p }) => {
    const s = settlements.find((x) => x.id === i.settlementId && x.firmId === p.firmId && x.state !== "draft");
    need(s, `no statement ${i.settlementId} visible in this scope`, "unknown_settlement");
    if (s!.state === "acknowledged") throw input422(`statement for ${s!.periodFrom} → ${s!.periodTo} was acknowledged at ${s!.acknowledgedAt}`, "already_acknowledged");
    need(s!.state === "issued", `statement for ${s!.periodFrom} → ${s!.periodTo} is ${s!.state}; only an issued statement is acknowledged`, "not_issued");
    s!.state = "acknowledged"; s!.acknowledgedAt = new Date().toISOString();
    return { id: s!.id, state: "acknowledged", acknowledgedAt: s!.acknowledgedAt, eventId: publish(surface, "settlement.acknowledged", "settlement", s!.id, s!.firmId, s!.regionId) };
  },
  "settlements.dispute": (i: W.DisputeSettlementInput, { surface, p }) => {
    const s = settlements.find((x) => x.id === i.settlementId && x.firmId === p.firmId && x.state !== "draft");
    need(s, `no statement ${i.settlementId} visible in this scope`, "unknown_settlement");
    need((i.reason ?? "").trim(), "a dispute says why — reason is empty. Name the line, the rate or the quantity that is wrong.", "empty_reason");
    if (s!.state === "disputed") throw input422(`statement for ${s!.periodFrom} → ${s!.periodTo} is already in dispute since ${s!.disputedAt}: "${s!.disputeReason}". The office answers a dispute; a second one adds nothing.`, "already_disputed");
    need(s!.state === "issued" || s!.state === "acknowledged", `statement for ${s!.periodFrom} → ${s!.periodTo} is ${s!.state}; a firm disputes an issued or acknowledged statement`, "not_issued");
    s!.state = "disputed"; s!.disputedAt = new Date().toISOString(); s!.disputeReason = i.reason.trim();
    return { id: s!.id, state: "disputed", disputedAt: s!.disputedAt, eventId: publish(surface, "settlement.disputed", "settlement", s!.id, s!.firmId, s!.regionId) };
  },

  // ---- work ----
  "jobs.list": (i: W.ListJobsInput, { p, surface }) => ({ jobs: visibleJobs(p, surface).filter((j) => !i.state || j.state === i.state).map((j) => jobWire(j, p)) }),
  "serviceRequests.list": (i: W.ListServiceRequestsInput, { p, surface }) => ({
    requests: serviceRequests.filter((r) => {
      if (i.siteId && r.siteId !== i.siteId) return false;
      if (p.namespace === "customer") return siteVisibleToCustomer(p, r.siteId);
      if (surface === "S3") return r.regionId === p.regionId;
      return true;
    }).map((r) => ({ ...r, jobState: r.jobId ? jobs.find((j) => j.id === r.jobId)?.state ?? null : null })),
  }),
  "serviceRequests.create": (i: W.CreateServiceRequestInput, { p, session, surface }) => {
    const description = (i.description ?? "").trim();
    need(description, "a request says what is wrong — the description is empty", "empty_description");
    need(siteVisibleToCustomer(p, i.siteId), `no node ${i.siteId} visible in this scope`, "unknown_site");
    const site = accounts.find((a) => a.id === i.siteId)!;
    need(site.tier === "site", `"${i.siteId}" is a ${site.tier}, not a site — service is requested at a site, the tier equipment lives at`, "not_a_site");
    const id = uid("q");
    serviceRequests.unshift({ id, siteId: site.id, siteName: site.name, priority: i.priority ?? "routine", description, requestedBy: session?.user.name ?? "customer", createdAt: new Date().toISOString(), jobId: null, jobState: null, orgId: site.orgId, regionId: site.regionId });
    return { id, orgId: site.orgId, regionId: site.regionId, eventId: publish(surface, "service_request.created", "service_request", id, site.orgId, site.regionId) };
  },

  // ---- S3 ----
  "dispatch.candidates": (i: W.CandidateCrewsInput, { p }) => {
    const j = jobs.find((x) => x.id === i.jobId && x.regionId === p.regionId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const window = { start: Date.parse(j!.serviceWindowStart), end: Date.parse(j!.serviceWindowEnd) };
    return {
      jobId: j!.id,
      candidates: crews.filter((c) => c.homeRegionId === j!.regionId && c.active).map((c) => {
        const r = evaluate(c, credentials.filter((x) => x.crewId === c.id).map((x) => ({ id: x.id, kind: x.kind, validFrom: Date.parse(x.validFrom), validTo: Date.parse(x.validTo) + DAY - 1, verifiedAt: x.verifiedAt ? Date.parse(x.verifiedAt) : null })), window, Date.now());
        return { crewId: c.id, label: c.label, employmentType: c.employmentType, cleared: !isRefusal(r), refusal: isRefusal(r) ? { reason: r.reason, credentialKind: r.credentialKind, detail: r.detail.replace(c.id, c.label) } : null };
      }),
    };
  },
  "dispatch.assign": (i: W.AssignInput, { p, surface }) => {
    const j = jobs.find((x) => x.id === i.jobId && x.regionId === p.regionId);
    need(j, `job ${i.jobId} not found in scope`, "unknown_job");
    const c = crews.find((x) => x.id === i.crewId && x.homeRegionId === j!.regionId);
    need(c, `crew ${i.crewId} not found in scope`, "unknown_crew");
    const window = { start: Date.parse(j!.serviceWindowStart), end: Date.parse(j!.serviceWindowEnd) };
    const r = evaluate(c!, credentials.filter((x) => x.crewId === c!.id).map((x) => ({ id: x.id, kind: x.kind, validFrom: Date.parse(x.validFrom), validTo: Date.parse(x.validTo) + DAY - 1, verifiedAt: x.verifiedAt ? Date.parse(x.verifiedAt) : null })), window, Date.now());
    if (isRefusal(r)) {
      const eventId = publish(surface, "crew.compliance_refused", "job", j!.id, j!.orgId, j!.regionId);
      return { ok: false, refusal: { ok: false, reason: r.reason, credentialKind: r.credentialKind, detail: r.detail.replace(c!.id, c!.label) }, eventId };
    }
    const prev = liveAssignment(j!.id);
    if (prev) prev.releasedAt = new Date().toISOString();
    const a: Assignment = { id: uid("x"), jobId: j!.id, crewId: c!.id, assignedAt: new Date().toISOString(), releasedAt: null };
    assignments.push(a);
    j!.state = prev ? "reassigned" : "assigned"; j!.version++;
    if (j!.slaSatisfiedAt === null && j!.slaDueAt) j!.slaSatisfiedAt = new Date().toISOString();
    const req = serviceRequests.find((s) => s.jobId === j!.id);
    if (req) req.jobState = j!.state;
    return { ok: true, assignmentId: a.id, clearanceId: uid("cl"), eventId: publish(surface, "job.assigned", "job", j!.id, j!.orgId, j!.regionId) };
  },
  "dispatch.release": (i: W.ReleaseAssignmentInput, { surface }) => {
    const a = assignments.find((x) => x.id === i.assignmentId);
    need(a, `assignment ${i.assignmentId} not found in scope`, "unknown_assignment");
    if (a!.releasedAt) throw input422(`assignment ${i.assignmentId} was already released at ${a!.releasedAt}`, "already_released");
    const j = jobs.find((x) => x.id === a!.jobId)!;
    if (j.state !== "assigned" && j.state !== "reassigned") throw new Refused(422, "TriggerRefused", `job is ${j.state.replace("_", " ")} — field execution has begun; this is a cancellation or a reassignment, not a release`, "ac_release_before_start");
    a!.releasedAt = new Date().toISOString();
    j.state = "created"; j.version++;
    return { jobId: j.id, eventId: publish(surface, "job.reassigned", "job", j.id, j.orgId, j.regionId) };
  },

  // ---- S5 ----
  "jobs.mine": (_i, { session }) => {
    const crewId = session?.user.crewId;
    return {
      jobs: jobs.filter((j) => liveAssignment(j.id)?.crewId === crewId && !["complete", "invoiced", "cancelled"].includes(j.state))
        .map((j) => ({ id: j.id, siteId: j.siteId, serviceCode: j.serviceCode, priority: j.priority, state: j.state, serviceWindowStart: j.serviceWindowStart, serviceWindowEnd: j.serviceWindowEnd, version: j.version })),
    };
  },
  "sync.replay": (i: W.SyncReplayInput, { surface }) => {
    const seen = new Set<string>();
    const outcomes: W.SyncOutcomeWire[] = [];
    for (const m of i.mutations ?? []) {
      if (seen.has(m.mutationId) || replayed.has(m.mutationId)) { outcomes.push({ outcome: "duplicate", mutationId: m.mutationId }); continue; }
      seen.add(m.mutationId); replayed.add(m.mutationId);
      const j = jobs.find((x) => x.id === (m.payload["jobId"] ?? m.entityId));
      if (m.op === "transition" && j) {
        const to = String(m.payload["to"] ?? m.payload["state"] ?? "");
        if (m.clientObservedVersion !== null && m.clientObservedVersion < j.version - 1) {
          outcomes.push({ outcome: "superseded", mutationId: m.mutationId, note: `the office changed this job while the device was offline (v${j.version})`, serverState: { version: j.version, state: j.state, fields: {} } });
          continue;
        }
        if (to) { j.state = to as W.JobStateWire; j.version++; publish(surface, to === "complete" ? "job.completed" : "job.transitioned", "job", j.id, j.orgId, j.regionId); }
        outcomes.push({ outcome: "applied", mutationId: m.mutationId, newVersion: j.version });
      } else {
        outcomes.push({ outcome: "applied", mutationId: m.mutationId, newVersion: (j?.version ?? 0) + 1 });
      }
    }
    return { outcomes };
  },
};

// ---------------------------------------------------------------------------
// Item 11 — procurement: the office's purchasing (S2) and the vendor's side
// (S7). Same wire shapes as apps/gateway/src/handlers/procurement.ts; the
// three-way match is the real domain function. A vendor sees its own rows,
// and an order only once issued — 0011's rules, imitated here by hand.
// ---------------------------------------------------------------------------
const VND = { coolair: "v0000000-0000-0000-0000-000000000001", lonestar: "v0000000-0000-0000-0000-000000000002" } as const;
type Vendor = Mutable<W.VendorWire>;
const vendorRows: Vendor[] = [
  { id: VND.coolair, legalName: "Coolair Supply Co.", status: "active", regionId: REGION_SOUTH, paymentTermsDays: 30, contactEmail: "orders@coolair.demo" },
  { id: VND.lonestar, legalName: "Lone Star Parts Depot", status: "active", regionId: REGION_SOUTH, paymentTermsDays: 45, contactEmail: "sales@lonestarparts.demo" },
];
for (const v of vendorRows) orgs.push({ id: v.id, name: v.legalName, kind: "vendor", externalRef: null, active: true });
const RP = { south: "w0000000-0000-0000-0000-000000000001", west: "w0000000-0000-0000-0000-000000000002", mtn: "w0000000-0000-0000-0000-000000000003", dc: "w0000000-0000-0000-0000-000000000004" } as const;
const receivingPointRows: W.ReceivingPointWire[] = [
  { id: RP.south, code: "SOUTH-HUB", tier: "regional_hub", regionId: REGION_SOUTH, address: { line1: "4410 Industrial Oaks Blvd", city: "Austin", state: "TX", postal: "78735" }, active: true },
  { id: RP.west, code: "WEST-HUB", tier: "regional_hub", regionId: REGION_WEST, address: { line1: "955 Spice Islands Dr", city: "Sparks", state: "NV", postal: "89431" }, active: true },
  { id: RP.mtn, code: "MTN-LS-02", tier: "location_stock", regionId: REGION_MOUNTAIN, address: { line1: "6100 Longbow Dr, Unit 4", city: "Boulder", state: "CO", postal: "80301" }, active: true },
  { id: RP.dc, code: "NATIONAL-DC", tier: "national", regionId: REGION_SOUTH, address: { line1: "2201 Great Southwest Pkwy", city: "Grand Prairie", state: "TX", postal: "75050" }, active: true },
];
type Item = Omit<W.CatalogItemWire, "current" | "proposals">;
const itemRows: Item[] = [];
const priceRows: Mutable<W.CatalogPriceWire>[] = [];
const addItem = (vendorId: string, sku: string, description: string, priceMinor: string, uom = "each"): string => {
  const id = uid("ci");
  itemRows.push({ id, vendorId, vendorSku: sku, description, uom, active: true });
  priceRows.push({ id: uid("cp"), itemId: id, vendorId, priceMinor, currency: "USD", effectiveFrom: day(-120), effectiveTo: null, state: "accepted", proposedAt: at(-125 * DAY), decidedAt: at(-121 * DAY), decisionNote: null });
  return id;
};
const IT = {
  cap: addItem(VND.coolair, "CAP-45-5-440", "Run capacitor 45/5 µF 440V", "1850"),
  contactor: addItem(VND.coolair, "CNT-2P-40A", "Contactor, 2-pole 40A 24V coil", "3275"),
  motor: addItem(VND.coolair, "MTR-CF-1/4", "Condenser fan motor 1/4 HP 1075 RPM", "14900"),
  filter: addItem(VND.coolair, "FLT-20x25x2-M8", "Pleated filter 20x25x2 MERV 8", "640"),
  r410: addItem(VND.lonestar, "R410A-25", "Refrigerant R-410A, 25 lb cylinder", "18900", "cylinder"),
  belt: addItem(VND.lonestar, "BLT-A42", "V-belt A42", "1125"),
  tstat: addItem(VND.lonestar, "TST-PRO-7", "Programmable thermostat, commercial", "11600"),
};
priceRows.push({ id: uid("cp"), itemId: IT.motor, vendorId: VND.coolair, priceMinor: "15650", currency: "USD", effectiveFrom: day(10), effectiveTo: null, state: "proposed", proposedAt: at(-2 * DAY), decidedAt: null, decisionNote: null });
type Po = Mutable<Omit<W.PurchaseOrderWire, "vendorName" | "receivingPointCode" | "receivingTier">> & { lines: { id: string; lineNo: number; itemId: string; quantityMilli: string; unitPriceMinor: string }[] };
const poRows: Po[] = [];
const shipmentRows: (W.ShipmentWire & { poId: string })[] = [];
const receiptRows: (W.ReceiptWire & { poId: string })[] = [];
const vinvRows: W.VendorInvoiceWire[] = [];
const rmaRows: Mutable<W.RmaWire>[] = [];
const accepted = (itemId: string) => priceRows.find((p) => p.itemId === itemId && p.state === "accepted" && p.effectiveFrom <= day(0) && (p.effectiveTo === null || p.effectiveTo > day(0)));
const amount = (q: bigint, p: bigint) => (q * p + 500n) / 1000n;
const seedPo = (vendorId: string, rp: string, state: W.PoState, daysAgo: number, lines: [string, number][]): Po => {
  const id = uid("po");
  const ls = lines.map(([itemId, q], i) => ({ id: uid("pl"), lineNo: i + 1, itemId, quantityMilli: String(q * 1000), unitPriceMinor: accepted(itemId)!.priceMinor }));
  const total = ls.reduce((t, l) => t + amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)), 0n);
  const po: Po = { id, number: `PO-${day(-daysAgo).replace(/-/g, "")}-${4100 + poRows.length}`, vendorId, receivingPointId: rp, regionId: receivingPointRows.find((r) => r.id === rp)!.regionId, state, currency: "USD", totalMinor: total.toString(),
    issuedAt: state === "draft" ? null : at(-daysAgo * DAY + HOUR), acknowledgedAt: ["acknowledged", "received"].includes(state) ? at(-daysAgo * DAY + 5 * HOUR) : null, promisedShipOn: ["acknowledged", "received"].includes(state) ? day(-daysAgo + 3) : null, createdAt: at(-daysAgo * DAY), lines: ls };
  poRows.push(po);
  return po;
};
{
  const done = seedPo(VND.coolair, RP.south, "received", 21, [[IT.cap, 24], [IT.contactor, 10], [IT.filter, 48]]);
  shipmentRows.push({ id: uid("sh"), poId: done.id, shippedOn: day(-18), carrier: "UPS Freight", tracking: "1Z9W4R870312", lines: done.lines.map((l) => ({ poLineId: l.id, quantityMilli: l.quantityMilli })) });
  for (const l of done.lines) receiptRows.push({ id: uid("rc"), poId: done.id, poLineId: l.id, quantityMilli: l.quantityMilli, receivedAt: at(-16 * DAY) });
  vinvRows.push({ id: uid("vi"), poId: done.id, poNumber: done.number, vendorId: VND.coolair, invoiceNumber: "CS-100482", invoiceDate: day(-15), totalMinor: done.totalMinor, currency: "USD", matchState: "matched", matchNotes: [], createdAt: at(-15 * DAY),
    lines: done.lines.map((l) => ({ poLineId: l.id, quantityMilli: l.quantityMilli, unitPriceMinor: l.unitPriceMinor, amountMinor: amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)).toString() })) });
  rmaRows.push({ id: uid("rm"), poId: done.id, poNumber: done.number, poLineId: done.lines[0]!.id, vendorId: VND.coolair, quantityMilli: "2000", reason: "Two capacitors arrived with bulged casings.", state: "requested", rmaNumber: null, vendorNote: null, createdAt: at(-3 * DAY), respondedAt: null });
  const part = seedPo(VND.coolair, RP.west, "acknowledged", 6, [[IT.motor, 6], [IT.cap, 12]]);
  shipmentRows.push({ id: uid("sh"), poId: part.id, shippedOn: day(-3), carrier: "FedEx Ground", tracking: "7749 0012 4431", lines: [{ poLineId: part.lines[0]!.id, quantityMilli: "4000" }, { poLineId: part.lines[1]!.id, quantityMilli: "12000" }] });
  receiptRows.push({ id: uid("rc"), poId: part.id, poLineId: part.lines[0]!.id, quantityMilli: "4000", receivedAt: at(-1 * DAY) }, { id: uid("rc"), poId: part.id, poLineId: part.lines[1]!.id, quantityMilli: "12000", receivedAt: at(-1 * DAY) });
  vinvRows.push({ id: uid("vi"), poId: part.id, poNumber: part.number, vendorId: VND.coolair, invoiceNumber: "CS-100511", invoiceDate: day(-1), totalMinor: "111600", currency: "USD", matchState: "held", createdAt: at(-1 * DAY),
    matchNotes: [{ poLineId: part.lines[0]!.id, code: "over_received", message: "line 1: 6 billed in all, 4 received" }],
    lines: [{ poLineId: part.lines[0]!.id, quantityMilli: "6000", unitPriceMinor: "14900", amountMinor: "89400" }, { poLineId: part.lines[1]!.id, quantityMilli: "12000", unitPriceMinor: "1850", amountMinor: "22200" }] });
  seedPo(VND.coolair, RP.mtn, "issued", 1, [[IT.filter, 96], [IT.contactor, 4]]);
  seedPo(VND.lonestar, RP.south, "issued", 0, [[IT.r410, 8], [IT.belt, 20]]);
  seedPo(VND.lonestar, RP.dc, "acknowledged", 9, [[IT.tstat, 15]]);
  seedPo(VND.coolair, RP.south, "draft", 0, [[IT.motor, 2]]);
}
const vendorOf = (p: Principal) => (p.namespace === "vendor" ? p.orgId : null);
const seesPo = (p: Principal, po: Po) => p.namespace === "internal" || (po.vendorId === vendorOf(p) && po.state !== "draft");
const poWire = (po: Po): W.PurchaseOrderWire => {
  const rp = receivingPointRows.find((r) => r.id === po.receivingPointId);
  const { lines: _l, ...rest } = po; void _l;
  return { ...rest, vendorName: vendorRows.find((v) => v.id === po.vendorId)?.legalName ?? null, receivingPointCode: rp?.code ?? null, receivingTier: rp?.tier ?? null };
};
const sumBy = <T extends { quantityMilli: string }>(rows: readonly T[]) => rows.reduce((t, r) => t + BigInt(r.quantityMilli), 0n);
const lineStats = (po: Po) => po.lines.map((l) => {
  const item = itemRows.find((i) => i.id === l.itemId)!;
  const shipped = sumBy(shipmentRows.filter((s) => s.poId === po.id).flatMap((s) => s.lines.filter((x) => x.poLineId === l.id)));
  const received = sumBy(receiptRows.filter((r) => r.poLineId === l.id));
  const invoiced = sumBy(vinvRows.filter((v) => v.poId === po.id && v.matchState === "matched").flatMap((v) => v.lines.filter((x) => x.poLineId === l.id)));
  const returned = sumBy(rmaRows.filter((r) => r.poLineId === l.id && r.state !== "rejected"));
  return { id: l.id, lineNo: l.lineNo, itemId: l.itemId, vendorSku: item.vendorSku, description: item.description, uom: item.uom, quantityMilli: l.quantityMilli, shippedMilli: shipped.toString(), receivedMilli: received.toString(),
    invoicedMilli: invoiced.toString(), returnedMilli: returned.toString(), unitPriceMinor: l.unitPriceMinor, amountMinor: amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)).toString() } satisfies W.PoLineWire;
});
const findPo = (p: Principal, id: string): Po => { const po = poRows.find((x) => x.id === id && seesPo(p, x)); need(po, `no purchase order ${id} visible in this scope`, "unknown_po"); return po!; };
const digits = (v: unknown, field: string, positive = false): bigint => { if (typeof v !== "string" || !/^\d+$/.test(v)) throw bad(`${field} must be a string of digits`); const n = BigInt(v); if (positive && n === 0n) throw bad(`${field} must be more than zero`); return n; };
const proc: Partial<Record<OperationId, Handler>> = {
  "vendors.list": (_i, { p }) => ({ vendors: vendorRows.filter((v) => p.namespace === "internal" || v.id === vendorOf(p)) }),
  "vendors.create": (i: W.CreateVendorInput, { surface }) => {
    need((i.legalName ?? "").trim(), "legalName is required", "empty_legal_name");
    const id = uid("v"); const regionId = i.regionId;
    vendorRows.push({ id, legalName: i.legalName.trim(), status: "active", regionId, paymentTermsDays: i.paymentTermsDays ?? 30, contactEmail: i.contactEmail ?? null });
    orgs.push({ id, name: i.legalName.trim(), kind: "vendor", externalRef: null, active: true });
    return { id, eventId: publish(surface, "vendor.created", "vendor", id, id, regionId) };
  },
  "receivingPoints.list": (_i, { p }) => ({ receivingPoints: receivingPointRows.filter((r) => p.namespace === "internal" || poRows.some((po) => po.receivingPointId === r.id && seesPo(p, po))) }),
  "receivingPoints.create": (i: W.CreateReceivingPointInput, { surface }) => {
    need((i.code ?? "").trim(), "code is required", "empty_code");
    need(!receivingPointRows.some((r) => r.code === i.code.trim().toUpperCase()), `receiving point ${i.code} already exists`, "receiving_points_code_key");
    const id = uid("w"); receivingPointRows.push({ id, code: i.code.trim().toUpperCase(), tier: i.tier, regionId: i.regionId, address: i.address, active: true });
    return { id, eventId: publish(surface, "receiving_point.set", "receiving_point", id, INTERNAL_ORG_ID, i.regionId) };
  },
  "catalog.list": (i: W.ListCatalogInput, { p }) => ({
    items: itemRows.filter((it) => (p.namespace === "internal" || it.vendorId === vendorOf(p)) && (!i.vendorId || it.vendorId === i.vendorId)).map((it) => ({
      ...it, current: accepted(it.id) ?? null, proposals: priceRows.filter((x) => x.itemId === it.id && x.state === "proposed"),
    })),
  }),
  "catalog.addItem": (i: W.AddCatalogItemInput, { surface }) => {
    need((i.vendorSku ?? "").trim() && (i.description ?? "").trim(), "vendorSku and description are required", "empty_item");
    const id = uid("ci"); itemRows.push({ id, vendorId: i.vendorId, vendorSku: i.vendorSku.trim(), description: i.description.trim(), uom: i.uom ?? "each", active: true });
    return { id, eventId: publish(surface, "catalog_item.set", "part", id, i.vendorId, REGION_SOUTH) };
  },
  "prices.propose": (i: W.ProposePriceInput, { p, surface }) => {
    const it = itemRows.find((x) => x.id === i.itemId && x.vendorId === vendorOf(p)); need(it, `no catalogue item ${i.itemId} visible in this scope`, "unknown_item");
    const price = digits(i.priceMinor, "priceMinor");
    need(i.effectiveFrom >= day(0), `a price is proposed from today or later; ${i.effectiveFrom} has passed`, "backdated_price");
    const id = uid("cp"); priceRows.push({ id, itemId: it!.id, vendorId: it!.vendorId, priceMinor: price.toString(), currency: "USD", effectiveFrom: i.effectiveFrom, effectiveTo: null, state: "proposed", proposedAt: new Date().toISOString(), decidedAt: null, decisionNote: null });
    return { id, eventId: publish(surface, "vendor_price.proposed", "catalog_price", id, it!.vendorId, REGION_SOUTH) };
  },
  "prices.withdraw": (i: W.WithdrawPriceInput, { p, surface }) => {
    const x = priceRows.find((r) => r.id === i.priceId && r.vendorId === vendorOf(p)); need(x, `no price ${i.priceId} visible in this scope`, "unknown_price");
    need(x!.state === "proposed", `this price is ${x!.state}; only a proposal waiting on the office is withdrawn`, "not_proposed");
    x!.state = "withdrawn";
    return { id: x!.id, eventId: publish(surface, "vendor_price.withdrawn", "catalog_price", x!.id, x!.vendorId, REGION_SOUTH) };
  },
  "prices.decide": (i: W.DecidePriceInput, { surface }) => {
    const x = priceRows.find((r) => r.id === i.priceId); need(x, `no price ${i.priceId} visible in this scope`, "unknown_price");
    need(x!.state === "proposed", `this price is ${x!.state}; the office decides a proposal once`, "not_proposed");
    let closedId: string | null = null;
    if (i.decision === "accepted") {
      const open = priceRows.find((r) => r.itemId === x!.itemId && r.state === "accepted" && r.effectiveFrom <= x!.effectiveFrom && (r.effectiveTo === null || r.effectiveTo > x!.effectiveFrom));
      need(!open || open.effectiveFrom !== x!.effectiveFrom, `an accepted price already starts on ${x!.effectiveFrom}`, "price_same_day");
      if (open) { open.effectiveTo = x!.effectiveFrom; closedId = open.id; }
    }
    x!.state = i.decision; x!.decidedAt = new Date().toISOString(); x!.decisionNote = i.note ?? null;
    return { id: x!.id, state: x!.state, closedId, eventId: publish(surface, "vendor_price.decided", "price_decision", x!.id, x!.vendorId, REGION_SOUTH) };
  },
  "pos.list": (i: W.ListPurchaseOrdersInput, { p }) => ({ orders: poRows.filter((po) => seesPo(p, po) && (!i.state || po.state === i.state)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(poWire) }),
  "pos.detail": (i: W.PurchaseOrderDetailInput, { p }) => {
    const po = findPo(p, i.poId);
    return {
      order: poWire(po), receivingPoint: receivingPointRows.find((r) => r.id === po.receivingPointId) ?? null, lines: lineStats(po),
      shipments: shipmentRows.filter((s) => s.poId === po.id).map(({ poId: _p, ...s }) => { void _p; return s; }),
      receipts: receiptRows.filter((r) => r.poId === po.id).map(({ poId: _p, ...r }) => { void _p; return r; }),
      invoices: vinvRows.filter((v) => v.poId === po.id), returns: rmaRows.filter((r) => r.poId === po.id),
    };
  },
  "pos.create": (i: W.CreatePurchaseOrderInput, { surface }) => {
    const v = vendorRows.find((x) => x.id === i.vendorId); need(v, `no vendor ${i.vendorId}`, "unknown_vendor");
    const rp = receivingPointRows.find((r) => r.id === i.receivingPointId); need(rp, `no receiving point ${i.receivingPointId}`, "unknown_receiving_point");
    need(Array.isArray(i.lines) && i.lines.length > 0, "lines needs at least one line", "no_lines");
    const lines = i.lines.map((l, n) => {
      const it = itemRows.find((x) => x.id === l.itemId); need(it && it.vendorId === v!.id, `item ${l.itemId} is another vendor's — an order goes to one vendor`, "item_not_vendors");
      const price = accepted(it!.id); need(price, `${it!.vendorSku} has no accepted price today — accept the vendor's proposal first`, "no_accepted_price");
      return { id: uid("pl"), lineNo: n + 1, itemId: it!.id, quantityMilli: digits(l.quantityMilli, "quantityMilli", true).toString(), unitPriceMinor: price!.priceMinor };
    });
    const id = uid("po"); const total = lines.reduce((t, l) => t + amount(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor)), 0n);
    const po: Po = { id, number: `PO-${day(0).replace(/-/g, "")}-${4100 + poRows.length}`, vendorId: v!.id, receivingPointId: rp!.id, regionId: rp!.regionId, state: "draft", currency: "USD", totalMinor: total.toString(), issuedAt: null, acknowledgedAt: null, promisedShipOn: null, createdAt: new Date().toISOString(), lines };
    poRows.push(po);
    return { id, number: po.number, totalMinor: po.totalMinor, eventId: publish(surface, "po.created", "purchase_order", id, v!.id, rp!.regionId) };
  },
  "pos.issue": (i: W.PoIdInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "draft", `order ${po.number} is ${po.state}; only a draft is issued`, "not_draft");
    po.state = "issued"; po.issuedAt = new Date().toISOString();
    return { id: po.id, state: po.state, eventId: publish(surface, "po.issued", "purchase_order", po.id, po.vendorId, po.regionId) };
  },
  "pos.cancel": (i: W.CancelPurchaseOrderInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(["draft", "issued", "acknowledged"].includes(po.state), `order ${po.number} is ${po.state} and cannot be cancelled`, "not_cancellable");
    need(!shipmentRows.some((s) => s.poId === po.id), `order ${po.number} has shipments recorded; receive it and return what is not wanted`, "already_shipped");
    po.state = "cancelled";
    return { id: po.id, state: po.state, eventId: publish(surface, "po.cancelled", "purchase_order", po.id, po.vendorId, po.regionId) };
  },
  "pos.acknowledge": (i: W.AcknowledgePurchaseOrderInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "issued", `order ${po.number} is ${po.state}; an issued order is acknowledged, once`, "not_issued");
    need(i.promisedShipOn >= day(0), `a promised ship date is today or later; ${i.promisedShipOn} has passed`, "ship_date_passed");
    po.state = "acknowledged"; po.acknowledgedAt = new Date().toISOString(); po.promisedShipOn = i.promisedShipOn;
    return { id: po.id, state: po.state, eventId: publish(surface, "po.acknowledged", "po_ack", po.id, po.vendorId, po.regionId) };
  },
  "shipments.record": (i: W.RecordShipmentInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "acknowledged", `order ${po.number} is ${po.state}; a shipment is recorded against an acknowledged order`, "not_acknowledged");
    need((i.carrier ?? "").trim(), "carrier is required", "empty_carrier");
    const stats = lineStats(po);
    for (const l of i.lines) {
      const st = stats.find((x) => x.id === l.poLineId); need(st, `line ${l.poLineId} is not on this purchase order`, "unknown_line");
      need(BigInt(st!.shippedMilli) + digits(l.quantityMilli, "quantityMilli", true) <= BigInt(st!.quantityMilli), `line ${st!.lineNo}: that would ship more than the ${st!.quantityMilli.slice(0, -3) || "0"} ordered`, "shipment_lines_within_order");
    }
    const id = uid("sh"); shipmentRows.push({ id, poId: po.id, shippedOn: i.shippedOn, carrier: i.carrier.trim(), tracking: i.tracking ?? null, lines: i.lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: l.quantityMilli })) });
    return { id, eventId: publish(surface, "po.shipped", "ship_date", id, po.vendorId, po.regionId) };
  },
  "receipts.record": (i: W.RecordReceiptInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(po.state === "acknowledged", `order ${po.number} is ${po.state}; goods are received against an acknowledged order`, "not_acknowledged");
    const stats = lineStats(po); const ids: string[] = [];
    for (const l of i.lines) {
      const st = stats.find((x) => x.id === l.poLineId); need(st, `line ${l.poLineId} is not on this purchase order`, "unknown_line");
      need(BigInt(st!.receivedMilli) + digits(l.quantityMilli, "quantityMilli", true) <= BigInt(st!.quantityMilli), `line ${st!.lineNo}: that would receive more than was ordered`, "po_receipts_within_order");
    }
    for (const l of i.lines) { const id = uid("rc"); ids.push(id); receiptRows.push({ id, poId: po.id, poLineId: l.poLineId, quantityMilli: l.quantityMilli, receivedAt: new Date().toISOString() }); }
    if (lineStats(po).every((l) => BigInt(l.receivedMilli) >= BigInt(l.quantityMilli))) po.state = "received";
    return { ids, state: po.state, eventId: publish(surface, "po.received", "po_receipt", po.id, po.vendorId, po.regionId) };
  },
  "vendorInvoices.submit": (i: W.SubmitVendorInvoiceInput, { p, surface }) => {
    const po = findPo(p, i.poId); need(["acknowledged", "received"].includes(po.state), `order ${po.number} is ${po.state}; an invoice is submitted against an acknowledged or received order`, "not_invoiceable");
    need((i.invoiceNumber ?? "").trim(), "invoiceNumber is required", "empty_invoice_number");
    need(!vinvRows.some((v) => v.vendorId === po.vendorId && v.invoiceNumber === i.invoiceNumber.trim()), `invoice ${i.invoiceNumber} was already submitted`, "vendor_invoices_vendor_id_invoice_number_key");
    const stats = lineStats(po);
    const lines = i.lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: digits(l.quantityMilli, "quantityMilli", true), unitPriceMinor: digits(l.unitPriceMinor, "unitPriceMinor") }));
    for (const l of lines) need(stats.some((s) => s.id === l.poLineId), `line ${l.poLineId} is not on order ${po.number}`, "unknown_line");
    const verdict = threeWayMatch(stats.map((s) => ({ poLineId: s.id, lineNo: s.lineNo, unitPriceMinor: BigInt(s.unitPriceMinor), receivedMilli: BigInt(s.receivedMilli), invoicedMilli: BigInt(s.invoicedMilli) })), lines);
    const wl = lines.map((l) => ({ poLineId: l.poLineId, quantityMilli: l.quantityMilli.toString(), unitPriceMinor: l.unitPriceMinor.toString(), amountMinor: amount(l.quantityMilli, l.unitPriceMinor).toString() }));
    const total = wl.reduce((t, l) => t + BigInt(l.amountMinor), 0n).toString();
    const id = uid("vi");
    vinvRows.unshift({ id, poId: po.id, poNumber: po.number, vendorId: po.vendorId, invoiceNumber: i.invoiceNumber.trim(), invoiceDate: i.invoiceDate, totalMinor: total, currency: "USD", matchState: verdict.state, matchNotes: [...verdict.notes], createdAt: new Date().toISOString(), lines: wl });
    return { id, matchState: verdict.state, matchNotes: verdict.notes, totalMinor: total, eventId: publish(surface, "vendor_invoice.submitted", "vendor_invoice", id, po.vendorId, po.regionId) };
  },
  "vendorInvoices.list": (i: W.ListVendorInvoicesInput, { p }) => ({ invoices: vinvRows.filter((v) => (p.namespace === "internal" || v.vendorId === vendorOf(p)) && (!i.poId || v.poId === i.poId)) }),
  "rmas.request": (i: W.RequestReturnInput, { p, surface }) => {
    const po = findPo(p, i.poId); const st = lineStats(po).find((l) => l.id === i.poLineId); need(st, `line ${i.poLineId} is not on order ${po.number}`, "unknown_line");
    need((i.reason ?? "").trim(), "reason is required", "empty_reason");
    need(BigInt(st!.returnedMilli) + digits(i.quantityMilli, "quantityMilli", true) <= BigInt(st!.receivedMilli), `line ${st!.lineNo}: more than was received`, "rmas_within_order");
    const id = uid("rm"); rmaRows.unshift({ id, poId: po.id, poNumber: po.number, poLineId: i.poLineId, vendorId: po.vendorId, quantityMilli: i.quantityMilli, reason: i.reason.trim(), state: "requested", rmaNumber: null, vendorNote: null, createdAt: new Date().toISOString(), respondedAt: null });
    return { id, eventId: publish(surface, "rma.requested", "rma_request", id, po.vendorId, po.regionId) };
  },
  "rmas.respond": (i: W.RespondToReturnInput, { p, surface }) => {
    const r = rmaRows.find((x) => x.id === i.rmaId && x.vendorId === vendorOf(p)); need(r, `no return ${i.rmaId} visible in this scope`, "unknown_rma");
    need(r!.state === "requested", `this return is already ${r!.state}; a vendor answers a request once`, "already_answered");
    if (i.decision === "authorized") need((i.rmaNumber ?? "").trim(), "an authorized return carries your RMA number", "rma_number_required");
    else need((i.note ?? "").trim(), "a rejected return says why", "note_required");
    r!.state = i.decision; r!.rmaNumber = i.decision === "authorized" ? i.rmaNumber!.trim() : null; r!.vendorNote = i.note?.trim() || null; r!.respondedAt = new Date().toISOString();
    return { id: r!.id, state: r!.state, eventId: publish(surface, "rma.responded", "rma", r!.id, r!.vendorId, REGION_SOUTH) };
  },
  "rmas.list": (i: W.ListReturnsInput, { p }) => ({ returns: rmaRows.filter((r) => (p.namespace === "internal" || r.vendorId === vendorOf(p)) && (!i.poId || r.poId === i.poId)) }),
};
Object.assign(H, proc);
const replayed = new Set<string>();

const recordCredential = (i: W.RecordCredentialInput, surface: SurfaceId) => {
  need((i.identifier ?? "").trim(), "identifier is empty", "empty_identifier");
  need(i.validFrom && i.validTo && i.validFrom <= i.validTo, `${i.kind} ${i.identifier} is valid from ${i.validFrom} to ${i.validTo} — a window that ends before it starts covers no day at all`, "empty_window");
  const crew = crews.find((c) => c.id === i.crewId);
  need(crew, `no crew ${i.crewId} visible in this scope`, "unknown_crew");
  const id = uid("d");
  credentials.push({ id, crewId: i.crewId, kind: i.kind, identifier: i.identifier.trim(), validFrom: i.validFrom, validTo: i.validTo, documentKey: i.documentKey ?? null, verifiedAt: null, verifiedBy: null });
  return { id, eventId: publish(surface, "credential.recorded", "crew_credential", id, crew!.firmId ?? INTERNAL_ORG_ID, crew!.homeRegionId) };
};

// ---------------------------------------------------------------------------
// The wire. `handle` is what a surface frame's fetch reaches, by postMessage.
// ---------------------------------------------------------------------------
const ROUTES = new Map(Object.values(OPERATIONS).map((op) => [routeKey(op), op]));
export type WireRequest = { surface: SurfaceId; url: string; method: string; headers: Record<string, string>; body?: string };
export type WireResponse = { status: number; body: unknown };

let offline = false;
export const setOffline = (v: boolean) => { offline = v; };
export const isOffline = () => offline;

const sessionFor = (req: WireRequest): Session | null => {
  const auth = req.headers["authorization"] ?? "";
  if (auth.startsWith("Bearer ")) return bearerSessions.get(auth.slice(7)) ?? null;
  return cookieSessions.get(req.surface) ?? null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a log line reads whatever shape came back
const noteOf = (id: OperationId, input: any, out: any): string => {
  if (id === "auth.login" || id === "auth.deviceLogin") return `as ${input?.email ?? "?"}`;
  if (id === "session.me") return "who is signed in, and where they sit in the hierarchy";
  if (id === "pos.detail") return `${out.order.number}: ${out.lines.length} line${out.lines.length === 1 ? "" : "s"}, ${out.order.state}`;
  if (typeof out?.number === "string") return `→ ${out.number}`;
  if (id === "hq.metrics") return `${out.values.length} figures across ${out.regions.length} regions`;
  if (id === "hq.history") return `${input?.metric}: ${out.points.length} daily points`;
  if (out && typeof out === "object") {
    for (const k of ["nodes", "jobs", "crews", "firms", "contracts", "settlements", "credentials", "requests", "candidates", "rateCards", "regions", "organizations", "metros", "equipment", "contacts", "invoices", "lines", "outcomes"]) {
      if (Array.isArray(out[k])) return `${out[k].length} row${out[k].length === 1 ? "" : "s"}`;
    }
    if (out.ok === false && out.refusal) return `refused: ${out.refusal.reason} ${out.refusal.credentialKind}`;
    if (typeof out.id === "string") return `→ ${out.id.slice(0, 8)}`;
  }
  return "";
};

export const handle = async (req: WireRequest): Promise<WireResponse | "offline"> => {
  const url = new URL(req.url);
  const op = ROUTES.get(`${req.method} ${url.pathname}`);
  if (offline && op?.id !== "events.stream") { log({ surface: req.surface, op: op?.id ?? url.pathname, status: 0, note: "gateway unreachable", kind: "offline" }); return "offline"; }
  if (!op) return { status: 404, body: { error: "NoRoute", message: `no route ${req.method} ${url.pathname}` } };
  if (!(op.surfaces as readonly string[]).includes(req.surface)) return { status: 403, body: { error: "SurfaceNotServed", message: `${op.id} is not served to ${req.surface}` } };
  const input = op.carrier === "body" ? (req.body ? JSON.parse(req.body) : {}) : op.carrier === "query" ? Object.fromEntries(url.searchParams) : undefined;

  try {
    let out: unknown;
    if (op.id === "auth.login" || op.id === "auth.deviceLogin") {
      const i = input as { email: string; password: string; hardwareId?: string };
      const user = users.find((u) => u.email.toLowerCase() === (i.email ?? "").trim().toLowerCase() && u.password === i.password && u.surfaces.includes(req.surface));
      if (!user || (op.id === "auth.deviceLogin" && i.hardwareId?.trim() !== devices[0]!.hardwareId)) throw new Refused(401, "AuthError", "invalid credentials", "invalid_credentials");
      const s = mint(user);
      if (op.id === "auth.deviceLogin") bearerSessions.set(s.token, s); else cookieSessions.set(req.surface, s);
      const ctx = await buildContext(principalOf(s), reader);
      const crew = user.crewId ? crews.find((c) => c.id === user.crewId)! : null;
      out = { token: s.token, expiresAt: at(8 * HOUR), context: { path: ctx.path, parent: ctx.parent, regions: ctx.regions, activeRegionId: ctx.activeRegionId }, ...(crew ? { crewId: crew.id, crewLabel: crew.label } : {}) };
    } else if (op.id === "auth.anonymousSession") {
      out = { token: `demo.anon.${uid("t")}`, expiresAt: at(15 * MIN) };
    } else if (op.id === "auth.logout") {
      const s = sessionFor(req);
      if (!s) throw new Refused(401, "AuthError", "no session", "missing");
      if (bearerSessions.has(s.token)) bearerSessions.delete(s.token); else cookieSessions.delete(req.surface);
      out = { ok: true, sessionId: s.id };
    } else {
      const h = H[op.id];
      if (!h) return { status: 404, body: { error: "NoRoute", message: `${op.id} is not in the demo gateway` } };
      let ctx: Ctx;
      if (op.auth === "bearer" && req.surface !== "S1") {
        const s = sessionFor(req);
        if (!s) throw new Refused(401, "AuthError", "no session — sign in", "missing");
        ctx = { surface: req.surface, p: principalOf(s), session: s };
      } else {
        ctx = { surface: req.surface, p: { namespace: "anonymous", subjectId: ANONYMOUS_PRINCIPAL_IDS.actor, orgId: ANONYMOUS_PRINCIPAL_IDS.org, regionId: ANONYMOUS_PRINCIPAL_IDS.region, scopeTier: "parent", scopeId: ANONYMOUS_PRINCIPAL_IDS.org, roles: [], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "anon" }, session: null };
      }
      out = await h(input, ctx);
    }
    const kind = op.kind === "mutation" || op.kind === "login" ? "write" : "read";
    if (op.id !== "system.health" && op.id !== "brand.theme") log({ surface: req.surface, op: op.id, status: 200, note: noteOf(op.id, input, out), kind: (out as { ok?: boolean })?.ok === false ? "refused" : kind });
    return { status: 200, body: out };
  } catch (e) {
    if (e instanceof Refused) {
      log({ surface: req.surface, op: op.id, status: e.status, note: e.code ?? e.message.slice(0, 60), kind: "refused" });
      return { status: e.status, body: { error: e.name2, code: e.code, message: e.message } };
    }
    if (e instanceof AdmissionRefused) {
      log({ surface: req.surface, op: op.id, status: 422, note: e.code, kind: "refused" });
      return { status: 422, body: { error: "AdmissionRefused", code: e.code, message: e.message } };
    }
    console.error(e);
    return { status: 500, body: { error: "InternalError", message: String((e as Error).message) } };
  }
};

/** An SSE subscription: the frame keeps its stream open; the gateway pushes envelopes to it. */
export const subscribe = (surface: SurfaceId, push: (e: EventEnvelope) => void): (() => void) => {
  const l = { surface, push };
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The demo's persona switch: replace the surface's cookie session, as a sign-in would. */
export const signInAs = (surface: SurfaceId, email: string): void => {
  const user = users.find((u) => u.email === email && u.surfaces.includes(surface));
  if (user) cookieSessions.set(surface, mint(user));
};
export const signedInAs = (surface: SurfaceId): string | null => cookieSessions.get(surface)?.user.email ?? null;
