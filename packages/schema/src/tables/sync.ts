import { operationalTable } from "../tenancy.ts";

/**
 * OFFLINE SYNC — non-negotiable #6. Device = intent, server = truth.
 *
 * Every mutation a device ever sends lands here first, keyed by the id the
 * device generated while offline. A replay after a twelve-hour outage is a
 * no-op because the row already exists. The outcome is recorded so the device
 * can be told what happened to each of its intents — including the ones a
 * human still has to look at.
 */
export const sync_mutations = operationalTable("sync_mutations", {
  columns: [
    { name: "device_id", type: "uuid", references: "devices(id)" },
    { name: "mutation_id", type: "text", comment: "Client-generated. UNIQUE per device." },
    { name: "device_seq", type: "bigint", comment: "The device's own ordering. Preserved — it is data, not an accident." },
    { name: "entity_table", type: "text" },
    { name: "entity_id", type: "uuid" },
    { name: "op", type: "text", check: "op IN ('insert','update','transition')" },
    { name: "payload", type: "jsonb" },
    { name: "client_observed_version", type: "integer", nullable: true },
    { name: "outcome", type: "text", check: "outcome IN ('applied','duplicate','superseded','queued_for_human','rejected')" },
    { name: "note", type: "text", nullable: true },
    { name: "device_at", type: "timestamptz", comment: "The device clock. Recorded, never trusted for ordering." },
    { name: "received_at", type: "timestamptz", default: "now()" },
  ],
  indexes: [["device_id", "device_seq"], ["entity_table", "entity_id"]],
  uniques: [["device_id", "mutation_id"]],
});

/**
 * The human queue. A crew that completed a job the office cancelled; a
 * signature whose job was reassigned. Nothing here resolves automatically,
 * because somebody drove to a site for nothing and that needs a person.
 */
export const sync_conflicts = operationalTable("sync_conflicts", {
  columns: [
    { name: "mutation_id", type: "uuid", references: "sync_mutations(id)" },
    { name: "entity_table", type: "text" },
    { name: "entity_id", type: "uuid" },
    { name: "server_state", type: "jsonb" },
    { name: "device_intent", type: "jsonb" },
    { name: "note", type: "text" },
    { name: "resolved_by", type: "uuid", nullable: true },
    { name: "resolved_at", type: "timestamptz", nullable: true },
    { name: "resolution", type: "text", nullable: true, check: "resolution IN ('accept_device','keep_server','manual')" },
  ],
  indexes: [["resolved_at"], ["entity_table", "entity_id"]],
});
