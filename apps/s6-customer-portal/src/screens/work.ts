import { html, pageHead, panel, statStrip, signal, StatusPill, PrimaryAction, PLAN_WORD, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import { WORK_DONE_STATES, type JobWire, type JobStateWire, type ServiceRequestWire, type InvoiceWire, type ServiceRequestPriority, type RequestPhotoWire, type ListJobsOutput, type ListServiceRequestsOutput } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Resource } from "../state.ts";
import { whenReady, readNodes, linkTo, type Screen, type ScreenContext } from "./common.ts";
import { requestForm, outcomeView, refOf } from "./request.ts";
import { money } from "./site.ts";

/**
 * WORK ORDERS — S6's home. Request a work order and watch it move, in the
 * customer's language rather than ours: "awaiting_parts" on the board is
 * "Ordering a part" here, and the stepper, the pill and the sentence under it
 * say the same thing three ways so no one of them carries the story alone.
 *
 * A work order is a request the customer made (with the job the office opened
 * against it, once there is one) or a job the office opened on its own — a
 * planned visit has no request behind it and is still the customer's work.
 * Every row is what `serviceRequests.list` and `jobs.list` returned; the
 * status and site filters only choose which of THOSE rows to draw. Scope is
 * the gateway's (0006), never a filter here.
 *
 * What is NOT on this screen is as deliberate as what is: no crew, no
 * employment shape, no compliance detail. For a customer principal RLS
 * returns no assignment row to join, so the crew fields are null by mechanism
 * and nothing reads them.
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

const CLOSED: readonly JobStateWire[] = [...WORK_DONE_STATES, "cancelled"];
export const isOpen = (job: Pick<JobWire, "state">): boolean => !CLOSED.includes(job.state);

/** The customer's word for a state. The wire's enum is ours; a customer reads plain words, as the pill's own register does. */
export const STATE_WORD: Readonly<Record<JobStateWire, string>> = {
  created: "Scheduled", assigned: "Crew assigned", reassigned: "Being reassigned", en_route: "Crew en route", on_site: "Crew on site",
  in_progress: "In progress", awaiting_parts: "Awaiting parts", complete: "Complete", reopened: "Reopened", invoiced: "Invoiced",
  cancelled: "Cancelled", aborted: "Stopped",
  quote_requested: "Quote requested", quote_submitted: "Quote sent to you", awaiting_customer: "Waiting on you",
  needs_pricing: "Complete", awaiting_po: "Waiting on your PO", awaiting_pictures: "Complete", invoice_trouble: "Invoice being corrected",
};

/** WHERE A WORK ORDER STANDS, in the customer's words. The job state behind each step is ours and never shown as the word it is on the board. */
export const STEPS = ["Requested", "Scheduled", "In progress", "Completed", "Invoiced"] as const;
export const stepOf = (r: { readonly jobState: JobStateWire | null }): number => {
  switch (r.jobState) {
    case null: case "created": case "quote_requested": case "quote_submitted": return 0;
    case "assigned": case "reassigned": case "en_route": return 1;
    case "on_site": case "in_progress": case "awaiting_parts": case "awaiting_customer": case "reopened": return 2;
    case "complete": case "needs_pricing": case "awaiting_po": case "awaiting_pictures": case "invoice_trouble": return 3;
    case "invoiced": return 4;
    default: return -1;
  }
};

/** A hold is the one place a step's name is not the whole story — the pill says what it is waiting on. */
const HOLD_WORD: Partial<Record<JobStateWire, string>> = {
  awaiting_parts: "Ordering a part", awaiting_customer: "Waiting on you", awaiting_po: "Waiting on your PO",
  invoice_trouble: "Invoice being corrected", quote_submitted: "Quote sent to you", reopened: "Reopened",
};

export type WorkOrder = {
  readonly key: string; readonly ref: string; readonly title: string;
  readonly siteId: string; readonly siteName: string;
  readonly submittedAt: string; readonly priority: ServiceRequestPriority | null;
  readonly jobState: JobStateWire | null; readonly job: JobWire | null;
  /** What the customer sent with the request; a job the office opened on its own has none. */
  readonly photos: readonly RequestPhotoWire[];
};

