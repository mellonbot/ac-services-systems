import { test } from "node:test";
import assert from "node:assert/strict";
import { createWrapUps, memoryMedia, missingFor, EMPTY_DRAFT, wrapUpsKey } from "./wrap-ups.ts";
import type { AttachJobMediaInput, Refusal, WrapUpInput } from "../../../packages/contracts/src/index.ts";
import type { QueueStore } from "./offline.ts";

const JOB = "f5000000-0000-0000-0000-000000000006";
const MEASURED = { tonnage: "7.5", voltage: "460/3", fuel: "gas", unitLengthIn: "88", unitWidthIn: "58", unitHeightIn: "49", curbLengthIn: "80", curbWidthIn: "50", oldModel: "48TCED08", oldSerial: "1209G40112" } as const;
const memory = (): QueueStore & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, v); } };
};
let n = 0;
const make = (store = memory(), media = memoryMedia()) =>
  ({ w: createWrapUps({ deviceId: "dev", subjectId: "tech", newId: () => `id-${++n}`, now: () => Date.parse("2026-10-27T15:00:00Z"), store, media }), store, media });

class Refused extends Error {
  readonly refusal: Refusal;
  constructor(refusal: Refusal) { super(refusal.message); this.refusal = refusal; }
}
const refusalOf = (e: unknown): Refusal | null => (e instanceof Refused ? e.refusal : null);
const gateway = (over: { media?: (i: AttachJobMediaInput) => void; wrap?: (i: WrapUpInput) => void } = {}) => {
  const log: string[] = [];
  return {
    log,
    attachJobMedia: async (i: AttachJobMediaInput) => { over.media?.(i); log.push(`${i.kind}:${i.mutationId}`); return { id: `m-${i.mutationId}`, jobId: i.jobId, duplicate: false }; },
    wrapUpJob: async (i: WrapUpInput) => { over.wrap?.(i); log.push(`wrap:${i.outcome}`); return { jobId: i.jobId, wrapUpId: i.wrapUpId, state: "complete" as const, duplicate: false }; },
  };
};

test("what is missing is said in the technician's terms, and the quote bar is higher than the completion bar", () => {
  assert.deepEqual(missingFor(EMPTY_DRAFT), ["2 more photos", "the customer's signature, or tick that no one was there to sign"]);
  const two = { ...EMPTY_DRAFT, photos: [{ id: "a", at: "" }, { id: "b", at: "" }], signature: { id: "s", at: "" } };
  assert.deepEqual(missingFor(two), []);
  assert.deepEqual(missingFor({ ...two, outcome: "quote_needed" }), ["8 more photos", "tonnage (1 to 150 tons, in halves)"]);
  assert.deepEqual(missingFor({ ...two, outcome: "quote_needed", photos: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, at: "" })), measurements: { ...MEASURED, curbWidthIn: "" } }), ["curb width in whole inches"]);
  assert.deepEqual(missingFor({ ...two, signature: null, absent: true, absentReason: "x" }), ["why no one could sign"]);
});

test("submit refuses an incomplete draft and moves a complete one to the outbox, numbers parsed and the signature or the reason, not both", async () => {
  const { w, store } = make();
  await w.addShot(JOB, "photo", "AAAA");
  assert.equal(w.submit(JOB).length, 2, "nothing moves while anything is missing");
  assert.equal(w.outbox.value.length, 0);
  await w.addShot(JOB, "photo", "BBBB");
  w.edit(JOB, { outcome: "quote_needed", absent: true, absentReason: "Roof hatch locked, tenant gone", notes: "  Coil corroded.  " });
  for (let i = 0; i < 8; i++) await w.addShot(JOB, "photo", "CCCC");
  w.edit(JOB, { measurements: MEASURED });
  assert.deepEqual(w.submit(JOB), []);
  const e = w.outbox.value[0]!;
  assert.equal(e.photos.length, 10);
  assert.deepEqual([e.signature, e.absentReason, e.notes, e.measurements?.tonnage, e.measurements?.unitLengthIn], [null, "Roof hatch locked, tenant gone", "Coil corroded.", 7.5, 88]);
  assert.equal(w.draftFor(JOB), EMPTY_DRAFT, "the draft is gone once submitted");
  const saved = JSON.parse(store.map.get(wrapUpsKey("dev", "tech"))!) as { outbox: unknown[] };
  assert.equal(saved.outbox.length, 1, "the outbox survives a reload");
  assert.equal(make(store).w.pendingFor(JOB)?.wrapUpId, e.wrapUpId);
});

