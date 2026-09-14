/**
 * OFFLINE SYNC — non-negotiable #6, and the hardest distributed-systems work
 * in Phase 1 (action plan B7). THE RULES ARE WRITTEN HERE BEFORE THE CODE
 * (docs/BACKBONE_CONTRACT.md §7 is the prose; this is the data).
 *
 *   The device is the source of INTENT. The server is the source of TRUTH.
 *
 * A device offline accumulates an ordered mutation log. On reconnect it
 * replays that log; the server applies each entry under a policy declared
 * for the entity, and returns an authoritative outcome the device adopts
 * without argument. The device never merges. Merging in two places is how two
 * crews' photo sets end up on one job and one crew's time sheet disappears.
 *
 * Conflict policy is DATA — one table, not `if`s in fifteen handlers —
 * because the policy per entity is a business decision an office manager has
 * an opinion about, and it will change after the first pilot week (WS-D D-4).
 *
 *   append_only          Photos, diagnostic captures, time entries, parts used.
 *                        Two sources adding rows is not a conflict. Nothing is
 *                        ever lost. Idempotent by (entity, mutation_id).
 *   device_authoritative Checklist responses. The technician was standing in
 *                        front of the equipment; the office was not. An office
 *                        edit to a completed checklist is a different action
 *                        with its own audit row, not a silent overwrite.
 *   server_authoritative Assignment, contract terms, rate cards, credentials,
 *                        clearances. The device may not invent one. An offline
 *                        device that could create an assignment locally is the
 *                        compliance gate defeated by sync.
 *   state_machine        Job state. Neither side wins: transitions replay in
 *                        DEVICE order against the server's current state and
 *                        each is accepted only if legal from there. A crew that
 *                        completed a job the office cancelled gets a conflict
 *                        queued for a human — correct, because somebody drove
 *                        to a site for nothing and that needs a person.
 *   manual_queue         Signatures, warranty decisions: legal weight, no
 *                        automatic resolution exists.
 */
export type ConflictPolicy = "append_only" | "device_authoritative" | "server_authoritative" | "state_machine" | "manual_queue";

export const CONFLICT_POLICIES: Readonly<Record<string, ConflictPolicy>> = Object.freeze({
  job_media: "append_only",
  time_entries: "append_only",
  parts_used: "append_only",
  checklist_items: "device_authoritative",
  jobs: "state_machine",
  assignments: "server_authoritative",
  contract_term_overrides: "server_authoritative",
  rate_cards: "server_authoritative",
  crew_credentials: "server_authoritative",
  compliance_clearances: "server_authoritative",
  warranty_cases: "manual_queue",
  signatures: "manual_queue",
});

export const mayDeviceWrite = (entityTable: string): boolean => {
  const p = CONFLICT_POLICIES[entityTable];
  return p !== undefined && p !== "server_authoritative";
};

/** The job state machine. Legal transitions only; anything else is a conflict, not a coercion. */
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

export type Mutation = {
  readonly mutationId: string;     // client-generated; replay is idempotent by construction
  readonly deviceId: string;
  readonly deviceSeq: number;      // the device's own ordering, preserved
  readonly entityTable: string;
  readonly entityId: string;
  readonly op: "insert" | "update" | "transition";
  readonly payload: Readonly<Record<string, unknown>>;
  readonly clientObservedVersion: number | null;
  readonly deviceAt: string;       // recorded, never trusted for ordering
};

export type ServerState = { readonly version: number; readonly state?: string; readonly fields: Readonly<Record<string, unknown>> };

export type SyncOutcome =
  | { readonly outcome: "applied"; readonly mutationId: string; readonly newVersion: number }
  | { readonly outcome: "duplicate"; readonly mutationId: string }
  | { readonly outcome: "superseded"; readonly mutationId: string; readonly note: string; readonly serverState: ServerState | null }
  | { readonly outcome: "queued_for_human"; readonly mutationId: string; readonly note: string; readonly serverState: ServerState | null }
  | { readonly outcome: "rejected"; readonly mutationId: string; readonly note: string };

/** Pure. Decides; does not write. The gateway's sync handler applies the decision. */
export const resolveMutation = (m: Mutation, server: ServerState | null, alreadySeen: ReadonlySet<string>): SyncOutcome => {
  if (alreadySeen.has(m.mutationId)) return { outcome: "duplicate", mutationId: m.mutationId };
  const policy = CONFLICT_POLICIES[m.entityTable];
  if (!policy) {
    return {
      outcome: "rejected", mutationId: m.mutationId,
      note: `no conflict policy declared for "${m.entityTable}". Declare one in CONFLICT_POLICIES before a device may write it — an undeclared policy is an undiscussed business decision.`,
    };
  }
  const next = (server?.version ?? 0) + 1;

  switch (policy) {
    case "append_only":
      return { outcome: "applied", mutationId: m.mutationId, newVersion: next };

    case "device_authoritative":
      return { outcome: "applied", mutationId: m.mutationId, newVersion: next };

    case "server_authoritative":
      return {
        outcome: "rejected", mutationId: m.mutationId,
        note: `"${m.entityTable}" is server-authoritative. The device holds a cached copy and may not write it. If this arrived from a tablet, the tablet has a bug — an offline device creating its own ${m.entityTable} row is the compliance gate defeated by sync.`,
      };

    case "state_machine": {
      if (m.op !== "transition") return { outcome: "rejected", mutationId: m.mutationId, note: `"${m.entityTable}" accepts transitions only; field edits are not a device concern` };
      const from = server?.state ?? "created";
      const to = String(m.payload.state ?? "");
      if (!DEVICE_TRANSITIONS.includes(to)) {
        return { outcome: "rejected", mutationId: m.mutationId, note: `a device may not move a job to "${to}". That transition belongs to dispatch.` };
      }
      if ((JOB_TRANSITIONS[from] ?? []).includes(to)) return { outcome: "applied", mutationId: m.mutationId, newVersion: next };
      if (from === to) return { outcome: "duplicate", mutationId: m.mutationId };
      if (from === "cancelled" || from === "invoiced" || from === "reassigned") {
        return {
          outcome: "queued_for_human", mutationId: m.mutationId, serverState: server,
          note: `crew moved the job to "${to}" while the office had it at "${from}". Somebody did work that will not bill, or billed work that was not done. A person resolves this.`,
        };
      }
      return {
        outcome: "superseded", mutationId: m.mutationId, serverState: server,
        note: `transition ${from} → ${to} is not legal from the server's current state; the device adopts the server state.`,
      };
    }

    case "manual_queue":
      return { outcome: "queued_for_human", mutationId: m.mutationId, serverState: server, note: `"${m.entityTable}" carries legal weight and has no automatic resolution.` };
  }
};

/**
 * Replay a device's log in ITS order. `serverOf` is called per mutation so
 * that a transition applied earlier in the batch is visible to the next one —
 * the caller threads state through it.
 */
export const replay = (
  mutations: readonly Mutation[],
  serverOf: (m: Mutation, priorOutcomes: readonly SyncOutcome[]) => ServerState | null,
  alreadySeen: ReadonlySet<string>,
): readonly SyncOutcome[] => {
  const seen = new Set(alreadySeen);
  const out: SyncOutcome[] = [];
  for (const m of [...mutations].sort((a, b) => a.deviceSeq - b.deviceSeq)) {
    const r = resolveMutation(m, serverOf(m, out), seen);
    seen.add(m.mutationId);
    out.push(r);
  }
  return out;
};
