import { createHash } from "node:crypto";
import type { UnitOfWork } from "../db/unit-of-work.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import { storageKey, type ObjectStore, type StorageKey } from "../../../../packages/storage/src/index.ts";
import {
  PHOTO_MAX_BYTES, PHOTOS_PER_REQUEST, sniffPhoto,
  type AttachPhotoInput, type AttachPhotoOutput, type GetMediaInput, type GetMediaOutput, type PhotoContentType,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * PHOTOS ON A SERVICE REQUEST (0017).
 *
 * The customer's browser sends the bytes here and nowhere else: the bucket's
 * address is in the gateway's environment, never in a bundle, and a surface
 * never receives a vendor URL. The bytes travel as base64 in the JSON body —
 * the same inline shape `sites.imagery` answers with — so the catalogue, the
 * generated client and the transport need no second carrier for one operation.
 *
 * What this handler decides is the INPUT: real image bytes (judged by the
 * file's own first bytes, never by the name or the header the browser sent),
 * inside the size, inside the count. Whose request it may be attached to is
 * 0017's insert policy: the requester's own, while no job is open against it.
 * The handler reads the same facts first only so the refusal can say which
 * one failed, in words.
 *
 * Order inside the unit of work: rows first, object second, commit last. A
 * refused row writes no object; a store that does not answer rolls the rows
 * back. The one leftover is an object written for a commit that then failed —
 * an orphan in the bucket, never a row pointing at nothing.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64 = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;
/** Bytes as "10.0 MB", in integer arithmetic. */
const mb = (n: number) => `${Math.floor(n / 1048576)}.${Math.floor(((n % 1048576) * 10) / 1048576)} MB`;

export const attachPhoto = async (
  uow: UnitOfWork, actorId: string, store: ObjectStore | null, input: AttachPhotoInput, newId: () => string,
): Promise<AttachPhotoOutput> => {
  const requestId = requireUuid(input.requestId, "requestId");
  if (typeof input.dataBase64 !== "string" || input.dataBase64.length === 0) throw new BadInput("dataBase64 is required");
  if (input.dataBase64.length > MAX_BASE64 + 4) throw new InputRefused(`a photo is at most ${mb(PHOTO_MAX_BYTES)}`, "photo_too_large");
  if (!BASE64.test(input.dataBase64)) throw new BadInput("dataBase64 is not base64");
  const bytes = new Uint8Array(Buffer.from(input.dataBase64, "base64"));
  if (bytes.length > PHOTO_MAX_BYTES) throw new InputRefused(`this photo is ${mb(bytes.length)}; a photo is at most ${mb(PHOTO_MAX_BYTES)}`, "photo_too_large");
  const contentType = sniffPhoto(bytes);
  if (!contentType) throw new InputRefused("that file is not a JPEG, PNG or HEIC photo", "not_a_photo");
  if (!store) throw new InputRefused("photo storage is not configured on this gateway — the request itself was received", "storage_not_configured");

  // Count and insert as one step per request: parallel uploads would each
  // count the same photos and all fit under the cap. (An advisory lock, not a
  // row lock: a customer may not lock a request it cannot update.)
  await uow.tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`request-photos:${requestId}`]);
  const req = (await uow.tx.query<{ org_id: string; region_id: string; requested_by: string; job_id: string | null; photos: number }>(
    `SELECT r.org_id, r.region_id, r.requested_by, r.job_id,
            (SELECT count(*)::int FROM service_request_media m WHERE m.request_id = r.id) AS photos
       FROM service_requests r WHERE r.id = $1`, [requestId],
  ))[0];
  if (!req) throw new InputRefused(`no request ${requestId} visible in this scope`, "unknown_request");
  if (req.requested_by !== actorId) throw new InputRefused("photos are added by the person who made the request", "not_your_request");
  if (req.job_id) throw new InputRefused("a job is open against this request — send further photos in the job's conversation", "job_open");
  if (req.photos >= PHOTOS_PER_REQUEST) throw new InputRefused(`a request carries at most ${PHOTOS_PER_REQUEST} photos`, "too_many_photos");

  const id = newId();
  const key = storageKey(req.region_id, req.org_id, "request_photo", id);
  const sha256 = createHash("sha256").update(bytes).digest();
  const eventId = await uow.apply(
    {
      entity: "photo", entityId: id, action: "service_request.attach_photo", topic: "service_request.photo_attached",
      before: null, after: { id, requestId, contentType, bytes: bytes.length },
      orgId: req.org_id, regionId: req.region_id,
      payload: { requestId },
    },
    async (tx) => {
      await tx.query(
        `INSERT INTO storage_objects (id, org_id, region_id, storage_key, content_type, byte_size, sha256, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, req.org_id, req.region_id, key, contentType, bytes.length, sha256, actorId],
      );
      await tx.query(
        `INSERT INTO service_request_media (id, org_id, region_id, request_id, storage_object_id, uploaded_by)
         VALUES ($1, $2, $3, $4, $1, $5)`,
        [id, req.org_id, req.region_id, requestId, actorId],
      );
      try { await store.put(key, bytes, contentType); } catch (e) {
        console.error(e);
        throw new InputRefused("photo storage did not answer — the request was received; send the photo again", "storage_unavailable");
      }
    },
  );
  return { id, requestId, contentType, bytes: bytes.length, eventId };
};

/**
 * One photo, inline. The row decides visibility (0017 → service_requests'
 * policy); the store is read only for a row this principal can see. A job's
 * photos and signature (0034) are the office's alone: a customer may see the
 * job, but the signature its staff gave and the rooftop photos are dispatch's
 * record, not something the portal shows.
 */
export const getMedia = async (uow: UnitOfWork, store: ObjectStore | null, input: GetMediaInput, namespace: string): Promise<GetMediaOutput> => {
  const id = requireUuid(input.id, "id");
  const row = (await uow.tx.query<{ storage_key: string; content_type: PhotoContentType }>(
    `SELECT o.storage_key, o.content_type
       FROM service_request_media m JOIN storage_objects o ON o.id = m.storage_object_id
      WHERE m.id = $1`, [id],
  ))[0] ?? (namespace === "internal" ? (await uow.tx.query<{ storage_key: string; content_type: PhotoContentType }>(
    `SELECT o.storage_key, o.content_type
       FROM job_media jm JOIN storage_objects o ON o.storage_key = jm.storage_key
      WHERE jm.id = $1`, [id],
  ))[0] : undefined);
  if (!row) throw new InputRefused(`no photo ${id} visible in this scope`, "unknown_photo");
  if (!store) throw new InputRefused("photo storage is not configured on this gateway", "storage_not_configured");
  let bytes: Uint8Array;
  try { bytes = await store.get(row.storage_key as StorageKey); } catch (e) {
    console.error(e);
    throw new InputRefused("photo storage did not answer — try again", "storage_unavailable");
  }
  return { id, contentType: row.content_type, image: `data:${row.content_type};base64,${Buffer.from(bytes).toString("base64")}` };
};