/** Requests with the job opened against each, then the jobs no request stands behind. Newest first, open before closed. */
export const ordersOf = (requests: readonly ServiceRequestWire[], jobs: readonly JobWire[]): WorkOrder[] => {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const asked = new Set(requests.map((r) => r.jobId).filter((id): id is string => id !== null));
  const fromRequests = requests.map((r): WorkOrder => {
    const job = r.jobId ? byId.get(r.jobId) ?? null : null;
    return {
      key: r.id, ref: refOf(r.id), title: r.description.split("\n")[0]!.slice(0, 80),
      siteId: r.siteId, siteName: r.siteName, submittedAt: r.createdAt, priority: r.priority,
      jobState: job?.state ?? r.jobState, job, photos: r.photos,
    };
  });
  const fromJobs = jobs.filter((j) => !asked.has(j.id)).map((j): WorkOrder => ({
    key: j.id, ref: refOf(j.id), title: j.serviceCode, siteId: j.siteId, siteName: j.siteName ?? "—",
    submittedAt: j.openedAt, priority: null, jobState: j.state, job: j, photos: [],
  }));
  const open = (o: WorkOrder) => stepOf(o) >= 0 && stepOf(o) < 3;
  return [...fromRequests, ...fromJobs].sort((a, b) => Number(open(b)) - Number(open(a)) || b.submittedAt.localeCompare(a.submittedAt));
};

