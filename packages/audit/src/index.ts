/**
 * Non-negotiable #4. The interface has no update and no delete, because an
 * interface that has them is an interface someone calls.
 *
 * The other two layers are in migrations/0002: the runtime roles hold
 * INSERT+SELECT only, and a trigger raises on UPDATE or DELETE regardless of
 * role. Three layers, because each covers what the others cannot see.
 */
export type AuditEntry = {
  /** Shared with the outbox row written in the same transaction. */
  readonly eventId: string;
  readonly actorId: string;
  readonly surfaceId: string;
  readonly sessionId: string | null;
  readonly requestId: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly regionId: string;
  readonly orgId: string;
  readonly occurredAt: string;
};

export type AuditWriter = {
  /** The ONLY method. Deliberately. */
  append(entry: AuditEntry): void;
};

export type AuditReader = {
  forEntity(entity: string, entityId: string): Promise<readonly AuditEntry[]>;
  forActor(actorId: string, since: string): Promise<readonly AuditEntry[]>;
};
