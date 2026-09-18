import { html, DataGrid, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
import type { JobWire, JobStateWire, ServiceRequestWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readNodes, treeOf, linkTo, when, type Screen } from "./common.ts";

/**
 * WORK — every job at a site this principal can see, and every request it
 * has made. Read straight off `jobs.list`, the operation S2 reads org-wide
 * and S3 reads region-locked; the customer's rows are the ones 0006's
 * `ac_work_visible` admits. What is NOT on this screen is as deliberate as
 * what is: no crew, no employment shape, no compliance detail. The wire
 * carries `currentCrewLabel` because S3's board needs it — for a customer
 * principal RLS returns no assignment row to join, so the field is null by
 * mechanism, and the column is simply not drawn.
 *
 * SLA health is derived the same way S3's board derives it — one function,
 * one three-state ramp — so a customer and the dispatcher serving them are
 * reading the same word off the same numbers.
 */
export const slaStatus = (job: Pick<JobWire, "slaDueAt" | "slaEscalationStage" | "slaSatisfiedAt">, nowMs: number): Status => {
  if (job.slaSatisfiedAt || !job.slaDueAt) return "ok";
  if (nowMs >= Date.parse(job.slaDueAt)) return "breached";
  if ((job.slaEscalationStage ?? 0) > 0) return "at_risk";
  return "ok";
};

const CLOSED: readonly JobStateWire[] = ["complete", "invoiced", "cancelled"];
export const isOpen = (job: Pick<JobWire, "state">): boolean => !CLOSED.includes(job.state);

/** The customer's word for a state. The wire's enum is ours; a customer reads plain words, as the pill's own register does. */
export const STATE_WORD: Readonly<Record<JobStateWire, string>> = {
  created: "Scheduled", assigned: "Crew assigned", reassigned: "Being reassigned", en_route: "Crew en route", on_site: "Crew on site",
  in_progress: "In progress", awaiting_parts: "Awaiting parts", complete: "Complete", reopened: "Reopened", invoiced: "Invoiced",
  cancelled: "Cancelled", aborted: "Stopped",
};

export const work: Screen = (ctx) => {
  const nodes = readNodes(ctx);
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const requests = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const now = Date.now();
  const siteName = (id: string) => (nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(id)?.name : undefined) ?? "—";

  return html`<section class="s6-work">
    <h1 class="s6-h1">Work</h1>
    <h2 class="s6-h2">Jobs</h2>
    ${whenReady(ctx, jobs.value, (out) => DataGrid<JobWire>({
      density: ctx.density,
      caption: "Jobs at sites in view",
      emptyText: "No jobs at your sites.",
      rows: [...out.jobs].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.openedAt.localeCompare(a.openedAt)),
      rowKey: (j) => j.id,
      columns: [
        { key: "site", header: "Site", cell: (j) => siteName(j.siteId) },
        { key: "serviceCode", header: "Service" },
        { key: "state", header: "State", cell: (j) => STATE_WORD[j.state] },
        { key: "window", header: "Window", cell: (j) => `${when(j.serviceWindowStart)} – ${when(j.serviceWindowEnd)}` },
        {
          key: "sla", header: "Response",
          cell: (j) => StatusPill({ density: ctx.density, status: slaStatus(j, now), label: j.slaSatisfiedAt ? `Responded ${when(j.slaSatisfiedAt)}` : j.slaDueAt ? `Due ${when(j.slaDueAt)}` : "No commitment on file" }) ?? html``,
        },
      ],
    }) ?? html``, () => ctx.store.invalidate("jobs.list"))}

    <h2 class="s6-h2">Requests</h2>
    ${whenReady(ctx, requests.value, (out) => DataGrid<ServiceRequestWire>({
      density: ctx.density,
      caption: "Service you have asked for",
      emptyText: "No requests yet.",
      rows: out.requests,
      rowKey: (r) => r.id,
      columns: [
        { key: "siteName", header: "Site" },
        { key: "priority", header: "Priority" },
        { key: "description", header: "What is wrong" },
        { key: "createdAt", header: "Asked", cell: (r) => when(r.createdAt) },
        { key: "status", header: "Status", cell: (r) => (r.jobState ? `Job: ${STATE_WORD[r.jobState]}` : "Waiting for the office") },
      ],
    }) ?? html``, () => ctx.store.invalidate("serviceRequests.list"))}
    <p class="s6-actions">${linkTo(ctx, "request", {}, "Request service")}</p>
  </section>`;
};
