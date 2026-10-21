import { html, signal, StatusPill, pageHead, panel, type Signal, type VNode } from "../../../../packages/ui/src/index.ts";
import { WORK_DONE_STATES, type JobDetailOutput, type JobMediaWire, type JobNoteWire, type JobUpdateWire, type JobVisitWire, type JobWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, homeMark, linkTo, submitAction, type Screen, type ScreenContext } from "./common.ts";
import { STATE_LABEL, initials, placeLine, daysInState } from "./jobs.ts";

/**
 * ONE JOB, AS DISPATCH READS IT (0016) — the header the crew needs before it
 * rolls, the work grouped by site visit, and what the customer has been told,
 * kept apart from what the office says to itself.
 *
 * A visit is the crews on site on one day: every assignment that started that
 * day, merged, with the span their time entries cover. Photos and notes go to
 * the visit that was under way when they were captured or written; anything
 * before the first visit is the office's, before dispatch. Photos are shown
 * as labelled placeholders — there is no image read path yet, and a tile that
 * names its storage key is honest about that.
 */
export type VisitGroup = {
  readonly key: string;
  readonly kind: "visit" | "office";
  readonly start: string;
  readonly end: string | null;
  readonly crews: readonly string[];
  readonly media: readonly JobMediaWire[];
  readonly notes: readonly JobNoteWire[];
};

const dayOf = (iso: string): string => iso.slice(0, 10);
const startOf = (v: JobVisitWire): string => v.workStart ?? v.assignedAt;

export const groupVisits = (detail: Pick<JobDetailOutput, "visits" | "media" | "notes">): VisitGroup[] => {
  const byDay = new Map<string, { start: string; end: string | null; crews: string[]; media: JobMediaWire[]; notes: JobNoteWire[] }>();
  for (const v of [...detail.visits].sort((a, b) => startOf(a).localeCompare(startOf(b)))) {
    const day = dayOf(startOf(v));
    const g = byDay.get(day) ?? { start: startOf(v), end: null, crews: [], media: [], notes: [] };
    const end = v.workEnd ?? v.releasedAt;
    if (end && (!g.end || end > g.end)) g.end = end;
    const crew = v.crewLabel ?? "Crew";
    if (!g.crews.includes(crew)) g.crews.push(crew);
    byDay.set(day, g);
  }
  const visits = [...byDay.entries()].map(([day, g]) => ({ key: day, kind: "visit" as const, ...g }));
  const office = { key: "office", kind: "office" as const, start: "", end: null, crews: [] as string[], media: [] as JobMediaWire[], notes: [] as JobNoteWire[] };
  const home = (at: string) => [...visits].reverse().find((v) => v.start <= at) ?? office;
  for (const m of detail.media) home(m.capturedAt).media.push(m);
  for (const n of detail.notes) if (n.kind === "note") home(n.at).notes.push(n);
  if (office.media.length || office.notes.length) office.start = [...office.media.map((m) => m.capturedAt), ...office.notes.map((n) => n.at)].sort()[0]!;
  return [...(office.start ? [office] : []), ...visits];
};

/** The job's own window, when nobody holds it yet and the work is still ahead. */
export const scheduledNext = (job: JobWire, now: number): boolean =>
  !job.currentCrewId && ![...WORK_DONE_STATES, "cancelled", "aborted"].includes(job.state) && Date.parse(job.serviceWindowEnd) > now;

const SHOWN = 3;
const PHOTOS_SHOWN = 4;

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const year = (iso: string) => new Date(iso).getFullYear();
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
const keyName = (storageKey: string) => storageKey.split("/").at(-1) ?? storageKey;