test("the outbox sends every photo and the signature before the wrap-up that names them, then lets the bytes go", async () => {
  const { w, media } = make();
  await w.addShot(JOB, "photo", "AAAA");
  await w.addShot(JOB, "photo", "BBBB");
  await w.addShot(JOB, "signature", "SSSS");
  w.submit(JOB);
  const g = gateway({ wrap: (i) => assert.deepEqual([i.photoMutationIds.length, typeof i.signatureMutationId, i.customerAbsentReason], [2, "string", undefined]) });
  assert.equal(await w.flush(g, refusalOf), true);
  assert.deepEqual(g.log.map((l) => l.split(":")[0]), ["photo", "photo", "signature", "wrap"]);
  assert.equal(w.outbox.value.length, 0);
  assert.equal(media.map.size, 0, "nothing left on the device once the office has it");
});

test("a dead zone stops the send where it is: what was sent stays sent, and the next flush picks up after it", async () => {
  const { w } = make();
  await w.addShot(JOB, "photo", "AAAA");
  await w.addShot(JOB, "photo", "BBBB");
  w.edit(JOB, { absent: true, absentReason: "No one home" });
  w.submit(JOB);
  let calls = 0;
  const flaky = gateway({ media: () => { if (++calls === 2) throw new Error("fetch failed"); } });
  assert.equal(await w.flush(flaky, refusalOf), true, "the first photo reached the office");
  const e = w.outbox.value[0]!;
  assert.deepEqual(e.photos.map((p) => p.sent), [true, false]);
  assert.equal(e.refused, null, "a transport failure is waiting, not refused");
  const ok = gateway();
  await w.flush(ok, refusalOf);
  assert.deepEqual(ok.log, [`photo:${e.photos[1]!.id}`, "wrap:complete"], "only what had not gone, then the wrap-up");
});

test("a refusal is kept with the office's words; reopening puts the wrap-up back as a draft with its photos", async () => {
  const { w } = make();
  await w.addShot(JOB, "photo", "AAAA");
  await w.addShot(JOB, "photo", "BBBB");
  w.edit(JOB, { absent: true, absentReason: "No one home" });
  w.submit(JOB);
  const g = gateway({ wrap: () => { throw new Refused({ kind: "admission", code: "not_in_progress", axis: "structural", message: "this job is cancelled — a wrap-up completes a job in progress" }); } });
  await w.flush(g, refusalOf);
  assert.match(w.pendingFor(JOB)!.refused!, /cancelled/);
  assert.equal(await w.flush(g, refusalOf), false, "a refused wrap-up is not sent again by itself");
  w.reopen(JOB);
  assert.equal(w.pendingFor(JOB), undefined);
  assert.deepEqual([w.draftFor(JOB).photos.length, w.draftFor(JOB).absent, w.draftFor(JOB).absentReason], [2, true, "No one home"]);
});

test("a photo whose bytes are gone from the device is refused to the technician, never sent as nothing", async () => {
  const { w, media } = make();
  await w.addShot(JOB, "photo", "AAAA");
  await w.addShot(JOB, "photo", "BBBB");
  w.edit(JOB, { absent: true, absentReason: "No one home" });
  w.submit(JOB);
  media.map.clear();
  const g = gateway();
  await w.flush(g, refusalOf);
  assert.deepEqual(g.log, []);
  assert.match(w.pendingFor(JOB)!.refused!, /lost from this device/);
});
