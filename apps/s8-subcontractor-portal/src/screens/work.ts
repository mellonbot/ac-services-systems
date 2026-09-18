import { html, DataGrid, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
import type { JobWire, JobStateWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, when, type Screen } from "./common.ts";

/**
 * WORK — every job one of the firm's crews has been sent to, live or past.
 * `jobs.list` is the same operation S2 reads org-wide, S3 region-locked and
 * S6 at its own sites; the firm's rows are the ones 0007's
 * `ac_firm_work_visible` admits, and the crew on the row is the firm's own
 * because the assignment join sits behind the same rule. The site's name is
 * on the wire because the firm may see the row it was sent to (0007's
 * accounts rule) and nothing above it — there is no tree to walk here.
 *
 * The SLA pill is derived the way S3's board and S6's work list derive it:
 * one function shape, one three-state ramp. A firm and the dispatcher who
 * sent it read the same word off the same numbers.
 */
export const slaStatus = (job: Pick<JobWire, "slaDueAt" | "slaEscalationStage" | "slaSatisfiedAt">, nowMs: number): Status => {
  if (job.slaSatisfiedAt || !job.slaDueAt) return "ok";
  if (nowMs >= Date.parse(job.slaDueAt)) return "breached";
  if ((job.slaEscalationStage ?? 0) > 0) return "at_risk";
  return "ok";
};

const CLOSED: readonly JobStateWire[] = ["complete", "invoiced", "cancelled"];
export const isOpen = (job: Pick<JobWire, "state">): boolean => !CLOSED.includes(job.state);

/** The firm's word for a state — the crew's own progress, in the register a coordinator reads. */
export const STATE_WORD: Readonly<Record<JobStateWire, string>> = {
  created: "Scheduled", assigned: "Assigned to you", reassigned: "Being reassigned", en_route: "Your crew en route", on_site: "Your crew on site",
  in_progress: "In progress", awaiting_parts: "Awaiting parts", complete: "Complete", reopened: "Reopened", invoiced: "Invoiced",
  cancelled: "Cancelled", aborted: "Stopped",
};

export const work: Screen = (ctx) => {
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const now = Date.now();
  return html`<section class="s8-work">
    <h1 class="s8-h1">Work</h1>
    <p class="s8-scope">Jobs your crews have been sent to. The response commitment is the customer's term, timed by Rankine; your crew's arrival is what satisfies it.</p>
    ${whenReady(ctx, jobs.value, (out) => DataGrid<JobWire>({
      density: ctx.density,
      caption: "Jobs your crews were assigned",
      emptyText: "No work has been assigned to your crews yet.",
      rows: [...out.jobs].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.openedAt.localeCompare(a.openedAt)),
      rowKey: (j) => j.id,
      columns: [
        { key: "site", header: "Site", cell: (j) => j.siteName ?? "—" },
        { key: "serviceCode", header: "Service" },
        { key: "crew", header: "Crew", cell: (j) => j.currentCrewLabel ?? "Released" },
        { key: "state", header: "State", cell: (j) => STATE_WORD[j.state] },
        { key: "window", header: "Window", cell: (j) => `${when(j.serviceWindowStart)} – ${when(j.serviceWindowEnd)}` },
        {
          key: "sla", header: "Response",
          cell: (j) => StatusPill({ density: ctx.density, status: slaStatus(j, now), label: j.slaSatisfiedAt ? `Responded ${when(j.slaSatisfiedAt)}` : j.slaDueAt ? `Due ${when(j.slaDueAt)}` : "No commitment on file" }) ?? html``,
        },
      ],
    }) ?? html``, () => ctx.store.invalidate("jobs.list"))}
  </section>`;
};
