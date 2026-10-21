import { html, signal, DataGrid, StatusPill, pageHead, statStrip, panel, shortRef, type Column, type Signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { ServiceRequestWire, ServiceRequestPriority } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, linkTo, type Screen, type ScreenContext } from "./common.ts";
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
 * Read-only by design: there is no operation that opens a job FROM a request
 * yet (`service_requests.job_id` is set by the office's own process), so this
 * screen shows the link once one exists and does not invent the act.
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

const priorityCell = (ctx: ScreenContext, p: ServiceRequestPriority): VNode =>
  p === "emergency" ? StatusPill({ density: ctx.density, status: "breached", label: "Emergency" }) ?? html``
  : p === "urgent" ? StatusPill({ density: ctx.density, status: "at_risk", label: "Urgent" }) ?? html``
  : html`<span>Routine</span>`;

/** One photo, read through the gateway as a data: URL — a surface never holds a bucket URL. Immutable, so read once per session. */
const photoOf = (ctx: ScreenContext, id: string) =>
  ctx.store.read(keyOf("media.get", { id }), () => ctx.shell.gateway.getMedia({ id })).value;

const thumbs = (ctx: ScreenContext, r: ServiceRequestWire, viewing: Signal<Viewing>): VNode => {
  if (r.photos.length === 0) return html`<span class="s3-muted">—</span>`;
  return html`<span class="s3-intake__thumbs">${r.photos.map((p, i) => {
    const m = photoOf(ctx, p.id);
    const label = `Photo ${i + 1} of ${r.photos.length}, request ${shortRef(r.id)}`;
    const open = viewing.value?.photoId === p.id;
    return html`<button type="button" class="s3-intake__thumb" aria-label=${`Open ${label}`} aria-pressed=${open ? "true" : "false"}
      onClick=${() => {
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
  const now = Date.now();

  const columns: readonly Column<ServiceRequestWire>[] = [
    { key: "received", header: "Received", numeric: true, cell: (r) => html`<span class="s3-cust" title=${new Date(r.createdAt).toLocaleString()}><strong class="s3-num">${age(r.createdAt, now)} ago</strong><small>${new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span>` },
    { key: "ref", header: "Ref", cell: (r) => html`<span class="s3-num">${shortRef(r.id)}</span>` },
    { key: "site", header: "Site", cell: (r) => html`<strong>${r.siteName}</strong>` },
    { key: "priority", header: "Priority", cell: (r) => priorityCell(ctx, r.priority) },
    { key: "asked", header: "What they asked", cell: (r) => html`<span class="s3-intake__asked" title=${r.description}>${r.description}</span>` },
    { key: "photos", header: "Photos", cell: (r) => thumbs(ctx, r, viewing) },
    { key: "status", header: "Status", cell: (r) => r.jobId
      ? linkTo(ctx, "detail", { jobId: r.jobId }, `Job opened · ${r.jobState ? STATE_LABEL[r.jobState] : "—"}`)
      : html`<span class="s3-muted">Waiting — no job yet</span>` },
  ];

  return html`<section class="s3-intake">
    ${pageHead("Intake", "What customers asked for in their portal, waiting first — with the photos they sent, under the reference they were given.")}
    ${whenReady(ctx, list.value, (out) => {
      const waiting = out.requests.filter(isWaiting);
      const emergency = waiting.filter((r) => r.priority === "emergency").length;
      const urgent = waiting.filter((r) => r.priority === "urgent").length;
      const oldest = waiting.reduce<string | null>((o, r) => (o === null || r.createdAt < o ? r.createdAt : o), null);
      const rows = intakeRows(out.requests, show.value);
      const view = viewer(ctx, out.requests, viewing);
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
