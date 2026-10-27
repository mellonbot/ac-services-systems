import { createHash } from "node:crypto";
import type { UnitOfWork } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { storageKey, type ObjectStore } from "../../../../packages/storage/src/index.ts";
import {
  PHOTO_MAX_BYTES, JOB_MEDIA_MAX, WRAP_UP_MIN_PHOTOS, QUOTE_MIN_PHOTOS, sniffPhoto, measurementsFault,
  type AttachJobMediaInput, type AttachJobMediaOutput, type WrapUpInput, type WrapUpOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * WRAPPING UP A VISIT FROM THE FIELD (0034).
 *
 * The device uploads each photo and the signature first (attachJobMedia),
 * each under its own mutationId, then submits the wrap-up naming them
 * (wrapUpJob). Both are idempotent, so the device's outbox can replay either
 * after a dropped answer. The wrap-up's rules are checked against what was
 * stored, never against the device's count: the photos it names must exist
 * on this job, enough of them, and the signature too.
 *
 * Whose job: the grant's crew's, while its assignment is live — the line
 * sync.replay holds (handlers/sync.ts). A released crew's wrap-up is refused
 * here rather than queued: unlike a time entry, completing a job that may now
 * be another crew's is not something to apply late.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64 = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;
const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};
const mutationId = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.length === 0 || v.length > 200) throw new BadInput(`${field} must be a non-empty string`);
  return v;
};
const instant = (v: unknown, field: string): string => {
  if (typeof v !== "string" || v.length > 64 || Number.isNaN(Date.parse(v))) throw new BadInput(`${field} must be a timestamp`);
  return new Date(v).toISOString();
};

type CrewJob = { readonly org_id: string; readonly region_id: string; readonly state: string; readonly version: number; readonly crew_id: string };
/** The job, locked, if this shift's crew holds it live; refused by name otherwise. */
const crewJob = async (uow: UnitOfWork, grantId: string, jobId: string): Promise<CrewJob> => {
  const row = (await uow.tx.query<CrewJob & { live: boolean }>(
    `SELECT j.org_id, j.region_id, j.state, j.version, g.crew_id,
            EXISTS (SELECT 1 FROM assignments a WHERE a.job_id = j.id AND a.crew_id = g.crew_id AND a.released_at IS NULL) AS live
       FROM jobs j, device_grants g
      WHERE j.id = $2 AND g.id = $1
      FOR UPDATE OF j`,
    [grantId, jobId],
  ))[0];
  if (!row || !row.live) throw new InputRefused(`job ${jobId} is not one this crew is on — tell the office`, "not_your_job");
  return row;
};

export const attachJobMedia = async (
  uow: UnitOfWork, actorId: string, grantId: string, store: ObjectStore | null, input: AttachJobMediaInput, newId: () => string,
): Promise<AttachJobMediaOutput> => {
  const jobId = uuid(input.jobId, "jobId");
  const mid = mutationId(input.mutationId, "mutationId");
  if (input.kind !== "photo" && input.kind !== "signature") throw new BadInput("kind is photo or signature");
  const capturedAt = instant(input.capturedAt, "capturedAt");
  if (typeof input.dataBase64 !== "string" || input.dataBase64.length === 0) throw new BadInput("dataBase64 is required");
  if (input.dataBase64.length > MAX_BASE64 + 4) throw new InputRefused("a photo is at most 10 MB", "photo_too_large");
  if (!BASE64.test(input.dataBase64)) throw new BadInput("dataBase64 is not base64");

  const job = await crewJob(uow, grantId, jobId);
  // A retried upload: the row is already there. Answered before the bytes are judged, so a replay costs nothing.
  const prior = (await uow.tx.query<{ id: string }>(`SELECT id FROM job_media WHERE job_id = $1 AND mutation_id = $2`, [jobId, mid]))[0];
  if (prior) return { id: prior.id, jobId, duplicate: true };

  const bytes = new Uint8Array(Buffer.from(input.dataBase64, "base64"));
  if (bytes.length > PHOTO_MAX_BYTES) throw new InputRefused("a photo is at most 10 MB", "photo_too_large");
  const contentType = sniffPhoto(bytes);
  if (!contentType) throw new InputRefused("that file is not a JPEG, PNG or HEIC photo", "not_a_photo");
  if (input.kind === "signature" && contentType !== "image/png") throw new InputRefused("a signature is sent as a PNG", "not_a_photo");
  if (!store) throw new InputRefused("photo storage is not configured on this gateway", "storage_not_configured");
  const count = (await uow.tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM job_media WHERE job_id = $1`, [jobId]))[0]!.n;
  if (count >= JOB_MEDIA_MAX) throw new InputRefused(`a job carries at most ${JOB_MEDIA_MAX} photos and signatures`, "too_many_photos");

  const id = newId();
  const key = storageKey(job.region_id, job.org_id, input.kind === "photo" ? "job_photo" : "job_signature", id);
  const sha256 = createHash("sha256").update(bytes).digest();
  await uow.apply(
    {
      entity: input.kind, entityId: id, action: `job.attach_${input.kind}`, topic: "job.media_attached",
      before: null, after: { id, jobId, kind: input.kind, contentType, bytes: bytes.length },
      orgId: job.org_id, regionId: job.region_id,
      payload: { jobId, kind: input.kind },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO storage_objects (id, org_id, region_id, storage_key, content_type, byte_size, sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, job.org_id, job.region_id, key, contentType, bytes.length, sha256, actorId],
      );
      await tx.query(
        `INSERT INTO job_media (id, org_id, region_id, job_id, storage_key, kind, captured_at, captured_by, mutation_id, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [id, job.org_id, job.region_id, jobId, key, input.kind, capturedAt, actorId, mid, JSON.stringify({ contentType, bytes: bytes.length })],
      );
      try { await store.put(key, bytes, contentType); } catch (e) {
        console.error(e);
        throw new InputRefused("photo storage did not answer — the photo is still on the device and will be sent again", "storage_unavailable");
      }
    },
  );
  return { id, jobId, duplicate: false };
};

