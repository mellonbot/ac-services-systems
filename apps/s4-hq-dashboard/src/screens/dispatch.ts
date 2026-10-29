import { html, DataGrid, StatusPill, pageHead, panel, statStrip, shortRef, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import { formatMoney } from "../../../../packages/ui/src/fixed-units.ts";
import { serviceLabel, WORK_DONE_STATES, type JobStateWire, type JobWire, type JobVisitWire, type JobNoteWire, type ServiceRequestWire, type ManagerOverviewOutput } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";
import { word, regionsBy } from "./office.ts";

/**
 * DISPATCH — S3's board, jobs, intake and manager view, read from HQ across
 * every region. The reads are S3's own; S3's writes (assign, release, move a
 * job, note it) are not served to S4, so nothing here dispatches. HQ sees the
 * board; the region runs it.
 */

export const DISPATCH_TABS = [
  ["dispatch.board", "Board"], ["dispatch.jobs", "All jobs"], ["dispatch.intake", "Intake"], ["dispatch.manager", "Manager"],
] as const;

export const dispatchNav = (ctx: ScreenContext, at: (typeof DISPATCH_TABS)[number][0]): VNode =>
  html`<nav class="s4-asof" aria-label="Dispatch views">${DISPATCH_TABS.map(([id, label]) => (id === at ? html`<strong aria-current="page">${label}</strong>` : linkTo(ctx, id, {}, label)))}</nav>`;

export const STATE_LABEL: Readonly<Record<JobStateWire, string>> = {
  created: "Unassigned", reassigned: "Unassigned", reopened: "Reopened", awaiting_parts: "Waiting on parts", complete: "Needs invoicing",
  assigned: "Dispatched", en_route: "En route", on_site: "On site", in_progress: "In progress",
  invoiced: "Invoiced", cancelled: "Cancelled", aborted: "Aborted",
  awaiting_customer: "On hold for customer", quote_requested: "Quote requested", quote_submitted: "Quote submitted",
  needs_pricing: "Needs pricing", awaiting_po: "Waiting on a PO", awaiting_pictures: "Waiting on pictures", invoice_trouble: "Trouble invoicing",
};

const CLOSED: readonly string[] = [...WORK_DONE_STATES, "cancelled", "aborted"];
export const isOpen = (j: JobWire): boolean => !CLOSED.includes(j.state);

/** The same derivation S3's board makes: past due is breached, an escalated clock is at risk. */
export const slaStatus = (job: Pick<JobWire, "slaDueAt" | "slaEscalationStage" | "slaSatisfiedAt">, nowMs: number): Status => {
  if (job.slaSatisfiedAt || !job.slaDueAt) return "ok";
  if (nowMs >= Date.parse(job.slaDueAt)) return "breached";
  if ((job.slaEscalationStage ?? 0) > 0) return "at_risk";
  return "ok";
};

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const num = (v: string | number): VNode => html`<span class="s4-num">${v}</span>`;
const readJobs = (ctx: ScreenContext) => ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
const readOnly = html`<p class="s4-readonly">Read only — the region dispatches from the Dispatch Console.</p>`;

const jobGrid = (ctx: ScreenContext, jobs: readonly JobWire[], caption: string, emptyText: string): VNode => {
  const region = regionsBy(ctx);
  const now = ctx.now();
  return DataGrid<JobWire>({
    density: ctx.density, caption, stack: true, linked: true, rows: jobs, rowKey: (r) => r.id, emptyText,
    columns: [
      { key: "job", header: "Job", numeric: true, cell: (r) => linkTo(ctx, "dispatch.job", { jobId: r.id }, shortRef(r.id)) },
      { key: "site", header: "Site", cell: (r) => r.siteName ?? "—" },
      { key: "work", header: "Work", cell: (r) => serviceLabel(r.serviceCode) },
      { key: "priority", header: "Priority", cell: (r) => word(r.priority) },
      { key: "region", header: "Region", cell: (r) => region(r.regionId) },
      { key: "crew", header: "Crew", cell: (r) => r.currentCrewLabel ?? "—" },
      { key: "state", header: "State", cell: (r) => STATE_LABEL[r.state] },
      { key: "due", header: "Due", numeric: true, cell: (r) => (r.slaDueAt && !r.slaSatisfiedAt ? when(r.slaDueAt) : "—") },
      { key: "sla", header: "SLA", cell: (r) => (r.slaDueAt && !r.slaSatisfiedAt ? StatusPill({ density: ctx.density, status: slaStatus(r, now) }) : "—") },
    ],
  }) ?? html``;
};

// ---------------------------------------------------------------------------
export const dispatchBoard: Screen = (ctx) => {
  const jobs = readJobs(ctx);
  const now = ctx.now();
  return html`<section>
    ${dispatchNav(ctx, "dispatch.board")}
    ${pageHead("Dispatch board", "Every open job in every region, who holds it and how its response clock stands.")}
    ${whenReady(ctx, jobs.value, (o) => {
      const open = o.jobs.filter(isOpen).sort((a, b) => (a.slaDueAt ?? "~").localeCompare(b.slaDueAt ?? "~"));
      const atRisk = open.filter((j) => slaStatus(j, now) === "at_risk").length;
      const breached = open.filter((j) => slaStatus(j, now) === "breached").length;
      const unassigned = open.filter((j) => j.currentCrewId === null).length;
      return html`
        ${statStrip([
          { n: num(open.length), label: "Open jobs" },
          { n: num(unassigned), label: "Unassigned", ...(unassigned > 0 ? { tone: "at_risk" as const } : {}) },
          { n: num(atRisk), label: "At risk", ...(atRisk > 0 ? { tone: "at_risk" as const } : {}) },
          { n: num(breached), label: "Breached", ...(breached > 0 ? { tone: "breached" as const } : {}) },
        ])}
        ${panel(jobGrid(ctx, open, "Open jobs, soonest due first", "No open jobs."), "Open jobs")}`;
    }, () => ctx.store.invalidate("jobs.list"))}
    ${readOnly}
  </section>`;
};

export const dispatchJobs: Screen = (ctx) => {
  const jobs = readJobs(ctx);
  return html`<section>
    ${dispatchNav(ctx, "dispatch.jobs")}
    ${pageHead("All jobs", "Every job, open and finished, newest opened first.")}
    ${panel(whenReady(ctx, jobs.value, (o) => jobGrid(ctx, [...o.jobs].sort((a, b) => b.openedAt.localeCompare(a.openedAt)), "Every job", "No jobs yet."), () => ctx.store.invalidate("jobs.list")))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const dispatchJob: Screen = (ctx, params) => {
  const jobId = params["jobId"]!;
  const detail = ctx.store.read(keyOf("jobs.detail", { jobId }), () => ctx.shell.gateway.jobDetail({ jobId }));
  const region = regionsBy(ctx);
  const back = linkTo(ctx, "dispatch.board", {}, "Back to the board");
  return html`<section>
    ${dispatchNav(ctx, "dispatch.board")}
    ${whenReady(ctx, detail.value, (d) => {
      const j = d.job;
      const addr = j.siteAddress ? [j.siteAddress.line1, j.siteAddress.city, j.siteAddress.state].filter(Boolean).join(", ") : null;
      return html`
        ${pageHead(`${serviceLabel(j.serviceCode)} · ${j.siteName ?? "Site"}`, `Job ${shortRef(j.id)} · ${STATE_LABEL[j.state]} · ${region(j.regionId)}`, back)}
        <dl class="ac-facts">
          <div><dt>Priority</dt><dd>${word(j.priority)}</dd></div>
          <div><dt>Crew</dt><dd>${j.currentCrewLabel ?? "Unassigned"}</dd></div>
          <div><dt>Response due</dt><dd class="ac-num">${j.slaDueAt && !j.slaSatisfiedAt ? when(j.slaDueAt) : "Met or none"}</dd></div>
          <div><dt>SLA</dt><dd>${j.slaDueAt && !j.slaSatisfiedAt ? StatusPill({ density: ctx.density, status: slaStatus(j, ctx.now()) }) : "—"}</dd></div>
          <div><dt>Window</dt><dd class="ac-num">${when(j.serviceWindowStart)} → ${when(j.serviceWindowEnd)}</dd></div>
          <div><dt>Address</dt><dd>${addr ?? "—"}</dd></div>
          <div><dt>Contact</dt><dd>${d.contact ? [d.contact.name, d.contact.phone, d.contact.email].filter(Boolean).join(" · ") : "—"}</dd></div>
          <div><dt>Return trip</dt><dd>${j.returnTrip ? "Owed" : "No"}</dd></div>
        </dl>
        ${panel(DataGrid<JobVisitWire>({
          density: ctx.density, caption: "Visits", stack: true, rows: d.visits, rowKey: (r) => r.id, emptyText: "No crew sent yet.",
          columns: [
            { key: "crew", header: "Crew", cell: (r) => r.crewLabel ?? shortRef(r.crewId) },
            { key: "assigned", header: "Assigned", numeric: true, cell: (r) => when(r.assignedAt) },
            { key: "start", header: "Work started", numeric: true, cell: (r) => when(r.workStart) },
            { key: "end", header: "Work ended", numeric: true, cell: (r) => when(r.workEnd) },
            { key: "released", header: "Released", numeric: true, cell: (r) => when(r.releasedAt) },
          ],
        }) ?? html``, "Visits")}
        ${panel(DataGrid<JobNoteWire>({
          density: ctx.density, caption: "Office notes", stack: true, rows: d.notes, rowKey: (r) => r.id, emptyText: "No notes.",
          columns: [
            { key: "at", header: "When", numeric: true, cell: (r) => when(r.at) },
            { key: "who", header: "By", cell: (r) => r.authorName ?? "—" },
            { key: "body", header: "Note", cell: (r) => r.body },
          ],
        }) ?? html``, "Notes")}
        ${panel(html`<ul class="s4-means">
          ${d.updates.length === 0 && d.messages.length === 0 ? html`<li class="s4-muted">Nothing said to the customer yet.</li>` : null}
          ${d.updates.map((u) => html`<li><b>Update${u.state === "draft" ? " (draft)" : ""}</b> · <span class="s4-num">${when(u.publishedAt ?? u.updatedAt)}</span> — ${u.body}</li>`)}
          ${d.messages.map((m) => html`<li><b>${m.authorKind === "customer" ? "Customer" : "Office"}${m.authorName ? `, ${m.authorName}` : ""}</b> · <span class="s4-num">${when(m.at)}</span> — ${m.body}</li>`)}
        </ul>`, "With the customer", `${d.media.length} photos and files on the job`)}`;
    }, () => ctx.store.invalidate("jobs.detail"))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
export const dispatchIntake: Screen = (ctx) => {
  const reqs = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const region = regionsBy(ctx);
  return html`<section>
    ${dispatchNav(ctx, "dispatch.intake")}
    ${pageHead("Intake", "What customers asked for, and whether the office has opened a job for it.")}
    ${whenReady(ctx, reqs.value, (o) => {
      const waiting = o.requests.filter((r) => r.jobId === null).length;
      return html`
        ${statStrip([
          { n: num(o.requests.length), label: "Requests" },
          { n: num(waiting), label: "Waiting for a job", ...(waiting > 0 ? { tone: "at_risk" as const } : {}) },
        ])}
        ${panel(DataGrid<ServiceRequestWire>({
          density: ctx.density, caption: "Service requests", stack: true, rows: o.requests, rowKey: (r) => r.id, emptyText: "No requests.",
          columns: [
            { key: "at", header: "Received", numeric: true, cell: (r) => when(r.createdAt) },
            { key: "site", header: "Site", cell: (r) => r.siteName },
            { key: "region", header: "Region", cell: (r) => region(r.regionId) },
            { key: "priority", header: "Priority", cell: (r) => word(r.priority) },
            { key: "what", header: "They said", cell: (r) => r.description },
            { key: "by", header: "Asked by", cell: (r) => r.requestedBy },
            { key: "job", header: "Job", cell: (r) => (r.jobId ? html`${linkTo(ctx, "dispatch.job", { jobId: r.jobId }, shortRef(r.jobId))} · ${r.jobState ? STATE_LABEL[r.jobState] : ""}` : r.waitingOnTerm ? `Waiting on ${r.waitingOnTerm}` : "Not opened") },
          ],
        }) ?? html``)}`;
    }, () => ctx.store.invalidate("serviceRequests.list"))}
    ${readOnly}
  </section>`;
};

// ---------------------------------------------------------------------------
const WAIT_LABEL: Readonly<Record<ManagerOverviewOutput["waits"][number]["step"], string>> = {
  request_to_scheduled: "Request → scheduled", scheduled_to_on_site: "Scheduled → on site", on_site_to_finished: "On site → finished", finished_to_invoiced: "Finished → invoiced",
};

export const dispatchManager: Screen = (ctx) => {
  const m = ctx.store.read(keyOf("manager.overview"), () => ctx.shell.gateway.managerOverview());
  return html`<section>
    ${dispatchNav(ctx, "dispatch.manager")}
    ${pageHead("Manager", "The leadership view the Dispatch Console keeps: what was finished and billed, how long each step waits, and where crews stand.")}
    ${whenReady(ctx, m.value, (o) => {
      const unbilled = o.unbilled.complete + o.unbilled.needsPricing + o.unbilled.awaitingPo + o.unbilled.awaitingPictures + o.unbilled.invoiceTrouble;
      const urgent = o.urgentUnassigned.reduce((s, u) => s + u.count, 0);
      return html`
        ${statStrip([
          ...o.billed.map((b) => ({ n: num(formatMoney(b.minor, b.currency)), label: "Billed this month", sub: `${formatMoney(b.priorMinor, b.currency)} same span last month` })),
          { n: num(o.completed.now), label: "Completed this month", sub: `${o.completed.prior} last month` },
          { n: num(o.fixedFirstVisit), label: "Fixed first visit" },
          { n: num(unbilled), label: "Finished, not invoiced", ...(unbilled > 0 ? { tone: "at_risk" as const } : {}) },
          { n: num(urgent), label: "Urgent, unassigned", ...(urgent > 0 ? { tone: "breached" as const } : {}) },
          { n: num(o.credentials.expired), label: "Crews with lapsed papers", ...(o.credentials.expired > 0 ? { tone: "breached" as const } : {}), sub: `${o.credentials.expiring} lapse within 30 days` },
          { n: num(o.nearOvertime), label: "Crews near overtime", ...(o.nearOvertime > 0 ? { tone: "at_risk" as const } : {}) },
          { n: num(`${o.labor.hours} h`), label: "Labour, 7 days", sub: `${o.labor.techs} employed crews` },
        ])}
        ${panel(html`<ul class="s4-means">${o.waits.map((w) => html`<li><b>${WAIT_LABEL[w.step]}</b> — <span class="s4-num">${w.avgDays === null ? "no jobs" : `${w.avgDays.toFixed(1)} days`}</span> over <span class="s4-num">${w.jobs}</span> jobs</li>`)}</ul>`, "How long each step waits", "Average over the last 30 days")}
        ${panel(DataGrid({
          density: ctx.density, caption: "Branches", stack: true, rows: o.branches, rowKey: (r) => r.regionId,
          columns: [
            { key: "name", header: "Branch", cell: (r) => r.name },
            { key: "techs", header: "Technicians", numeric: true, align: "end", cell: (r) => r.techs },
            { key: "hours", header: "Labour, 7 days", numeric: true, align: "end", cell: (r) => `${r.laborHours} h` },
            { key: "unbilled", header: "Not invoiced", numeric: true, align: "end", cell: (r) => r.unbilled },
          ],
        }) ?? html``, "Branches")}
        ${panel(DataGrid({
          density: ctx.density, caption: "Team", stack: true, rows: o.team, rowKey: (r) => r.userId, emptyText: "No one on the team.",
          columns: [
            { key: "name", header: "Name", cell: (r) => r.name },
            { key: "roles", header: "Roles", cell: (r) => r.roles.map(word).join(", ") },
            { key: "branch", header: "Branch", cell: (r) => r.branch },
            { key: "on", header: "Now", cell: (r) => (r.onJob ? "On a job" : "—") },
            { key: "hours", header: "Hours this week", numeric: true, align: "end", cell: (r) => (r.hoursThisWeek === null ? "—" : r.hoursThisWeek) },
            { key: "cred", header: "Papers", cell: (r) => (r.credential ? StatusPill({ density: ctx.density, status: r.credential, label: r.credential === "ok" ? "Current" : r.credential === "at_risk" ? "Lapsing" : "Lapsed" }) : "—") },
          ],
        }) ?? html``, "Team")}
        <p class="s4-sub">As of <span class="s4-num">${when(o.asOf)}</span>.</p>`;
    }, () => ctx.store.invalidate("manager.overview"))}
    ${readOnly}
  </section>`;
};

