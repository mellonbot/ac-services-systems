/**
 * Non-negotiable #6 — offline-first sync surviving a total backbone outage.
 *
 * DEVICE = INTENT. SERVER = TRUTH.
 *
 * Conflict policy is DATA, not branches scattered through handlers. A branch
 * per entity is how the fifteenth entity gets the wrong policy at 2am.
 */
export type ConflictPolicy =
  | "server_authoritative"   // device may never write; it may only ask
  | "last_write_wins"        // by server receipt time, not device clock
  | "append_only"            // no conflict possible; replay is idempotent
  | "field_merge";           // per-field newest-wins, for long-lived forms

export const SYNC_POLICY: Readonly<Record<string, ConflictPolicy>> = Object.freeze({
  /**
   * The load-bearing one. `assignments` is server-authoritative so an offline
   * device cannot route around the compliance gate — the gate lives at
   * assignment, and assignment never happens on a device.
   */
  assignment: "server_authoritative",
  crew_release: "server_authoritative",
  job_state: "append_only",
  checklist: "field_merge",
  photo: "append_only",
  part_used: "append_only",
  time_entry: "append_only",
  signature: "append_only",
  contact_update: "last_write_wins",
});

/**
 * Replay idempotency. The device generates the id before it is ever online, so
 * a replay after a twelve-hour outage is a no-op rather than a duplicate. Every
 * append-only entity is keyed by (entityId, mutationId).
 */
export const replayKey = (entityId: string, mutationId: string): string =>
  `${entityId}:${mutationId}`;

export const mayDeviceWrite = (entity: string): boolean =>
  SYNC_POLICY[entity] !== undefined && SYNC_POLICY[entity] !== "server_authoritative";
