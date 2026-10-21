import { html, signal, DataGrid, StatusPill, PrimaryAction, pageHead, statStrip, panel, shortRef, type Column, type Signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { ServiceRequestWire, ServiceRequestPriority, JobPriority, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, linkTo, refusalView, type Screen, type ScreenContext } from "./common.ts";
import { STATE_LABEL } from "./jobs.ts";

/**
 * INTAKE — what customers asked for in their portal (S6), as the region's
 * dispatcher reads it. `serviceRequests.list` is region-locked for this
 * principal by RLS, the same read S6 makes for its own rows, so the office
 * and the customer are looking at one request, under one reference
 * (`shortRef`), with the photos the customer sent.
 *
 * Waiting first — a request no job has been opened against is the office's
 * to act on — then by the priority the customer declared, then newest. A
 * priority is the customer's word, not the office's grade; emergency and
 * urgent take the state ramp because they read as state, routine is plain.
 *
 * A waiting request is answered here: "Open job" opens a job at the
 * request's site (`serviceRequests.openJob` — jobs.create's own path, the SLA
 * timer derived, never typed) and links the two, then hands the dispatcher to
 * the dispatch screen for the new job. Priority starts at what the customer
 * declared and the window at the date they asked for, when they asked for one;
 * the dispatcher may change either.
 */
type Show = "waiting" | "all";
type Viewing = { readonly requestId: string; readonly photoId: string } | null;

const RANK: Readonly<Record<ServiceRequestPriority, number>> = { emergency: 0, urgent: 1, routine: 2 };
const isWaiting = (r: Pick<ServiceRequestWire, "jobId">) => r.jobId === null;

export const intakeRows = (requests: readonly ServiceRequestWire[], show: Show): ServiceRequestWire[] =>
  requests
    .filter((r) => show === "all" || isWaiting(r))
    .sort((a, b) => Number(!isWaiting(a)) - Number(!isWaiting(b)) || RANK[a.priority] - RANK[b.priority] || b.createdAt.localeCompare(a.createdAt));

/** "12m", "3h", "2d" — how long a request has been with the office. */
export const age = (iso: string, now: number): string => {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

const perStore = <T>(initial: T) => {
  const m = new WeakMap<Store, Signal<T>>();
  return (store: Store): Signal<T> => {
    let s = m.get(store);
    if (!s) { s = signal<T>(initial); m.set(store, s); }
    return s;
  };
};
const showFor = perStore<Show>("waiting");
const viewingFor = perStore<Viewing>(null);
type Opening = { readonly requestId: string; readonly busy: boolean; readonly refusal: Refusal | null } | null;
const openingFor = perStore<Opening>(null);

const JOB_PRIORITIES: readonly JobPriority[] = ["emergency", "urgent", "routine", "pm"];
const PRIORITY_WORD: Readonly<Record<JobPriority, string>> = { emergency: "Emergency", urgent: "Urgent", routine: "Routine", pm: "Planned maintenance" };

/** "2026-10-22T08:00" — what a datetime-local input holds, in the dispatcher's own time. */
const localInput = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/**
 * The window the form starts at: the morning of the date the customer asked
 * for (S6 writes "Preferred date: YYYY-MM-DD." into the description), else the
 * next whole hour — four hours either way.
 */
export const defaultWindow = (description: string, now: Date): { start: string; end: string } => {
  const asked = /Preferred date: (\d{4})-(\d{2})-(\d{2})/.exec(description);
  const start = asked ? new Date(Number(asked[1]), Number(asked[2]) - 1, Number(asked[3]), 8) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  return { start: localInput(start), end: localInput(new Date(start.getTime() + 4 * 3_600_000)) };
};

const openJob = async (ctx: ScreenContext, r: ServiceRequestWire, form: HTMLFormElement, opening: Signal<Opening>): Promise<void> => {
  const f = new FormData(form);
  opening.value = { requestId: r.id, busy: true, refusal: null };
  try {
    const out = await ctx.shell.gateway.openServiceRequestJob({
      requestId: r.id,
      serviceCode: String(f.get("serviceCode") ?? "").trim(),
      priority: String(f.get("priority") ?? r.priority) as JobPriority,
      serviceWindowStart: new Date(String(f.get("start"))).toISOString(),
      serviceWindowEnd: new Date(String(f.get("end"))).toISOString(),
    });
    opening.value = null;
    ctx.store.notice.value = [`Request ${shortRef(r.id)} at ${r.siteName} is answered — job ${out.id} is open, response due ${new Date(out.dueAt).toLocaleString()}. Assign a crew below.`];
    ctx.store.invalidate("serviceRequests.list");
    ctx.store.invalidate("jobs.list");
    ctx.router.navigate("dispatch", { jobId: out.id });
  } catch (e) {
    opening.value = { requestId: r.id, busy: false, refusal: ctx.shell.refusalOf(e) ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) } };
  }
};

