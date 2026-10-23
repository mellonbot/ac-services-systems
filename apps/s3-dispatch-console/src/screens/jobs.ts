import { html, signal, DataGrid, StatusPill, pageHead, statStrip, panel, type Column, type Signal, type VNode } from "../../../../packages/ui/src/index.ts";
import { serviceLabel, OFFICE_JOB_TRANSITIONS, JOB_WORK_CLASS_LABEL, type JobWire, type JobStateWire, type AddressWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, homeMark, linkTo, submitAction, type Screen, type ScreenContext } from "./common.ts";
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
 *
 * Notes and the return-trip flag (0015) are the office's own: a flag is set
 * by hand, never guessed out of the note text, and a note is append-only —
 * the cell shows the newest, and a correction is a newer note.
 */
type BucketId = "action" | "customer" | "progress" | "closed";

export const STATE_LABEL: Readonly<Record<JobStateWire, string>> = {
  created: "Unassigned", reassigned: "Unassigned", reopened: "Reopened", awaiting_parts: "Waiting on parts", complete: "Needs invoicing",
  assigned: "Dispatched", en_route: "En route", on_site: "On site", in_progress: "In progress",
  invoiced: "Invoiced", cancelled: "Cancelled", aborted: "Aborted",
  awaiting_customer: "On hold for customer", quote_requested: "Quote requested", quote_submitted: "Quote submitted",
  needs_pricing: "Needs pricing", awaiting_po: "Waiting on a PO", awaiting_pictures: "Waiting on pictures", invoice_trouble: "Trouble invoicing",
};

/** The button's word for a move — what the dispatcher is saying happened, not the state's name. */
const MOVE_LABEL: Readonly<Partial<Record<JobStateWire, string>>> = {
  quote_requested: "Quote requested", quote_submitted: "Quote sent", created: "Approved", cancelled: "Declined",
  awaiting_customer: "Hold for customer", in_progress: "Resume",
  needs_pricing: "Needs pricing", awaiting_po: "Waiting on PO", awaiting_pictures: "Need pictures", complete: "Ready to invoice",
  invoice_trouble: "Kicked back", invoiced: "Re-sent",
};

/**
 * The buckets are CATEGORIES — where a job sits in the work, not how it is
 * doing — so they carry no state ink (Bulletin 2, Rule 1): a count of twelve
 * drawn in the fault ink reads as twelve breaches when nothing is late. The
 * figures that are states sit in the strip above, toned there.
 */
const BUCKETS: readonly { id: BucketId; title: string; sub: string; states: readonly JobStateWire[] }[] = [
  { id: "action", title: "Needs action", sub: "Blocked on your team", states: ["needs_pricing", "awaiting_po", "invoice_trouble", "complete", "awaiting_pictures", "awaiting_parts", "created", "reassigned", "reopened"] },
  { id: "customer", title: "Waiting on customer", sub: "Ball's in their court", states: ["awaiting_customer", "quote_requested", "quote_submitted"] },
  { id: "progress", title: "In progress", sub: "Scheduled or on-site", states: ["assigned", "en_route", "on_site", "in_progress"] },
  { id: "closed", title: "Closed out", sub: "Invoiced, cancelled, or aborted", states: ["invoiced", "cancelled", "aborted"] },
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

export const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();

type Filter = "action" | "customer" | "open" | "returnTrip" | "Needs pricing" | "Waiting on a PO" | "Trouble invoicing" | "Needs invoicing" | "Unassigned";
const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "action", label: "All needs-action" },
  { id: "Needs pricing", label: "Needs pricing" },
  { id: "Waiting on a PO", label: "Waiting on PO" },
  { id: "Trouble invoicing", label: "Trouble invoicing" },
  { id: "Needs invoicing", label: "Needs invoicing" },
  { id: "Unassigned", label: "Unassigned" },
  { id: "customer", label: "Waiting on customer" },
  { id: "returnTrip", label: "Return trip flagged" },
  { id: "open", label: "All open" },
];
/** The one note being written, per store: which job, and the draft so far. */
const drafts = new WeakMap<Store, Signal<{ jobId: string; body: string } | null>>();
const draftFor = (store: Store): Signal<{ jobId: string; body: string } | null> => {
  let d = drafts.get(store);
  if (!d) { d = signal<{ jobId: string; body: string } | null>(null); drafts.set(store, d); }
  return d;
};
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
      if (filter === "returnTrip") return j.returnTrip && b !== "closed";
      if (filter === "action" || filter === "customer") return b === filter;
      return STATE_LABEL[j.state] === filter;
    })
    .sort((a, b) => daysInState(b, now) - daysInState(a, now));

