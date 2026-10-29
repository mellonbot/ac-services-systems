import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { JOB_SELECT, toWire, requireUuid, requireText, jobInScope, type JobRow } from "./jobs.ts";
import { iso } from "../sql.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import type {
  JobDetailInput, JobDetailOutput, JobConversationInput, JobConversationOutput, JobVisitWire, JobMediaWire, JobNoteWire,
  JobUpdateWire, JobMessageWire, JobContactWire, JobNoteKind, JobUpdateState, JobWrapUpWire, WrapUpOutcome, WrapUpMeasurementsWire,
  SaveJobUpdateInput, SaveJobUpdateOutput, PublishJobUpdateInput, PublishJobUpdateOutput, PostJobMessageInput, PostJobMessageOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * 0016 — ONE JOB, AS DISPATCH READS IT, AND WHAT THE CUSTOMER IS TOLD.
 *
 * jobs.detail is S3's: everything the office knows about a job, read under
 * the caller's own RLS — internal notes and draft updates included, because
 * the office may read them. jobs.conversation is S6's: the same updates and
 * thread tables read as the customer, where 0016's policies return published
 * updates only and no note at all. Neither filters by hand; the database
 * decides, and the integration tests read both sides to prove it.
 */
const MAX_BODY = 2000;

const body = (v: unknown, what: string): string => {
  const b = requireText(v, "body");
  if (b.length > MAX_BODY) throw new BadInput(`${what} must be ${MAX_BODY} characters or fewer`);
  return b;
};

type UpdateRow = { id: string; source_note_id: string | null; body: string; state: JobUpdateState; updated_at: string; published_at: string | null; published_by_name: string | null };
const updateWire = (r: UpdateRow): JobUpdateWire => ({
  id: r.id, sourceNoteId: r.source_note_id, body: r.body, state: r.state,
  updatedAt: r.updated_at, publishedAt: r.published_at, publishedByName: r.published_by_name,
});
const readUpdates = async (uow: UnitOfWork, jobId: string): Promise<JobUpdateWire[]> =>
  (await uow.tx.query<UpdateRow>(
    `SELECT u.id, u.source_note_id, u.body, u.state, ${iso("u.updated_at")} AS updated_at, ${iso("u.published_at")} AS published_at, pb.display_name AS published_by_name
       FROM job_updates u LEFT JOIN users pb ON pb.id = u.published_by
      WHERE u.job_id = $1 ORDER BY u.created_at, u.id`, [jobId],
  )).map(updateWire);

type MessageRow = { id: string; author_kind: "customer" | "office"; author_name: string | null; body: string; at: string };
const readMessages = async (uow: UnitOfWork, jobId: string): Promise<JobMessageWire[]> =>
  (await uow.tx.query<MessageRow>(
    `SELECT m.id, m.author_kind, u.display_name AS author_name, m.body, ${iso("m.created_at")} AS at
       FROM job_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.job_id = $1 ORDER BY m.created_at, m.id`, [jobId],
  )).map((r) => ({ id: r.id, authorKind: r.author_kind, authorName: r.author_name, body: r.body, at: r.at }));