type View = "visit" | "photos" | "notes";
type UiState = { view: View; expanded: boolean; open: Set<string>; drafts: Record<string, string>; reply: string; note: string; standing: string | null };
const states = new WeakMap<Store, Map<string, Signal<UiState>>>();
const uiFor = (store: Store, jobId: string): Signal<UiState> => {
  let byJob = states.get(store);
  if (!byJob) { byJob = new Map(); states.set(store, byJob); }
  let s = byJob.get(jobId);
  if (!s) { s = signal<UiState>({ view: "visit", expanded: false, open: new Set(), drafts: {}, reply: "", note: "", standing: null }); byJob.set(jobId, s); }
  return s;
};

const crewChip = (label: string): VNode => html`<span class="s3-tech"><span class="dispatch-board__avatar" aria-hidden="true">${initials(label)}</span>${label}</span>`;

const photoTile = (m: JobMediaWire): VNode => html`<figure class="s3-photo" title=${m.storageKey}>
  <span class="s3-photo__well" aria-hidden="true"></span>
  <figcaption><strong>${m.label ?? m.kind.replace(/_/g, " ")}</strong><span class="s3-num">${keyName(m.storageKey)}</span></figcaption>
</figure>`;

const visitCard = (g: VisitGroup, ui: Signal<UiState>): VNode => {
  const open = ui.value.open.has(g.key);
  const photos = open ? g.media : g.media.slice(0, PHOTOS_SHOWN);
  const more = g.media.length - photos.length;
  return html`<li class="s3-visit" data-kind=${g.kind}>
    <div class="s3-visit__date">
      ${g.kind === "visit" ? html`<strong class="s3-num">${date(g.start)}</strong><span class="s3-num">${year(g.start)}</span>` : html`<strong>Office</strong><span>before dispatch</span>`}
    </div>
    <div class="s3-visit__card">
      <div class="s3-visit__head">
        <span class="s3-visit__crews">${g.kind === "visit" ? g.crews.map(crewChip) : html`<span class="s3-muted">No crew on site</span>`}</span>
        ${g.kind === "visit" ? html`<span class="s3-visit__when s3-num">${time(g.start)}${g.end ? ` – ${time(g.end)}` : " – open"}</span>` : null}
      </div>
      ${photos.length ? html`<div class="s3-photos">
        ${photos.map(photoTile)}
        ${more > 0 ? html`<button type="button" class="s3-photo s3-photo--more" onClick=${() => { const o = new Set(ui.value.open); o.add(g.key); ui.value = { ...ui.value, open: o }; }}><span class="s3-num">+${more}</span> more</button>` : null}
      </div>` : null}
      ${g.notes.map((n) => html`<p class="s3-visit__note">${n.body}<span class="s3-visit__by">${n.authorName ?? "Office"} · <span class="s3-num">${time(n.at)}</span></span></p>`)}
      ${!photos.length && !g.notes.length ? html`<p class="s3-muted">No photos or notes logged on this visit.</p>` : null}
    </div>
  </li>`;
};

const timeline = (d: JobDetailOutput, ui: Signal<UiState>, now: number): VNode => {
  const groups = groupVisits(d);
  const hidden = ui.value.expanded ? [] : groups.slice(0, Math.max(0, groups.length - SHOWN));
  const shown = groups.slice(hidden.length);
  const next = scheduledNext(d.job, now);
  if (!groups.length && !next) return html`<p class="s3-muted">No visits yet — nobody has been assigned to this job.</p>`;
  return html`<ol class="s3-visits">
    ${hidden.length ? html`<li class="s3-visits__earlier">
      <span><strong class="s3-num">${hidden.length}</strong> earlier visit${hidden.length === 1 ? "" : "s"} ${hidden.length === 1 ? "on" : "between"} <span class="s3-num">${date(hidden[0]!.start)} ${year(hidden[0]!.start)}</span>${hidden.length > 1 ? html` – <span class="s3-num">${date(hidden.at(-1)!.start)} ${year(hidden.at(-1)!.start)}</span>` : null} · <span class="s3-num">${hidden.reduce((n, g) => n + g.media.length, 0)}</span> photos</span>
      <button type="button" class="s3-act" onClick=${() => { ui.value = { ...ui.value, expanded: true }; }}>Expand history</button>
    </li>` : null}
    ${shown.map((g) => visitCard(g, ui))}
    ${next ? html`<li class="s3-visit" data-kind="next">
      <div class="s3-visit__date"><strong class="s3-num">${date(d.job.serviceWindowStart)}</strong><span class="s3-num">${year(d.job.serviceWindowStart)}</span></div>
      <div class="s3-visit__card s3-visit__card--next">
        <div class="s3-visit__head">
          <span class="s3-visit__sched">Scheduled — unassigned tech</span>
          <span class="s3-visit__when s3-num">Window ${time(d.job.serviceWindowStart)} – ${time(d.job.serviceWindowEnd)}</span>
        </div>
        <p class="s3-visit__note">${d.job.serviceCode.replace(/_/g, " ")} · ${d.job.priority}</p>
      </div>
    </li>` : null}
  </ol>`;
};

