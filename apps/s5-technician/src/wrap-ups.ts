import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import {
  WRAP_UP_MIN_PHOTOS, QUOTE_MIN_PHOTOS, measurementsFault,
  type AttachJobMediaInput, type AttachJobMediaOutput, type JobMediaKind, type Refusal,
  type WrapUpInput, type WrapUpMeasurementsWire, type WrapUpOutcome, type WrapUpOutput,
} from "../../../packages/contracts/src/index.ts";
import type { QueueStore } from "./offline.ts";

/**
 * THE WRAP-UP, ON THE DEVICE (0034). A draft per job while the technician
 * works it — photos, the outcome, notes, measurements, the signature — and,
 * once submitted, an outbox entry that is sent when there is a connection:
 * each photo and the signature first (jobs.attachMedia), then the wrap-up
 * that names them (jobs.wrapUp). Both calls are idempotent on the server, so
 * a send cut off half-way is simply sent again.
 *
 * Drafts and the outbox are small and live in the same storage as the sync
 * queue, under the same device-and-technician key. Photo bytes do not fit
 * there (a phone's localStorage holds about 5 MB), so they live in a
 * MediaStore — IndexedDB in the browser — keyed by the mutationId they will
 * be uploaded under.
 */
export type MediaStore = {
  put(id: string, base64: string): Promise<void>;
  get(id: string): Promise<string | null>;
  delete(id: string): Promise<void>;
};

export const memoryMedia = (): MediaStore & { readonly map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, put: async (id, b) => { map.set(id, b); }, get: async (id) => map.get(id) ?? null, delete: async (id) => { map.delete(id); } };
};

