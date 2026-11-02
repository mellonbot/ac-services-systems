import type { RelayTx } from "./relay.ts";
import { evaluateCascade, SLA_NOT_OWED_STATES, type TimerState, type SlaTerms } from "../../../packages/domain/src/sla/index.ts";
import { randomUUID } from "node:crypto";
import { isTopic } from "../../../packages/contracts/src/events.ts";
import type { ScopeBinding } from "../../../packages/contracts/src/scope.ts";
import { INTERNAL_ORG_ID } from "../../../packages/schema/src/tenancy.ts";

/**
 * SCHEDULED SWEEPS. Each runs as the ac_worker role, inside one transaction,
 * and writes through the same audit+outbox pair the gateway does — by hand
 * here, because the worker has no surface and no principal; its actor is the
 * well-known WORKER id and its surface is "worker". The audit trigger and the
 * outbox shape do not care who writes; they care that both rows land together.
 */
export const WORKER_ACTOR = "00000000-0000-0000-0000-00000000aa01";

/**
 * THE WORKER'S SCOPE BINDING. Every table the sweeps read is behind row-level
 * security whose policies read `ac.*` settings, and a transaction that has
 * bound none is a principal from nowhere: `ac_region_visible` is false, and
 * the sweep sees zero rows — not an error, zero rows. That is how the SLA
 * cascade and the credential-expiry sweep ran green for a week against a live
 * database and escalated nothing (found 2026-09-18 while reading the schema
 * as a firm for item 7). The worker is us, org-wide, or pinned to one region
 * for Tier 3; it says so before its first statement, the way the gateway does.
 */
export const workerScope = (regionId?: string): ScopeBinding => ({
  "ac.namespace": "internal",
  "ac.org_id": INTERNAL_ORG_ID,
  "ac.region_id": regionId ?? "",
  "ac.scope_tier": regionId ? "region" : "parent",
  "ac.scope_id": regionId ?? INTERNAL_ORG_ID,
  "ac.firm_id": "",
  "ac.device_id": "",
  "ac.actor_id": WORKER_ACTOR,
  "ac.surface_id": "worker",
});

export const emit = async (tx: RelayTx, e: { topic: string; entity: string; entityId: string; payload: Record<string, unknown>; orgId: string; regionId: string; action: string; before?: unknown; after?: unknown }, at: Date) => {
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
 * CREDENTIAL EXPIRY (B5). Emits credential.expiring once at each of
 * EXPIRY_WARN_DAYS before valid_to, and credential.expired the day after it.
 * valid_to is inclusive — the gate clears a window through the end of that day
 * (UTC, gateway/handlers/assignment.ts) — so its last day is a warning, not an
 * expiry. A credential expiring inside an already assigned job's window is the
 * one that matters: the gate cleared it when it was true, and it is about to
 * stop being true.
 *
 * Not swept: a credential an active crew has already replaced (a verified
 * document of the same kind that starts by the day after this one ends and
 * runs past it), and any credential of an inactive crew. Neither is anything
 * anyone needs to act on.
 */
export const EXPIRY_WARN_DAYS: readonly number[] = Object.freeze([30, 7, 1]);

/** A verified credential of the same kind, for the same crew, that carries on where `c` ends. Shared with the HQ rollup. */
export const SUPERSEDED = (c: string) =>
  `EXISTS (SELECT 1 FROM crew_credentials n WHERE n.crew_id = ${c}.crew_id AND n.kind = ${c}.kind AND n.id <> ${c}.id
             AND n.verified_at IS NOT NULL AND n.valid_from <= ${c}.valid_to + 1 AND n.valid_to > ${c}.valid_to)`;

export const sweepCredentialExpiry = async (tx: RelayTx, today: Date): Promise<number> => {
  const iso = today.toISOString().slice(0, 10);
  // The dedupe below reads the outbox. Two workers (the unregioned one and a
  // Tier 3 regional one, or two replicas) running this at once would each
  // read no row and each warn; the lock makes the second wait and see the first's.
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('ac-worker:credential-expiry'))");
  const rows = await tx.query<{ id: string; crew_id: string; kind: string; valid_to: string; org_id: string; region_id: string; days_left: number; threshold: number | null; assigned_jobs: number }>(
    // $1 is a UTC date (toISOString), so every day here is a UTC day, as the
    // gate's is. A job is at risk when its window ends after the credential's
    // last instant: UTC midnight that starts the day after valid_to.
    `WITH due AS (
       SELECT c.id, c.crew_id, c.kind, c.valid_to, c.org_id, c.region_id, (c.valid_to - $1::date) AS days_left
         FROM crew_credentials c JOIN crews cr ON cr.id = c.crew_id
        WHERE cr.active AND c.valid_to BETWEEN $1::date - 1 AND $1::date + 30
          AND NOT ${SUPERSEDED("c")}
     ), marked AS (
       -- The nearest warning mark at or above the days left; none once it has expired.
       SELECT d.*, CASE WHEN d.days_left < 0 THEN NULL ELSE (SELECT min(w) FROM unnest($2::int[]) AS w WHERE w >= d.days_left) END AS threshold
         FROM due d
     )
     SELECT m.id, m.crew_id, m.kind, to_char(m.valid_to,'YYYY-MM-DD') AS valid_to, m.org_id, m.region_id, m.days_left, m.threshold,
            (SELECT count(*) FROM assignments a JOIN jobs j ON j.id = a.job_id
              WHERE a.crew_id = m.crew_id AND a.released_at IS NULL
                AND upper(j.service_window) >= ((m.valid_to + 1)::timestamp AT TIME ZONE 'UTC')) AS assigned_jobs
       FROM marked m
      -- Once per mark, and once on expiry — not once a day for thirty days.
      WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.entity = 'crew_credential' AND o.entity_id = m.id
                          AND o.topic = CASE WHEN m.threshold IS NULL THEN 'credential.expired' ELSE 'credential.expiring' END
                          AND (m.threshold IS NULL OR o.payload->>'threshold' = m.threshold::text))`,
    [iso, EXPIRY_WARN_DAYS],
  );
  for (const r of rows) {
    const topic = r.days_left < 0 ? "credential.expired" : "credential.expiring";
    await emit(tx, {
      topic, entity: "crew_credential", entityId: r.id, action: `credential.${topic.split(".")[1]}`,
      payload: { crewId: r.crew_id, kind: r.kind, validTo: r.valid_to, daysLeft: r.days_left, ...(r.threshold === null ? {} : { threshold: r.threshold }), assignedJobsAtRisk: Number(r.assigned_jobs) },
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
    // A job that ended before anyone was sent, is done, or is waiting on the
    // customer's answer to a quote owes no response (SLA_NOT_OWED_STATES): its
    // timer is not escalated, and not paged on. Oldest due first, a minute's
    // worth at a time.
    `SELECT t.id, t.job_id, t.response_term, t.opened_at, t.due_at, t.satisfied_at, t.breached_at, t.escalation_stage, t.shadow_mode, t.org_id, t.region_id
       FROM sla_timers t JOIN jobs j ON j.id = t.job_id
      WHERE t.satisfied_at IS NULL AND t.escalation_stage < 3
        AND j.state <> ALL($1::text[])
      ORDER BY t.due_at
      LIMIT 500
      FOR UPDATE OF t SKIP LOCKED`,
    [SLA_NOT_OWED_STATES],
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