export const wrapUpJob = async (uow: UnitOfWork, actorId: string, grantId: string, input: WrapUpInput): Promise<WrapUpOutput> => {
  const jobId = uuid(input.jobId, "jobId");
  const wrapUpId = mutationId(input.wrapUpId, "wrapUpId");
  if (input.outcome !== "complete" && input.outcome !== "quote_needed") throw new BadInput("outcome is complete or quote_needed");
  const submittedAt = instant(input.submittedAt, "submittedAt");
  const notes = input.notes === undefined || input.notes.trim() === "" ? null : input.notes;
  if (notes !== null && (typeof notes !== "string" || notes.length > 4000)) throw new BadInput("notes are at most 4000 characters");
  if (!Array.isArray(input.photoMutationIds) || input.photoMutationIds.length > JOB_MEDIA_MAX) throw new BadInput(`photoMutationIds is a list of at most ${JOB_MEDIA_MAX}`);
  const photoIds = [...new Set(input.photoMutationIds.map((p, i) => mutationId(p, `photoMutationIds[${i}]`)))];
  const signed = input.signatureMutationId !== undefined;
  const absent = input.customerAbsentReason === undefined ? null : String(input.customerAbsentReason).trim();
  if (signed === (absent !== null)) throw new BadInput("send the signature or why there is none — one of the two");
  if (absent !== null && (absent.length < 3 || absent.length > 500)) throw new InputRefused("say why no one could sign, in a few words", "absent_needs_reason");
  const quote = input.outcome === "quote_needed";
  if (quote) {
    const fault = measurementsFault(input.measurements);
    if (fault) throw new InputRefused(`a quote needs the unit's measurements: ${fault}`, "measurements_incomplete");
  } else if (input.measurements !== undefined) {
    throw new BadInput("measurements are sent with Quote needed only");
  }

  // A replay is answered before the crew is checked — the wrap-up stands even if the crew has since been released —
  // and again once the job is locked, because a retry sent while the first submit was in flight waits on that lock.
  const replayed = async () => {
    const prior = (await uow.tx.query<{ job_id: string }>(`SELECT job_id FROM job_wrap_ups WHERE wrap_up_id = $1`, [wrapUpId]))[0];
    if (prior && prior.job_id !== jobId) throw new BadInput(`wrapUpId ${wrapUpId} already closed a different job`);
    return prior !== undefined;
  };
  if (await replayed()) return { jobId, wrapUpId, state: "complete", duplicate: true };
  const job = await crewJob(uow, grantId, jobId);
  if (await replayed()) return { jobId, wrapUpId, state: "complete", duplicate: true };
  if (job.state !== "in_progress") throw new InputRefused(`this job is ${job.state.replace(/_/g, " ")} — a wrap-up completes a job in progress`, "not_in_progress");

  const min = quote ? QUOTE_MIN_PHOTOS : WRAP_UP_MIN_PHOTOS;
  if (photoIds.length < min) throw new InputRefused(`${quote ? "a quote" : "a completion"} needs at least ${min} photos; ${photoIds.length} sent`, "too_few_photos");
  const media = await uow.tx.query<{ id: string; kind: string; mutation_id: string }>(
    `SELECT id, kind, mutation_id FROM job_media WHERE job_id = $1 AND mutation_id = ANY($2::text[])`,
    [jobId, signed ? [...photoIds, input.signatureMutationId!] : photoIds],
  );
  const photos = media.filter((m) => m.kind === "photo").length;
  if (photos < photoIds.length) throw new InputRefused(`${photoIds.length - photos} of the photos have not reached the office yet — they are sent first`, "media_not_uploaded");
  const signature = signed ? media.find((m) => m.kind === "signature" && m.mutation_id === input.signatureMutationId) : undefined;
  if (signed && !signature) throw new InputRefused("the signature has not reached the office yet — it is sent first", "media_not_uploaded");

  await uow.apply(
    {
      entity: "job_state", entityId: jobId, action: "job.wrap_up", topic: "job.completed",
      before: { state: job.state, version: job.version }, after: { state: "complete", outcome: input.outcome },
      orgId: job.org_id, regionId: job.region_id,
      payload: { jobId, wrapUpId, outcome: input.outcome, photos },
    },
    async (tx) => {
      const moved = await tx.query("UPDATE jobs SET state = 'complete', version = version + 1 WHERE id = $1 AND version = $2 RETURNING id", [jobId, job.version]);
      if (moved.length !== 1) throw new Error(`wrap-up: job ${jobId} changed under its own lock`);
      await tx.query(
        `INSERT INTO job_state_events (org_id, region_id, job_id, from_state, to_state, actor_id, surface_id, mutation_id, occurred_at)
         VALUES ($1, $2, $3, 'in_progress', 'complete', $4, 'S5', $5, $6)`,
        [job.org_id, job.region_id, jobId, actorId, wrapUpId, submittedAt],
      );
      await tx.query(
        `INSERT INTO job_wrap_ups (org_id, region_id, job_id, wrap_up_id, crew_id, submitted_by, submitted_at, outcome, notes, measurements, signature_media_id, customer_absent_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
        [job.org_id, job.region_id, jobId, wrapUpId, job.crew_id, actorId, submittedAt, input.outcome, notes,
         quote ? JSON.stringify(input.measurements) : null, signature?.id ?? null, absent],
      );
    },
  );
  return { jobId, wrapUpId, state: "complete", duplicate: false };
};
