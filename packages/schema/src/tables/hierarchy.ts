import { operationalTable } from "../tenancy.ts";

/**
 * NON-NEGOTIABLE #1 — the four-tier hierarchy. D2 closed in three parts:
 *
 *   1. Four tiers: parent → region → location → site.
 *   2. Terms carry a policy (packages/contracts/src/terms.ts).
 *   3. `region_id` is OUR service region, never the customer's grouping.
 *
 * The PARENT tier is not in this table. It is the `organizations` row — a
 * tenancy root, above the region boundary, because a customer parent spans our
 * regions by definition. Putting it here would force a region_id onto a node
 * that has none, and the only ways to do that are a nullable column (the end of
 * the shard key) or a fake "home region" (a lie the resolver has to know about).
 *
 * The REGION node is where a customer's tree meets one of our service regions:
 * "Amped / South". Its region_id is that region. Every location and site under
 * it inherits the SAME region_id — enforced by trigger in migrations/0002, so
 * a location cannot be moved under a different region node without its shard
 * key moving with it. region_id derives from the parent edge and nothing else.
 *
 * The customer's own administrative grouping — their "Mountain" region, their
 * AP contact's territory — is `customer_group`. Reportable, invoice-groupable,
 * filterable. Never a foreign key into `regions`, never the parent edge, never
 * the shard key. A customer reorganising their org chart edits a text column;
 * it does not reshard our database.
 */
export const accounts = operationalTable("accounts", {
  columns: [
    {
      name: "parent_id", type: "uuid", nullable: true, references: "accounts(id)",
      comment: "NULL only for tier='region' (whose parent is the organization). Trigger-enforced.",
    },
    { name: "tier", type: "text", check: "tier IN ('region','location','site')" },
    { name: "name", type: "text" },
    {
      name: "customer_group", type: "text", nullable: true,
      comment: "The customer's OWN grouping. An attribute, never structural. Finding 5.",
    },
    { name: "external_ref", type: "text", nullable: true, comment: "Customer's site/store code, for their AP allocation." },
    { name: "address", type: "jsonb", nullable: true },
    { name: "timezone", type: "text", nullable: true, comment: "IANA. SLA business-hours maths needs the site's clock, not the server's." },
    { name: "active", type: "boolean", default: "true" },
    {
      name: "path", type: "uuid[]", default: "'{}'",
      comment: "Ancestor ids, region node first, this node last. Maintained by trigger from parent_id; never written by hand. What RLS's customer-scope check reads, so scoping is an array test, not a recursive query under RLS.",
    },
  ],
  indexes: [["parent_id"], ["tier"], ["org_id", "tier"], ["customer_group"]],
  constraints: [
    { name: "accounts_region_has_no_parent", sql: "CHECK ((tier = 'region') = (parent_id IS NULL))" },
  ],
});

/**
 * The kinds of unit a site carries. A closed list so the site card can count
 * "3 RTU, 1 AHU" rather than free text nobody can group; `other` is the
 * designed home for what the list has not met yet, and widening it is a
 * reviewed diff here rather than a new spelling in a text column.
 */
export const EQUIPMENT_KINDS = [
  "rtu", "split", "package", "ahu", "chiller", "boiler", "heat_pump", "mini_split", "vrf", "exhaust", "mau", "controls", "other",
] as const;

/**
 * Equipment lives at the site. Diagnostic history keys off this, which is the
 * raw material of the Phase 4 data moat — hence org_id/region_id here too.
 *
 * Item 9 (the S6 site card) added `kind` and `label`: what a facility
 * manager calls the unit ("RTU-3, north roof") and which shelf of the count
 * it sits on. "Last serviced" is NOT a column — it is derived from the jobs
 * that named the unit (`job_equipment`), so it cannot drift from the work.
 */
export const equipment = operationalTable("equipment", {
  columns: [
    { name: "site_id", type: "uuid", references: "accounts(id)" },
    { name: "manufacturer_id", type: "uuid", nullable: true, references: "part_manufacturers(id)" },
    { name: "kind", type: "text", check: `kind IN (${EQUIPMENT_KINDS.map((k) => `'${k}'`).join(",")})`, default: "'other'" },
    { name: "label", type: "text", nullable: true, comment: "The customer's own tag for the unit — 'RTU-3', 'North roof unit'. Free text; the kind is the closed list." },
    { name: "model", type: "text" },
    { name: "serial", type: "text", nullable: true },
    { name: "installed_on", type: "date", nullable: true },
    { name: "tonnage_milli", type: "integer", nullable: true, comment: "Integer thousandths of a ton." },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["site_id"], ["serial"]],
});

/**
 * Which units a job was about. A PM visit touches several; a repair usually
 * one. Written when the office opens the job (jobs.create `equipmentIds`) —
 * the field layer stamping a unit from the roof is S5's follow-up, not a
 * column. The site card's "last serviced" for a unit is the latest completed
 * job that names it here, and nothing else: no stored date to fall behind.
 */
export const job_equipment = operationalTable("job_equipment", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "equipment_id", type: "uuid", references: "equipment(id)" },
  ],
  indexes: [["equipment_id"]],
  uniques: [["job_id", "equipment_id"]],
});

export const CONTACT_ROLES = ["site_manager", "facilities", "accounts_payable", "security", "other"] as const;

/**
 * The people at a node. The customer's on-site manager, their AP contact,
 * the security desk that lets a crew onto the roof at 2 a.m. Hangs off any
 * tier — a contact recorded at the location is the contact for every site
 * under it that does not name its own. Visible under the node's own rule, so
 * a facility manager reads their own and their location's, and nothing beside.
 */
export const account_contacts = operationalTable("account_contacts", {
  columns: [
    { name: "account_id", type: "uuid", references: "accounts(id)" },
    { name: "role", type: "text", check: `role IN (${CONTACT_ROLES.map((r) => `'${r}'`).join(",")})`, default: "'site_manager'" },
    { name: "name", type: "text" },
    { name: "phone", type: "text", nullable: true },
    { name: "email", type: "text", nullable: true },
    { name: "note", type: "text", nullable: true, comment: "Hours, gate code holder, 'call before 7am' — what a crew needs to know to reach them." },
    { name: "is_primary", type: "boolean", default: "false" },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["account_id"]],
});
