import type { UnitOfWork } from "../unit-of-work.ts";
import { resolveMutation, type Mutation, type ServerState, type SyncOutcome } from "../../../../packages/domain/src/sync/index.ts";
import type { Topic } from "../../../../packages/contracts/src/events.ts";
import { BadInput, InputRefused, dbRefusal } from "../refusals.ts";

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
 *
 * Nothing about tenancy is taken from the request: every row a mutation
 * writes carries the JOB's own org and region, read here, and a device may
 * touch only a job its grant's crew has been assigned to. A crew whose
 * assignment has since been released is not refused — offline work done
 * before a release is real — but nothing it sends is applied either: the job
 * may already be another crew's, so every such mutation goes to the conflict
 * queue for a person. The intent record of a mutation that names any other
 * job carries the grant's own tenancy.
 *
 * The job row is locked for the batch, and a transition writes only over the
 * version it was decided against: an office transition or release that lands
 * mid-replay is never silently overwritten.
 *
 * One device replays one batch at a time: the batch takes a transaction lock
 * on the device id before it reads what it has seen, so a retry sent while the
 * first attempt is still running waits for it and then finds duplicates —
 * rather than racing it into UNIQUE(device_id, mutation_id) and refusing all.
 *
 * One bad mutation does not sink the batch. A malformed one is rejected before
 * anything is written; one the database refuses is rolled back to its own
 * savepoint and recorded as rejected. Either way the rest of the batch goes
 * on, and the device is told which one and why — a batch refused whole is
 * replayed whole, and refused again, forever.
 */
export type SyncBatch = { readonly deviceId: string; readonly grantId: string; readonly orgId: string; readonly regionId: string; readonly mutations: readonly Mutation[] };

const TOPIC_FOR: Readonly<Record<string, Topic>> = {
  jobs: "job.transitioned", job_media: "job.transitioned", time_entries: "job.transitioned", parts_used: "job.transitioned", checklist_items: "job.transitioned",
};

