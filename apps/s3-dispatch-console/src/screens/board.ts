import { html, signal, StatusPill, type Signal, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import type { JobWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
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
type BoardFilter = "all" | "unassigned" | "assigned";
const boardFilters = new WeakMap<Store, Signal<BoardFilter>>();
const filterFor = (store: Store): Signal<BoardFilter> => {
  let filter = boardFilters.get(store);
  if (!filter) {
    filter = signal<BoardFilter>("all");
    boardFilters.set(store, filter);
  }
  return filter;
};
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

const shopModel = (): VNode => html`<svg class="s3-shop-model" viewBox="0 0 360 250" role="img" aria-labelledby="shop-model-title">
  <title id="shop-model-title">Illustrative isometric AC Services dispatch shop, not a geographic location</title>
  <ellipse cx="181" cy="222" rx="143" ry="15" fill="color-mix(in srgb,var(--color-text) 9%,transparent)" />
  <polygon points="42,103 177,36 316,103 181,173" fill="var(--color-surface-sunken)" stroke="var(--color-border-hard)" />
  <polygon points="42,103 181,173 181,225 42,155" fill="var(--color-surface)" stroke="var(--color-border-hard)" />
  <polygon points="181,173 316,103 316,155 181,225" fill="var(--color-page)" stroke="var(--color-border-hard)" />
  <polygon points="42,103 177,36 316,103 181,173" fill="var(--color-surface)" stroke="var(--color-text)" stroke-width="1.5" />
  <path d="M49 101 177 39 309 102" fill="none" stroke="var(--color-action)" stroke-width="3" />
  <polygon points="78,104 177,55 280,104 181,154" fill="var(--color-surface-sunken)" stroke="var(--color-border-hard)" />
  <polygon points="78,104 181,154 181,169 78,119" fill="var(--color-page)" stroke="var(--color-border-hard)" />
  <polygon points="181,154 280,104 280,119 181,169" fill="var(--color-surface)" stroke="var(--color-border-hard)" />
  <polygon points="112,122 151,142 151,187 112,167" fill="var(--color-surface-sunken)" stroke="var(--color-text)" />
  <polygon points="151,142 173,131 173,176 151,187" fill="var(--color-border)" stroke="var(--color-text)" />
  <path d="M116 131 148 147M116 137 148 153M116 143 148 159M116 149 148 165" stroke="var(--color-border-hard)" stroke-width="2" />
  <polygon points="207,127 252,104 252,150 207,173" fill="var(--color-surface-sunken)" stroke="var(--color-text)" />
  <path d="M214 139 245 123M214 146 245 130M214 153 245 137" stroke="var(--color-border-hard)" stroke-width="2" />
  <polygon points="235,62 259,74 259,95 235,83" fill="var(--color-page)" stroke="var(--color-border-hard)" />
  <path d="M241 62v14m7-11v14m7-11v14" stroke="var(--color-text-muted)" stroke-width="2" />
  <text x="195" y="202" class="s3-shop-model__sign" text-anchor="middle">AC SERVICES</text>
</svg>`;

const truckModel = (id: string): VNode => html`<svg class="s3-truck-model" viewBox="0 0 112 58" role="img" aria-labelledby=${`truck-title-${id}`}>
  <title id=${`truck-title-${id}`}>AC Services truck model; technician location unavailable</title>
  <ellipse cx="56" cy="49" rx="48" ry="5" fill="color-mix(in srgb,var(--color-text) 8%,transparent)" />
  <polygon points="9,28 57,13 93,22 44,39" fill="var(--color-surface-sunken)" stroke="var(--color-text)" stroke-width="1.4" />
  <polygon points="9,28 44,39 44,47 9,36" fill="var(--color-page)" stroke="var(--color-text)" stroke-width="1.4" />
  <polygon points="44,39 93,22 93,31 44,47" fill="var(--color-surface)" stroke="var(--color-text)" stroke-width="1.4" />
  <polygon points="61,20 78,15 90,18 73,24" fill="var(--color-surface)" stroke="var(--color-border-hard)" />
  <path d="M14 31 39 39M49 39 88 26" stroke="var(--color-action)" stroke-width="2" />
  <circle cx="27" cy="40" r="6" fill="var(--color-text)" /><circle cx="27" cy="40" r="2.5" fill="var(--color-surface)" />
  <circle cx="76" cy="34" r="6" fill="var(--color-text)" /><circle cx="76" cy="34" r="2.5" fill="var(--color-surface)" />
  <text x="29" y="34" class="s3-truck-model__mark" text-anchor="middle">AC</text>
</svg>`;

const jobRow = (ctx: Parameters<Screen>[0], job: JobWire, now: number): VNode => html`<li class="s3-map-job" data-state=${job.state}>
  <div class="s3-map-job__main">
    <span class="s3-map-job__site">${job.siteName ?? "Site name unavailable"}</span>
    <span class="s3-map-job__service">${job.serviceCode.replace(/_/g, " ")} · ${job.priority}</span>
  </div>
  <div class="s3-map-job__assignment">
    ${job.currentCrewId && job.currentCrewLabel
      ? html`<span class="s3-map-job__crew">${truckModel(job.id)}<span>${job.currentCrewLabel}</span></span>`
      : html`<span class="s3-map-job__unassigned">Unassigned</span>`}
    <span class="s3-map-job__location">Technician location unavailable</span>
  </div>
  <div class="s3-map-job__footer">
    ${StatusPill({ density: ctx.density, status: slaStatus(job, now), label: job.slaSatisfiedAt ? "Satisfied" : job.slaDueAt ? new Date(job.slaDueAt).toLocaleString() : "No timer" })}
    <span class="s3-map-job__state">${job.state}</span>
    <span class="s3-row-actions">
      ${isDispatchable(job) ? linkTo(ctx, "dispatch", { jobId: job.id }, "Dispatch") : null}
      ${isReleasable(job) ? submitAction(ctx, "Release", () => void releaseJob(ctx, job), `release-${job.id}`, "quiet") : null}
    </span>
  </div>
</li>`;

const releaseJob = async (ctx: Parameters<Screen>[0], job: JobWire): Promise<void> => {
  if (!job.currentAssignmentId) return;
  try {
    await ctx.shell.gateway.releaseAssignment({ assignmentId: job.currentAssignmentId, orgId: job.orgId, regionId: job.regionId, reason: "released from the board" });
    ctx.store.notice.value = [`${job.serviceCode} at its site was released for re-dispatch.`];
    ctx.store.invalidate("jobs.list");
  } catch {
    ctx.store.notice.value = ["The release did not go through. The board still shows the crew as assigned — try again."];
  }
};

const boardRows = [
  { initials: "BK", name: "Blake Keating", service: "Shipman Co — rooftop install", id: "33390928", code: "3", label: "Shipman Co — rooftop install", tone: "breached", left: 22, width: 24 },
  { initials: "BM", name: "Brian Martinez", service: "FirstKey — Repairs", id: "33390251", code: "3", label: "FirstKey — Repairs", tone: "breached", left: 7, width: 22 },
  { initials: "CD", name: "Colton Dawson", service: "5 stops — PM route", id: "33390971", code: "3", label: "Turner Res.", tone: "breached", left: 13, width: 16 },
  { initials: "DL", name: "Dylan Lemons", service: "Crew lead — new install", id: "33390937", code: "2", label: "Meridian Plaza — new system", tone: "breached", left: 12, width: 19 },
  { initials: "GH", name: "Garrett Howard", service: "Paired with Dylan Lemons", id: "33390937", code: "", label: "Meridian Plaza — new system", tone: "idle", left: 0, width: 0 },
  { initials: "HV", name: "Herberto Vega", service: "Shipman Co — RTU changeout", id: "33390948", code: "3", label: "Shipman Co — RTU changeout", tone: "breached", left: 26, width: 18 },
  { initials: "JF", name: "Johnny Fontez", service: "Shipman Co rooftop, 9a", id: "33390948", code: "", label: "Shipman Co — RTU changeout", tone: "idle", left: 0, width: 0 },
  { initials: "LD", name: "Logan Dawson", service: "No jobs assigned", id: "", code: "", label: "Open all day — good for callbacks near Crowley", tone: "idle", left: 0, width: 0 },
] as const;

const dashboardStats = [
  { value: 9, label: "Jobs today", tone: "default" },
  { value: 3, label: "Crews out", tone: "muted" },
  { value: 2, label: "Needs attention", tone: "warn" },
  { value: 177, label: "Unscheduled", tone: "muted" },
  { value: 1, label: "Tech available", tone: "success" },
] as const;

const dashboardLegend = [
  { label: "Scheduled (in progress)", tone: "scheduled" },
  { label: "Completed", tone: "completed" },
  { label: "Needs attention", tone: "warn" },
  { label: "Waiting on customer/parts", tone: "waiting" },
  { label: "Unassigned 0", tone: "neutral" },
  { label: "Open PO's 0", tone: "neutral" },
  { label: "Needs attention today 2", tone: "warn" },
  { label: "Marked for follow-up 0", tone: "neutral" },
  { label: "Unscheduled 177", tone: "neutral" },
] as const;

export const board: Screen = (ctx) => {
  const jobsKey = keyOf("jobs.list", {});
  const jobs = ctx.store.read(jobsKey, () => ctx.shell.gateway.listJobs({}));
  const filter = filterFor(ctx.store);
  const now = Date.now();

  return html`<section class="s3-board dispatch-dashboard">
    <div class="dispatch-dashboard__shell">
      <header class="dispatch-header" data-ground="plate">
        <nav class="dispatch-header__nav" aria-label="Dispatch navigation">
          <button type="button" class="dispatch-header__tab is-active">Dispatch Board</button>
          <button type="button" class="dispatch-header__tab">Job Detail</button>
          <button type="button" class="dispatch-header__tab">Job Dashboard</button>
          <button type="button" class="dispatch-header__tab">Manager</button>
        </nav>
        <div class="dispatch-header__tools">
          <button type="button" class="dispatch-header__logout">Sign out</button>
        </div>
      </header>

      <div class="dispatch-dashboard__title-row">
        <div>
          <h1>Dispatch Board</h1>
          <p>One color per job status, crew grouping, and idle tech availability in one glance.</p>
        </div>
        <div class="dispatch-dashboard__date-controls">
          <button type="button" class="dispatch-dashboard__date is-active">Tue, Sep 8</button>
          <button type="button" class="dispatch-dashboard__date">Today</button>
        </div>
      </div>

      ${whenReady(ctx, jobs.value, () => html`<div class="dispatch-dashboard__stats">${dashboardStats.map((stat) => html`<div class="dispatch-stat" data-tone=${stat.tone}>
        <span class="dispatch-stat__value">${stat.value}</span>
        <span class="dispatch-stat__label">${stat.label}</span>
      </div>`)}</div>`) }

      <div class="dispatch-dashboard__board">
        <div class="dispatch-board__header">
          <div class="dispatch-board__label">Technician</div>
          <div class="dispatch-board__hours">
            <span>7 AM</span><span>8 AM</span><span>9 AM</span><span>10 AM</span><span>11 AM</span><span>12 PM</span><span>1 PM</span><span>2 PM</span><span>3 PM</span><span>4 PM</span>
          </div>
        </div>

        ${boardRows.map((row) => html`<div class="dispatch-board__row">
          <div class="dispatch-board__tech">
            <span class="dispatch-board__avatar" data-tone="${row.tone}">${row.initials}</span>
            <div class="dispatch-board__meta">
              <strong>${row.name}</strong>
              <small>${row.service}</small>
            </div>
          </div>
          <div class="dispatch-board__calendar" aria-label=${row.label}>
            ${row.id ? html`<div class="dispatch-board__segment" data-tone=${row.tone} style=${`left:${row.left}%; width:${row.width}%;`}>${row.id}<span>${row.label}</span></div>` : null}
          </div>
        </div>`)}
      </div>

      <div class="dispatch-dashboard__legend">
        ${dashboardLegend.map((item) => html`<span class="dispatch-legend__item" data-tone=${item.tone}>${item.label}</span>`)}
      </div>
    </div>

    <div class="dispatch-dashboard__legacy" style="display:none;">
      ${whenReady(ctx, jobs.value, (out) => boardStats(out.jobs, now))}
      ${whenReady(ctx, jobs.value, (out) => {
        const visibleJobs = out.jobs.filter((job) => !CLOSED.includes(job.state) &&
          (filter.value === "all" || (filter.value === "assigned" ? job.currentCrewId !== null : job.currentCrewId === null)));
        return html`<div class="s3-map-layout">
          <section class="s3-map-scene" aria-label="Illustrative dispatch area">
            <div class="s3-map-scene__top">
              <div><h2 class="s3-h2">Dispatch area</h2><p>Operational schematic · not geographic</p></div>
              <span class="s3-map-scene__badge">Locations unavailable</span>
            </div>
            <div class="s3-map-scene__art">
              <svg class="s3-map-lines" viewBox="0 0 960 560" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
                <path d="M-60 120 275 290 1020-70M-45 490 410 250 1020 560M260-40 520 600M710-60 405 600M-60 310 1010 310" />
                <path d="M-40 122 275 282 1015-74M-40 490 410 242 1010 555M260-40 512 600M710-60 397 600M-60 299 1010 299" />
                <path d="M80 0v560M0 420h960M850 0v560" />
              </svg>
              <div class="s3-map-scene__blocks" aria-hidden="true">
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
              </div>
              <figure class="s3-shop">
                ${shopModel()}
                <figcaption><strong>AC Services</strong><span>Illustrative shop model · actual address not configured</span></figcaption>
              </figure>
              <div class="s3-map-notice" role="note">
                <strong>No location pins yet</strong>
                <span>Site coordinates and technician GPS are not in the dispatch feed. No routes or vehicle positions are being inferred.</span>
              </div>
              <div class="s3-map-scale" aria-hidden="true"><span></span>Not to scale</div>
            </div>
          </section>
          <section class="s3-map-jobs" aria-labelledby="s3-jobs-title">
            <header class="s3-map-jobs__head">
              <div><h2 id="s3-jobs-title" class="s3-h2">Open work</h2><span>${visibleJobs.length} ${visibleJobs.length === 1 ? "job" : "jobs"} in view</span></div>
              <div class="s3-map-filters" role="group" aria-label="Filter jobs">
                ${(["all", "unassigned", "assigned"] as const).map((value) => html`<button type="button" data-current=${filter.value === value ? "true" : "false"} aria-pressed=${filter.value === value} onClick=${() => { filter.value = value; }}>${value === "all" ? "All" : value === "unassigned" ? "Unassigned" : "Assigned"}</button>`)}
              </div>
            </header>
            ${visibleJobs.length
              ? html`<ul class="s3-map-job-list">${visibleJobs.map((job) => jobRow(ctx, job, now))}</ul>`
              : html`<div class="s3-map-empty"><strong>${filter.value === "unassigned" ? "No unassigned jobs" : filter.value === "assigned" ? "No active assignments" : "No open work"}</strong><span>New jobs will appear here when they enter this region's board.</span></div>`}
          </section>
        </div>`;
      })}
    </div>
  </section>`;
};