export const jobDetail = async (uow: UnitOfWork, input: JobDetailInput): Promise<JobDetailOutput> => {
  const jobId = requireUuid(input.jobId, "jobId");
  const row = (await uow.tx.query<JobRow>(`${JOB_SELECT} WHERE j.id = $1`, [jobId]))[0];
  if (!row) throw new InputRefused(`job ${jobId} not found in scope`, "unknown_job");

  // The nearest contact up the site's own path: the site's manager, else the location's desk.
  const contact = (await uow.tx.query<JobContactWire>(
    `SELECT c.name, c.phone, c.email
       FROM accounts s JOIN account_contacts c ON c.account_id = ANY(s.path) AND c.active
      WHERE s.id = $1
      ORDER BY array_position(s.path, c.account_id) DESC, c.is_primary DESC, (c.role = 'site_manager') DESC, c.created_at
      LIMIT 1`, [row.site_id],
  ))[0] ?? null;

  // A visit is an assignment; its span is the crew's own time entries on this job inside it.
  const visits = (await uow.tx.query<{ id: string; crew_id: string; crew_label: string | null; assigned_at: string; released_at: string | null; work_start: string | null; work_end: string | null }>(
    `SELECT a.id, a.crew_id, c.label AS crew_label, ${iso("a.assigned_at")} AS assigned_at, ${iso("a.released_at")} AS released_at,
            ${iso("w.work_start")} AS work_start, ${iso("w.work_end")} AS work_end
       FROM assignments a
       LEFT JOIN crews c ON c.id = a.crew_id
       LEFT JOIN LATERAL (
         SELECT min(lower(t.span)) AS work_start, max(upper(t.span)) AS work_end
           FROM time_entries t
          WHERE t.job_id = a.job_id AND t.crew_id = a.crew_id
            AND lower(t.span) >= a.assigned_at AND (a.released_at IS NULL OR lower(t.span) < a.released_at)
       ) w ON true
      WHERE a.job_id = $1
      ORDER BY a.assigned_at, a.id`, [jobId],
  )).map((r): JobVisitWire => ({
    id: r.id, crewId: r.crew_id, crewLabel: r.crew_label, assignedAt: r.assigned_at, releasedAt: r.released_at, workStart: r.work_start, workEnd: r.work_end,
  }));

  const media = (await uow.tx.query<{ id: string; kind: string; storage_key: string; label: string | null; captured_at: string }>(
    `SELECT id, kind, storage_key, meta->>'label' AS label, ${iso("captured_at")} AS captured_at
       FROM job_media WHERE job_id = $1 ORDER BY captured_at, id`, [jobId],
  )).map((r): JobMediaWire => ({ id: r.id, kind: r.kind, storageKey: r.storage_key, label: r.label, capturedAt: r.captured_at }));

  const notes = (await uow.tx.query<{ id: string; body: string; kind: JobNoteKind; at: string; author_name: string | null }>(
    `SELECT n.id, n.body, n.kind, ${iso("n.created_at")} AS at, u.display_name AS author_name
       FROM job_notes n LEFT JOIN users u ON u.id = n.author_id
      WHERE n.job_id = $1 ORDER BY n.created_at, n.id`, [jobId],
  )).map((r): JobNoteWire => ({ id: r.id, body: r.body, kind: r.kind, at: r.at, authorName: r.author_name }));

  const w = (await uow.tx.query<{
    outcome: WrapUpOutcome; submitted_at: string; submitted_by: string | null; crew_label: string | null; notes: string | null;
    measurements: WrapUpMeasurementsWire | null; signature_media_id: string | null; customer_absent_reason: string | null;
    quote_job_id: string | null; quote_job_no: string | null; quote_error: string | null;
  }>(
    `SELECT w.outcome, ${iso("w.submitted_at")} AS submitted_at, u.display_name AS submitted_by, c.label AS crew_label, w.notes, w.measurements,
            w.signature_media_id, w.customer_absent_reason, w.quote_job_id, q.job_no AS quote_job_no, w.quote_error
       FROM job_wrap_ups w
       LEFT JOIN users u ON u.id = w.submitted_by
       LEFT JOIN crews c ON c.id = w.crew_id
       LEFT JOIN jobs q ON q.id = w.quote_job_id
      WHERE w.job_id = $1`, [jobId],
  ))[0];
  const wrapUp: JobWrapUpWire | null = w ? {
    outcome: w.outcome, submittedAt: w.submitted_at, submittedByName: w.submitted_by, crewLabel: w.crew_label, notes: w.notes, measurements: w.measurements,
    signatureMediaId: w.signature_media_id, customerAbsentReason: w.customer_absent_reason,
    quoteJobId: w.quote_job_id, quoteJobNo: w.quote_job_no, quoteError: w.quote_error,
  } : null;

  return { job: toWire(row), contact, visits, media, notes, updates: await readUpdates(uow, jobId), messages: await readMessages(uow, jobId), wrapUp };
};

/** S6: a job the customer may see, and only what it may read about it. */
export const jobConversation = async (uow: UnitOfWork, input: JobConversationInput): Promise<JobConversationOutput> => {
  const jobId = requireUuid(input.jobId, "jobId");
  const visible = (await uow.tx.query(`SELECT 1 FROM jobs WHERE id = $1`, [jobId]))[0];
  if (!visible) throw new InputRefused(`job ${jobId} not found in scope`, "unknown_job");
  return { jobId, updates: await readUpdates(uow, jobId), messages: await readMessages(uow, jobId) };
};

