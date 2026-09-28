import { html, DataGrid, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
import type { JobWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, submitAction, linkTo, type Screen } from "./common.ts";

/**
 * THE BOARD — S3's home screen (09 §2.8 item 4). Every job region-locked RLS
 * lets this principal see, with its current (unreleased) assignment and its
 * open SLA timer, read straight off `jobs.list` — the same operation S2 reads
 * org-wide, so a board and an org-wide report can never quietly disagree
 * about what a job's state is.
 *
 * SLA health is the one thing this screen derives rather than displays
 * verbatim, because the wire gives a due date and an escalation stage, not a
 * word — `slaStatus` is the one function that turns those into the same
 * three-state ramp DegradedBanner and RefusalCard already use, so a
 * dispatcher reading three screens is not learning three vocabularies.
 */
export const slaStatus = (job: Pick<JobWire, "slaDueAt" | "slaEscalationStage" | "slaSatisfiedAt">, nowMs: number): Status => {
  if (job.slaSatisfiedAt || !job.slaDueAt) return "ok";
  if (nowMs >= Date.parse(job.slaDueAt)) return "breached";
  if ((job.slaEscalationStage ?? 0) > 0) return "at_risk";
  return "ok";
};

/** A job is releasable exactly when S3's own gated door put it there: state "assigned" with an open assignment. */
export const isReleasable = (job: JobWire): boolean => job.state === "assigned" && job.currentAssignmentId !== null;
/** A job is dispatchable when nobody currently holds it and it has not moved past the point dispatch.assign accepts (see assignCrew's own WHERE). */
export const isDispatchable = (job: JobWire): boolean => job.currentCrewId === null && (job.state === "created" || job.state === "reassigned");

const CLOSED = ["complete", "invoiced", "cancelled", "aborted"];
/** The strip above the board: what a dispatcher reads before the rows. Counts of the rows the gateway returned — no filter of its own. */
export const boardStats = (jobs: readonly JobWire[], now: number) => {
  const open = jobs.filter((j) => !CLOSED.includes(j.state));
  const unassigned = open.filter((j) => !j.currentCrewId).length;
  const atRisk = open.filter((j) => j.slaDueAt && !j.slaSatisfiedAt && ((j.slaEscalationStage ?? 0) > 0 || Date.parse(j.slaDueAt) - now <= 60 * 60_000)).length;
  const crews = new Set(open.map((j) => j.currentCrewId).filter(Boolean)).size;
  const tile = (n: number, label: string, tone?: string) => html`<div class="ac-stat" data-tone=${tone}><span class="ac-stat__n">${n}</span><span class="ac-stat__l">${label}</span></div>`;
  return html`<div class="ac-stats" id="board-stats">
    ${tile(open.length, "Open jobs")}
    ${tile(unassigned, "Unassigned", unassigned ? "at_risk" : undefined)}
    ${tile(atRisk, "At risk now", atRisk ? "breached" : undefined)}
    ${tile(crews, "Crews out", "info")}
  </div>`;
};

export const board: Screen = (ctx) => {
  const jobsKey = keyOf("jobs.list", {});
  const jobs = ctx.store.read(jobsKey, () => ctx.shell.gateway.listJobs({}));
  const now = Date.now();

  const release = async (job: JobWire) => {
    if (!job.currentAssignmentId) return;
    try {
      await ctx.shell.gateway.releaseAssignment({ assignmentId: job.currentAssignmentId, orgId: job.orgId, regionId: job.regionId, reason: "released from the board" });
      ctx.store.notice.value = [`${job.serviceCode} at its site was released for re-dispatch.`];
      ctx.store.invalidate("jobs.list");
    } catch {
      ctx.store.notice.value = ["The release did not go through. The board still shows the crew as assigned — try again."];
    }
  };

  return html`<section class="s3-board">
    <header class="ac-page-head">
      <div><h1 class="ac-page-head__title">Dispatch board</h1>
        <p class="ac-page-head__lede">Every job in your region with its response clock. Dispatch runs through the compliance gate; a crew that does not clear the whole service window is refused in plain words.</p></div>
    </header>
    ${whenReady(ctx, jobs.value, (out) => boardStats(out.jobs, now))}
    ${whenReady(ctx, jobs.value, (out) => DataGrid<JobWire>({
      density: ctx.density,
      caption: "Jobs visible to this region",
      emptyText: "No jobs on the board.",
      rows: out.jobs,
      rowKey: (j) => j.id,
      columns: [
        { key: "site", header: "Site", cell: (j) => j.siteName ?? html`<span class="s3-muted">—</span>` },
        { key: "serviceCode", header: "Service" },
        { key: "priority", header: "Priority" },
        { key: "state", header: "State" },
        {
          key: "sla", header: "SLA",
          cell: (j) => StatusPill({ density: ctx.density, status: slaStatus(j, now), label: j.slaSatisfiedAt ? "Satisfied" : j.slaDueAt ? new Date(j.slaDueAt).toLocaleString() : "No timer" }) ?? html``,
        },
        { key: "crew", header: "Crew", cell: (j) => j.currentCrewLabel ?? "Unassigned" },
        {
          key: "actions", header: "Actions",
          cell: (j) => html`<span class="s3-row-actions">
            ${isDispatchable(j) ? linkTo(ctx, "dispatch", { jobId: j.id }, "Dispatch") : null}
            ${isReleasable(j) ? submitAction(ctx, "Release", () => void release(j), `release-${j.id}`, "quiet") : null}
          </span>`,
        },
      ],
    }) ?? html``)}
  </section>`;
};
