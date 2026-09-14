import type { Tier } from "../../../../contracts/src/tiers.ts";
import type { Override, ScopePath } from "../resolve.ts";

/**
 * AMPED FITNESS — the signed MSA hand-modelled, as data. This is the fixture
 * the D2 findings were found against (claude/07_D2_Hierarchy_Findings.md) and
 * the one the M2 gate ("a synthetic 50-location parent inherits correctly")
 * extends. Every finding is a row below, and every row below has a test.
 *
 * Tree (customer tree meets OUR service regions):
 *
 *   Amped Fitness Inc.                          parent (organization)
 *   ├── Amped / West           (our WEST)       region
 *   │   ├── Amped San Jose                      location    customer_group: "Pacific"
 *   │   │   └── San Jose — Roof Units           site
 *   │   └── Amped Reno                          location    customer_group: "Pacific"
 *   ├── Amped / Mountain       (our MOUNTAIN)   region
 *   │   └── Amped Boulder                       location    customer_group: "Mountain"
 *   │       ├── Boulder — Roof Units            site        Carrier warranty attaches HERE
 *   │       └── Boulder — Basement AHU          site        ...and not here
 *   └── Amped / South          (our SOUTH)      region
 *       ├── Amped El Paso                       location    customer_group: "Mountain"  ← finding 5
 *       └── Amped Austin                        location    customer_group: "Texas"
 */
export const ORG = "a0000000-0000-0000-0000-000000000001";
export const REGION_WEST = "a0000000-0000-0000-0000-00000000000a";
export const REGION_MOUNTAIN = "a0000000-0000-0000-0000-00000000000b";
export const REGION_SOUTH = "a0000000-0000-0000-0000-00000000000c";

export const N = {
  west: "a0000000-0000-0000-0000-000000000010",
  mountain: "a0000000-0000-0000-0000-000000000011",
  south: "a0000000-0000-0000-0000-000000000012",
  sanJose: "a0000000-0000-0000-0000-000000000020",
  reno: "a0000000-0000-0000-0000-000000000021",
  boulder: "a0000000-0000-0000-0000-000000000022",
  elPaso: "a0000000-0000-0000-0000-000000000023",
  austin: "a0000000-0000-0000-0000-000000000024",
  sanJoseRoof: "a0000000-0000-0000-0000-000000000030",
  boulderRoof: "a0000000-0000-0000-0000-000000000031",
  boulderAhu: "a0000000-0000-0000-0000-000000000032",
} as const;

export type Node = { readonly id: string; readonly tier: Tier; readonly name: string; readonly parent: string | null; readonly serviceRegion: string; readonly customerGroup?: string };

export const NODES: readonly Node[] = [
  { id: ORG, tier: "parent", name: "Amped Fitness Inc.", parent: null, serviceRegion: "-" },
  { id: N.west, tier: "region", name: "Amped / West", parent: ORG, serviceRegion: REGION_WEST },
  { id: N.mountain, tier: "region", name: "Amped / Mountain", parent: ORG, serviceRegion: REGION_MOUNTAIN },
  { id: N.south, tier: "region", name: "Amped / South", parent: ORG, serviceRegion: REGION_SOUTH },
  { id: N.sanJose, tier: "location", name: "Amped San Jose", parent: N.west, serviceRegion: REGION_WEST, customerGroup: "Pacific" },
  { id: N.reno, tier: "location", name: "Amped Reno", parent: N.west, serviceRegion: REGION_WEST, customerGroup: "Pacific" },
  { id: N.boulder, tier: "location", name: "Amped Boulder", parent: N.mountain, serviceRegion: REGION_MOUNTAIN, customerGroup: "Mountain" },
  { id: N.elPaso, tier: "location", name: "Amped El Paso", parent: N.south, serviceRegion: REGION_SOUTH, customerGroup: "Mountain" },
  { id: N.austin, tier: "location", name: "Amped Austin", parent: N.south, serviceRegion: REGION_SOUTH, customerGroup: "Texas" },
  { id: N.sanJoseRoof, tier: "site", name: "San Jose — Roof Units", parent: N.sanJose, serviceRegion: REGION_WEST },
  { id: N.boulderRoof, tier: "site", name: "Boulder — Roof Units", parent: N.boulder, serviceRegion: REGION_MOUNTAIN },
  { id: N.boulderAhu, tier: "site", name: "Boulder — Basement AHU", parent: N.boulder, serviceRegion: REGION_MOUNTAIN },
];