const openPanel = (ctx: ScreenContext, requests: readonly ServiceRequestWire[], opening: Signal<Opening>): VNode | null => {
  const o = opening.value;
  const r = o ? requests.find((x) => x.id === o.requestId && isWaiting(x)) : undefined;
  if (!o || !r) return null;
  const w = defaultWindow(r.description, new Date());
  return panel(html`<form class="ac-form" id="intake-open-form" onSubmit=${(e: Event) => { e.preventDefault(); if (!ctx.degraded && !o.busy) void openJob(ctx, r, e.currentTarget as HTMLFormElement, opening); }}>
      <p class="s3-customer-text">${r.description}</p>
      <label class="ac-field"><span>Service</span>
        <input class="ac-input" name="serviceCode" id="intake-service" required maxlength="80" placeholder="e.g. repairs, rtu_changeout, pm_route" />
      </label>
      <label class="ac-field"><span>Priority</span>
        <select class="ac-input" name="priority" id="intake-priority">
          ${JOB_PRIORITIES.map((p) => html`<option value=${p} defaultSelected=${p === r.priority}>${PRIORITY_WORD[p]}${p === r.priority ? " — as the customer declared" : ""}</option>`)}
        </select>
      </label>
      <label class="ac-field"><span>Window from</span><input class="ac-input" type="datetime-local" name="start" id="intake-start" required defaultValue=${w.start} /></label>
      <label class="ac-field"><span>Window to</span><input class="ac-input" type="datetime-local" name="end" id="intake-end" required defaultValue=${w.end} /></label>
      <p class="s3-muted">The response time is the site's agreed term — it is derived when the job opens, not chosen here.</p>
      <span class="s3-row-actions">
        ${PrimaryAction({
          density: ctx.density, label: o.busy ? "Opening…" : "Open job", type: "submit", id: "intake-open-submit",
          ...(ctx.degraded ? { disabledReason: `Gateway unreachable — ${ctx.shell.degradedMode}` } : o.busy ? { disabledReason: "Opening…" } : {}),
        })}
        <button type="button" class="s3-act" id="intake-open-cancel" onClick=${() => { opening.value = null; }}>Cancel</button>
      </span>
      ${o.refusal ? refusalView(ctx, o.refusal) : null}
    </form>`,
    `Open a job — ${shortRef(r.id)}`, r.siteName, undefined, "intake-open");
};

const priorityCell = (ctx: ScreenContext, p: ServiceRequestPriority): VNode =>
  p === "emergency" ? StatusPill({ density: ctx.density, status: "breached", label: "Emergency" }) ?? html``
  : p === "urgent" ? StatusPill({ density: ctx.density, status: "at_risk", label: "Urgent" }) ?? html``
  : html`<span>Routine</span>`;

/** One photo, read through the gateway as a data: URL — a surface never holds a bucket URL. Immutable, so read once per session. */
const photoOf = (ctx: ScreenContext, id: string) =>
  ctx.store.read(keyOf("media.get", { id }), () => ctx.shell.gateway.getMedia({ id })).value;

const thumbs = (ctx: ScreenContext, r: ServiceRequestWire, viewing: Signal<Viewing>, opening: Signal<Opening>): VNode => {
  if (r.photos.length === 0) return html`<span class="s3-muted">—</span>`;
  return html`<span class="s3-intake__thumbs">${r.photos.map((p, i) => {
    const m = photoOf(ctx, p.id);
    const label = `Photo ${i + 1} of ${r.photos.length}, request ${shortRef(r.id)}`;
    const open = viewing.value?.photoId === p.id;
    return html`<button type="button" class="s3-intake__thumb" aria-label=${`Open ${label}`} aria-pressed=${open ? "true" : "false"}
      onClick=${() => {
        opening.value = null;
        viewing.value = open ? null : { requestId: r.id, photoId: p.id };
        // Below the list on a narrow screen: bring it to the eye, or the tap looks like it did nothing.
        if (!open && typeof document !== "undefined") requestAnimationFrame(() => document.getElementById("intake-viewer")?.scrollIntoView({ block: "nearest" }));
      }}>
      ${m.state === "ready" ? html`<img src=${m.value.image} alt="" />` : html`<span class="s3-intake__thumb-empty">${m.state === "refused" ? "!" : "…"}</span>`}
    </button>`;
  })}</span>`;
};

const viewer = (ctx: ScreenContext, requests: readonly ServiceRequestWire[], viewing: Signal<Viewing>): VNode | null => {
  const v = viewing.value;
  const r = v ? requests.find((x) => x.id === v.requestId) : undefined;
  const i = r ? r.photos.findIndex((p) => p.id === v!.photoId) : -1;
  if (!r || i < 0) return null;
  const m = photoOf(ctx, r.photos[i]!.id);
  const step = (d: number) => { viewing.value = { requestId: r.id, photoId: r.photos[(i + d + r.photos.length) % r.photos.length]!.id }; };
  return panel(html`<figure class="s3-intake__view" id="intake-viewer">
      ${m.state === "ready"
        ? html`<img src=${m.value.image} alt=${`Photo ${i + 1} of ${r.photos.length} sent with request ${shortRef(r.id)} at ${r.siteName}`} />`
        : html`<p class="s3-muted" role=${m.state === "refused" ? "note" : "status"}>${m.state === "refused" ? `This photo could not be shown — ${m.refusal.message}` : "Loading…"}</p>`}
      <figcaption><span class="s3-num">${shortRef(r.id)}</span> · ${r.siteName} · photo <span class="s3-num">${i + 1}</span> of <span class="s3-num">${r.photos.length}</span></figcaption>
    </figure>`,
    "Photo", r.description.split("\n")[0],
    html`<span class="s3-row-actions">
      ${r.photos.length > 1 ? html`<button type="button" class="s3-act" onClick=${() => step(-1)}>Previous</button><button type="button" class="s3-act" onClick=${() => step(1)}>Next</button>` : null}
      <button type="button" class="s3-act" id="intake-viewer-close" onClick=${() => { viewing.value = null; }}>Close</button>
    </span>`, "intake-photo");
};

