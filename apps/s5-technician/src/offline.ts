import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import type { SyncMutationWire, SyncOutcomeWire } from "../../../packages/contracts/src/index.ts";

/**
 * S5's OFFLINE MUTATION QUEUE (SURFACES.S5.degraded: "device holds intent,
 * server holds truth, replay is idempotent by client-generated mutation id").
 *
 * A screen never calls `sync.replay` directly for a write — it calls
 * `enqueue()`, which is instant and durable across a dropped connection, and
 * `flush()` is what actually walks the one door. Every mutation this queue
 * produces is exactly a `SyncMutationWire` — the same shape
 * `packages/domain/src/sync`'s own `Mutation` type declares for the
 * gateway's side of the same contract — but this file cannot import that
 * package to prove it: `apps/s5-technician` stops at the shell
 * (schema-guard.ts's "dependencies point one way" — a surface reaches
 * `packages/domain` over the wire, through `sync.replay`, never in process).
 * `JOB_TRANSITIONS`/`DEVICE_TRANSITIONS` below are copied from there for
 * exactly that reason, not rederived — the source of truth for what a device
 * may legally attempt is `packages/domain/src/sync/index.ts`, and
 * `test/integration/s3-s5.test.ts` is what proves this copy has not drifted
 * from it.
 *
 * Idempotency is the mutationId, minted here once per intent and never
 * reused: a retried flush after a dropped response replays the SAME id, and
 * the server's own `resolveMutation()` recognizes it as "duplicate" rather
 * than writing the same intent twice.
 *
 * The queue is written to storage on every change and read back when the
 * device signs in again, so a reload, a discarded tab or a sign-out in a dead
 * zone loses nothing. So are the attention items (until the tech dismisses
 * them) and the running time clock. All three are keyed by device AND
 * technician: a queue is replayed under the token of whoever signs in, so one
 * tech's queued work must never be sent under another's name — it waits on
 * this device for its own tech. Storage is injected for the same reason S1's
 * buffer injects it: absent under node, and it THROWS in a browser with site
 * data blocked — a failure degrades to memory only.
 */
export const JOB_TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  created: ["assigned", "cancelled", "quote_requested"],
  assigned: ["en_route", "reassigned", "cancelled"],
  reassigned: ["assigned", "cancelled"],
  en_route: ["on_site", "cancelled"],
  on_site: ["in_progress", "aborted", "awaiting_customer"],
  in_progress: ["awaiting_parts", "complete", "aborted", "awaiting_customer"],
  awaiting_parts: ["in_progress", "aborted"],
  complete: ["invoiced", "reopened", "needs_pricing", "awaiting_po", "awaiting_pictures"],
  reopened: ["in_progress"],
  invoiced: ["invoice_trouble"],
  cancelled: [],
  aborted: ["reopened"],
  // Waiting on the customer (0013). A quote is the office's, before dispatch;
  // an approval or access mid-job is either the office's or the technician's.
  quote_requested: ["quote_submitted", "cancelled"],
  quote_submitted: ["created", "cancelled"],
  awaiting_customer: ["in_progress", "aborted"],
  // What blocks the invoice (0014) — the office's, every one.
  needs_pricing: ["complete"],
  awaiting_po: ["complete"],
  awaiting_pictures: ["complete"],
  invoice_trouble: ["invoiced"],
});

/** Transitions a DEVICE may drive. Assignment and cancellation are the office's. */
export const DEVICE_TRANSITIONS: readonly string[] = ["en_route", "on_site", "in_progress", "awaiting_parts", "awaiting_customer", "complete", "aborted"];

/**
 * What JOB_TRANSITIONS[state] ∩ DEVICE_TRANSITIONS permits from here — the
 * buttons a job-detail screen may offer. Never "complete": a job is completed
 * by its wrap-up (0034), and sync.replay refuses the bare transition.
 */
export const nextDeviceStates = (state: string): readonly string[] => {
  const allowed = new Set(DEVICE_TRANSITIONS.filter((s) => s !== "complete"));
  return (JOB_TRANSITIONS[state] ?? []).filter((s) => allowed.has(s));
};

export type QueueEntry = { readonly mutation: SyncMutationWire; readonly enqueuedAt: number };
/** A mutation the server did not simply apply — something for the tech (or a supervisor) to read, not to silently retry. */
export type Attention = { readonly mutationId: string; readonly entityTable: string; readonly entityId: string; readonly kind: SyncOutcomeWire["outcome"]; readonly note: string };

