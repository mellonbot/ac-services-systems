import { randomUUID } from "node:crypto";
import type { RelayTx } from "./relay.ts";
import { emit, WORKER_ACTOR } from "./sweeps.ts";
import { createJob } from "../../gateway/src/handlers/jobs.ts";
import type { UnitOfWork } from "../../gateway/src/db/unit-of-work.ts";

/** How long a quote job's window runs from the day the technician asked for it. */
export const QUOTE_WINDOW_DAYS = 7;

/**
 * QUOTE JOBS (0034). A technician's "Quote needed" completes the visit and
 * records the unit's measurements; the QUOTE job is opened here, because a
 * device cannot open one — its SLA comes from the site's terms, which only
 * the office reads. Opened through the gateway's own createJob, so it takes
 * the same SLA derivation and the same refusals as one the office opens, then
 * moved to quote_requested, where the office prices it (0013).
 *
 * The worker is the author: `apply` below writes the audit and outbox rows
 * as the worker, the way every sweep does. A wrap-up the worker cannot open a
 * job for (no SLA term at the site, say) keeps quote_job_id empty and says
 * why in quote_error — the office sees it — and is tried again next sweep.
 */
export const sweepQuoteJobs = async (tx: RelayTx, now: Date): Promise<{ opened: number; refused: number }> => {
  const rows = await tx.query<{ id: string; job_id: string; site_id: string; job_no: string | null; notes: string | null }>(
    `SELECT w.id, w.job_id, j.site_id, j.job_no, w.notes
       FROM job_wrap_ups w JOIN jobs j ON j.id = w.job_id
      WHERE w.outcome = 'quote_needed' AND w.quote_job_id IS NULL
      ORDER BY w.created_at LIMIT 20
      FOR UPDATE OF w SKIP LOCKED`,
  );
  // createJob asks for the gateway's unit of work and uses two members of it:
  // the transaction, and `apply`, which here writes as the worker.
  const asWorker = {
    tx,
    apply: async (m: Parameters<UnitOfWork["apply"]>[0], write: (t: RelayTx) => Promise<void>) => {
      await write(tx);
      return emit(tx, { topic: m.topic, entity: m.entity, entityId: m.entityId, payload: (m.payload ?? { after: m.after }) as Record<string, unknown>, orgId: m.orgId, regionId: m.regionId, action: `worker.${m.action}`, before: m.before, after: m.after }, now);
    },
  } as unknown as UnitOfWork;

  let opened = 0, refused = 0;
  for (const w of rows) {
    await tx.query("SAVEPOINT quote_job");
    try {
      const job = await createJob(asWorker, {
        siteId: w.site_id, serviceCode: "QUOTE", priority: "routine",
        serviceWindowStart: now.toISOString(), serviceWindowEnd: new Date(now.getTime() + QUOTE_WINDOW_DAYS * 86_400_000).toISOString(),
      }, randomUUID, now);
      await tx.query("UPDATE jobs SET state = 'quote_requested', version = version + 1 WHERE id = $1", [job.id]);
      await tx.query(
        `INSERT INTO job_state_events (org_id, region_id, job_id, from_state, to_state, actor_id, surface_id, mutation_id, occurred_at)
         VALUES ($1, $2, $3, 'created', 'quote_requested', $4, 'worker', $5, $6)`,
        [job.orgId, job.regionId, job.id, WORKER_ACTOR, `worker:quote:${w.id}`, now.toISOString()],
      );
      const from = w.job_no ?? w.job_id;
      await tx.query(
        `INSERT INTO job_notes (org_id, region_id, job_id, body, author_id, kind) VALUES ($1, $2, $3, $4, $5, 'standing')`,
        [job.orgId, job.regionId, job.id, `Quote asked for from the field on ${from}.${w.notes ? ` ${w.notes}` : ""}`.slice(0, 2000), WORKER_ACTOR],
      );
      await tx.query("UPDATE job_wrap_ups SET quote_job_id = $2, quote_error = NULL WHERE id = $1", [w.id, job.id]);
      await emit(tx, {
        topic: "job.transitioned", entity: "job", entityId: job.id, action: "worker.quote_job.open",
        payload: { jobId: job.id, from: "created", to: "quote_requested", fromJobId: w.job_id },
        orgId: job.orgId, regionId: job.regionId, before: { state: "created" }, after: { state: "quote_requested" },
      }, now);
      await tx.query("RELEASE SAVEPOINT quote_job");
      opened++;
    } catch (e) {
      await tx.query("ROLLBACK TO SAVEPOINT quote_job");
      await tx.query("UPDATE job_wrap_ups SET quote_error = $2 WHERE id = $1", [w.id, (e as Error).message.slice(0, 500)]);
      refused++;
    }
  }
  await tx.commit();
  return { opened, refused };
};
