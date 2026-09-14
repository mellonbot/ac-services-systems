import { operationalTable } from "../tenancy.ts";

/**
 * IDENTITY. Every principal the gateway will ever mint a token for is a row
 * here, in exactly one namespace, with a scope node in the hierarchy. The
 * token carries these columns as claims; the gateway resolves the rest.
 *
 * Internal staff: org = INTERNAL_ORG, region = home region, scope = the node
 *   they may see (a dispatcher: their region; ops leadership: the org).
 * Customer users: org = the customer's organization, scope = the tier node
 *   their IdP tier claim maps to (executive → parent, regional manager →
 *   region, facility manager → location).
 * Subcontractor users: org = the firm's organization, firm_id set.
 * Devices are NOT users. They are `devices` with a shift grant.
 */
export const users = operationalTable("users", {
  columns: [
    { name: "namespace", type: "text", check: "namespace IN ('internal','customer','subcontractor','vendor')" },
    { name: "email", type: "text" },
    { name: "display_name", type: "text" },
    { name: "roles", type: "jsonb", default: "'[]'::jsonb" },
    { name: "scope_tier", type: "text", check: "scope_tier IN ('parent','region','location','site')" },
    { name: "scope_id", type: "uuid" },
    { name: "firm_id", type: "uuid", nullable: true, references: "subcontractor_firms(id)" },
    { name: "crew_id", type: "uuid", nullable: true, references: "crews(id)", comment: "A technician user is a member of a crew." },
    { name: "external_idp_subject", type: "text", nullable: true, comment: "Customer IdP subject — S6 federates, it does not hold passwords." },
    { name: "password_hash", type: "text", nullable: true, comment: "scrypt, internal + subcontractor only." },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["namespace", "email"], ["firm_id"], ["scope_tier", "scope_id"]],
  uniques: [["email"]],
  constraints: [
    { name: "users_subcontractor_have_firm", sql: "CHECK ((namespace = 'subcontractor') = (firm_id IS NOT NULL))" },
  ],
});

/** A physical field device — commodity rugged Android in the pilot, the Yocto tablet after. */
export const devices = operationalTable("devices", {
  columns: [
    { name: "hardware_id", type: "text" },
    { name: "kind", type: "text", check: "kind IN ('android_pilot','yocto_tablet','web_fallback')" },
    { name: "public_key", type: "bytea", comment: "Device-held key; the shift grant is bound to it." },
    { name: "firm_id", type: "uuid", nullable: true, references: "subcontractor_firms(id)", comment: "Hardware the firm already owns (D-2a). Provisioning is a credential grant, not a shipment." },
    { name: "active", type: "boolean", default: "true" },
  ],
  indexes: [["hardware_id"]],
  uniques: [["hardware_id"]],
});

/**
 * The shift grant: this device, this crew, this window. S5's principal is a
 * grant, not a person — a technician's token expires with the shift, which is
 * what makes a lost tablet a bounded problem.
 */
export const device_grants = operationalTable("device_grants", {
  columns: [
    { name: "device_id", type: "uuid", references: "devices(id)" },
    { name: "crew_id", type: "uuid", references: "crews(id)" },
    { name: "technician_id", type: "uuid", references: "users(id)" },
    { name: "service_window", type: "tstzrange" },
    { name: "granted_by", type: "uuid" },
    { name: "revoked_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["device_id"], ["crew_id"]],
});

/** Server-side session record: a token is only valid while its session row is not revoked. */
export const sessions = operationalTable("sessions", {
  columns: [
    { name: "principal_kind", type: "text", check: "principal_kind IN ('user','device_grant','anonymous')" },
    { name: "principal_id", type: "uuid" },
    { name: "issued_at", type: "timestamptz", default: "now()" },
    { name: "expires_at", type: "timestamptz" },
    { name: "revoked_at", type: "timestamptz", nullable: true },
    { name: "surface_id", type: "text" },
  ],
  indexes: [["principal_id"], ["expires_at"]],
});
