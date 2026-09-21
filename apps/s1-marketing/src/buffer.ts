import { signal, type Signal } from "../../../packages/ui/src/index.ts";
import type { SubmitLeadInput } from "../../../packages/contracts/src/index.ts";

/**
 * S1's DURABLE BUFFER (SURFACES.S1.degraded: "forms queue to a durable buffer
 * and replay. Site stays up when the gateway does not").
 *
 * The sentence is in the registry and it has been there since 05 Rev M, so
 * the question this file answers is not whether to have a queue but what
 * makes one honest. Three things, and each is a line of code that could
 * plausibly have been left out:
 *
 *   1. IT SURVIVES THE TAB. S5's queue lives in memory, because a technician's
 *      device is awake and holding the app open for a shift. A stranger on a
 *      phone in a mechanical room with one bar closes the tab, or the tab is
 *      discarded under memory pressure, and comes back later. So this one is
 *      written to storage on every change, and read back at boot.
 *
 *   2. IT REPLAYS THE SAME ID. `submissionId` is minted once, at enqueue, and
 *      never again. A replay that already landed loses to the unique index in
 *      migration 0008 and comes back as `leads_submission_id_key`, which this
 *      file reads as DONE. Without that, "we'll retry when you're back online"
 *      means "we'll phone you once per reconnection".
 *
 *   3. IT TELLS THE TRUTH ON SCREEN. A queued form is shown as queued, never
 *      as sent. The whole failure this buffer exists to prevent is a visitor
 *      who thinks we have their number and waits; a page that says "thanks,
 *      we'll be in touch" over a form that is still sitting in localStorage
 *      has converted an outage into a lost customer, quietly.
 *
 * Storage is injected rather than reached for. `localStorage` is absent under
 * node and THROWS in a browser with site data blocked — not returns null,
 * throws — so every access here is guarded and a failure degrades to an
 * in-memory queue rather than taking the form down with it.
 */

/** The slice of the Storage API this needs. A browser's localStorage satisfies it; a test passes a Map. */
export type BufferStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export const BUFFER_KEY = "ac.s1.pending";

export type QueuedLead = {
  readonly input: SubmitLeadInput;
  readonly queuedAt: number;
  /** How many times a flush has carried this one to the gateway and not been told it landed. */
  readonly attempts: number;
};

export type Outcome =
  /** The gateway took it, or told us it already had it. Either way it is ours no longer. */
  | { readonly kind: "landed"; readonly submissionId: string; readonly duplicate: boolean }
  /** The gateway refused it on its merits. Retrying sends the same thing and gets the same answer — this needs a person, not a timer. */
  | { readonly kind: "refused"; readonly submissionId: string; readonly message: string }
  /**
   * The session died while the visitor was typing. NOT the lead's fault and
   * not the visitor's: stays queued, and the caller mints a new session. The
   * one refusal that is worth retrying unchanged.
   */
  | { readonly kind: "stale"; readonly submissionId: string }
  /** Nobody answered. Stays queued. */
  | { readonly kind: "waiting"; readonly submissionId: string };

export type LeadBuffer = {
  readonly pending: Signal<readonly QueuedLead[]>;
  readonly flushing: Signal<boolean>;
  /** The refusals a flush produced that a person has to read. Cleared by `dismiss`. */
  readonly attention: Signal<readonly { readonly submissionId: string; readonly message: string }[]>;
  enqueue(input: SubmitLeadInput): void;
  dismiss(submissionId: string): void;
  /** Walk the queue oldest first, stopping at the first one nobody answers. Returns what happened. */
  flush(submit: (input: SubmitLeadInput) => Promise<unknown>): Promise<readonly Outcome[]>;
};

/**
 * The unique index's name, as `dbRefusal` reports it (apps/gateway/src/refusals.ts
 * puts the constraint name in `code` for a 23505). A replay that hits it is a
 * replay of something already recorded — success, arriving late.
 */
export const DUPLICATE_CODE = "leads_submission_id_key";

