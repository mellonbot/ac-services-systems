import { html, signal, DataGrid, StatusPill, pageHead, statStrip, panel, type Column, type Signal, type VNode } from "../../../../packages/ui/src/index.ts";
import { OFFICE_JOB_TRANSITIONS, type JobWire, type JobStateWire, type AddressWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, linkTo, submitAction, type Screen, type ScreenContext } from "./common.ts";
import { slaStatus, isDispatchable } from "./board.ts";

/**
 * THE JOB DASHBOARD — every job on `jobs.list` rolled into four action
 * buckets instead of a list of twelve states, with the jobs stalling longest
 * surfaced by age. Same read as the board, so the two cannot disagree about
 * a job's state.
 *
 * "Stalling" is days in the current state (`stateChangedAt`, from the job's
 * own state log). The waiting-on-customer states (0013) are moved here by
 * hand, one button per edge OFFICE_JOB_TRANSITIONS admits — the same list
 * the gateway enforces, so the screen never offers a move it would refuse.
 */
type BucketId = "action" | "customer" | "progress" | "closed";
type Tone = "breached" | "at_risk" | "info" | "ok";

const STATE_LABEL: Readonly<Record<JobStateWire, string>> = {
  created: "Unassigned", reassigned: "Unassigned", reopened: "Reopened", awaiting_parts: "Waiting on parts", complete: "Needs invoicing",
  assigned: "Dispatched", en_route: "En route", on_site: "On site", in_progress: "In progress",
  invoiced: "Invoiced", cancelled: "Cancelled", aborted: "Aborted",
  awaiting_customer: "On hold for customer", quote_requested: "Quote requested", quote_submitted: "Quote submitted",
};

/** The button's word for a move — what the dispatcher is saying happened, not the state's name. */
const MOVE_LABEL: Readonly<Partial<Record<JobStateWire, string>>> = {
  quote_requested: "Quote requested", quote_submitted: "Quote sent", created: "Approved", cancelled: "Declined",
  awaiting_customer: "Hold for customer", in_progress: "Resume",
};

const BUCKETS: readonly { id: BucketId; title: string; sub: string; tone: Tone; states: readonly JobStateWire[] }[] = [
  { id: "action", title: "Needs action", sub: "Blocked on your team", tone: "breached", states: ["created", "reassigned", "reopened", "awaiting_parts", "complete"] },
  { id: "customer", title: "Waiting on customer", sub: "Ball's in their court", tone: "at_risk", states: ["awaiting_customer", "quote_requested", "quote_submitted"] },
  { id: "progress", title: "In progress", sub: "Scheduled or on-site", tone: "info", states: ["assigned", "en_route", "on_site", "in_progress"] },
  { id: "closed", title: "Closed out", sub: "Invoiced, cancelled, or aborted", tone: "ok", states: ["invoiced", "cancelled", "aborted"] },
];

const bucketOf = (state: JobStateWire): BucketId => BUCKETS.find((b) => b.states.includes(state))!.id;

/** Rows a bucket lists: one per label, in first-seen state order, so "Unassigned" counts created and reassigned together. */
const bucketRows = (jobs: readonly JobWire[], states: readonly JobStateWire[]) => {
  const rows = new Map<string, number>();
  for (const s of states) rows.set(STATE_LABEL[s], (rows.get(STATE_LABEL[s]) ?? 0) + jobs.filter((j) => j.state === s).length);
  return [...rows];
};

const DAY = 86_400_000;
export const daysInState = (job: Pick<JobWire, "stateChangedAt">, now: number): number => Math.max(0, Math.floor((now - Date.parse(job.stateChangedAt)) / DAY));

/** "Crowley, TX 76028" — the line a dispatcher places a job by. Falls back to the street line, then to nothing. */
export const placeLine = (a: AddressWire | null): string | null => {
  if (!a) return null;
  const region = [a.state, a.postal].filter(Boolean).join(" ");
  const place = [a.city, region].filter(Boolean).join(", ");
  return place || a.line1 || null;
};

const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();

type Filter = "action" | "customer" | "open" | "Unassigned" | "Waiting on parts" | "Needs invoicing" | "Reopened";
const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "action", label: "All needs-action" },
  { id: "Unassigned", label: "Unassigned" },
  { id: "Waiting on parts", label: "Waiting on parts" },
  { id: "Needs invoicing", label: "Needs invoicing" },
  { id: "Reopened", label: "Reopened" },
  { id: "customer", label: "Waiting on customer" },
  { id: "open", label: "All open" },
];
const filters = new WeakMap<Store, Signal<Filter>>();
const filterFor = (store: Store): Signal<Filter> => {
  let f = filters.get(store);
  if (!f) { f = signal<Filter>("action"); filters.set(store, f); }
  return f;
};

export const stalling = (jobs: readonly JobWire[], filter: Filter, now: number): JobWire[] =>
  jobs
    .filter((j) => {
      const b = bucketOf(j.state);
      if (filter === "open") return b !== "closed";
      if (filter === "action" || filter === "customer") return b === filter;
      return STATE_LABEL[j.state] === filter;
    })
    .sort((a, b) => daysInState(b, now) - daysInState(a, now));