const bucketCard = (bucket: (typeof BUCKETS)[number], jobs: readonly JobWire[]): VNode => {
  const inBucket = jobs.filter((j) => bucketOf(j.state) === bucket.id);
  const rows = bucketRows(inBucket, bucket.states);
  return html`<div class="s3-bucket">
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
    ctx.store.notice.value = [to === "created" ? `Job ${job.id}: approved — back to dispatch.` : to === "complete" ? `Job ${job.id}: ready to invoice.` : `Job ${job.id}: ${STATE_LABEL[to].toLowerCase()}.`];
  } catch {
    ctx.store.notice.value = [`Job ${job.id} did not move — it may have changed since this page loaded. The list has been refreshed.`];
  }
  ctx.store.invalidate("jobs.list");
};

const saveNote = async (ctx: ScreenContext, job: JobWire, body: string, draft: Signal<{ jobId: string; body: string } | null>): Promise<void> => {
  try {
    await ctx.shell.gateway.addJobNote({ jobId: job.id, orgId: job.orgId, regionId: job.regionId, body });
    draft.value = null;
    ctx.store.notice.value = [`Note added to job ${job.id}.`];
  } catch {
    ctx.store.notice.value = [`The note on job ${job.id} was not saved — it is still in the box; try again.`];
  }
  ctx.store.invalidate("jobs.list");
};

const flagReturnTrip = async (ctx: ScreenContext, job: JobWire, returnTrip: boolean): Promise<void> => {
  try {
    await ctx.shell.gateway.setReturnTrip({ jobId: job.id, orgId: job.orgId, regionId: job.regionId, returnTrip });
    ctx.store.notice.value = [returnTrip ? `Job ${job.id} flagged for a return trip.` : `Return-trip flag cleared on job ${job.id}.`];
  } catch {
    ctx.store.notice.value = [`The return-trip flag on job ${job.id} did not change. The list has been refreshed.`];
  }
  ctx.store.invalidate("jobs.list");
};

export const jobs: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const filter = filterFor(ctx.store);
  const draft = draftFor(ctx.store);
  const now = Date.now();

  const noteCell = (j: JobWire): VNode => {
    const d = draft.value;
    if (d && d.jobId === j.id) {
      return html`<span class="s3-note-edit">
        <input class="ac-input" aria-label=${`Note on job ${j.id}`} maxlength="2000" value=${d.body} autofocus
          onInput=${(e: Event) => { draft.value = { jobId: j.id, body: (e.currentTarget as HTMLInputElement).value }; }} />
        <span class="s3-row-actions">
          ${submitAction(ctx, "Save", () => { const body = draft.value?.body.trim() ?? ""; if (body) void saveNote(ctx, j, body, draft); }, `note-save-${j.id}`)}
          <button type="button" class="s3-act" onClick=${() => { draft.value = null; }}>Cancel</button>
        </span>
      </span>`;
    }
    return html`<span class="s3-note">
      ${j.latestNote
        ? html`<span class="s3-note__body" title=${`${j.latestNote.body} — ${new Date(j.latestNote.at).toLocaleString()}`}>${j.latestNote.body}</span>`
        : html`<span class="s3-muted">—</span>`}
      <button type="button" class="s3-act" id=${`note-${j.id}`} onClick=${() => { draft.value = { jobId: j.id, body: "" }; }}>Add note</button>
    </span>`;
  };

  const columns = (): readonly Column<JobWire>[] => [
    { key: "id", header: "Job #", numeric: true, cell: (j) => linkTo(ctx, "detail", { jobId: j.id }, j.id) },
    { key: "site", header: "Customer", cell: (j) => html`<span class="s3-cust"><strong>${j.siteName ?? "Site name unavailable"}</strong>${homeMark(j.customerSegment)}<small>${placeLine(j.siteAddress) ?? "Address not recorded"}</small><small class="s3-cust__svc">${JOB_WORK_CLASS_LABEL[j.workClass]} · ${serviceLabel(j.serviceCode)} · ${j.priority}</small></span>` },
    { key: "crew", header: "Tech", cell: (j) => j.currentCrewLabel
      ? html`<span class="s3-tech"><span class="dispatch-board__avatar" aria-hidden="true">${initials(j.currentCrewLabel)}</span>${j.currentCrewLabel}</span>`
      : html`<span class="s3-muted">Unassigned</span>` },
    { key: "state", header: "Status", cell: (j) => STATE_LABEL[j.state] },
    { key: "flags", header: "Flags", cell: (j) => html`<span class="s3-flags">
      ${j.returnTrip ? html`<span class="s3-flag">Return trip</span>` : null}
      <button type="button" class="s3-act" id=${`flag-${j.id}`} aria-pressed=${j.returnTrip ? "true" : "false"} disabled=${ctx.degraded}
        title=${ctx.degraded ? ctx.shell.degradedNotice : undefined}
        onClick=${() => void flagReturnTrip(ctx, j, !j.returnTrip)}>${j.returnTrip ? "Clear" : "Flag return trip"}</button>
    </span>` },
    { key: "sla", header: "SLA", cell: (j) => j.slaDueAt && !j.slaSatisfiedAt
      ? StatusPill({ density: ctx.density, status: slaStatus(j, now) })
      : html`<span class="s3-muted">—</span>` },
    { key: "move", header: "Move", cell: (j) => html`<span class="s3-moves">${isDispatchable(j) ? linkTo(ctx, "dispatch", { jobId: j.id }, "Dispatch", "s3-act") : null}${(OFFICE_JOB_TRANSITIONS[j.state] ?? []).map((to) =>
      html`<button type="button" class="s3-act" id=${`move-${j.id}-${to}`} disabled=${ctx.degraded}
        title=${ctx.degraded ? ctx.shell.degradedNotice : undefined}
        onClick=${() => void moveJob(ctx, j, to)}>${MOVE_LABEL[to] ?? STATE_LABEL[to]}</button>`)}</span>` },
    { key: "note", header: "Note", cell: noteCell },
    { key: "age", header: "Days in status", numeric: true, align: "end", cell: (j) => html`<span title=${`In this status since ${new Date(j.stateChangedAt).toLocaleString()}`}>${daysInState(j, now)}d</span>` },
  ];

  return html`<section class="s3-jobs">
    ${pageHead("Job Dashboard", "Job states rolled into four action buckets, with the jobs that are actually stalling surfaced by age — not just by count.")}
    ${whenReady(ctx, list.value, (out) => {
      const count = (label: string) => out.jobs.filter((j) => STATE_LABEL[j.state] === label).length;
      const open = out.jobs.filter((j) => bucketOf(j.state) !== "closed");
      const returnTrips = open.filter((j) => j.returnTrip).length;
      const pricing = count("Needs pricing"), trouble = count("Trouble invoicing"), quoteReq = count("Quote requested"), quoteSent = count("Quote submitted");
      const rows = stalling(out.jobs, filter.value, now);
      return html`
        ${statStrip([
          { n: count("Needs invoicing"), label: "Needs invoicing", sub: "Finished, ready to bill" },
          { n: pricing, label: "Needs pricing", sub: "Blocking the invoice", ...(pricing ? { tone: "at_risk" as const } : {}) },
          { n: trouble, label: "Trouble invoicing", sub: "Kicked back, needs a fix", ...(trouble ? { tone: "breached" as const } : {}) },
          { n: quoteReq, label: "Quote requested", sub: "Customer asked for pricing" },
          { n: quoteSent, label: "Quote submitted", sub: "Sent, awaiting approval" },
          { n: returnTrips, label: "Flagged: return trip", sub: "A second visit is owed", ...(returnTrips ? { tone: "at_risk" as const } : {}) },
        ], "jobs-stats")}
        <div class="s3-buckets">${BUCKETS.map((b) => bucketCard(b, out.jobs))}</div>
        ${panel(html`<div class="s3-grid-scroll">${DataGrid({ density: "console", columns: columns(), rows, rowKey: (j: JobWire) => j.id, emptyText: "Nothing stalled under this filter.", stack: true })}</div>`,
          "Jobs stalling the longest", "Sorted by days sitting in the current status — the ones a count alone won't show you",
          html`<div class="s3-chips" role="group" aria-label="Filter stalled jobs">
            ${FILTERS.map((f) => html`<button type="button" class="ac-chip" aria-pressed=${filter.value === f.id ? "true" : "false"} onClick=${() => { filter.value = f.id; }}>${f.label}</button>`)}
          </div>`, "jobs-stalling")}`;
    })}
  </section>`;
};
