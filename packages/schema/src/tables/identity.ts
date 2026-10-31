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
    // 0032 — what a person sets about themselves from the Account button.
    { name: "presence", type: "text", default: "'available'", check: "presence IN ('available','busy','away','off')" },
    { name: "status_note", type: "text", nullable: true, check: "char_length(status_note) <= 80" },
    { name: "avatar", type: "bytea", nullable: true, check: "octet_length(avatar) <= 65536", comment: "A small square JPEG or PNG the browser scaled before sending." },
    { name: "avatar_type", type: "text", nullable: true, check: "avatar_type IN ('image/jpeg','image/png')" },
    { name: "password_changed_at", type: "timestamptz", nullable: true },
    // 0038 — an office-issued temporary password: true until the person sets their own at sign-in.
    { name: "must_change_password", type: "boolean", default: "false" },
  ],
  indexes: [["namespace", "email"], ["firm_id"], ["scope_tier", "scope_id"]],
  uniques: [["email"]],
  constraints: [
    { name: "users_subcontractor_have_firm", sql: "CHECK ((namespace = 'subcontractor') = (firm_id IS NOT NULL))" },
    { name: "users_avatar_has_type", sql: "CHECK ((avatar IS NULL) = (avatar_type IS NULL))" },
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

/**
 * 0035 — a message from one company person to another, or to every active
 * company login. The row is the sender's: their org and home region. A
 * customer, a vendor and a firm are not senders and not recipients.
 * `recipient_id` is set only for a direct message; an everyone message names
 * nobody, and the copies live in staff_message_receipts.
 */
export const staff_messages = operationalTable("staff_messages", {
  columns: [
    { name: "sender_id", type: "uuid", references: "users(id)" },
    { name: "audience", type: "text", check: "audience IN ('direct','everyone')" },
    { name: "recipient_id", type: "uuid", nullable: true, references: "users(id)" },
    { name: "body", type: "text", check: "length(btrim(body)) BETWEEN 1 AND 2000" },
  ],
  indexes: [["sender_id", "created_at"]],
  constraints: [{ name: "staff_messages_direct_names_one", sql: "CHECK ((audience = 'direct') = (recipient_id IS NOT NULL))" }],
});

/** One copy of a staff message, for the person it was sent to. Dismissing it is the only change the row ever takes. */
export const staff_message_receipts = operationalTable("staff_message_receipts", {
  columns: [
    { name: "message_id", type: "uuid", references: "staff_messages(id)" },
    { name: "user_id", type: "uuid", references: "users(id)" },
    { name: "dismissed_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["user_id", "dismissed_at"], ["message_id"]],
  uniques: [["message_id", "user_id"]],
});