/** The slice of the Storage API this needs. A browser's localStorage satisfies it; a test passes a Map. */
export type QueueStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; readonly length?: number; key?(index: number): string | null };
export const queueKey = (deviceId: string, subjectId: string): string => `ac.s5.pending.${deviceId}.${subjectId}`;
export const attentionKey = (deviceId: string, subjectId: string): string => `ac.s5.attention.${deviceId}.${subjectId}`;
export const clockKey = (deviceId: string, subjectId: string): string => `ac.s5.clock.${deviceId}.${subjectId}`;

/**
 * How many changes OTHER technicians left queued on this device. They are not
 * replayed under this sign-in — the tech is told they exist instead. The
 * device-only key an earlier build wrote has no owner on it, so it counts as
 * someone else's too.
 */
export const othersPending = (store: QueueStore | null | undefined, deviceId: string, subjectId: string): number => {
  if (!store?.key || store.length === undefined) return 0;
  const own = queueKey(deviceId, subjectId);
  const legacy = `ac.s5.pending.${deviceId}`;
  let count = 0;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || k === own || (k !== legacy && !k.startsWith(`${legacy}.`))) continue;
      const parsed: unknown = JSON.parse(store.getItem(k) ?? "[]");
      if (Array.isArray(parsed)) count += parsed.length;
    }
  } catch { /* blocked or unreadable: nothing to report */ }
  return count;
};

/**
 * Where a job stands once this device's queued transitions land: the server's
 * state with each pending transition for the job applied in device order, and
 * the version the NEXT transition observes — the server bumps a job's version
 * by one per applied transition, so each queued one is one more.
 */
export const projectedJob = (job: { readonly id: string; readonly state: string; readonly version: number }, pending: readonly QueueEntry[]): { state: string; version: number; queued: number } => {
  let state = job.state;
  let queued = 0;
  for (const e of pending) {
    const m = e.mutation;
    if (m.entityTable !== "jobs" || m.op !== "transition" || m.entityId !== job.id) continue;
    state = String(m.payload.state);
    queued++;
  }
  return { state, version: job.version + queued, queued };
};

export type OfflineQueue = {
  readonly pending: Signal<readonly QueueEntry[]>;
  /** Why the last flush got no answer (null once one is answered) — a token refusal means sign in again, not retry. */
  readonly failure: Signal<unknown>;
  readonly attention: Signal<readonly Attention[]>;
  /** Job id → when its time clock was started. Saved on every change: a running clock outlives a reload. */
  readonly clock: Signal<Readonly<Record<string, string>>>;
  readonly flushing: Signal<boolean>;
  enqueue(entityTable: string, entityId: string, op: SyncMutationWire["op"], payload: Readonly<Record<string, unknown>>, clientObservedVersion: number | null): SyncMutationWire;
  dismissAttention(mutationId: string): void;
  /** Resolves true when the gateway answered the batch — the only case where a refetch can show anything new. */
  flush(replay: (mutations: readonly SyncMutationWire[]) => Promise<{ outcomes: readonly SyncOutcomeWire[] }>): Promise<boolean>;
};

const noteOf = (o: SyncOutcomeWire): string => ("note" in o ? o.note : "");

