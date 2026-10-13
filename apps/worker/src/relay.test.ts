import { test } from "node:test";
import assert from "node:assert/strict";
import { notifyPublisher, type RelayTx } from "./relay.ts";
import type { DomainEvent } from "../../../packages/contracts/src/events.ts";

const U = (n: number) => `c4110000-0000-0000-0000-${String(n).padStart(12, "0")}`;

test("NOTIFY publishes both channels for a batch in one ordered query", async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const tx: RelayTx = {
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<readonly T[]> { calls.push({ sql, params }); return []; },
    async commit() {},
    async rollback() {},
  };
  const events: DomainEvent[] = [
    { eventId: U(1), topic: "job.created", entity: "job", entityId: U(11), payload: {}, regionId: U(2), orgId: U(3), actorId: U(4), surfaceId: "S2", occurredAt: "2026-10-01T12:00:00.000Z" },
    { eventId: U(5), topic: "job.assigned", entity: "job", entityId: U(12), payload: {}, regionId: U(6), orgId: U(7), actorId: U(8), surfaceId: "S3", occurredAt: "2026-10-01T12:00:01.000Z" },
  ];

  await notifyPublisher(tx).publish(events);

  assert.equal(calls.length, 1);
  assert.match(calls[0]!.sql, /WITH ORDINALITY/);
  assert.match(calls[0]!.sql, /ORDER BY n\.ordinality/);
  assert.deepEqual(calls[0]!.params[0], [`ac_events_${U(2).replace(/-/g, "")}`, "ac_events", `ac_events_${U(6).replace(/-/g, "")}`, "ac_events"]);
  assert.deepEqual(
    (calls[0]!.params[1] as string[]).map((payload) => JSON.parse(payload)),
    events.flatMap((event) => {
      const envelope = {
        eventId: event.eventId, topic: event.topic, entity: event.entity, entityId: event.entityId,
        regionId: event.regionId, orgId: event.orgId, occurredAt: event.occurredAt,
      };
      return [envelope, envelope];
    }),
  );
});
