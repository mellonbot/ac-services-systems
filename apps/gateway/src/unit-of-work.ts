import { SURFACES, type SurfaceId } from "../../../packages/contracts/src/surfaces.ts";
import type { WriteEntity } from "../../../packages/contracts/src/entities.ts";
import { isTopic, type DomainEvent, type Topic } from "../../../packages/contracts/src/events.ts";
import type { Principal, ScopeBinding } from "../../../packages/contracts/src/scope.ts";
import type { AuditEntry } from "../../../packages/audit/src/index.ts";
import { scopeBinding } from "./context.ts";

/**
 * THE UNIT OF WORK — the single object that can change anything.
 *
 * Obligations, all discharged together or not at all:
 *   1. the scope binding is SET LOCAL before any statement (RLS has its inputs);
 *   2. the surface's write allowlist is checked on every mutation;
 *   3. the mutation's tenancy matches the principal's (a dispatcher in one
 *      region cannot write a row into another, whatever the payload says);
 *   4. the audit entry is written INSIDE the same transaction;
 *   5. the event goes to the outbox, in the same transaction, with a topic
 *      from the catalogue and the SAME event_id as the audit row.
 *
 * Notice what is NOT here: a `skipAudit` option, a `force` flag, a way to
 * write without declaring the entity, a way to emit without a topic. Each of
 * those is one line to add and would have been added by now if the interface
 * had a slot for it.
 */
export type Mutation = {
  readonly entity: WriteEntity;
  readonly entityId: string;
  readonly action: string;
  readonly topic: Topic;
  readonly before: unknown;
  readonly after: unknown;
  /** Tenancy of the row being written. Checked against the principal. */
  readonly orgId: string;
  readonly regionId: string;
  readonly payload?: Readonly<Record<string, unknown>>;
};

/** The transaction the gateway drives. Implemented over pg in pg-tx.ts; faked in tests. */
export type Tx = {
  setLocal(binding: ScopeBinding): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  insert(table: string, row: Record<string, unknown>): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
};

export type UnitOfWorkContext = {
  readonly surfaceId: SurfaceId;
  readonly principal: Principal;
  readonly requestId: string;
  /** The gateway's clock, passed in. Nothing below reads Date.now(). */
  readonly now: () => Date;
  readonly newId: () => string;
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

export class TenancyMismatch extends Error {
  constructor(what: string) {
    super(`unit of work: ${what}. A principal writes inside its own tenancy or not at all.`);
    this.name = "TenancyMismatch";
  }
}

export class SurfaceDisabled extends Error {
  constructor(surfaceId: SurfaceId) {
    super(`${surfaceId} is not enabled (phase ${SURFACES[surfaceId].phase}). Enabling it is a data change in the registry (D9).`);
    this.name = "SurfaceDisabled";
  }
}

export class RoleDenied extends Error {
  constructor(surfaceId: SurfaceId, roles: readonly string[]) {
    super(`${surfaceId} admits [${SURFACES[surfaceId].roles?.join(", ")}]; principal holds [${roles.join(", ") || "—"}]. Roles are data in the surface registry.`);
    this.name = "RoleDenied";
  }
}

export const createUnitOfWork = async (ctx: UnitOfWorkContext, tx: Tx) => {
  const surface = SURFACES[ctx.surfaceId];
  if (!surface.enabled) throw new SurfaceDisabled(ctx.surfaceId);
  if (surface.namespace !== ctx.principal.namespace) {
    throw new TenancyMismatch(`${ctx.surfaceId} serves the ${surface.namespace} namespace; principal is ${ctx.principal.namespace}`);
  }
  if (surface.roles && !surface.roles.some((r) => ctx.principal.roles.includes(r))) {
    throw new RoleDenied(ctx.surfaceId, ctx.principal.roles);
  }

  // 1. RLS inputs, first, before any statement runs.
  await tx.setLocal(scopeBinding(ctx.principal, ctx.surfaceId));

  const audits: AuditEntry[] = [];
  const events: DomainEvent[] = [];
  let open = true;

  const apply = async (m: Mutation, write: (tx: Tx) => Promise<void>): Promise<string> => {
    if (!open) throw new Error("unit of work already closed");
    // 2. The check nobody has to remember. S4's empty list enforces itself here.
    if (!surface.writes.includes(m.entity)) throw new SurfaceWriteDenied(ctx.surfaceId, m.entity);
    // 3. Tenancy. Internal and device principals are OURS: they write into customer
    //    orgs, bounded by region (org-scoped internal principals: any region).
    //    External principals (customer, subcontractor, vendor, anonymous) write
    //    only into their own org, and only in their own region.
    const p = ctx.principal;
    const ours = p.namespace === "internal" || p.namespace === "device";
    const orgScoped = p.namespace === "internal" && p.scopeTier === "parent";
    if (!ours && m.orgId !== p.orgId) throw new TenancyMismatch(`row org ${m.orgId} is not principal org ${p.orgId}`);
    if (!orgScoped && m.regionId !== p.regionId) throw new TenancyMismatch(`row region ${m.regionId} is not principal region ${p.regionId}`);
    if (!isTopic(m.topic)) throw new Error(`"${m.topic}" is not in the event catalogue (packages/contracts/src/events.ts)`);

    await write(tx);

    const eventId = ctx.newId();
    const occurredAt = ctx.now().toISOString();
    audits.push({
      eventId, actorId: p.subjectId, surfaceId: ctx.surfaceId, sessionId: p.sessionId, requestId: ctx.requestId,
      action: m.action, entity: m.entity, entityId: m.entityId, before: m.before, after: m.after,
      regionId: m.regionId, orgId: m.orgId, occurredAt,
    });
    events.push({
      eventId, topic: m.topic, entity: m.entity, entityId: m.entityId,
      payload: m.payload ?? { after: m.after }, regionId: m.regionId, orgId: m.orgId,
      actorId: p.subjectId, surfaceId: ctx.surfaceId, occurredAt,
    });
    return eventId;
  };

  const commit = async (): Promise<{ eventIds: readonly string[] }> => {
    if (!open) throw new Error("unit of work already closed");
    open = false;
    // 4 + 5. Same transaction. An audit log written afterwards is a log that is
    // missing exactly the entries that mattered — the ones where the process died.
    for (const a of audits) {
      await tx.insert("audit_log", {
        event_id: a.eventId, actor_id: a.actorId, surface_id: a.surfaceId, session_id: a.sessionId, request_id: a.requestId,
        action: a.action, entity: a.entity, entity_id: a.entityId, before: a.before, after: a.after,
        region_id: a.regionId, org_id: a.orgId, occurred_at: a.occurredAt,
      });
    }
    for (const e of events) {
      await tx.insert("outbox", {
        event_id: e.eventId, topic: e.topic, entity: e.entity, entity_id: e.entityId, payload: e.payload,
        actor_id: e.actorId, surface_id: e.surfaceId, region_id: e.regionId, org_id: e.orgId, occurred_at: e.occurredAt,
      });
    }
    await tx.commit();
    return { eventIds: events.map((e) => e.eventId) };
  };

  const rollback = async (): Promise<void> => {
    open = false;
    await tx.rollback();
  };

  return { apply, commit, rollback, tx, pending: () => ({ audits: [...audits], events: [...events] }) };
};

export type UnitOfWork = Awaited<ReturnType<typeof createUnitOfWork>>;