/** IndexedDB, one object store. Opened lazily; a browser that refuses it (private mode, blocked site data) keeps the bytes in memory for the session. */
export const indexedDbMedia = (name: string): MediaStore => {
  const fallback = memoryMedia();
  let db: Promise<IDBDatabase | null> | null = null;
  const open = () => db ??= new Promise((resolve) => {
    try {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("media"); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  const run = async <T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest, orElse: (m: MediaStore) => Promise<T>): Promise<T> => {
    const d = await open();
    if (!d) return orElse(fallback);
    return new Promise<T>((resolve, reject) => {
      const req = act(d.transaction("media", mode).objectStore("media"));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    put: (id, b) => run("readwrite", (s) => s.put(b, id), (m) => m.put(id, b)),
    get: async (id) => (await run<string | null | undefined>("readonly", (s) => s.get(id), (m) => m.get(id))) ?? null,
    delete: (id) => run("readwrite", (s) => s.delete(id), (m) => m.delete(id)),
  };
};

type Shot = { readonly id: string; readonly at: string };
/** Measurement fields as typed — strings until Submit, so a half-typed number is not lost. */
export type MeasurementDraft = Partial<Record<keyof WrapUpMeasurementsWire, string>>;
export type Draft = {
  readonly outcome: WrapUpOutcome;
  readonly photos: readonly Shot[];
  readonly notes: string;
  readonly measurements: MeasurementDraft;
  readonly signature: Shot | null;
  readonly absent: boolean;
  readonly absentReason: string;
};
export const EMPTY_DRAFT: Draft = { outcome: "complete", photos: [], notes: "", measurements: {}, signature: null, absent: false, absentReason: "" };

type Sent = Shot & { readonly sent: boolean };
export type OutboxEntry = {
  readonly wrapUpId: string; readonly jobId: string; readonly submittedAt: string;
  readonly outcome: WrapUpOutcome; readonly notes: string; readonly measurements: WrapUpMeasurementsWire | null;
  readonly photos: readonly Sent[]; readonly signature: Sent | null; readonly absentReason: string | null;
  /** Why the office refused it, in its own words. Null while it is only waiting for a connection. */
  readonly refused: string | null;
};

const NUMERIC = new Set(["tonnage", "unitLengthIn", "unitWidthIn", "unitHeightIn", "curbLengthIn", "curbWidthIn"]);
export const measurementsOf = (m: MeasurementDraft): Record<string, unknown> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, NUMERIC.has(k) ? (v === undefined || v.trim() === "" ? undefined : Number(v)) : v]));

/** What still stands between this draft and Submit, in words a technician acts on. Empty when it can be sent. */
export const missingFor = (d: Draft): readonly string[] => {
  const out: string[] = [];
  const min = d.outcome === "quote_needed" ? QUOTE_MIN_PHOTOS : WRAP_UP_MIN_PHOTOS;
  if (d.photos.length < min) out.push(`${min - d.photos.length} more photo${min - d.photos.length === 1 ? "" : "s"}`);
  if (d.outcome === "quote_needed") {
    const fault = measurementsFault(measurementsOf(d.measurements));
    if (fault) out.push(fault);
  }
  if (d.absent) { if (d.absentReason.trim().length < 3) out.push("why no one could sign"); }
  else if (!d.signature) out.push("the customer's signature, or tick that no one was there to sign");
  return out;
};

type Gateway = {
  attachJobMedia(input: AttachJobMediaInput): Promise<AttachJobMediaOutput>;
  wrapUpJob(input: WrapUpInput): Promise<WrapUpOutput>;
};

export type WrapUps = {
  readonly drafts: Signal<Readonly<Record<string, Draft>>>;
  readonly outbox: Signal<readonly OutboxEntry[]>;
  /** Photo and signature bytes this session has read, for thumbnails. */
  readonly previews: Signal<Readonly<Record<string, string>>>;
  readonly media: MediaStore;
  draftFor(jobId: string): Draft;
  edit(jobId: string, patch: Partial<Draft>): void;
  addShot(jobId: string, kind: JobMediaKind, base64: string): Promise<void>;
  removePhoto(jobId: string, id: string): Promise<void>;
  clearSignature(jobId: string): Promise<void>;
  /** Loads a stored shot's bytes into `previews` (after a reload). */
  preview(id: string): void;
  /** Moves a complete draft to the outbox. Returns what is still missing instead, and moves nothing, if anything is. */
  submit(jobId: string): readonly string[];
  /** A refused wrap-up goes back to being a draft, photos and all, for the technician to put right. */
  reopen(jobId: string): void;
  pendingFor(jobId: string): OutboxEntry | undefined;
  /**
   * Sends the outbox, oldest first. Resolves true when anything reached the
   * office. Stops at the first transport failure — a dead zone is not a
   * reason to try every entry — and never rejects.
   */
  flush(gateway: Gateway, refusalOf: (e: unknown) => Refusal | null): Promise<boolean>;
};

/** A photo or signature whose bytes are gone from this device — a refusal only the technician can put right. */
class LostShot extends Error {}

export const wrapUpsKey = (deviceId: string, subjectId: string): string => `ac.s5.wrapups.${deviceId}.${subjectId}`;

export const createWrapUps = (opts: { deviceId: string; subjectId: string; newId: () => string; now: () => number; store?: QueueStore | null; media: MediaStore }): WrapUps => {
  const key = wrapUpsKey(opts.deviceId, opts.subjectId);
  const saved = (() => {
    try { return JSON.parse(opts.store?.getItem(key) ?? "null") as { drafts?: unknown; outbox?: unknown } | null; } catch { return null; }
  })();
  const drafts = signal<Readonly<Record<string, Draft>>>(saved?.drafts && typeof saved.drafts === "object" ? saved.drafts as Record<string, Draft> : {});
  const outbox = signal<readonly OutboxEntry[]>(Array.isArray(saved?.outbox) ? saved.outbox as OutboxEntry[] : []);
  const previews = signal<Readonly<Record<string, string>>>({});
  const save = () => {
    try { opts.store?.setItem(key, JSON.stringify({ drafts: drafts.value, outbox: outbox.value })); } catch { /* blocked site data: this session's */ }
  };
  const draftFor = (jobId: string) => drafts.value[jobId] ?? EMPTY_DRAFT;
  const edit = (jobId: string, patch: Partial<Draft>) => { drafts.value = { ...drafts.value, [jobId]: { ...draftFor(jobId), ...patch } }; save(); };
  const at = () => new Date(opts.now()).toISOString();
  const setOutbox = (next: readonly OutboxEntry[]) => { outbox.value = next; save(); };
  let flushing = false;

  return {
    drafts, outbox, previews, media: opts.media, draftFor, edit,
    async addShot(jobId, kind, base64) {
      const shot = { id: opts.newId(), at: at() };
      await opts.media.put(shot.id, base64);
      previews.value = { ...previews.value, [shot.id]: base64 };
      const d = draftFor(jobId);
      if (kind === "photo") edit(jobId, { photos: [...d.photos, shot] });
      else {
        if (d.signature) await opts.media.delete(d.signature.id);
        edit(jobId, { signature: shot, absent: false });
      }
    },
    async removePhoto(jobId, id) {
      await opts.media.delete(id);
      edit(jobId, { photos: draftFor(jobId).photos.filter((p) => p.id !== id) });
    },
    async clearSignature(jobId) {
      const s = draftFor(jobId).signature;
      if (s) await opts.media.delete(s.id);
      edit(jobId, { signature: null });
    },
    preview(id) {
      if (previews.value[id]) return;
      void opts.media.get(id).then((b) => { if (b) previews.value = { ...previews.value, [id]: b }; });
    },
    submit(jobId) {
      const d = draftFor(jobId);
      const missing = missingFor(d);
      if (missing.length) return missing;
      const entry: OutboxEntry = {
        wrapUpId: opts.newId(), jobId, submittedAt: at(), outcome: d.outcome, notes: d.notes.trim(),
        measurements: d.outcome === "quote_needed" ? measurementsOf(d.measurements) as WrapUpMeasurementsWire : null,
        photos: d.photos.map((p) => ({ ...p, sent: false })),
        signature: d.absent || !d.signature ? null : { ...d.signature, sent: false },
        absentReason: d.absent ? d.absentReason.trim() : null,
        refused: null,
      };
      const rest = { ...drafts.value };
      delete (rest as Record<string, Draft>)[jobId];
      drafts.value = rest;
      setOutbox([...outbox.value.filter((e) => e.jobId !== jobId), entry]);
      return [];
    },
    reopen(jobId) {
      const e = outbox.value.find((x) => x.jobId === jobId);
      if (!e) return;
      setOutbox(outbox.value.filter((x) => x !== e));
      const m = e.measurements ? Object.fromEntries(Object.entries(e.measurements).map(([k, v]) => [k, String(v)])) : {};
      edit(jobId, {
        outcome: e.outcome, notes: e.notes, measurements: m, photos: e.photos.map(({ id, at }) => ({ id, at })),
        signature: e.signature ? { id: e.signature.id, at: e.signature.at } : null, absent: e.absentReason !== null, absentReason: e.absentReason ?? "",
      });
    },
    pendingFor: (jobId) => outbox.value.find((e) => e.jobId === jobId),

    async flush(gateway, refusalOf) {
      if (flushing) return false;
      flushing = true;
      let reached = false;
      const replace = (from: OutboxEntry, to: OutboxEntry | null) =>
        setOutbox(to ? outbox.value.map((e) => (e.wrapUpId === from.wrapUpId ? to : e)) : outbox.value.filter((e) => e.wrapUpId !== from.wrapUpId));
      try {
        for (const start of outbox.value.filter((e) => e.refused === null)) {
          let entry = start;
          try {
            for (const shot of [...entry.photos.map((p) => ({ p, kind: "photo" as const })), ...(entry.signature ? [{ p: entry.signature, kind: "signature" as const }] : [])]) {
              if (shot.p.sent) continue;
              const bytes = await opts.media.get(shot.p.id);
              if (bytes === null) throw new LostShot("a photo was lost from this device before it was sent — reopen the wrap-up and take it again");
              await gateway.attachJobMedia({ jobId: entry.jobId, mutationId: shot.p.id, kind: shot.kind, dataBase64: bytes, capturedAt: shot.p.at });
              reached = true;
              const mark = (s: Sent): Sent => (s.id === shot.p.id ? { ...s, sent: true } : s);
              const next: OutboxEntry = { ...entry, photos: entry.photos.map(mark), signature: entry.signature ? mark(entry.signature) : null };
              replace(entry, next);
              entry = next;
            }
            await gateway.wrapUpJob({
              jobId: entry.jobId, wrapUpId: entry.wrapUpId, outcome: entry.outcome, submittedAt: entry.submittedAt,
              photoMutationIds: entry.photos.map((p) => p.id),
              ...(entry.notes ? { notes: entry.notes } : {}),
              ...(entry.measurements ? { measurements: entry.measurements } : {}),
              ...(entry.signature ? { signatureMutationId: entry.signature.id } : { customerAbsentReason: entry.absentReason! }),
            });
            reached = true;
            replace(entry, null);
            for (const s of [...entry.photos, ...(entry.signature ? [entry.signature] : [])]) await opts.media.delete(s.id);
          } catch (e) {
            if (e instanceof LostShot) { replace(entry, { ...entry, refused: e.message }); continue; }
            const r = refusalOf(e);
            if (!r || r.kind === "transport" || r.kind === "token") break;
            reached = true;
            replace(entry, { ...entry, refused: r.message });
          }
        }
      } finally {
        flushing = false;
      }
      return reached;
    },
  };
};
