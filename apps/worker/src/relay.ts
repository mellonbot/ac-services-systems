import type { DomainEvent } from "../../../packages/contracts/src/events.ts";
import { isTopic } from "../../../packages/contracts/src/events.ts";
import type { EventPublisher } from "../../../packages/events/src/index.ts";

/**
 * THE OUTBOX RELAY — B5, the other half.
 *
 * Reads unpublished outbox rows in occurrence order, hands them to the
 * publisher, marks them published — in one transaction per batch, with
 * FOR UPDATE SKIP LOCKED so two relay processes never fight over a row and
 * a crashed relay leaves nothing stuck.
 *
 * Delivery is at-least-once. Subscribers dedupe on event_id, which is also
 * the audit row's id: a subscriber that wants to know "did this really
 * happen" can join to audit_log and get the actor, the surface and the
 * before/after in one row.
 *
 * `region_id` is on every event, so a Tier 3 relay per region is a WHERE
 * clause, not a redesign.
 */
export type RelayTx = {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

type Row = {
  id: string; event_id: string; topic: string; entity: string; entity_id: string; payload: Record<string, unknown>;
  actor_id: string; surface_id: string; region_id: string; org_id: string; occurred_at: string; attempts: number;
};

export const relayOnce = async (tx: RelayTx, publisher: EventPublisher, batchSize = 200, regionId?: string): Promise<{ published: number; refused: number }> => {
  const rows = await tx.query<Row>(
    `SELECT id, event_id, topic, entity, entity_id, payload, actor_id, surface_id, region_id, org_id, occurred_at, attempts
       FROM outbox
      WHERE published_at IS NULL AND ($2::uuid IS NULL OR region_id = $2)
      ORDER BY occurred_at, id
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [batchSize, regionId ?? null],
  );
  if (rows.length === 0) {
    await tx.commit();
    return { published: 0, refused: 0 };
  }

  const good: DomainEvent[] = [];
  const bad: Row[] = [];
  for (const r of rows) {
    if (!isTopic(r.topic)) {
      bad.push(r);
      continue;
    }
    good.push({
      eventId: r.event_id, topic: r.topic, entity: r.entity, entityId: r.entity_id, payload: r.payload,
      regionId: r.region_id, orgId: r.org_id, actorId: r.actor_id, surfaceId: r.surface_id,
      occurredAt: typeof r.occurred_at === "string" ? r.occurred_at : new Date(r.occurred_at).toISOString(),
    });
  }

  try {
    if (good.length) await publisher.publish(good);
  } catch (e) {
    // Nothing is marked; the whole batch is retried. attempts is the signal an operator watches.
    await tx.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)]);
    await tx.commit();
    throw e;
  }

  if (good.length) await tx.query(`UPDATE outbox SET published_at = now() WHERE event_id = ANY($1::uuid[])`, [good.map((g) => g.eventId)]);
  // An unknown topic is a row that should never have been written — the unit of work refuses them.
  // If one exists, something wrote to the outbox around the gateway. Park it and count it; do not lose it.
  if (bad.length) await tx.query(`UPDATE outbox SET attempts = attempts + 1000 WHERE id = ANY($1::uuid[])`, [bad.map((b) => b.id)]);
  await tx.commit();
  return { published: good.length, refused: bad.length };
};

/** Phase 1 publisher: Postgres NOTIFY fanout (the gateway LISTENs and pushes SSE to surfaces) plus subscriber cursors. */
export const notifyPublisher = (tx: RelayTx): EventPublisher => ({
  async publish(events) {
    for (const e of events) {
      // NOTIFY payload cap is 8000 bytes; send the envelope, subscribers fetch the payload by event_id if they need it.
      const envelope = JSON.stringify({ eventId: e.eventId, topic: e.topic, entity: e.entity, entityId: e.entityId, regionId: e.regionId, orgId: e.orgId, occurredAt: e.occurredAt });
      await tx.query(`SELECT pg_notify($1, $2)`, [`ac_events_${e.regionId.replace(/-/g, "")}`, envelope]);
      await tx.query(`SELECT pg_notify('ac_events', $1)`, [envelope]);
    }
  },
});