export const pathOf = (tier: Tier, id: string): ScopePath => {
  const out: { tier: Tier; id: string; name: string }[] = [];
  let cur = NODES.find((n) => n.id === id && n.tier === tier);
  while (cur) {
    out.unshift({ tier: cur.tier, id: cur.id, name: cur.name });
    cur = cur.parent === null ? undefined : NODES.find((n) => n.id === cur!.parent);
  }
  if (out.length === 0) throw new Error(`no node ${tier}:${id}`);
  return out;
};

export const MSA = "c0000000-0000-0000-0000-000000000001";
export const AMEND_SJ = "c0000000-0000-0000-0000-000000000002";
export const AMEND_AUSTIN_JULY = "c0000000-0000-0000-0000-000000000003";
export const BOULDER_WARRANTY = "c0000000-0000-0000-0000-000000000004";

const row = (id: string, contractId: string, scopeTier: Tier, scopeId: string, termKey: string, termValue: unknown, effectiveFrom: string, effectiveTo: string | null = null): Override =>
  ({ id, contractId, scopeTier, scopeId, termKey, termValue, effectiveFrom, effectiveTo });

/** The rows as they legally stand. Every one admits. */
export const OVERRIDES: readonly Override[] = [
  // MSA at the parent, signed 2026-01-01
  row("o-001", MSA, "parent", ORG, "payment_terms_days", 45, "2026-01-01"),
  row("o-002", MSA, "parent", ORG, "billing_rollup_tier", "parent", "2026-01-01"),
  row("o-003", MSA, "parent", ORG, "sla_response", "same_day", "2026-01-01"),
  row("o-004", MSA, "parent", ORG, "sla_credit_pct", 10, "2026-01-01"),
  row("o-005", MSA, "parent", ORG, "pm_visits_per_year", 2, "2026-01-01"),
  row("o-006", MSA, "parent", ORG, "labor_rate_minor", "14500", "2026-01-01"),
  row("o-007", MSA, "parent", ORG, "diagnostic_data_rights_reserved", true, "2026-01-01"),
  // Finding 2, the legal direction: San Jose tightens same-day to 4-hour
  row("o-010", AMEND_SJ, "location", N.sanJose, "sla_response", "4_hour", "2026-03-01"),
  // Not-a-finding: Austin's after-hours multiplier rises on 1 July. Two rows, no overlap.
  row("o-020", MSA, "location", N.austin, "after_hours_multiplier_milli", 1500, "2026-01-01", "2026-07-01"),
  row("o-021", AMEND_AUSTIN_JULY, "location", N.austin, "after_hours_multiplier_milli", 1750, "2026-07-01"),
  // Finding 3: Carrier warranty attaches to the roof units and stops there
  row("o-030", BOULDER_WARRANTY, "site", N.boulderRoof, "vendor_warranty", "Carrier 58-month parts, PO 88213", "2026-02-15"),
  // Boulder buys extra PM visits (stricter = higher): legal
  row("o-040", MSA, "location", N.boulder, "pm_visits_per_year", 4, "2026-01-01"),
];

/** The rows the findings say must be REFUSED. Each has a test asserting it is. */
export const ILLEGAL = {
  /** Finding 1: a location setting its own payment terms. */
  locationPaymentTerms: row("x-001", AMEND_SJ, "location", N.elPaso, "payment_terms_days", 30, "2026-04-01"),
  /** Finding 2, the illegal direction: Reno relaxing to 48-hour. */
  renoLoosensSla: row("x-002", AMEND_SJ, "location", N.reno, "sla_response", "48_hour", "2026-04-01"),
  /** Finding 4: a second Boulder SLA-credit amendment overlapping the first. */
  boulderCreditA: row("x-003", "c0000000-0000-0000-0000-000000000010", "location", N.boulder, "sla_credit_pct", 8, "2026-05-01", "2026-12-31"),
  boulderCreditB: row("x-004", "c0000000-0000-0000-0000-000000000011", "location", N.boulder, "sla_credit_pct", 5, "2026-07-01", null),
  /** Finding 3, the other side: warranty cannot be set at the location to cover both sites. */
  warrantyAtLocation: row("x-005", BOULDER_WARRANTY, "location", N.boulder, "vendor_warranty", "Carrier 58-month", "2026-02-15"),
  /** Money as a JSON number. */
  laborRateAsNumber: row("x-006", MSA, "region", N.south, "labor_rate_minor", 15500, "2026-01-01"),
  /** Tightening above an existing looser row: parent PM visits raised to 6 when Boulder has 4. */
  parentPmVisitsAbove: row("x-007", MSA, "parent", ORG, "pm_visits_per_year", 6, "2026-09-01"),
} as const;