const header = (ctx: ScreenContext, d: JobDetailOutput, ui: Signal<UiState>): VNode => {
  const j = d.job;
  const crews = [...new Set(d.visits.map((v) => v.crewLabel ?? "Crew"))];
  const standing = [...d.notes].reverse().find((n) => n.kind === "standing") ?? null;
  const editing = ui.value.standing;
  const place = placeLine(j.siteAddress);
  const street = j.siteAddress?.line1;
  return panel(html`<div class="s3-detail-head">
    <p class="s3-eyebrow">Job # <span class="s3-num">${j.id}</span></p>
    <h2 class="s3-detail-head__site">${j.siteName ?? "Site name unavailable"}</h2>${homeMark(j.customerSegment)}
    <p class="s3-detail-head__where">${[street, place].filter(Boolean).join(", ") || "Address not recorded"}${d.contact ? html` · ${d.contact.name}${d.contact.phone ? html`, <span class="s3-num">${d.contact.phone}</span>` : null}` : null}</p>
    <p class="s3-flags"><span class="s3-flag">${STATE_LABEL[j.state]}</span><span class="s3-flag">${j.priority[0]!.toUpperCase()}${j.priority.slice(1)} priority</span>${j.returnTrip ? html`<span class="s3-flag">Return trip</span>` : null}</p>
  </div>
  <dl class="s3-jobfacts">
    <div><dt>Service window</dt><dd class="s3-num">${new Date(j.serviceWindowStart).toLocaleDateString()} – ${new Date(j.serviceWindowEnd).toLocaleDateString()}</dd></div>
    ${sameDay(j.serviceWindowStart, j.serviceWindowEnd) ? html`<div><dt>Arrival window</dt><dd class="s3-num">${time(j.serviceWindowStart)} – ${time(j.serviceWindowEnd)}</dd></div>` : null}
    <div><dt>In this status</dt><dd class="s3-num">${daysInState(j, Date.now())}d</dd></div>
    <div><dt>Total visits</dt><dd class="s3-num">${groupVisits(d).filter((g) => g.kind === "visit").length}</dd></div>
    <div><dt>Photos on file</dt><dd class="s3-num">${d.media.length}</dd></div>
  </dl>
  <p class="s3-eyebrow">Assigned techs (all visits)</p>
  <p class="s3-detail-head__crews">${crews.length ? crews.map(crewChip) : html`<span class="s3-muted">None yet</span>`}</p>
  <section class="s3-standing" aria-labelledby="standing-title">
    <p class="s3-eyebrow" id="standing-title">Standing notes for techs</p>
    ${editing !== null
      ? html`<textarea class="ac-input s3-draftbox" aria-label="Standing note for techs" maxlength="2000" value=${editing}
          onInput=${(e: Event) => { ui.value = { ...ui.value, standing: (e.currentTarget as HTMLTextAreaElement).value }; }}></textarea>
        <span class="s3-row-actions">
          ${submitAction(ctx, "Save standing note", () => { const body = (ui.value.standing ?? "").trim(); if (body) void act(ctx, () => ctx.shell.gateway.addJobNote({ jobId: j.id, orgId: j.orgId, regionId: j.regionId, body, kind: "standing" }), "Standing note saved.", () => { ui.value = { ...ui.value, standing: null }; }); }, "standing-save")}
          <button type="button" class="s3-act" onClick=${() => { ui.value = { ...ui.value, standing: null }; }}>Cancel</button>
        </span>`
      : html`${standing ? html`<p class="s3-standing__body">${standing.body}</p><p class="s3-visit__by">${standing.authorName ?? "Office"} · <span class="s3-num">${stamp(standing.at)}</span></p>` : html`<p class="s3-muted">None. What should every tech know before rolling to this job?</p>`}
        <button type="button" class="s3-act" id="standing-edit" onClick=${() => { ui.value = { ...ui.value, standing: standing?.body ?? "" }; }}>${standing ? "Replace" : "Write one"}</button>`}
  </section>`, undefined, undefined, undefined, "job-head");
};