export const createOfflineQueue = (opts: { deviceId: string; subjectId: string; newId: () => string; now: () => number; store?: QueueStore | null }): OfflineQueue => {
  const store = opts.store ?? null;
  const key = queueKey(opts.deviceId, opts.subjectId);
  const read = (k: string): unknown => {
    if (!store) return null;
    try { return JSON.parse(store.getItem(k) ?? "null"); } catch { return null; }
  };
  const save = (k: string, value: unknown) => {
    if (!store) return;
    try { store.setItem(k, JSON.stringify(value)); } catch { /* blocked site data: it is this session's */ }
  };
  const load = (): readonly QueueEntry[] => {
    if (!store) return [];
    try {
      const parsed: unknown = JSON.parse(store.getItem(key) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      // Written by an earlier session of this page; checked before it is trusted into the gateway.
      return parsed.filter((e): e is QueueEntry =>
        !!e && typeof e === "object" && typeof (e as QueueEntry).mutation?.mutationId === "string"
        && typeof (e as QueueEntry).mutation?.deviceSeq === "number" && (e as QueueEntry).mutation.deviceId === opts.deviceId);
    } catch {
      return [];
    }
  };
  const pending = signal<readonly QueueEntry[]>(load());
  const storedAttention = read(attentionKey(opts.deviceId, opts.subjectId));
  const attention = signal<readonly Attention[]>(Array.isArray(storedAttention)
    ? storedAttention.filter((a): a is Attention => !!a && typeof a === "object" && typeof (a as Attention).mutationId === "string" && typeof (a as Attention).entityId === "string")
    : []);
  const storedClock = read(clockKey(opts.deviceId, opts.subjectId));
  const clock = signal<Readonly<Record<string, string>>>(storedClock && typeof storedClock === "object" && !Array.isArray(storedClock)
    ? Object.fromEntries(Object.entries(storedClock).filter(([, v]) => typeof v === "string"))
    : {});
  clock.subscribe((v) => save(clockKey(opts.deviceId, opts.subjectId), v));
  const flushing = signal(false);
  const failure = signal<unknown>(null);
  // Device order continues across sessions: a reloaded queue's next intent comes after its last.
  let seq = pending.value.reduce((m, e) => Math.max(m, e.mutation.deviceSeq), 0);
  const persist = (next: readonly QueueEntry[]) => {
    pending.value = next;
    save(key, next);
  };
  const setAttention = (next: readonly Attention[]) => {
    attention.value = next;
    save(attentionKey(opts.deviceId, opts.subjectId), next);
  };

  const enqueue: OfflineQueue["enqueue"] = (entityTable, entityId, op, payload, clientObservedVersion) => {
    const mutation: SyncMutationWire = {
      mutationId: opts.newId(), deviceId: opts.deviceId, deviceSeq: ++seq,
      entityTable, entityId, op, payload, clientObservedVersion,
      deviceAt: new Date(opts.now()).toISOString(),
    };
    persist([...pending.value, { mutation, enqueuedAt: opts.now() }]);
    return mutation;
  };

  const dismissAttention = (mutationId: string) => {
    setAttention(attention.value.filter((a) => a.mutationId !== mutationId));
  };

  /**
   * One request per flush, in the device's own order (deviceSeq — replay()
   * sorts by it again server-side, so a batch handed over out of order is
   * still applied correctly). "applied" and "duplicate" leave the queue for
   * good; everything else is dropped from the RETRY queue (retrying a
   * superseded or rejected mutation blindly would just get the same answer)
   * and surfaced instead, so a person reads it rather than the device
   * silently discarding it.
   *
   * A TRANSPORT failure (gateway unreachable, timeout) is different in kind
   * from a mutation-level outcome: `replay()` itself never got to answer, so
   * there is nothing to learn about any individual mutation — the whole
   * batch simply stays in `pending` for the next tick or the next screen
   * open. `flush()` therefore never rejects; it is caller-safe to fire and
   * forget (`void queue.flush(...)`) from a 1s ticker without a `.catch()`
   * at every call site, matching "device holds intent" — a dead network is
   * an ordinary, expected state for this screen, not an error to propagate.
   */
  const flush: OfflineQueue["flush"] = async (replay) => {
    if (flushing.value || pending.value.length === 0) return false;
    flushing.value = true;
    try {
      const batch = pending.value;
      let outcomes: readonly SyncOutcomeWire[];
      try {
        ({ outcomes } = await replay(batch.map((e) => e.mutation)));
      } catch (e) {
        failure.value = e;
        return false; // unreachable gateway — nothing learned per-mutation; batch stays queued as-is
      }
      failure.value = null;
      const byId = new Map(outcomes.map((o) => [o.mutationId, o]));
      const flagged: Attention[] = [];
      const unanswered: QueueEntry[] = [];
      for (const entry of batch) {
        const o = byId.get(entry.mutation.mutationId);
        if (!o) { unanswered.push(entry); continue; } // sync.replay answers every mutation it was sent; kept queued only if it somehow did not
        if (o.outcome === "applied" || o.outcome === "duplicate") continue;
        flagged.push({ mutationId: entry.mutation.mutationId, entityTable: entry.mutation.entityTable, entityId: entry.mutation.entityId, kind: o.outcome, note: noteOf(o) });
      }
      // `batch` is always a prefix of whatever `pending.value` has become —
      // only `enqueue` (append-only) and this assignment touch it — so
      // anything appended during the await is exactly the tail past batch.length.
      persist([...unanswered, ...pending.value.slice(batch.length)]);
      if (flagged.length) setAttention([...attention.value, ...flagged]);
      return true;
    } finally {
      flushing.value = false;
    }
  };

  return { pending, failure, attention, clock, flushing, enqueue, dismissAttention, flush };
};
