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
 */
export const JOB_TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  created: ["assigned", "cancelled"],
  assigned: ["en_route", "reassigned", "cancelled"],
  reassigned: ["assigned", "cancelled"],
  en_route: ["on_site", "cancelled"],
  on_site: ["in_progress", "aborted"],
  in_progress: ["awaiting_parts", "complete", "aborted"],
  awaiting_parts: ["in_progress", "aborted"],
  complete: ["invoiced", "reopened"],
  reopened: ["in_progress"],
  invoiced: [],
  cancelled: [],
  aborted: ["reopened"],
});

/** Transitions a DEVICE may drive. Assignment and cancellation are the office's. */
export const DEVICE_TRANSITIONS: readonly string[] = ["en_route", "on_site", "in_progress", "awaiting_parts", "complete", "aborted"];

/** What JOB_TRANSITIONS[state] ∩ DEVICE_TRANSITIONS permits from here — the buttons a job-detail screen may offer. */
export const nextDeviceStates = (state: string): readonly string[] => {
  const allowed = new Set(DEVICE_TRANSITIONS);
  return (JOB_TRANSITIONS[state] ?? []).filter((s) => allowed.has(s));
};

export type QueueEntry = { readonly mutation: SyncMutationWire; readonly enqueuedAt: number };
/** A mutation the server did not simply apply — something for the tech (or a supervisor) to read, not to silently retry. */
export type Attention = { readonly mutationId: string; readonly entityTable: string; readonly entityId: string; readonly kind: SyncOutcomeWire["outcome"]; readonly note: string };

export type OfflineQueue = {
  readonly pending: Signal<readonly QueueEntry[]>;
  readonly attention: Signal<readonly Attention[]>;
  readonly flushing: Signal<boolean>;
  enqueue(entityTable: string, entityId: string, op: SyncMutationWire["op"], payload: Readonly<Record<string, unknown>>, clientObservedVersion: number | null): SyncMutationWire;
  dismissAttention(mutationId: string): void;
  flush(replay: (mutations: readonly SyncMutationWire[]) => Promise<{ outcomes: readonly SyncOutcomeWire[] }>): Promise<void>;
};

const noteOf = (o: SyncOutcomeWire): string => ("note" in o ? o.note : "");

export const createOfflineQueue = (opts: { deviceId: string; newId: () => string; now: () => number }): OfflineQueue => {
  const pending = signal<readonly QueueEntry[]>([]);
  const attention = signal<readonly Attention[]>([]);
  const flushing = signal(false);
  let seq = 0;

  const enqueue: OfflineQueue["enqueue"] = (entityTable, entityId, op, payload, clientObservedVersion) => {
    const mutation: SyncMutationWire = {
      mutationId: opts.newId(), deviceId: opts.deviceId, deviceSeq: ++seq,
      entityTable, entityId, op, payload, clientObservedVersion,
      deviceAt: new Date(opts.now()).toISOString(),
    };
    pending.value = [...pending.value, { mutation, enqueuedAt: opts.now() }];
    return mutation;
  };

  const dismissAttention = (mutationId: string) => {
    attention.value = attention.value.filter((a) => a.mutationId !== mutationId);
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
    if (flushing.value || pending.value.length === 0) return;
    flushing.value = true;
    try {
      const batch = pending.value;
      let outcomes: readonly SyncOutcomeWire[];
      try {
        ({ outcomes } = await replay(batch.map((e) => e.mutation)));
      } catch {
        return; // unreachable gateway — nothing learned per-mutation; batch stays queued as-is
      }
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
      pending.value = [...unanswered, ...pending.value.slice(batch.length)];
      if (flagged.length) attention.value = [...attention.value, ...flagged];
    } finally {
      flushing.value = false;
    }
  };

  return { pending, attention, flushing, enqueue, dismissAttention, flush };
};
