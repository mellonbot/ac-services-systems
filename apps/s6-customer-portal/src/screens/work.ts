import { html, pageHead, DataGrid, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
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

/**
 * WHERE A REQUEST STANDS, in the customer's words. The five steps are the
 * reference layout's stepper; the job state behind each is ours and never
 * shown as the word it is on the board.
 */
export const STEPS = ["Requested", "Scheduled", "In progress", "Completed", "Invoiced"] as const;
export const stepOf = (r: Pick<ServiceRequestWire, "jobState">): number => {
  switch (r.jobState) {
    case null: case "created": return 0;
    case "assigned": case "reassigned": case "en_route": return 1;
    case "on_site": case "in_progress": case "awaiting_parts": case "reopened": return 2;
    case "complete": return 3;
    case "invoiced": return 4;
    default: return -1;
  }
};
const STEP_SENTENCE = [
  "It is with the office, who will open a job and match a technician.",
  "A technician is booked for your site.",
  "A technician is working on it.",
  "The work is done.",
  "The work is done and invoiced.",
];
export const requestCard = (ctx: Parameters<Screen>[0], r: ServiceRequestWire) => {
  const at = stepOf(r);
  const stopped = at < 0;
  return html`<article class="s6-order" data-request=${r.id}>
    <header class="s6-order__head">
      <div><h3 class="s6-order__title">${r.description.length > 72 ? `${r.description.slice(0, 72)}…` : r.description}</h3>
        <p class="s6-order__meta">${r.siteName} · asked ${when(r.createdAt)} · ${r.priority}</p></div>
      ${StatusPill({ density: ctx.density, status: stopped ? "blocked" : at >= 3 ? "ok" : at === 0 ? "at_risk" : "ok", label: stopped ? "Cancelled" : STEPS[at]! })}
    </header>
    ${stopped ? null : html`<ol class="s6-steps" aria-label="Where this request stands">
      ${STEPS.map((label, i) => html`<li class="s6-step" data-state=${i < at ? "done" : i === at ? "current" : "todo"} aria-current=${i === at ? "step" : undefined}><span class="s6-step__dot" aria-hidden="true"></span><span class="s6-step__label">${label}</span></li>`)}
    </ol>`}
    <p class="s6-order__note">${stopped ? "This request was closed without a visit." : STEP_SENTENCE[at]}</p>
  </article>`;
};

export const work: Screen = (ctx) => {
  const nodes = readNodes(ctx);
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const requests = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const now = Date.now();
  const siteName = (id: string) => (nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(id)?.name : undefined) ?? "—";

  return html`<section class="s6-work">
    ${pageHead("Work", "The requests you have made and the jobs at your sites, each shown by where it stands — in your words, not ours.")}
    <h2 class="s6-h2">Your requests</h2>
    ${whenReady(ctx, requests.value, (out) => out.requests.length === 0
      ? html`<p class="s6-empty">No requests yet.</p>`
      : html`<div class="s6-orders" id="request-cards">${out.requests.map((r) => requestCard(ctx, r))}</div>`, () => ctx.store.invalidate("serviceRequests.list"))}
    <h2 class="s6-h2">Jobs</h2>
    ${whenReady(ctx, jobs.value, (out) => DataGrid<JobWire>({
      density: ctx.density,
      caption: "Jobs at sites in view",
      emptyText: "No jobs at your sites.",
      rows: [...out.jobs].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.openedAt.localeCompare(a.openedAt)),
      rowKey: (j) => j.id,
      columns: [
        { key: "site", header: "Site", cell: (j) => linkTo(ctx, "site", { siteId: j.siteId }, siteName(j.siteId)) },
        { key: "serviceCode", header: "Service" },
        { key: "state", header: "State", cell: (j) => STATE_WORD[j.state] },
        { key: "window", header: "Window", cell: (j) => `${when(j.serviceWindowStart)} – ${when(j.serviceWindowEnd)}` },
        {
          key: "sla", header: "Response",
          cell: (j) => StatusPill({ density: ctx.density, status: slaStatus(j, now), label: j.slaSatisfiedAt ? `Responded ${when(j.slaSatisfiedAt)}` : j.slaDueAt ? `Due ${when(j.slaDueAt)}` : "No commitment on file" }) ?? html``,
        },
      ],
    }) ?? html``, () => ctx.store.invalidate("jobs.list"))}

    <p class="s6-actions">${linkTo(ctx, "request", {}, "Request service")}</p>
  </section>`;
};