/** Every write here: call, say what happened in the dispatcher's words, refetch the job. */
const act = async (ctx: ScreenContext, call: () => Promise<unknown>, ok: string, after?: () => void): Promise<void> => {
  try {
    await call();
    after?.();
    ctx.store.notice.value = [ok];
  } catch (e) {
    const r = ctx.shell.refusalOf(e);
    ctx.store.notice.value = [`That did not go through${r && "message" in r && r.message ? ` — ${r.message}` : ""}. Nothing was lost; try again.`];
  }
  ctx.store.invalidate("jobs.detail");
  ctx.store.invalidate("jobs.list");
};

const updateBlock = (ctx: ScreenContext, d: JobDetailOutput, ui: Signal<UiState>, note: JobNoteWire | null, u: JobUpdateWire | null): VNode => {
  const j = d.job;
  const key = u?.id ?? `new:${note?.id ?? ""}`;
  const draft = ui.value.drafts[key];
  const setDraft = (v: string | undefined) => { const drafts = { ...ui.value.drafts }; if (v === undefined) delete drafts[key]; else drafts[key] = v; ui.value = { ...ui.value, drafts }; };

  if (u?.state === "published") {
    return html`<p class="s3-eyebrow">What the customer sees</p>
      <p class="s3-customer-text">${u.body}</p>
      <p class="s3-update__foot">${StatusPill({ density: ctx.density, status: "ok", label: "Published" })}<span><span class="s3-num">${stamp(u.publishedAt!)}</span>${u.publishedByName ? html` · ${u.publishedByName}` : null}</span></p>`;
  }
  if (!u && draft === undefined) {
    return html`<p class="s3-update__foot"><span class="s3-flag">Internal only — never shown to the customer</span>
      <button type="button" class="s3-act" id=${`write-${note?.id}`} onClick=${() => setDraft("")}>Write a customer update</button></p>`;
  }
  const text = draft ?? u?.body ?? "";
  const save = async (): Promise<string | null> => {
    const body = text.trim();
    if (!body) return null;
    const out = await ctx.shell.gateway.saveJobUpdate({ jobId: j.id, orgId: j.orgId, regionId: j.regionId, body, ...(u ? { updateId: u.id } : {}), ...(!u && note ? { sourceNoteId: note.id } : {}) });
    return out.id;
  };
  return html`<p class="s3-eyebrow">What the customer sees</p>
    <textarea class="ac-input s3-draftbox" aria-label=${`Customer update${note ? ` from the note of ${stamp(note.at)}` : ""}`} maxlength="2000" value=${text}
      onInput=${(e: Event) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}></textarea>
    <p class="s3-update__foot">
      <span class="s3-flag">Draft — not visible to the customer</span>
      <span class="s3-row-actions">
        ${submitAction(ctx, "Save draft", () => void act(ctx, save, "Draft saved. The customer cannot see it.", () => setDraft(undefined)), `save-${key}`, "quiet")}
        ${submitAction(ctx, "Publish to customer", () => void act(ctx, async () => { const id = await save(); if (id) await ctx.shell.gateway.publishJobUpdate({ updateId: id }); }, "Published — the customer will see it in their portal.", () => setDraft(undefined)), `publish-${key}`)}
      </span>
    </p>`;
};