const bucketCard = (bucket: (typeof BUCKETS)[number], jobs: readonly JobWire[]): VNode => {
  const inBucket = jobs.filter((j) => bucketOf(j.state) === bucket.id);
  const rows = bucketRows(inBucket, bucket.states);
  return html`<div class="s3-bucket" data-tone=${bucket.tone}>
    ${panel(html`<div class="s3-bucket__head">
        <span class="s3-bucket__n s3-num">${inBucket.length.toLocaleString()}</span>
        <h2 class="s3-bucket__title">${bucket.title}</h2>
        <p class="s3-bucket__sub">${bucket.sub}</p>
      </div>
      <dl class="s3-bucket__rows">${rows.map(([label, n]) => html`<div class="s3-bucket__row"><dt>${label}</dt><dd class="s3-num">${n.toLocaleString()}</dd></div>`)}</dl>`)}
  </div>`;
};

const moveJob = async (ctx: ScreenContext, job: JobWire, to: JobStateWire): Promise<void> => {
  try {
    await ctx.shell.gateway.transitionJob({ jobId: job.id, orgId: job.orgId, regionId: job.regionId, to });
    ctx.store.notice.value = [to === "created" ? `Job ${job.id}: approved — back to dispatch.` : `Job ${job.id}: ${STATE_LABEL[to].toLowerCase()}.`];
  } catch {
    ctx.store.notice.value = [`Job ${job.id} did not move — it may have changed since this page loaded. The list has been refreshed.`];
  }
  ctx.store.invalidate("jobs.list");
};

export const jobs: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const filter = filterFor(ctx.store);
  const now = Date.now();

  const columns = (): readonly Column<JobWire>[] => [
    { key: "id", header: "Job #", numeric: true, cell: (j) => isDispatchable(j) ? linkTo(ctx, "dispatch", { jobId: j.id }, j.id) : j.id },
    { key: "site", header: "Customer", cell: (j) => html`<span class="s3-cust"><strong>${j.siteName ?? "Site name unavailable"}</strong><small>${placeLine(j.siteAddress) ?? "Address not recorded"}</small><small class="s3-cust__svc">${j.serviceCode.replace(/_/g, " ")} · ${j.priority}</small></span>` },
    { key: "crew", header: "Tech", cell: (j) => j.currentCrewLabel
      ? html`<span class="s3-tech"><span class="dispatch-board__avatar" aria-hidden="true">${initials(j.currentCrewLabel)}</span>${j.currentCrewLabel}</span>`
      : html`<span class="s3-muted">Unassigned</span>` },
    { key: "state", header: "Status", cell: (j) => STATE_LABEL[j.state] },
    { key: "sla", header: "SLA", cell: (j) => j.slaDueAt && !j.slaSatisfiedAt
      ? StatusPill({ density: ctx.density, status: slaStatus(j, now) })
      : html`<span class="s3-muted">—</span>` },
    { key: "move", header: "Move", cell: (j) => html`<span class="s3-row-actions">${(OFFICE_JOB_TRANSITIONS[j.state] ?? []).map((to) =>
      submitAction(ctx, MOVE_LABEL[to] ?? STATE_LABEL[to], () => void moveJob(ctx, j, to), `move-${j.id}-${to}`, "quiet"))}</span>` },
    { key: "age", header: "Days in status", numeric: true, align: "end", cell: (j) => html`<span title=${`In this status since ${new Date(j.stateChangedAt).toLocaleString()}`}>${daysInState(j, now)}d</span>` },
  ];

  return html`<section class="s3-jobs">
    ${pageHead("Job Dashboard", "Job states rolled into four action buckets, with the jobs that are actually stalling surfaced by age — not just by count.")}
    ${whenReady(ctx, list.value, (out) => {
      const count = (label: string) => out.jobs.filter((j) => STATE_LABEL[j.state] === label).length;
      const open = out.jobs.filter((j) => bucketOf(j.state) !== "closed");
      const breached = open.filter((j) => slaStatus(j, now) === "breached").length;
      const atRisk = open.filter((j) => slaStatus(j, now) === "at_risk").length;
      const unassigned = count("Unassigned"), parts = count("Waiting on parts"), quoteReq = count("Quote requested"), quoteSent = count("Quote submitted");
      const rows = stalling(out.jobs, filter.value, now);
      return html`
        ${statStrip([
          { n: count("Needs invoicing"), label: "Needs invoicing", sub: "Finished, ready to bill" },
          { n: unassigned, label: "Unassigned", sub: "Waiting on dispatch", ...(unassigned ? { tone: "at_risk" as const } : {}) },
          { n: parts, label: "Waiting on parts", sub: "Held by supply", ...(parts ? { tone: "at_risk" as const } : {}) },
          { n: quoteReq, label: "Quote requested", sub: "Customer asked for pricing" },
          { n: quoteSent, label: "Quote submitted", sub: "Sent, awaiting approval" },
          { n: breached, label: "SLA breached", sub: "Past due, still open", ...(breached ? { tone: "breached" as const } : {}) },
          { n: atRisk, label: "SLA at risk", sub: "Escalating now", ...(atRisk ? { tone: "at_risk" as const } : {}) },
        ], "jobs-stats")}
        <div class="s3-buckets">${BUCKETS.map((b) => bucketCard(b, out.jobs))}</div>
        ${panel(DataGrid({ density: "console", columns: columns(), rows, rowKey: (j: JobWire) => j.id, emptyText: "Nothing stalled under this filter.", stack: true }),
          "Jobs stalling the longest", "Sorted by days sitting in the current status — the ones a count alone won't show you",
          html`<div class="s3-chips" role="group" aria-label="Filter stalled jobs">
            ${FILTERS.map((f) => html`<button type="button" class="ac-chip" aria-pressed=${filter.value === f.id ? "true" : "false"} onClick=${() => { filter.value = f.id; }}>${f.label}</button>`)}
          </div>`, "jobs-stalling")}`;
    })}
  </section>`;
};
