import { SURFACES, type SurfaceId } from "@ac/contracts";
import type { WriteEntity } from "@ac/contracts";
import type { AuditEntry } from "@ac/audit";
import type { DomainEvent } from "@ac/events";

/**
 * THE UNIT OF WORK — the single object that can change anything.
 *
 * Three obligations, all discharged together or not at all:
 *   1. the surface's write allowlist is checked on every mutation;
 *   2. the audit entry is written INSIDE the same transaction;
 *   3. events go to the outbox, in the same transaction, not to a broker.
 *
 * Notice what is NOT here: a `skipAudit` option, a `force` flag, a way to write
 * without declaring the entity. Each of those is one line to add and would have
 * been added by now if the interface had a slot for it.
 */
export type Mutation = {
  readonly entity: WriteEntity;
  readonly entityId: string;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
};

export type Tx = {
  insert(table: string, row: Record<string, unknown>): Promise<void>;
  update(table: string, id: string, patch: Record<string, unknown>): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

export type UnitOfWorkContext = {
  readonly surfaceId: SurfaceId;
  readonly actorId: string;
  readonly regionId: string;
  readonly orgId: string;
};

export class SurfaceWriteDenied extends Error {
  constructor(surfaceId: SurfaceId, entity: string) {
    super(
      `${surfaceId} (${SURFACES[surfaceId].name}) may not write "${entity}". ` +
      `Its allowlist is [${SURFACES[surfaceId].writes.join(", ") || "—"}], declared in ` +
      `packages/contracts/src/surfaces.ts. If this surface should own this entity, that is a ` +
      `reviewed diff on the registry, not a change here.`,
    );
    this.name = "SurfaceWriteDenied";
  }
}

export const createUnitOfWork = (ctx: UnitOfWorkContext, tx: Tx) => {
  const audits: AuditEntry[] = [];
  const events: DomainEvent[] = [];

  const apply = async (m: Mutation, write: (tx: Tx) => Promise<void>): Promise<void> => {
    // The check nobody has to remember. S4's empty list enforces itself here.
    if (!SURFACES[ctx.surfaceId].writes.includes(m.entity)) {
      throw new SurfaceWriteDenied(ctx.surfaceId, m.entity);
    }
    await write(tx);
    audits.push({
      actorId: ctx.actorId, surfaceId: ctx.surfaceId, action: m.action,
      entity: m.entity, entityId: m.entityId, before: m.before, after: m.after,
      regionId: ctx.regionId, orgId: ctx.orgId,
    });
    events.push({
      topic: `${m.entity}.${m.action}`,
      payload: { entityId: m.entityId, after: m.after },
      regionId: ctx.regionId, orgId: ctx.orgId,
    });
  };

  const commit = async (): Promise<void> => {
    // Same transaction. An audit log written afterwards is a log that is missing
    // exactly the entries that mattered — the ones where the process died.
    for (const a of audits) await tx.insert("audit_log", { ...a });
    for (const e of events) await tx.insert("outbox", { topic: e.topic, payload: e.payload, region_id: e.regionId, org_id: e.orgId });
    await tx.commit();
  };

  return { apply, commit, rollback: () => tx.rollback() };
};