const communication = (ctx: ScreenContext, d: JobDetailOutput, ui: Signal<UiState>): VNode => {
  const j = d.job;
  const notes = d.notes.filter((n) => n.kind === "note").reverse();
  const loose = d.updates.filter((u) => !u.sourceNoteId);
  const updateFor = (n: JobNoteWire) => [...d.updates].reverse().find((u) => u.sourceNoteId === n.id) ?? null;
  const send = () => {
    const body = ui.value.reply.trim();
    if (body) void act(ctx, () => ctx.shell.gateway.postJobMessage({ jobId: j.id, body }), "Reply posted to the customer thread.", () => { ui.value = { ...ui.value, reply: "" }; });
  };
  const addNote = () => {
    const body = ui.value.note.trim();
    if (body) void act(ctx, () => ctx.shell.gateway.addJobNote({ jobId: j.id, orgId: j.orgId, regionId: j.regionId, body }), "Internal note added.", () => { ui.value = { ...ui.value, note: "" }; });
  };
  return panel(html`<div class="s3-comms">
    <section class="s3-comms__col" aria-labelledby="updates-title">
      <p class="s3-eyebrow" id="updates-title">Updates to publish</p>
      ${loose.map((u) => html`<article class="s3-update">${updateBlock(ctx, d, ui, null, u)}</article>`)}
      ${notes.length ? notes.map((n) => html`<article class="s3-update">
        <p class="s3-eyebrow">From note · <span class="s3-num">${stamp(n.at)}</span>${n.authorName ? html` · ${n.authorName}` : null} · Internal</p>
        <p class="s3-update__note">${n.body}</p>
        ${updateBlock(ctx, d, ui, n, updateFor(n))}
      </article>`) : html`<p class="s3-muted">No internal notes yet. A customer update is written from one.</p>`}
    </section>
    <section class="s3-comms__col" aria-labelledby="thread-title">
      <p class="s3-eyebrow" id="thread-title">Customer thread <span class="s3-flag">Visible to customer</span></p>
      <div class="s3-thread">
        ${d.messages.length ? html`<ol class="s3-thread__list">${d.messages.map((m) => html`<li class="s3-msg" data-side=${m.authorKind}>
          <span class="s3-msg__by">${m.authorName ?? (m.authorKind === "office" ? "Dispatch" : "Customer")} · <span class="s3-num">${stamp(m.at)}</span></span>
          <p class="s3-msg__body">${m.body}</p>
        </li>`)}</ol>` : html`<p class="s3-muted">No messages yet.</p>`}
        <form class="s3-thread__reply" onSubmit=${(e: Event) => { e.preventDefault(); send(); }}>
          <input class="ac-input s3-grow" aria-label="Reply to the customer" placeholder=${`Reply${d.contact ? ` to ${d.contact.name.split(" ")[0]}` : ""} (they will see this)`} maxlength="2000" value=${ui.value.reply}
            onInput=${(e: Event) => { ui.value = { ...ui.value, reply: (e.currentTarget as HTMLInputElement).value }; }} />
          ${submitAction(ctx, "Send", send, "reply-send")}
        </form>
        <label class="s3-notify"><input type="checkbox" disabled /> <span>Also notify by email and push<small>Not available yet — there is no email or push delivery. The customer sees the reply the next time they open the portal.</small></span></label>
      </div>
      <section class="s3-internal" aria-labelledby="internal-title">
        <p class="s3-eyebrow" id="internal-title">Internal notes <span class="s3-flag">Staff only</span></p>
        ${notes.length ? html`<ol class="s3-internal__list">${notes.map((n) => html`<li><span class="s3-visit__by"><span class="s3-num">${stamp(n.at)}</span> · ${n.authorName ?? "Office"}</span><p>${n.body}</p></li>`)}</ol>` : null}
        <form class="s3-thread__reply" onSubmit=${(e: Event) => { e.preventDefault(); addNote(); }}>
          <input class="ac-input s3-grow" aria-label="Internal note" placeholder="Add an internal note (staff only)" maxlength="2000" value=${ui.value.note}
            onInput=${(e: Event) => { ui.value = { ...ui.value, note: (e.currentTarget as HTMLInputElement).value }; }} />
          ${submitAction(ctx, "Add note", addNote, "note-add", "quiet")}
        </form>
      </section>
    </section>
  </div>`, "Customer communication", "Internal notes, photos and comments stay private. Nothing reaches the customer until dispatch writes an update and publishes it.",
  d.contact ? html`<span class="s3-flag">Customer: ${d.contact.name}, ${j.siteName ?? "site"}</span>` : null, "job-comms");
};

