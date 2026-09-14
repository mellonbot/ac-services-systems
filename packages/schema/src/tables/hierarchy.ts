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
 * Equipment lives at the site. Diagnostic history keys off this, which is the
 * raw material of the Phase 4 data moat — hence org_id/region_id here too.
 */
export const equipment = operationalTable("equipment", {
  columns: [
    { name: "site_id", type: "uuid", references: "accounts(id)" },
    { name: "manufacturer_id", type: "uuid", nullable: true, references: "part_manufacturers(id)" },
    { name: "model", type: "text" },
    { name: "serial", type: "text", nullable: true },
    { name: "installed_on", type: "date", nullable: true },
    { name: "tonnage_milli", type: "integer", nullable: true, comment: "Integer thousandths of a ton." },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["site_id"], ["serial"]],
});
