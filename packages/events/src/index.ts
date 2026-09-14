/**
 * Transactional outbox. Events are written in the SAME transaction as the
 * state change (apps/gateway unit-of-work); apps/worker relays them afterwards.
 *
 * The alternative — publish inside the handler — produces the two failures
 * that are impossible to debug six months later: an event for a transaction
 * that rolled back, and a committed change with no event because the broker
 * blinked.
 *
 * The catalogue of topics and the envelope live in packages/contracts/src/events.ts
 * so surfaces can subscribe by type without depending on this package.
 */
export type { DomainEvent, Topic } from "../../contracts/src/events.ts";
import type { DomainEvent, Topic } from "../../contracts/src/events.ts";

/** What the relay hands events to. In Phase 1: a Postgres LISTEN/NOTIFY fanout and SSE from the gateway. */
export type EventPublisher = {
  publish(events: readonly DomainEvent[]): Promise<void>;
};

export type Subscription = {
  readonly subscriber: string;
  readonly topics: readonly Topic[];
  readonly onEvent: (e: DomainEvent) => Promise<void> | void;
};