export const intake: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("serviceRequests.list", {}), () => ctx.shell.gateway.listServiceRequests({}));
  const show = showFor(ctx.store);
  const viewing = viewingFor(ctx.store);
  const opening = openingFor(ctx.store);
  const now = Date.now();

  const columns: readonly Column<ServiceRequestWire>[] = [
    { key: "received", header: "Received", numeric: true, cell: (r) => html`<span class="s3-cust" title=${new Date(r.createdAt).toLocaleString()}><strong class="s3-num">${age(r.createdAt, now)} ago</strong><small>${new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span>` },
    { key: "ref", header: "Ref", cell: (r) => html`<span class="s3-num">${shortRef(r.id)}</span>` },
    { key: "site", header: "Site", cell: (r) => html`<strong>${r.siteName}</strong>` },
    { key: "priority", header: "Priority", cell: (r) => priorityCell(ctx, r.priority) },
    { key: "asked", header: "What they asked", cell: (r) => html`<span class="s3-intake__asked" title=${r.description}>${r.description}</span>` },
    { key: "photos", header: "Photos", cell: (r) => thumbs(ctx, r, viewing, opening) },
    { key: "status", header: "Status", cell: (r) => r.jobId
      ? linkTo(ctx, "detail", { jobId: r.jobId }, `Job opened · ${r.jobState ? STATE_LABEL[r.jobState] : "—"}`)
      : html`<span class="s3-moves"><span class="s3-muted">Waiting — no job yet</span>
          <button type="button" class="s3-act" id=${`open-${r.id}`} disabled=${ctx.degraded}
            title=${ctx.degraded ? `Gateway unreachable — ${ctx.shell.degradedMode}` : undefined}
            onClick=${() => { viewing.value = null; opening.value = { requestId: r.id, busy: false, refusal: null }; }}>Open job</button></span>` },
  ];

  return html`<section class="s3-intake">
    ${pageHead("Intake", "What customers asked for in their portal, waiting first — with the photos they sent, under the reference they were given.")}
    ${whenReady(ctx, list.value, (out) => {
      const waiting = out.requests.filter(isWaiting);
      const emergency = waiting.filter((r) => r.priority === "emergency").length;
      const urgent = waiting.filter((r) => r.priority === "urgent").length;
      const oldest = waiting.reduce<string | null>((o, r) => (o === null || r.createdAt < o ? r.createdAt : o), null);
      const rows = intakeRows(out.requests, show.value);
      const view = openPanel(ctx, out.requests, opening) ?? viewer(ctx, out.requests, viewing);
      return html`
        ${statStrip([
          { n: waiting.length, label: "Waiting", sub: "No job opened yet" },
          { n: emergency, label: "Emergency", sub: "Declared by the customer", ...(emergency ? { tone: "breached" as const } : {}) },
          { n: urgent, label: "Urgent", sub: "Declared by the customer", ...(urgent ? { tone: "at_risk" as const } : {}) },
          { n: oldest ? age(oldest, now) : "—", label: "Oldest waiting", sub: oldest ? new Date(oldest).toLocaleString() : "Nothing waiting" },
          { n: waiting.filter((r) => r.photos.length > 0).length, label: "With photos", sub: "Waiting requests" },
        ], "intake-stats")}
        <div class="s3-intake__layout" data-viewing=${view ? "true" : "false"}>
          ${panel(html`<div class="s3-grid-scroll">${DataGrid({ density: "console", columns, rows, rowKey: (r: ServiceRequestWire) => r.id, emptyText: show.value === "waiting" ? "Nothing waiting — every request has a job." : "No requests in this region.", stack: true })}</div>`,
            "Requests", show.value === "waiting" ? "Waiting for a job, emergencies first" : "Every request in the region, waiting first",
            html`<div class="s3-chips" role="group" aria-label="Show">
              <button type="button" class="ac-chip" aria-pressed=${show.value === "waiting" ? "true" : "false"} onClick=${() => { show.value = "waiting"; }}>Waiting</button>
              <button type="button" class="ac-chip" aria-pressed=${show.value === "all" ? "true" : "false"} onClick=${() => { show.value = "all"; }}>All</button>
            </div>`, "intake-requests")}
          ${view}
        </div>`;
    }, () => ctx.store.invalidate("serviceRequests.list"))}
  </section>`;
};