export const detail: Screen = (ctx, params) => {
  const jobId = params.jobId!;
  const res = ctx.store.read(keyOf("jobs.detail", { jobId }), () => ctx.shell.gateway.jobDetail({ jobId }));
  const ui = uiFor(ctx.store, jobId);
  const now = Date.now();
  return html`<section class="s3-detail">
    ${pageHead("Job Detail", "Photos and notes grouped by site visit, in order within each visit — and what the customer has been told, kept apart from what the office says to itself.")}
    ${whenReady(ctx, res.value, (d) => html`
      <div class="s3-detail-grid">
        ${header(ctx, d, ui)}
        ${panel(ui.value.view === "visit" ? timeline(d, ui, now)
            : ui.value.view === "photos" ? (d.media.length ? html`<div class="s3-photos">${d.media.map(photoTile)}</div>` : html`<p class="s3-muted">No photos on file.</p>`)
            : html`<ol class="s3-internal__list">${[...d.notes].reverse().map((n) => html`<li><span class="s3-visit__by"><span class="s3-num">${stamp(n.at)}</span> · ${n.authorName ?? "Office"}${n.kind === "standing" ? " · standing" : ""}</span><p>${n.body}</p></li>`)}</ol>`,
          "Visit history", "Grouped by visit · photos and notes in the order they were added",
          html`<nav class="ac-seg" aria-label="Visit history view">${(["visit", "photos", "notes"] as const).map((v) => html`<button type="button" class="ac-seg__item s3-seg-btn" data-current=${ui.value.view === v ? "true" : undefined} aria-pressed=${ui.value.view === v ? "true" : "false"}
            onClick=${() => { ui.value = { ...ui.value, view: v }; }}>${v === "visit" ? "By visit" : v === "photos" ? "All photos" : "All notes"}</button>`)}</nav>`, "job-visits")}
      </div>
      ${communication(ctx, d, ui)}`)}
  </section>`;
};

/** The tab with no job chosen: the jobs that moved most recently, each a way in. */
export const pick: Screen = (ctx) => {
  const res = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  return html`<section class="s3-detail">
    ${pageHead("Job Detail", "Pick a job — the ones that changed most recently are first. A job number anywhere on the dashboard opens its detail too.")}
    ${whenReady(ctx, res.value, (out) => panel(html`<ul class="s3-pick">${[...out.jobs].sort((a, b) => b.stateChangedAt.localeCompare(a.stateChangedAt)).slice(0, 25).map((j) => html`<li>
      ${linkTo(ctx, "detail", { jobId: j.id }, j.id)}
      <span><strong>${j.siteName ?? "Site name unavailable"}</strong> <span class="s3-muted">${placeLine(j.siteAddress) ?? ""}</span></span>
      <span>${STATE_LABEL[j.state]}</span>
    </li>`)}</ul>`, "Recent jobs"))}
  </section>`;
};