export const pillOf = (o: WorkOrder, nowMs: number): { status: Status; label: string } => {
  const at = stepOf(o);
  if (at < 0) return { status: "blocked", label: "Cancelled" };
  if (o.job && at < 3 && slaStatus(o.job, nowMs) === "breached") return { status: "breached", label: "Response overdue" };
  const hold = o.jobState ? HOLD_WORD[o.jobState] : undefined;
  if (hold) return { status: "at_risk", label: hold };
  return { status: "ok", label: STEPS[at]! };
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const windowOf = (start: string, end: string) => `${day(start)}, ${time(start)} – ${time(end)}`;

/** The invoice a job was billed on, and what THIS job's visible lines came to. */
const billOf = (job: JobWire | null, invoices: readonly InvoiceWire[]) => {
  if (!job) return null;
  for (const inv of invoices) {
    const lines = inv.lines.filter((l) => l.jobId === job.id);
    if (lines.length) return { inv, amount: money(lines.reduce((s, l) => s + BigInt(l.amountMinor), 0n).toString(), inv.currency) };
  }
  return null;
};

const noteOf = (ctx: ScreenContext, o: WorkOrder, invoices: readonly InvoiceWire[]): VNode | string => {
  const at = stepOf(o);
  const j = o.job;
  if (at < 0) return "This was closed without a visit.";
  switch (o.jobState) {
    case "awaiting_parts": return "Diagnosed — we are sourcing a part now. A technician will return once it arrives.";
    case "awaiting_customer": return "We need something from you before we can go on — the office will be in touch.";
    case "quote_submitted": return "A quote is with you. Work is scheduled once it is approved.";
    case "awaiting_po": return "The work is done. We are waiting on your purchase order before we invoice.";
    case "invoice_trouble": return "The work is done. The invoice is being corrected before it reaches you.";
  }
  if (at === 0) return "It is with the office, who will open a job and match a technician for your site.";
  if (at === 1 && j) return html`Technician booked for <strong class="ac-num">${windowOf(j.serviceWindowStart, j.serviceWindowEnd)}</strong>.`;
  if (at === 2) return "A technician is working on it.";
  const done = j ? `Completed ${day(j.stateChangedAt)}.` : "The work is done.";
  const bill = at === 4 ? billOf(j, invoices) : null;
  if (!bill) return at === 4 ? `${done} It has been invoiced.` : done;
  return html`${done} Invoice <span class="ac-num">${refOf(bill.inv.id)}</span> · <span class="ac-num">${bill.amount}</span>${bill.inv.dueAt ? html` due <span class="ac-num">${day(bill.inv.dueAt)}</span>` : null} — ${linkTo(ctx, "site", { siteId: o.siteId }, "see it on the site card")}`;
};

export const orderCard = (ctx: ScreenContext, o: WorkOrder, invoices: readonly InvoiceWire[], nowMs: number): VNode => {
  const at = stepOf(o);
  const pill = pillOf(o, nowMs);
  return html`<article class="s6-order" data-order=${o.key}>
    <header class="s6-order__head">
      <div><h3 class="s6-order__title"><span class="s6-order__ref">${o.ref}</span> · ${o.title}</h3>
        <p class="s6-order__meta">${linkTo(ctx, "site", { siteId: o.siteId }, o.siteName)} · ${o.priority ? "submitted" : "opened by the office"} <span class="ac-num">${day(o.submittedAt)}, ${time(o.submittedAt)}</span>${o.priority && o.priority !== "routine" ? ` · ${o.priority}` : ""}${o.job ? html` · ${linkTo(ctx, "job", { jobId: o.job.id }, "updates and messages")}` : null}</p></div>
      ${StatusPill({ density: ctx.density, status: pill.status, label: pill.label })}
    </header>
    ${at < 0 ? null : html`<ol class="s6-steps" aria-label="Where this work order stands">
      ${STEPS.map((label, i) => html`<li class="s6-step" data-state=${i < at ? "done" : i === at ? "current" : "todo"} aria-current=${i === at ? "step" : undefined}><span class="s6-step__dot" aria-hidden="true"></span><span class="s6-step__label">${label}</span></li>`)}
    </ol>`}
    <p class="s6-order__note">${noteOf(ctx, o, invoices)}</p>
    ${o.photos.length ? photoStrip(ctx, o.photos) : null}
  </article>`;
};

/**
 * The photos sent with a request, each read through the gateway (`media.get`)
 * as a data: URL — a surface never holds a bucket URL. A photo is immutable,
 * so each is fetched once per session and kept.
 */
const photoStrip = (ctx: ScreenContext, photos: readonly RequestPhotoWire[]): VNode => html`<ul class="s6-photos" aria-label="Photos sent with this request">
  ${photos.map((p, i) => {
    const r = ctx.store.read(keyOf("media.get", { id: p.id }), () => ctx.shell.gateway.getMedia({ id: p.id })).value;
    const label = `Photo ${i + 1} of ${photos.length}`;
    return html`<li class="s6-photo" data-photo=${p.id}>${
      r.state === "ready" ? html`<img class="s6-photo__img" src=${r.value.image} alt=${label} loading="lazy" />`
      : html`<span class="s6-photo__empty" role=${r.state === "refused" ? "note" : "status"}>${r.state === "refused" ? `${label} could not be shown` : "Loading…"}</span>`
    }</li>`;
  })}
</ul>`;

type Show = "all" | "open" | "scheduled" | "completed";
const SHOW_WORD: Readonly<Record<Show, string>> = { all: "All", open: "Open", scheduled: "Scheduled", completed: "Completed" };
const shows = (s: Show, o: WorkOrder): boolean => {
  const at = stepOf(o);
  switch (s) {
    case "all": return true;
    case "open": return at >= 0 && at < 3;
    case "scheduled": return at === 1;
    case "completed": return at >= 3;
  }
};
const show = signal<Show>("all");
const onSite = signal<string | null>(null);
export const resetWorkFilters = () => { show.value = "all"; onSite.value = null; };


/** The work orders, newest first, with the status filter — and the site chips when there is more than one site to choose between. */
export const ordersPanel = (ctx: ScreenContext, jobs: Resource<ListJobsOutput>, requests: Resource<ListServiceRequestsOutput>, invoices: readonly InvoiceWire[], nowMs: number, bySite: boolean): VNode =>
  panel(whenReady(ctx, jobs, () => whenReady(ctx, requests, (out) => {
    const orders = ordersOf(out.requests, jobs.state === "ready" ? jobs.value.jobs : []);
    const siteIds = [...new Map(orders.map((o) => [o.siteId, o.siteName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const drawn = orders.filter((o) => shows(show.value, o) && (onSite.value === null || o.siteId === onSite.value));
    return html`
      ${bySite && siteIds.length > 1 ? html`<div class="s6-chips" role="group" aria-label="Filter by site">
        <button type="button" class="ac-chip" aria-pressed=${onSite.value === null ? "true" : "false"} onClick=${() => { onSite.value = null; }}>All sites</button>
        ${siteIds.map(([id, name]) => html`<button type="button" class="ac-chip" aria-pressed=${onSite.value === id ? "true" : "false"} onClick=${() => { onSite.value = id; }}>${name}</button>`)}
      </div>` : null}
      ${drawn.length === 0
        ? html`<p class="s6-empty">${orders.length === 0 ? "No work orders yet. Request one and it appears here." : "Nothing matches this filter."}</p>`
        : html`<div class="s6-orders" id="request-cards">${drawn.map((o) => orderCard(ctx, o, invoices, nowMs))}</div>`}`;
  }, () => ctx.store.invalidate("serviceRequests.list")), () => ctx.store.invalidate("jobs.list")), "Your work orders", undefined,
    html`<div class="ac-seg" role="group" aria-label="Show">
      ${(Object.keys(SHOW_WORD) as Show[]).map((s) => html`<button type="button" class="ac-seg__item s6-seg-button" data-current=${show.value === s ? "true" : "false"} aria-pressed=${show.value === s ? "true" : "false"} onClick=${() => { show.value = s; }}>${SHOW_WORD[s]}</button>`)}
    </div>`, "orders");

const DAY_MS = 86_400_000;

export const work: Screen = (ctx) => {
  const nodes = readNodes(ctx);
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const requests = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const invoices = ctx.store.read(keyOf("invoices.list", {}), () => ctx.shell.gateway.listInvoices({}));
  const contracts = ctx.store.read(keyOf("contracts.list", {}), () => ctx.shell.gateway.listContracts({ orgId: ctx.shell.principal.orgId }));
  const now = Date.now();

  const jobRows = jobs.value.state === "ready" ? jobs.value.value.jobs : [];
  const invoiceRows = invoices.value.state === "ready" ? invoices.value.value.invoices : [];
  const plans = contracts.value.state === "ready"
    ? [...new Set(contracts.value.value.contracts.filter((c) => c.state === "active").map((c) => PLAN_WORD[c.billingPath]))]
    : [];

  const focusForm = () => {
    const el = typeof document !== "undefined" ? document.getElementById("request-site") : null;
    el?.scrollIntoView({ block: "center" });
    el?.focus();
  };

  return html`<section class="s6-work">
    ${pageHead("Work orders", "Request service and follow it from request to invoice — in your words, not ours.")}

    <div class="s6-account" id="account">
      <div class="s6-account__who">
        <h2 class="s6-account__name">${ctx.shell.context?.parent.name ?? "Your account"}</h2>
        <p class="s6-account__sub">${whenReady(ctx, nodes.value, (out) => {
          const count = (tier: string) => out.nodes.filter((n) => n.tier === tier).length;
          const sites = count("site"), locations = count("location");
          return html`<span class="ac-num">${sites}</span> site${sites === 1 ? "" : "s"} across <span class="ac-num">${locations}</span> location${locations === 1 ? "" : "s"} in your view`;
        })}</p>
      </div>
      <div class="s6-account__side">
        ${plans.map((p) => html`<span class="s6-tag">${p}</span>`)}
        ${PrimaryAction({ density: ctx.density, label: "New work order", id: "account-request", onClick: focusForm })}
      </div>
    </div>

    ${jobs.value.state === "refused" ? null : whenReady(ctx, requests.value, (out) => {
      const orders = ordersOf(out.requests, jobRows);
      const n = (k: number) => orders.filter((o) => stepOf(o) === k).length;
      const done30 = orders.filter((o) => stepOf(o) >= 3 && now - Date.parse(o.job?.stateChangedAt ?? o.submittedAt) <= 30 * DAY_MS).length;
      const due = invoiceRows.filter((i) => i.dueAt && Date.parse(i.dueAt) >= now).length;
      return statStrip([
        { n: n(0), label: "Open requests" },
        { n: n(1), label: "Scheduled" },
        { n: n(2), label: "In progress" },
        { n: done30, label: "Completed (30 days)" },
        { n: due, label: "Invoices due", sub: "due date still ahead" },
      ], "work-stats");
    })}

    <div class="s6-home">
      ${panel(requestForm(ctx), "Request a work order", "Goes straight to the office for your region — no phone tag.", undefined, "request-panel")}
      <div class="s6-home__orders">
        ${outcomeView(ctx)}
        ${ordersPanel(ctx, jobs.value, requests.value, invoiceRows, now, true)}
      </div>
    </div>
  </section>`;
};
