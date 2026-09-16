import { operationalTable, globalReferenceTable } from "../tenancy.ts";

/**
 * NON-NEGOTIABLE #4. Written INSIDE the same transaction as the change it
 * describes, by the only object that can write at all (apps/gateway
 * unit-of-work). No update or delete method exists on the interface; the
 * runtime roles hold INSERT+SELECT only; a trigger raises regardless of role.
 * Three layers, because the interface is the one an ORM can be talked past.
 */
export const audit_log = operationalTable("audit_log", {
  columns: [
    { name: "event_id", type: "uuid", comment: "Shared with the outbox row written in the same transaction. One id, two tables, one fact." },
    { name: "actor_id", type: "uuid" },
    { name: "surface_id", type: "text" },
    { name: "session_id", type: "uuid", nullable: true },
    { name: "request_id", type: "text", nullable: true },
    { name: "action", type: "text" },
    { name: "entity", type: "text" },
    { name: "entity_id", type: "uuid" },
    { name: "before", type: "jsonb", nullable: true },
    { name: "after", type: "jsonb", nullable: true },
    { name: "occurred_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["entity", "entity_id"], ["occurred_at"], ["actor_id"]],
  uniques: [["event_id"]],
});

/**
 * TRANSACTIONAL OUTBOX. Events are written here in the same transaction as
 * the state change; apps/worker relays them. The alternative — publish inside
 * the handler — produces the two failures that cannot be debugged six months
 * later: an event for a transaction that rolled back, and a committed change
 * with no event because the broker blinked.
 */
export const outbox = operationalTable("outbox", {
  columns: [
    { name: "event_id", type: "uuid" },
    { name: "topic", type: "text" },
    { name: "entity", type: "text" },
    { name: "entity_id", type: "uuid" },
    { name: "payload", type: "jsonb" },
    { name: "actor_id", type: "uuid" },
    { name: "surface_id", type: "text" },
    { name: "occurred_at", type: "timestamptz", default: "now()" },
    { name: "published_at", type: "timestamptz", nullable: true },
    { name: "attempts", type: "integer", default: "0" },
  ],
  indexes: [["published_at", "occurred_at"], ["topic"]],
  uniques: [["event_id"]],
});

/** Subscriber cursors — a block that restarts resumes where it stopped. */
export const subscriptions = operationalTable("subscriptions", {
  columns: [
    { name: "subscriber", type: "text" },
    { name: "topic", type: "text" },
    { name: "last_event_id", type: "uuid", nullable: true },
    { name: "last_occurred_at", type: "timestamptz", nullable: true },
  ],
  uniques: [["subscriber", "topic", "region_id"]],
});

/**
 * A TENANT'S WHITE-LABEL, STORED.
 *
 * The theme is validated BEFORE it becomes a row — that is the whole shape of
 * the feature, and the reason it is a write through the unit of work rather
 * than a config file: the theme that satisfies a brand team and the theme that
 * breaks the portal are separated by one check, and the check has to run
 * somewhere a designer cannot skip. packages/tokens validateBrandTheme runs in
 * apps/gateway/src/handlers/brand.ts; a theme that fails is a 422 with the
 * ratio and never reaches this table.
 *
 * `host` is the lookup key and the unique, because the browser that asks for a
 * theme has not authenticated yet: it can say where it is, not whose it is.
 * `org_id` is unique too — a tenant has ONE theme, not one per region.
 * region_id is the shard key here and nothing more; it does not mean a tenant
 * may look different in Texas.
 *
 * The admission verdict is stored beside the theme rather than recomputed at
 * read: the accent gate's answer is what an account manager was shown when
 * they saved, and a stored answer is one an argument six months later can be
 * held against.
 */
export const brand_themes = operationalTable("brand_themes", {
  columns: [
    { name: "host", type: "text", comment: "The portal hostname this theme answers for. Lowercased by the handler; the unique is what makes the lookup unambiguous." },
    { name: "accent", type: "text", comment: "The tenant's brand colour. Gated separately from the slots — see accent_admission." },
    { name: "overrides", type: "jsonb", comment: "Accent slots only. A key outside packages/tokens BRAND_OVERRIDABLE is refused by the handler before the insert." },
    { name: "accent_admission", type: "jsonb", comment: "admitAccent()'s verdict as written: which tiers may paint it as a word, as a fill, and whether it clears the state ramp's hue." },
    { name: "authored_by", type: "uuid" },
    { name: "updated_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["host"]],
  uniques: [["host"], ["org_id"]],
});

/** Non-negotiable #5 — object storage behind our own interface. */
export const storage_objects = operationalTable("storage_objects", {
  columns: [
    { name: "storage_key", type: "text", comment: "region/org/kind/id. Carries no bucket, no host, no vendor." },
    { name: "content_type", type: "text" },
    { name: "byte_size", type: "bigint" },
    { name: "sha256", type: "bytea" },
    { name: "uploaded_by", type: "uuid" },
  ],
  indexes: [["storage_key"]],
  uniques: [["storage_key"]],
});

/**
 * SLA timers. due_at is DERIVED from the resolved contract for the site —
 * a dispatcher cannot set the clock, because a dispatcher who can will be
 * asked to. shadow_mode is a field, not a deployment: the cascade runs for
 * real and records what it would have done, per region (WS-C C6).
 */
export const sla_timers = operationalTable("sla_timers", {
  columns: [
    { name: "job_id", type: "uuid", references: "jobs(id)" },
    { name: "response_term", type: "text", comment: "The resolved sla_response value, frozen here." },
    { name: "opened_at", type: "timestamptz" },
    { name: "due_at", type: "timestamptz" },
    { name: "satisfied_at", type: "timestamptz", nullable: true },
    { name: "breached_at", type: "timestamptz", nullable: true },
    { name: "escalation_stage", type: "integer", default: "0", check: "escalation_stage BETWEEN 0 AND 3" },
    { name: "shadow_mode", type: "boolean", default: "true" },
    { name: "resolution_trace", type: "jsonb", comment: "The resolver's trace at derivation. The answer to 'why is this clock what it is'." },
  ],
  indexes: [["job_id"], ["due_at"]],
  uniques: [["job_id"]],
});

export const currencies = globalReferenceTable("currencies", {
  primaryKey: ["code"],
  columns: [
    { name: "code", type: "text" },
    { name: "minor_units", type: "integer" },
  ],
});

export const part_manufacturers = globalReferenceTable("part_manufacturers", {
  columns: [
    { name: "id", type: "uuid", default: "gen_random_uuid()" },
    { name: "name", type: "text" },
  ],
  uniques: [["name"]],
});

export const schema_migrations = globalReferenceTable("schema_migrations", {
  primaryKey: ["version"],
  columns: [
    { name: "version", type: "text" },
    { name: "applied_at", type: "timestamptz", default: "now()" },
  ],
});

/**
 * MIRROR of packages/contracts/src/terms.ts. GENERATED into 0001 by
 * tools/ci/emit-schema.ts; SELECT-only for every runtime role. Exists so the
 * admission trigger can refuse an override row from a psql session. The code
 * is the register; this is its shadow in the database.
 */
export const term_registry = globalReferenceTable("term_registry", {
  primaryKey: ["key"],
  columns: [
    { name: "key", type: "text" },
    { name: "authoring_tiers", type: "jsonb" },
    { name: "combine_kind", type: "text", check: "combine_kind IN ('nearest','ratchet','attach')" },
    { name: "stricter", type: "text", nullable: true, check: "stricter IN ('lower','higher')" },
    { name: "value_kind", type: "text" },
    { name: "enum_values", type: "jsonb", nullable: true },
  ],
});
