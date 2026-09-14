import type { UnitOfWork } from "../unit-of-work.ts";
import { resolveMutation, type Mutation, type ServerState, type SyncOutcome } from "../../../../packages/domain/src/sync/index.ts";
import type { Topic } from "../../../../packages/contracts/src/events.ts";

/**
 * S5/tablet → gateway: replay a device's offline log.
 *
 * Each mutation: record the intent in sync_mutations FIRST (idempotency by
 * (device, mutation_id)); decide under the entity's policy; apply what the
 * decision allows; queue what needs a human; tell the device what happened.
 * Every applied mutation is a unit-of-work mutation: audit row, outbox event.
 *
 * The device principal is a shift grant. Its region is the grant's region;
 * the unit of work refuses a row into any other region regardless of payload.
 */
export type SyncBatch = { readonly deviceId: string; readonly mutations: readonly Mutation[]; readonly orgId: string; readonly regionId: string };

const TOPIC_FOR: Readonly<Record<string, Topic>> = {
  jobs: "job.transitioned", job_media: "job.transitioned", time_entries: "job.transitioned", parts_used: "job.transitioned", checklist_items: "job.transitioned",
};

const jobStateOf = async (uow: UnitOfWork, jobId: string): Promise<ServerState | null> => {
  const r = (await uow.tx.query<{ state: string; version: number }>("SELECT state, version FROM jobs WHERE id = $1", [jobId]))[0];
  return r ? { version: r.version, state: r.state, fields: {} } : null;
};

export const ingestSync = async (uow: UnitOfWork, actorId: string, batch: SyncBatch, receivedAt: Date): Promise<readonly SyncOutcome[]> => {
  const seenRows = await uow.tx.query<{ mutation_id: string }>("SELECT mutation_id FROM sync_mutations WHERE device_id = $1", [batch.deviceId]);
  const seen = new Set(seenRows.map((r) => r.mutation_id));
  const outcomes: SyncOutcome[] = [];

  for (const m of [...batch.mutations].sort((a, b) => a.deviceSeq - b.deviceSeq)) {
    const server = m.entityTable === "jobs" ? await jobStateOf(uow, m.entityId) : null;
    const outcome = resolveMutation(m, server, seen);
    seen.add(m.mutationId);
    outcomes.push(outcome);
    if (outcome.outcome === "duplicate") continue;

    // 1. The intent is always recorded, whatever happened to it.
    const rec = await uow.tx.query<{ id: string }>(
      `INSERT INTO sync_mutations (org_id, region_id, device_id, mutation_id, device_seq, entity_table, entity_id, op, payload, client_observed_version, outcome, note, device_at, received_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14) RETURNING id`,
      [batch.orgId, batch.regionId, batch.deviceId, m.mutationId, m.deviceSeq, m.entityTable, m.entityId, m.op, JSON.stringify(m.payload),
       m.clientObservedVersion, outcome.outcome, "note" in outcome ? outcome.note : null, m.deviceAt, receivedAt.toISOString()],
    );
    const recId = rec[0]!.id;

    if (outcome.outcome === "queued_for_human") {
      await uow.apply(
        {
          entity: "job_state", entityId: m.entityId, action: "sync.conflict", topic: "sync.conflict_queued",
          before: outcome.serverState, after: m.payload, orgId: batch.orgId, regionId: batch.regionId,
          payload: { mutationId: m.mutationId, entityTable: m.entityTable, note: outcome.note },
        },
        async (tx) => {
          await tx.insert("sync_conflicts", {
            org_id: batch.orgId, region_id: batch.regionId, mutation_id: recId, entity_table: m.entityTable, entity_id: m.entityId,
            server_state: outcome.serverState ?? {}, device_intent: m.payload, note: outcome.note,
          });
        },
      );
      continue;
    }
    if (outcome.outcome !== "applied") continue;

    // 2. Apply. Each table is a small, explicit writer — no generic "upsert whatever the payload says".
    await uow.apply(
      {
        entity: entityFor(m.entityTable), entityId: m.entityId, action: `sync.${m.entityTable}.${m.op}`, topic: TOPIC_FOR[m.entityTable] ?? "job.transitioned",
        before: server, after: m.payload, orgId: batch.orgId, regionId: batch.regionId,
        payload: { mutationId: m.mutationId, deviceId: batch.deviceId, ...m.payload },
      },
      async (tx) => {
        switch (m.entityTable) {
          case "jobs": {
            const to = String(m.payload.state);
            await tx.query("UPDATE jobs SET state = $2, version = version + 1 WHERE id = $1", [m.entityId, to]);
            await tx.insert("job_state_events", {
              org_id: batch.orgId, region_id: batch.regionId, job_id: m.entityId, from_state: server?.state ?? null, to_state: to,
              actor_id: actorId, surface_id: "S5", mutation_id: m.mutationId, occurred_at: m.deviceAt,
            });
            return;
          }
          case "job_media":
            await tx.insert("job_media", { org_id: batch.orgId, region_id: batch.regionId, job_id: m.entityId, storage_key: m.payload.storage_key, kind: m.payload.kind, captured_at: m.deviceAt, captured_by: actorId, mutation_id: m.mutationId, meta: m.payload.meta ?? null });
            return;
          case "time_entries":
            await tx.query(
              `INSERT INTO time_entries (org_id, region_id, job_id, crew_id, span, kind, mutation_id) VALUES ($1,$2,$3,$4,tstzrange($5::timestamptz,$6::timestamptz,'[)'),$7,$8)`,
              [batch.orgId, batch.regionId, m.entityId, m.payload.crew_id, m.payload.start, m.payload.end, m.payload.kind, m.mutationId],
            );
            return;
          case "parts_used":
            await tx.insert("parts_used", { org_id: batch.orgId, region_id: batch.regionId, job_id: m.entityId, part_sku: m.payload.part_sku, quantity_milli: String(m.payload.quantity_milli), source: m.payload.source, mutation_id: m.mutationId });
            return;
          case "checklist_items":
            await tx.query(
              `INSERT INTO checklist_items (org_id, region_id, job_id, item_key, response, answered_at, answered_by)
               VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
               ON CONFLICT (job_id, item_key) DO UPDATE SET response = EXCLUDED.response, answered_at = EXCLUDED.answered_at, answered_by = EXCLUDED.answered_by, version = checklist_items.version + 1`,
              [batch.orgId, batch.regionId, m.entityId, m.payload.item_key, JSON.stringify(m.payload.response), m.deviceAt, actorId],
            );
            return;
          default:
            throw new Error(`sync: no writer for "${m.entityTable}" — the policy says applied but nothing knows how to write it`);
        }
      },
    );
  }
  return outcomes;
};

const entityFor = (table: string) =>
  (({ jobs: "job_state", job_media: "photo", time_entries: "time_entry", parts_used: "part_used", checklist_items: "checklist" }) as Record<string, "job_state" | "photo" | "time_entry" | "part_used" | "checklist">)[table] ?? "job_state";
