import type { RelayTx } from "./relay.ts";
import { evaluateCascade, type TimerState, type SlaTerms } from "../../../packages/domain/src/sla/index.ts";
import { randomUUID } from "node:crypto";
import { isTopic } from "../../../packages/contracts/src/events.ts";

/**
 * SCHEDULED SWEEPS. Each runs as the ac_worker role, inside one transaction,
 * and writes through the same audit+outbox pair the gateway does — by hand
 * here, because the worker has no surface and no principal; its actor is the
 * well-known WORKER id and its surface is "worker". The audit trigger and the
 * outbox shape do not care who writes; they care that both rows land together.
 */
export const WORKER_ACTOR = "00000000-0000-0000-0000-00000000aa01";

const emit = async (tx: RelayTx, e: { topic: string; entity: string; entityId: string; payload: Record<string, unknown>; orgId: string; regionId: string; action: string; before?: unknown; after?: unknown }, at: Date) => {
  if (!isTopic(e.topic)) throw new Error(`worker: "${e.topic}" is not in the event catalogue`);
  const eventId = randomUUID();
  await tx.query(
    `INSERT INTO audit_log (event_id, actor_id, surface_id, action, entity, entity_id, before, after, region_id, org_id, occurred_at)
     VALUES ($1,$2,'worker',$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10)`,
    [eventId, WORKER_ACTOR, e.action, e.entity, e.entityId, JSON.stringify(e.before ?? null), JSON.stringify(e.after ?? null), e.regionId, e.orgId, at.toISOString()],
  );
  await tx.query(
    `INSERT INTO outbox (event_id, topic, entity, entity_id, payload, actor_id, surface_id, region_id, org_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'worker',$7,$8,$9)`,
    [eventId, e.topic, e.entity, e.entityId, JSON.stringify(e.payload), WORKER_ACTOR, e.regionId, e.orgId, at.toISOString()],
  );
  return eventId;
};

/**
 * CREDENTIAL EXPIRY (B5). Emits credential.expiring at 30 days and
 * credential.expired on the day. A credential expiring inside an already
 * assigned job's window is the one that matters: the gate cleared it when it
 * was true, and it is about to stop being true.
 */
export const sweepCredentialExpiry = async (tx: RelayTx, today: Date): Promise<number> => {
  const iso = today.toISOString().slice(0, 10);
  const rows = await tx.query<{ id: string; crew_id: string; kind: string; valid_to: string; org_id: string; region_id: string; days_left: number; assigned_jobs: number }>(
    `SELECT c.id, c.crew_id, c.kind, to_char(c.valid_to,'YYYY-MM-DD') AS valid_to, c.org_id, c.region_id,
            (c.valid_to - $1::date) AS days_left,
            (SELECT count(*) FROM assignments a JOIN jobs j ON j.id = a.job_id
              WHERE a.crew_id = c.crew_id AND a.released_at IS NULL AND upper(j.service_window) > c.valid_to::timestamptz) AS assigned_jobs
       FROM crew_credentials c
      WHERE c.valid_to BETWEEN $1::date AND ($1::date + 30)
        AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'crew_credential' AND o.entity_id = c.id
                          AND o.topic = CASE WHEN c.valid_to <= $1::date THEN 'credential.expired' ELSE 'credential.expiring' END
                          AND o.occurred_at::date = $1::date)`,
    [iso],
  );
  for (const r of rows) {
    const topic = r.days_left <= 0 ? "credential.expired" : "credential.expiring";
    await emit(tx, {
      topic, entity: "crew_credential", entityId: r.id, action: `credential.${topic.split(".")[1]}`,
      payload: { crewId: r.crew_id, kind: r.kind, validTo: r.valid_to, daysLeft: r.days_left, assignedJobsAtRisk: Number(r.assigned_jobs) },
      orgId: r.org_id, regionId: r.region_id, after: { validTo: r.valid_to, daysLeft: r.days_left },
    }, today);
  }
  await tx.commit();
  return rows.length;
};

/**
 * SLA CASCADE (C6). Runs every minute. shadow_mode is per timer (inherited
 * from the region's setting at open); the cascade records what it WOULD do
 * either way, so a shadow week means something when it is turned on.
 */
export const sweepSlaCascade = async (tx: RelayTx, now: Date): Promise<number> => {
  const rows = await tx.query<{ id: string; job_id: string; response_term: string; opened_at: string; due_at: string; satisfied_at: string | null; breached_at: string | null; escalation_stage: number; shadow_mode: boolean; org_id: string; region_id: string }>(
    `SELECT id, job_id, response_term, opened_at, due_at, satisfied_at, breached_at, escalation_stage, shadow_mode, org_id, region_id
       FROM sla_timers WHERE satisfied_at IS NULL AND escalation_stage < 3 FOR UPDATE SKIP LOCKED`,
  );
  let actions = 0;
  for (const r of rows) {
    const t: TimerState = {
      opened_at: new Date(r.opened_at), due_at: new Date(r.due_at), satisfied_at: r.satisfied_at ? new Date(r.satisfied_at) : null,
      breached_at: r.breached_at ? new Date(r.breached_at) : null, escalation_stage: r.escalation_stage as TimerState["escalation_stage"], shadow_mode: r.shadow_mode,
    };
    const terms: SlaTerms = { response: r.response_term };
    const action = evaluateCascade(t, now, terms);
    if (!action) continue;
    actions++;
    await tx.query(`UPDATE sla_timers SET escalation_stage = $2, breached_at = CASE WHEN $2 = 3 THEN $3 ELSE breached_at END WHERE id = $1`, [r.id, action.stage, now.toISOString()]);
    await emit(tx, {
      topic: action.stage === 3 ? "sla.breached" : "sla.escalated", entity: "sla_timer", entityId: r.id, action: `sla.stage_${action.stage}`,
      payload: { jobId: r.job_id, stage: action.stage, audience: action.audience, shadow: action.shadow, reason: action.reason },
      orgId: r.org_id, regionId: r.region_id, before: { stage: r.escalation_stage }, after: { stage: action.stage, shadow: action.shadow },
    }, now);
  }
  await tx.commit();
  return actions;
};
