import { operationalTable, globalReferenceTable } from "../tenancy.ts";

/**
 * Non-negotiable #4. Written INSIDE the same transaction as the change it
 * describes, by the only object that can write at all. No update or delete
 * method exists on the interface; the app role holds INSERT+SELECT only; a
 * trigger raises regardless of role. Three layers, because the interface is
 * the one an ORM can be talked past.
 */
export const audit_log = operationalTable("audit_log", {
  columns: [
    { name: "actor_id", type: "uuid" },
    { name: "surface_id", type: "text" },
    { name: "action", type: "text" },
    { name: "entity", type: "text" },
    { name: "entity_id", type: "uuid" },
    { name: "before", type: "jsonb", nullable: true },
    { name: "after", type: "jsonb", nullable: true },
    { name: "occurred_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["entity", "entity_id"], ["occurred_at"]],
});

/** Transactional outbox. Events carry region_id like every other row. */
export const outbox = operationalTable("outbox", {
  columns: [
    { name: "topic", type: "text" },
    { name: "payload", type: "jsonb" },
    { name: "published_at", type: "timestamptz", nullable: true },
  ],
  indexes: [["published_at"]],
});

/** Non-negotiable #5 — object storage behind our own interface. */
export const storage_objects = operationalTable("storage_objects", {
  columns: [
    { name: "storage_key", type: "text", comment: "region/org/kind/id. Carries no bucket, no host, no vendor." },
    { name: "content_type", type: "text" },
    { name: "byte_size", type: "bigint" },
    { name: "sha256", type: "bytea" },
  ],
  indexes: [["storage_key"]],
});

export const currencies = globalReferenceTable("currencies", {
  primaryKey: ["code"],
  columns: [
    { name: "code", type: "text" },
    { name: "minor_units", type: "integer" },
  ],
});

export const schema_migrations = globalReferenceTable("schema_migrations", {
  primaryKey: ["version"],
  columns: [
    { name: "version", type: "text" },
    { name: "applied_at", type: "timestamptz", default: "now()" },
  ],
});