/**
 * The three things a thrown gateway error can mean here, read off the kind
 * rather than off a status code — `Refusal` only carries a status on
 * `transport`, and that is deliberate: the shell's whole classification is
 * "what kind of no is this", and a status number would be a second answer to
 * the same question.
 *
 *   transport  nobody answered. Queue it and try again.
 *   token      the session died while the visitor was typing. Queue it; the
 *              caller mints a new one. Retrying the SAME lead is correct.
 *   anything   the gateway answered on the merits. A retry sends the same
 *              else       thing and gets the same answer, so it stops here and
 *                         a person reads it.
 */
const kindOf = (e: unknown): string | null =>
  (e as { refusal?: { kind?: string } })?.refusal?.kind ?? null;

const codeOf = (e: unknown): string | null =>
  (e as { refusal?: { code?: string } })?.refusal?.code ?? null;

const messageOf = (e: unknown): string =>
  (e as { refusal?: { message?: string } })?.refusal?.message ?? (e instanceof Error ? e.message : String(e));

export const createLeadBuffer = (opts: { store?: BufferStore | null; now: () => number }): LeadBuffer => {
  const store = opts.store ?? null;

  const load = (): readonly QueuedLead[] => {
    if (!store) return [];
    try {
      const raw = store.getItem(BUFFER_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Anything in storage came from a previous version of this page and is
      // not to be trusted into the gateway un-looked-at.
      return parsed.filter((e): e is QueuedLead =>
        !!e && typeof e === "object"
        && typeof (e as QueuedLead).input?.submissionId === "string"
        && typeof (e as QueuedLead).input?.source === "string");
    } catch {
      return [];
    }
  };

  const pending = signal<readonly QueuedLead[]>(load());
  const flushing = signal(false);
  const attention = signal<readonly { submissionId: string; message: string }[]>([]);

  const persist = (next: readonly QueuedLead[]) => {
    pending.value = next;
    if (!store) return;
    try { store.setItem(BUFFER_KEY, JSON.stringify(next)); } catch { /* blocked site data: the queue is this session's */ }
  };

  const drop = (submissionId: string) => persist(pending.value.filter((q) => q.input.submissionId !== submissionId));

  const enqueue = (input: SubmitLeadInput) => {
    if (pending.value.some((q) => q.input.submissionId === input.submissionId)) return;
    persist([...pending.value, { input, queuedAt: opts.now(), attempts: 0 }]);
  };

  const dismiss = (submissionId: string) => {
    attention.value = attention.value.filter((a) => a.submissionId !== submissionId);
  };

  const flush: LeadBuffer["flush"] = async (submit) => {
    if (flushing.value) return [];
    flushing.value = true;
    const outcomes: Outcome[] = [];
    try {
      // Oldest first, and STOP at the first one nobody answers. Walking past
      // it would mean N requests into a gateway that is down, from a page
      // whose whole degraded story is that it does not depend on one.
      for (const q of [...pending.value]) {
        const submissionId = q.input.submissionId;
        try {
          await submit(q.input);
          drop(submissionId);
          outcomes.push({ kind: "landed", submissionId, duplicate: false });
        } catch (e) {
          if (codeOf(e) === DUPLICATE_CODE) {
            // It landed; the answer to the first attempt is what went missing.
            drop(submissionId);
            outcomes.push({ kind: "landed", submissionId, duplicate: true });
            continue;
          }
          const kind = kindOf(e);
          const bump = () => persist(pending.value.map((p) =>
            p.input.submissionId === submissionId ? { ...p, attempts: p.attempts + 1 } : p));
          if (kind === "token") {
            bump();
            outcomes.push({ kind: "stale", submissionId });
            break;
          }
          if (kind !== null && kind !== "transport") {
            const message = messageOf(e);
            drop(submissionId);
            attention.value = [...attention.value, { submissionId, message }];
            outcomes.push({ kind: "refused", submissionId, message });
            continue;
          }
          bump();
          outcomes.push({ kind: "waiting", submissionId });
          break;
        }
      }
    } finally {
      flushing.value = false;
    }
    return outcomes;
  };

  return { pending, flushing, attention, enqueue, dismiss, flush };
};