type CrewJob = { readonly orgId: string; readonly regionId: string; readonly crewId: string; readonly live: boolean; readonly server: ServerState };
const crewJobOf = async (uow: UnitOfWork, grantId: string, jobId: string): Promise<CrewJob | null> => {
  const r = (await uow.tx.query<{ org_id: string; region_id: string; crew_id: string; live: boolean; state: string; version: number }>(
    `SELECT j.org_id, j.region_id, g.crew_id, j.state, j.version,
            EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.crew_id = g.crew_id AND a.released_at IS NULL) AS live
       FROM jobs j, device_grants g
      WHERE j.id = $2 AND g.id = $1
        AND EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.crew_id = g.crew_id)
        FOR UPDATE OF j`,
    [grantId, jobId],
  ))[0];
  return r ? { orgId: r.org_id, regionId: r.region_id, crewId: r.crew_id, live: r.live, server: { version: r.version, state: r.state, fields: {} } } : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPS = new Set(["insert", "update", "transition"]);
const isDate = (v: unknown): boolean => typeof v === "string" && v.length <= 64 && !Number.isNaN(Date.parse(v));
const quantity = (v: unknown): boolean =>
  typeof v === "number" ? Number.isSafeInteger(v) && v > 0 : typeof v === "string" && /^\d{1,18}$/.test(v) && /[1-9]/.test(v);
/** Why a mutation cannot even be recorded, in words for the device; null when its shape is sound. */
export const shapeFault = (m: Mutation): string | null => {
  if (typeof m.mutationId !== "string" || m.mutationId.length === 0 || m.mutationId.length > 200) return "mutationId must be a non-empty string";
  if (!Number.isSafeInteger(m.deviceSeq)) return "deviceSeq must be an integer";
  if (typeof m.entityTable !== "string") return "entityTable must be a string";
  if (typeof m.entityId !== "string" || !UUID.test(m.entityId)) return "entityId must be a uuid";
  if (!OPS.has(m.op)) return "op must be insert, update or transition";
  if (!m.payload || typeof m.payload !== "object" || Array.isArray(m.payload)) return "payload must be an object";
  if (m.clientObservedVersion !== null && !Number.isSafeInteger(m.clientObservedVersion)) return "clientObservedVersion must be an integer or null";
  if (!isDate(m.deviceAt)) return "deviceAt must be a timestamp";
  const p = m.payload;
  if (m.entityTable === "jobs" && typeof p.state !== "string") return "a job transition names its state";
  if (m.entityTable === "time_entries" && (!isDate(p.start) || !isDate(p.end))) return "a time entry has a start and an end timestamp";
  // A bigint column. A JSON number past 2^53 is not the number the device meant, and a string past eighteen digits does not fit.
  if (m.entityTable === "parts_used" && !quantity(p.quantity_milli)) return "quantity_milli must be a positive integer";
  if (m.entityTable === "shift_punches" && ((p.kind !== "in" && p.kind !== "out") || !isDate(p.at))) return "a punch is in or out, at a timestamp";
  return null;
};

/** A refusal the database or a handler made about this one row — not a bug, and not the batch's. */
const refusedRow = (e: unknown): boolean => e instanceof BadInput || e instanceof InputRefused || dbRefusal(e) !== null;

export const ingestSync = async (uow: UnitOfWork, actorId: string, batch: SyncBatch, receivedAt: Date): Promise<readonly SyncOutcome[]> => {
  if (!Array.isArray(batch.mutations)) throw new BadInput("mutations must be a list");
  await uow.tx.query("SELECT pg_advisory_xact_lock(hashtextextended('sync:' || $1, 0))", [batch.deviceId]);
  const seenRows = await uow.tx.query<{ mutation_id: string }>("SELECT mutation_id FROM sync_mutations WHERE device_id = $1", [batch.deviceId]);
  const seen = new Set(seenRows.map((r) => r.mutation_id));
  const outcomes: SyncOutcome[] = [];

  const sound: Mutation[] = [];
  for (const m of batch.mutations as readonly unknown[]) {
    const fault = m && typeof m === "object" ? shapeFault(m as Mutation) : "a mutation must be an object";
    if (fault === null) { sound.push(m as Mutation); continue; }
    const id = (m as { mutationId?: unknown } | null)?.mutationId;
    outcomes.push({ outcome: "rejected", mutationId: typeof id === "string" ? id : "", note: `malformed mutation: ${fault}` });
  }

  for (const m of sound.sort((a, b) => a.deviceSeq - b.deviceSeq)) {
    await uow.tx.query("SAVEPOINT sync_mutation");
    try {
      await ingestOne(uow, actorId, batch, receivedAt, m, seen, outcomes);
      await uow.tx.query("RELEASE SAVEPOINT sync_mutation");
    } catch (e) {
      if (!refusedRow(e)) throw e;
      await uow.tx.query("ROLLBACK TO SAVEPOINT sync_mutation");
      // Whatever ingestOne pushed for this mutation did not happen.
      if (outcomes.at(-1)?.mutationId === m.mutationId) outcomes.pop();
      console.warn(`sync: mutation ${m.mutationId} from device ${batch.deviceId} refused —`, (e as Error).message);
      const note = "the server refused this change and recorded it; it will not be applied — tell the office";
      await uow.tx.query(
        `INSERT INTO sync_mutations (org_id, region_id, device_id, mutation_id, device_seq, entity_table, entity_id, op, payload, client_observed_version, outcome, note, device_at, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,'rejected',$11,$12,$13)`,
        [batch.orgId, batch.regionId, batch.deviceId, m.mutationId, m.deviceSeq, m.entityTable, m.entityId, m.op, JSON.stringify(m.payload),
         m.clientObservedVersion, note, m.deviceAt, receivedAt.toISOString()],
      );
      seen.add(m.mutationId);
      outcomes.push({ outcome: "rejected", mutationId: m.mutationId, note });
    }
  }
  return outcomes;
};

const ingestOne = async (uow: UnitOfWork, actorId: string, batch: SyncBatch, receivedAt: Date, m: Mutation, seen: Set<string>, outcomes: SyncOutcome[]): Promise<void> => {
  if (m.entityTable === "shift_punches") return ingestPunch(uow, batch, receivedAt, m, seen, outcomes);
  // Every other table a device writes hangs off a job, and entityId names it.
  const job = seen.has(m.mutationId) ? null : await crewJobOf(uow, batch.grantId, m.entityId);
  const server = m.entityTable === "jobs" ? job?.server ?? null : null;
  const outcome: SyncOutcome = seen.has(m.mutationId)
    ? resolveMutation(m, server, seen)
    : !job
      ? { outcome: "rejected", mutationId: m.mutationId, note: `job ${m.entityId} is not one this crew has been sent to — a device writes only its own crew's work` }
      : !job.live
        ? { outcome: "queued_for_human", mutationId: m.mutationId, serverState: job.server, note: `this crew was released from the job before the device synced; the job may now be another crew's. A person decides whether this work stands.` }
        : resolveMutation(m, server, seen);
  const orgId = job?.orgId ?? batch.orgId;
  const regionId = job?.regionId ?? batch.regionId;
  seen.add(m.mutationId);
  outcomes.push(outcome);
  if (outcome.outcome === "duplicate") return;

  // 1. The intent is always recorded, whatever happened to it.
  const rec = await uow.tx.query<{ id: string }>(
    `INSERT INTO sync_mutations (org_id, region_id, device_id, mutation_id, device_seq, entity_table, entity_id, op, payload, client_observed_version, outcome, note, device_at, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14) RETURNING id`,
    [orgId, regionId, batch.deviceId, m.mutationId, m.deviceSeq, m.entityTable, m.entityId, m.op, JSON.stringify(m.payload),
     m.clientObservedVersion, outcome.outcome, "note" in outcome ? outcome.note : null, m.deviceAt, receivedAt.toISOString()],
  );
  const recId = rec[0]!.id;

  if (outcome.outcome === "queued_for_human") {
    await uow.apply(
      {
        entity: "job_state", entityId: m.entityId, action: "sync.conflict", topic: "sync.conflict_queued",
        before: outcome.serverState, after: m.payload, orgId, regionId,
        payload: { mutationId: m.mutationId, entityTable: m.entityTable, note: outcome.note },
      },
      async (tx) => {
        await tx.insert("sync_conflicts", {
          org_id: orgId, region_id: regionId, mutation_id: recId, entity_table: m.entityTable, entity_id: m.entityId,
          server_state: outcome.serverState ?? {}, device_intent: m.payload, note: outcome.note,
        });
      },
    );
    return;
  }
  if (outcome.outcome !== "applied") return;

  // 2. Apply. Each table is a small, explicit writer — no generic "upsert whatever the payload says".
  await uow.apply(
    {
      entity: entityFor(m.entityTable), entityId: m.entityId, action: `sync.${m.entityTable}.${m.op}`, topic: TOPIC_FOR[m.entityTable] ?? "job.transitioned",
      before: server, after: m.payload, orgId, regionId,
      payload: { mutationId: m.mutationId, deviceId: batch.deviceId, ...m.payload },
    },
    async (tx) => {
      switch (m.entityTable) {
        case "jobs": {
          const to = String(m.payload.state);
          const moved = await tx.query("UPDATE jobs SET state = $2, version = version + 1 WHERE id = $1 AND version = $3 RETURNING id", [m.entityId, to, server!.version]);
          if (moved.length !== 1) throw new Error(`sync: job ${m.entityId} changed under a locked replay — version ${server!.version} is no longer current`);
          await tx.insert("job_state_events", {
            org_id: orgId, region_id: regionId, job_id: m.entityId, from_state: server?.state ?? null, to_state: to,
            actor_id: actorId, surface_id: "S5", mutation_id: m.mutationId, occurred_at: m.deviceAt,
          });
          return;
        }
        case "job_media":
          await tx.insert("job_media", { org_id: orgId, region_id: regionId, job_id: m.entityId, storage_key: m.payload.storage_key, kind: m.payload.kind, captured_at: m.deviceAt, captured_by: actorId, mutation_id: m.mutationId, meta: m.payload.meta ?? null });
          return;
        case "time_entries":
          await tx.query(
            `INSERT INTO time_entries (org_id, region_id, job_id, crew_id, span, kind, mutation_id) VALUES ($1,$2,$3,$4,tstzrange($5::timestamptz,$6::timestamptz,'[)'),$7,$8)`,
            [orgId, regionId, m.entityId, job!.crewId, m.payload.start, m.payload.end, m.payload.kind, m.mutationId],
          );
          return;
        case "parts_used":
          await tx.insert("parts_used", { org_id: orgId, region_id: regionId, job_id: m.entityId, part_sku: m.payload.part_sku, quantity_milli: String(m.payload.quantity_milli), source: m.payload.source, mutation_id: m.mutationId });
          return;
        case "checklist_items":
          await tx.query(
            `INSERT INTO checklist_items (org_id, region_id, job_id, item_key, response, answered_at, answered_by)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
             ON CONFLICT (job_id, item_key) DO UPDATE SET response = EXCLUDED.response, answered_at = EXCLUDED.answered_at, answered_by = EXCLUDED.answered_by, version = checklist_items.version + 1`,
            [orgId, regionId, m.entityId, m.payload.item_key, JSON.stringify(m.payload.response), m.deviceAt, actorId],
          );
          return;
        default:
          throw new Error(`sync: no writer for "${m.entityTable}" — the policy says applied but nothing knows how to write it`);
      }
    },
  );
};

/**
 * A shift punch (0033) hangs off the shift, not a job: entityId is the grant,
 * and only the batch's own — the device, crew and technician are the grant's,
 * never the payload's. Append-only: a punch made offline is applied when it
 * arrives, at the time the device recorded the tap.
 */
const ingestPunch = async (uow: UnitOfWork, batch: SyncBatch, receivedAt: Date, m: Mutation, seen: Set<string>, outcomes: SyncOutcome[]): Promise<void> => {
  const outcome: SyncOutcome = seen.has(m.mutationId) || m.entityId === batch.grantId
    ? resolveMutation(m, null, seen)
    : { outcome: "rejected", mutationId: m.mutationId, note: "a punch is made on this device's own shift and no other" };
  seen.add(m.mutationId);
  outcomes.push(outcome);
  if (outcome.outcome === "duplicate") return;
  await uow.tx.query(
    `INSERT INTO sync_mutations (org_id, region_id, device_id, mutation_id, device_seq, entity_table, entity_id, op, payload, client_observed_version, outcome, note, device_at, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14)`,
    [batch.orgId, batch.regionId, batch.deviceId, m.mutationId, m.deviceSeq, m.entityTable, m.entityId, m.op, JSON.stringify(m.payload),
     m.clientObservedVersion, outcome.outcome, "note" in outcome ? outcome.note : null, m.deviceAt, receivedAt.toISOString()],
  );
  if (outcome.outcome !== "applied") return;
  const grant = (await uow.tx.query<{ org_id: string; region_id: string; crew_id: string; technician_id: string }>(
    `SELECT org_id, region_id, crew_id, technician_id FROM device_grants WHERE id = $1`, [batch.grantId]))[0];
  if (!grant) throw new InputRefused(`shift grant ${batch.grantId} is unknown to this gateway`, "unknown_device");
  await uow.apply(
    {
      entity: "time_entry", entityId: batch.grantId, action: `sync.shift_punches.${String(m.payload.kind)}`, topic: "shift.punched",
      before: null, after: m.payload, orgId: grant.org_id, regionId: grant.region_id,
      payload: { mutationId: m.mutationId, deviceId: batch.deviceId, technicianId: grant.technician_id, kind: m.payload.kind, at: m.payload.at },
    },
    async (tx) => {
      await tx.insert("shift_punches", {
        org_id: grant.org_id, region_id: grant.region_id, grant_id: batch.grantId, technician_id: grant.technician_id, crew_id: grant.crew_id,
        kind: m.payload.kind, punched_at: m.payload.at, mutation_id: m.mutationId,
      });
    },
  );
};

const entityFor = (table: string) =>
  (({ jobs: "job_state", job_media: "photo", time_entries: "time_entry", parts_used: "part_used", checklist_items: "checklist" }) as Record<string, "job_state" | "photo" | "time_entry" | "part_used" | "checklist">)[table] ?? "job_state";
