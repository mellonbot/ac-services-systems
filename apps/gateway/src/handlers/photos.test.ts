import { test } from "node:test";
import assert from "node:assert/strict";
import { createUnitOfWork, type Tx } from "../unit-of-work.ts";
import { attachPhoto, getMedia } from "./photos.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import { PHOTO_MAX_BYTES, PHOTOS_PER_REQUEST, sniffPhoto } from "../../../../packages/contracts/src/operations.ts";
import type { ObjectStore, StorageKey } from "../../../../packages/storage/src/index.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";

/**
 * Photos at the handler: what counts as a photo, the size and count limits,
 * whose request it may join, and the order of the writes. Whether the row is
 * admitted is 0017's policy, held in test/integration/s6-photos.test.ts.
 */
const U = (n: number) => `61000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ORG = U(1), REGION = U(2), REQ = U(3), CONTACT = U(4), COLLEAGUE = U(5);

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const HEIC = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

const scripted = (answers: readonly (readonly [string, unknown[]])[], log: string[] = []) => {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const tx: Tx = {
    async setLocal() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      log.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
      for (const [needle, rows] of answers) if (sql.includes(needle)) return rows as never;
      return [];
    },
    async insert() {},
    async commit() {},
    async rollback() {},
  };
  return { tx, queries };
};
const facility: Principal = {
  namespace: "customer", subjectId: CONTACT, orgId: ORG, regionId: REGION, scopeTier: "location", scopeId: U(9),
  roles: ["payer", "requester"], firmId: null, deviceId: null, shiftId: null, tierClaim: null, sessionId: "sess-6",
};
let seq = 0;
const uowFor = async (tx: Tx) => createUnitOfWork({ surfaceId: "S6", principal: facility, requestId: "r", now: () => new Date("2026-10-21T12:00:00Z"), newId: () => U(600 + ++seq) }, tx);
const newId = () => U(700 + ++seq);
const reqRow = (extra: Record<string, unknown> = {}) => ({ org_id: ORG, region_id: REGION, requested_by: CONTACT, job_id: null, photos: 0, ...extra });
const memory = (log: string[] = []) => {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const store: ObjectStore = {
    async put(key, body, contentType) { log.push(`PUT ${key}`); objects.set(key, { body, contentType }); },
    async get(key) { const o = objects.get(key); if (!o) throw new Error("NoSuchKey"); return o.body; },
  };
  return { store, objects };
};

test("sniffPhoto: a photo is known by its own first bytes — not its name, not the type the browser claimed", () => {
  assert.equal(sniffPhoto(JPEG), "image/jpeg");
  assert.equal(sniffPhoto(PNG), "image/png");
  assert.equal(sniffPhoto(HEIC), "image/heic");
  assert.equal(sniffPhoto(new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypavif")])), null, "AVIF is not one we take");
  assert.equal(sniffPhoto(Buffer.from("%PDF-1.7")), null);
  assert.equal(sniffPhoto(new Uint8Array()), null);
});

test("attachPhoto: the rows first, then the object, keyed region/org/request_photo/id — and the audit names a photo", async () => {
  const log: string[] = [];
  const s = scripted([["FROM service_requests r", [reqRow()]]], log);
  const { store, objects } = memory(log);
  const out = await attachPhoto(await uowFor(s.tx), CONTACT, store, { requestId: REQ, dataBase64: b64(JPEG) }, newId);
  assert.equal(out.contentType, "image/jpeg");
  assert.equal(out.bytes, JPEG.length);
  const key = `${REGION}/${ORG}/request_photo/${out.id}`;
  assert.deepEqual([...objects.get(key)!.body], [...JPEG]);
  const so = s.queries.find((q) => q.sql.includes("INSERT INTO storage_objects"))!;
  assert.equal(so.params[3], key, "the key carries no bucket, no host, no vendor");
  assert.equal(so.params[4], "image/jpeg", "the sniffed type, not a claimed one");
  assert.equal((so.params[6] as Buffer).length, 32, "sha256 of the bytes");
  assert.ok(s.queries.some((q) => q.sql.includes("INSERT INTO service_request_media")));
  const i = log.findIndex((l) => l.startsWith("INSERT INTO service_request_media"));
  assert.ok(i >= 0 && log.indexOf(`PUT ${key}`) > i, "the object is written after the rows, inside the same unit of work");
});

test("attachPhoto: a store that does not answer refuses in words (not a 500 that flips the portal degraded), and nothing is committed", async () => {
  const s = scripted([["FROM service_requests r", [reqRow()]]]);
  const down: ObjectStore = { async put() { throw new Error("ECONNRESET"); }, async get() { return new Uint8Array(); } };
  const uow = await uowFor(s.tx);
  const orig = console.error; console.error = () => {};
  try {
    await assert.rejects(attachPhoto(uow, CONTACT, down, { requestId: REQ, dataBase64: b64(PNG) }, newId), (e: InputRefused) => e.code === "storage_unavailable");
  } finally { console.error = orig; }
  assert.equal(uow.pending().audits.length, 0, "the apply threw before its audit row was kept");
});

test("attachPhoto refuses, each in its own words: not a photo, too large, no store, not visible, not yours, job open, the seventh", async () => {
  const { store } = memory();
  const run = async (input: { requestId: string; dataBase64: string }, row: unknown[] = [reqRow()], st: ObjectStore | null = store) =>
    attachPhoto(await uowFor(scripted([["FROM service_requests r", row]]).tx), CONTACT, st, input, newId);
  const refused = (code: string) => (e: InputRefused) => e instanceof InputRefused && e.code === code;
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(Buffer.from("%PDF-1.7 not a photo")) }), refused("not_a_photo"));
  const big = new Uint8Array(PHOTO_MAX_BYTES + 1); big.set(JPEG);
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(big) }), refused("photo_too_large"));
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(JPEG) }, [reqRow()], null), refused("storage_not_configured"));
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(JPEG) }, []), refused("unknown_request"));
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(JPEG) }, [reqRow({ requested_by: COLLEAGUE })]), refused("not_your_request"));
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(JPEG) }, [reqRow({ job_id: U(8) })]), refused("job_open"));
  await assert.rejects(run({ requestId: REQ, dataBase64: b64(JPEG) }, [reqRow({ photos: PHOTOS_PER_REQUEST })]), refused("too_many_photos"));
  await assert.rejects(run({ requestId: "nope", dataBase64: b64(JPEG) }), BadInput);
  await assert.rejects(run({ requestId: REQ, dataBase64: "not*base64" }), BadInput);
});

test("getMedia: a visible photo comes back inline as a data: URL; an invisible one is unknown, not forbidden", async () => {
  const { store, objects } = memory();
  const key = `${REGION}/${ORG}/request_photo/${U(30)}` as StorageKey;
  objects.set(key, { body: PNG, contentType: "image/png" });
  const out = await getMedia(await uowFor(scripted([["FROM service_request_media m", [{ storage_key: key, content_type: "image/png" }]]]).tx), store, { id: U(30) }, "customer");
  assert.equal(out.image, `data:image/png;base64,${b64(PNG)}`);
  await assert.rejects(getMedia(await uowFor(scripted([]).tx), store, { id: U(30) }, "customer"), (e: InputRefused) => e.code === "unknown_photo");
});

test("getMedia: a job's photo or signature (0034) is the office's — read for an internal principal, unknown to a customer even where the row is visible", async () => {
  const { store, objects } = memory();
  const key = `${REGION}/${ORG}/job_signature/${U(31)}` as StorageKey;
  objects.set(key, { body: PNG, contentType: "image/png" });
  const jobRow: [string, unknown[]] = ["FROM job_media jm", [{ storage_key: key, content_type: "image/png" }]];
  const office = await getMedia(await uowFor(scripted([jobRow]).tx), store, { id: U(31) }, "internal");
  assert.equal(office.image, `data:image/png;base64,${b64(PNG)}`);
  await assert.rejects(getMedia(await uowFor(scripted([jobRow]).tx), store, { id: U(31) }, "customer"), (e: InputRefused) => e.code === "unknown_photo");
});