/** S3: a new draft, or new words on a draft. Never on a published update — the trigger refuses that too. */
export const saveJobUpdate = async (uow: UnitOfWork, actorId: string, input: SaveJobUpdateInput, newId: () => string, at: Date): Promise<SaveJobUpdateOutput> => {
  const text = body(input.body, "an update");
  const job = await jobInScope(uow, input);

  if (input.updateId !== undefined) {
    const updateId = requireUuid(input.updateId, "updateId");
    const u = (await uow.tx.query<{ job_id: string; state: JobUpdateState; body: string }>(`SELECT job_id, state, body FROM job_updates WHERE id = $1`, [updateId]))[0];
    if (!u || u.job_id !== job.jobId) throw new InputRefused(`update ${updateId} is not a draft on job ${job.jobId}`, "unknown_update");
    if (u.state === "published") throw new InputRefused(`update ${updateId} is already published to the customer — a correction is a new update`, "already_published");
    const eventId = await uow.apply(
      {
        entity: "job_update", entityId: job.jobId, action: "job.update.edit", topic: "job.annotated",
        before: { updateId, body: u.body }, after: { updateId, body: text },
        orgId: job.org_id, regionId: job.region_id, payload: { jobId: job.jobId, updateId },
      },
      async (tx) => { await tx.query(`UPDATE job_updates SET body = $2, updated_at = $3 WHERE id = $1 AND state = 'draft'`, [updateId, text, at.toISOString()]); },
    );
    return { id: updateId, state: "draft", eventId };
  }

  let sourceNoteId: string | null = null;
  if (input.sourceNoteId !== undefined) {
    sourceNoteId = requireUuid(input.sourceNoteId, "sourceNoteId");
    const n = (await uow.tx.query<{ job_id: string }>(`SELECT job_id FROM job_notes WHERE id = $1`, [sourceNoteId]))[0];
    if (!n || n.job_id !== job.jobId) throw new BadInput(`note ${sourceNoteId} is not a note on job ${job.jobId}`);
  }
  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "job_update", entityId: job.jobId, action: "job.update.draft", topic: "job.annotated",
      before: null, after: { updateId: id, sourceNoteId, body: text },
      orgId: job.org_id, regionId: job.region_id, payload: { jobId: job.jobId, updateId: id },
    },
    async (tx) => {
      await tx.insert("job_updates", { id, org_id: job.org_id, region_id: job.region_id, job_id: job.jobId, source_note_id: sourceNoteId, body: text, author_id: actorId, updated_at: at.toISOString() });
    },
  );
  return { id, state: "draft", eventId };
};

/** S3: the draft goes to the customer, once. */
export const publishJobUpdate = async (uow: UnitOfWork, actorId: string, input: PublishJobUpdateInput, at: Date): Promise<PublishJobUpdateOutput> => {
  const updateId = requireUuid(input.updateId, "updateId");
  const u = (await uow.tx.query<{ job_id: string; state: JobUpdateState; org_id: string; region_id: string }>(
    `SELECT job_id, state, org_id, region_id FROM job_updates WHERE id = $1`, [updateId],
  ))[0];
  if (!u) throw new InputRefused(`update ${updateId} not found in scope`, "unknown_update");
  if (u.state === "published") throw new InputRefused(`update ${updateId} is already published to the customer`, "already_published");
  const publishedAt = at.toISOString();
  const eventId = await uow.apply(
    {
      entity: "job_update", entityId: u.job_id, action: "job.update.publish", topic: "job.update_published",
      before: { updateId, state: "draft" }, after: { updateId, state: "published", publishedAt },
      orgId: u.org_id, regionId: u.region_id, payload: { jobId: u.job_id, updateId },
    },
    async (tx) => {
      const done = await tx.query(
        `UPDATE job_updates SET state = 'published', published_at = $2, published_by = $3, updated_at = $2 WHERE id = $1 AND state = 'draft' RETURNING id`,
        [updateId, publishedAt, actorId],
      );
      if (done.length === 0) throw new InputRefused(`update ${updateId} was published while this request was in flight`, "already_published");
    },
  );
  return { id: updateId, publishedAt, eventId };
};

/** S3 and S6: one door into the thread. Which side wrote it is the namespace, not the payload. */
export const postJobMessage = async (uow: UnitOfWork, principal: Principal, input: PostJobMessageInput, newId: () => string): Promise<PostJobMessageOutput> => {
  const authorKind = principal.namespace === "internal" ? "office" : principal.namespace === "customer" ? "customer" : null;
  if (!authorKind) throw new InputRefused("only the office and the customer write in a job's thread", "unknown_job");
  const jobId = requireUuid(input.jobId, "jobId");
  const text = body(input.body, "a message");
  const job = (await uow.tx.query<{ org_id: string; region_id: string }>(`SELECT org_id, region_id FROM jobs WHERE id = $1`, [jobId]))[0];
  if (!job) throw new InputRefused(`job ${jobId} not found in scope`, "unknown_job");
  const id = newId();
  const eventId = await uow.apply(
    {
      entity: "job_message", entityId: jobId, action: "job.message.post", topic: "job.message_posted",
      before: null, after: { messageId: id, authorKind },
      orgId: job.org_id, regionId: job.region_id, payload: { jobId, messageId: id, authorKind },
    },
    async (tx) => {
      await tx.insert("job_messages", { id, org_id: job.org_id, region_id: job.region_id, job_id: jobId, author_kind: authorKind, author_id: principal.subjectId, body: text });
    },
  );
  return { id, authorKind, eventId };
};
