/**
 * Offline replay for the demo stand-in. The decision is the domain's
 * resolveMutation — the same function the gateway applies — including the
 * rejection of a bare transition to "complete" (that is jobs.wrapUp).
 *
 * payload.to is copied onto payload.state when state is absent, because the
 * older demo tablets sent "to". The real gateway requires state and does not
 * do this; the shim is demo compatibility only.
 *
 * Job state changes only when the outcome is "applied" for a jobs transition.
 * The loop matches domain replay: sort by deviceSeq, decide against the seen
 * set, then record the id. Applying between decisions is what makes the next
 * mutation see the state this one just wrote. Domain replay calls serverOf
 * before the decision, so the write cannot live inside that callback.
 */
import { resolveMutation, type Mutation, type SyncOutcome } from "../../packages/domain/src/sync/index.ts";
import type * as W from "../../packages/contracts/src/operations.ts";
import type { SurfaceId } from "../../packages/contracts/src/surfaces.ts";
import { jobs, publish } from "./model.ts";

const replayed = new Set<string>();

const withState = (payload: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  payload.state === undefined && "to" in payload ? { ...payload, state: payload.to } : { ...payload };

const serverOf = (job: { version: number; state: string } | undefined): { version: number; state: string; fields: Record<string, never> } | null =>
  job ? { version: job.version, state: job.state, fields: {} } : null;

export const replaySync = (mutations: readonly W.SyncMutationWire[] | undefined, surface: SurfaceId): W.SyncOutcomeWire[] => {
  const seen = new Set(replayed);
  const outcomes: SyncOutcome[] = [];
  for (const raw of [...(mutations ?? [])].sort((a, b) => a.deviceSeq - b.deviceSeq)) {
    const payload = withState(raw.payload ?? {});
    const m: Mutation = {
      mutationId: raw.mutationId, deviceId: raw.deviceId, deviceSeq: raw.deviceSeq,
      entityTable: raw.entityTable, entityId: raw.entityId, op: raw.op, payload,
      clientObservedVersion: raw.clientObservedVersion, deviceAt: raw.deviceAt,
    };
    const job = m.entityTable === "jobs" ? jobs.find((x) => x.id === m.entityId) : undefined;
    const outcome: SyncOutcome = seen.has(m.mutationId)
      ? resolveMutation(m, serverOf(job), seen)
      : m.entityTable === "jobs" && !job
        ? { outcome: "rejected", mutationId: m.mutationId, note: `job ${m.entityId} is not one this crew has been sent to — a device writes only its own crew's work` }
        : resolveMutation(m, serverOf(job), seen);
    seen.add(m.mutationId);
    replayed.add(m.mutationId);
    outcomes.push(outcome);
    if (outcome.outcome === "applied" && m.entityTable === "jobs" && m.op === "transition" && job) {
      const to = String(payload.state ?? "");
      job.state = to as W.JobStateWire;
      job.version = outcome.newVersion;
      job.stateChangedAt = new Date().toISOString();
      publish(surface, to === "complete" ? "job.completed" : "job.transitioned", "job", job.id, job.orgId, job.regionId);
    }
  }
  return outcomes;
};
