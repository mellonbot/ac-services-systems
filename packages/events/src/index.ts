/**
 * Transactional outbox. Events are written in the SAME transaction as the state
 * change; a relay publishes them afterwards.
 *
 * The alternative — publish inside the handler — produces the two failures that
 * are impossible to debug six months later: an event for a transaction that
 * rolled back, and a committed change with no event because the broker blinked.
 */
export type DomainEvent = {
  readonly topic: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** On the event stream too. Non-negotiable #2 says "audit log and event stream included". */
  readonly regionId: string;
  readonly orgId: string;
};

export type EventPublisher = {
  enqueue(event: DomainEvent): void;
};
