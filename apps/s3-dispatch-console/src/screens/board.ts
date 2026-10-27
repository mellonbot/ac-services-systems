import { html, signal, shortRef, StatusPill, DataGrid, pageHead, statStrip, panel, type Signal, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import { serviceLabel, WORK_DONE_STATES, crewKindFor, crewKindForRole, type JobWire, type CrewWire, type CrewKind, type TechnicianWire } from "../../../../packages/contracts/src/index.ts";
import { STATUS_GLYPH } from "../../../../packages/tokens/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, homeMark, linkTo, type Screen } from "./common.ts";

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

const CLOSED: readonly string[] = [...WORK_DONE_STATES, "cancelled", "aborted"];
/** How far the board steps from today, either way: three days back, three days ahead. */
export const DAY_REACH = 3;
const boardDays = new WeakMap<Store, Signal<number>>();
const dayFor = (store: Store): Signal<number> => {
  let day = boardDays.get(store);
  if (!day) {
    day = signal(0);
    boardDays.set(store, day);
  }
  return day;
};





const HOUR_MS = 60 * 60_000;
/** The board's working day, 7 AM to 5 PM: ten hour columns, as the reference layout draws it. */
const FIRST_HOUR = 7, LAST_HOUR = 17;
const startOfDay = (ms: number, offset: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
};
const initialsOf = (label: string): string => label.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const describe = (job: JobWire): string => `${job.siteName ?? "Site name unavailable"} — ${serviceLabel(job.serviceCode)}`;

const WAITING: readonly string[] = ["awaiting_customer", "awaiting_parts", "quote_requested", "quote_submitted", "awaiting_po", "awaiting_pictures"];
const DONE: readonly string[] = [...WORK_DONE_STATES];
/**
 * Which legend entry a job's bar is drawn in. A late or escalated SLA wins
 * over the job's stage, and is drawn as the state it is — at risk and
 * breached apart, each in its own ink AND with its mark and word on the bar.
 * A stage is not a state (Arc Foundry rule 1), so stages are drawn in ink
 * and told apart by line form: solid scheduled, dashed waiting, dotted done.
 */
export type BoardTone = "breached" | "at_risk" | "waiting" | "completed" | "scheduled";
export const boardTone = (job: JobWire, now: number): BoardTone => {
  if (DONE.includes(job.state)) return "completed";
  const sla = slaStatus(job, now);
  if (sla === "breached" || sla === "at_risk") return sla;
  if (WAITING.includes(job.state)) return "waiting";
  return "scheduled";
};
const TONE_WORD: Readonly<Record<BoardTone, string>> = { breached: STATUS_GLYPH.breached.word, at_risk: STATUS_GLYPH.at_risk.word, waiting: "Waiting", completed: "Completed", scheduled: "Scheduled" };
const stateMark = (tone: BoardTone): VNode | null =>
  tone === "breached" || tone === "at_risk"
    ? html`<b class="dispatch-board__state"><span aria-hidden="true">${STATUS_GLYPH[tone].glyph}</span> ${STATUS_GLYPH[tone].word}</b>`
    : null;

type BoardRow = {
  readonly key: string; readonly initials: string; readonly name: string; readonly service: string;
  /** Which half of the board the row sits in: service technicians above, install crews below. */
  readonly kind: CrewKind;
  /** An install crew's members; empty for a technician's own unit. */
  readonly members: string;
  /** False for a technician on no crew: on the roster, but nothing can be dispatched to them. */
  readonly dispatchable: boolean;
  readonly jobs: readonly JobWire[];
};
export type BoardRoster = { readonly crews: readonly CrewWire[]; readonly technicians: readonly TechnicianWire[] };

/**
 * Everything the board draws: one row per active crew on the roster (a
 * technician's service unit is drawn under the technician's name), one per
 * active technician on no crew, and one per crew still holding work that the
 * roster no longer lists — so every person shows whether or not they hold a
 * job, and no job loses its row. Each row's bars are the jobs whose service
 * window touches the chosen day; the figures and legend counts come from the
 * same rows. Service technicians come first, install crews after them.
 */
export const boardModel = (jobs: readonly JobWire[], now: number, offset: number, roster: BoardRoster = { crews: [], technicians: [] }) => {
  const dayStart = startOfDay(now, offset);
  const from = dayStart + FIRST_HOUR * HOUR_MS;
  const to = dayStart + LAST_HOUR * HOUR_MS;
  const open = jobs.filter((j) => !CLOSED.includes(j.state));
  const onDay = (j: JobWire) => Date.parse(j.serviceWindowStart) < dayStart + 24 * HOUR_MS && Date.parse(j.serviceWindowEnd) > dayStart;
  const today = jobs.filter((j) => j.state !== "cancelled" && j.state !== "aborted" && onDay(j));

  const techs = roster.technicians.filter((t) => t.active);
  const crews = new Map<string, { name: string; kind: CrewKind; members: string; rostered: boolean; held: JobWire[]; today: JobWire[] }>();
  for (const c of roster.crews) {
    if (!c.active) continue;
    const on = techs.filter((t) => t.crewId === c.id);
    const name = c.kind === "service" && on.length === 1 ? on[0]!.name : c.label;
    crews.set(c.id, { name, kind: c.kind, members: c.kind === "install" ? on.map((t) => t.name).join(", ") : "", rostered: true, held: [], today: [] });
  }
  for (const j of jobs) {
    if (!j.currentCrewId) continue;
    const crew = crews.get(j.currentCrewId) ?? { name: j.currentCrewLabel ?? "Crew", kind: crewKindFor(j.workClass), members: "", rostered: false, held: [], today: [] };
    if (!CLOSED.includes(j.state)) crew.held.push(j);
    if (today.includes(j)) crew.today.push(j);
    crews.set(j.currentCrewId, crew);
  }
  const rows: BoardRow[] = [
    ...[...crews.entries()]
      .filter(([, c]) => c.rostered || c.held.length || c.today.length)
      .map(([key, c]) => {
        const sorted = [...c.today].sort((a, b) => Date.parse(a.serviceWindowStart) - Date.parse(b.serviceWindowStart));
        return { key, initials: initialsOf(c.name), name: c.name, kind: c.kind, service: sorted.length ? describe(sorted[0]!) : "No jobs today", members: c.members, dispatchable: true, jobs: sorted };
      }),
    ...techs
      .filter((t) => !t.crewId || !crews.has(t.crewId))
      .map((t) => ({ key: `tech-${t.id}`, initials: initialsOf(t.name), name: t.name, kind: crewKindForRole(t.role), service: "On no crew — not dispatchable", members: "", dispatchable: false, jobs: [] })),
  ].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "service" ? -1 : 1));

  const place = (j: JobWire) => {
    const left = Math.max(0, Math.min(1, (Date.parse(j.serviceWindowStart) - from) / (to - from)));
    const right = Math.max(0, Math.min(1, (Date.parse(j.serviceWindowEnd) - from) / (to - from)));
    return { left: left * 100, width: Math.max(0, right - left) * 100 };
  };
  const attention = open.filter((j) => slaStatus(j, now) !== "ok").length;
  const unassigned = open.filter((j) => !j.currentCrewId);
  const stats = [
    { n: today.length, label: "Jobs today" },
    { n: rows.filter((r) => r.jobs.length).length, label: "Crews out" },
    { n: attention, label: "Needs attention", ...(attention ? { tone: "breached" as const } : {}) },
    { n: unassigned.length, label: "Unscheduled" },
    { n: rows.filter((r) => r.dispatchable && !r.jobs.length).length, label: "Tech available", tone: "ok" as const },
  ];
  const legend = [
    { label: "Scheduled (in progress)", tone: "scheduled" },
    { label: "Completed", tone: "completed" },
    { label: "Waiting on customer/parts", tone: "waiting" },
    { label: "At risk today", n: today.filter((j) => !DONE.includes(j.state) && slaStatus(j, now) === "at_risk").length, tone: "at_risk" },
    { label: "Breached today", n: today.filter((j) => !DONE.includes(j.state) && slaStatus(j, now) === "breached").length, tone: "breached" },
    { label: "Unassigned", n: unassigned.filter(onDay).length, tone: "neutral" },
    { label: "Marked for follow-up", n: open.filter((j) => j.returnTrip).length, tone: "neutral" },
    { label: "Unscheduled", n: unassigned.length, tone: "neutral" },
  ];
  // The current time, as a share of the grid — null when the day shown is not today or the hour is off the grid.
  const nowAt = now >= from && now <= to ? ((now - from) / (to - from)) * 100 : null;
  // What the grid cannot draw: work nobody holds (rows are crews), and a crew's work that day wholly before 7 AM or after 5 PM —
  // the after-hours emergency is exactly the job a dispatcher must not lose. Most urgent SLA first, then by window.
  const bySla = (a: JobWire, b: JobWire) => (a.slaDueAt && !a.slaSatisfiedAt ? Date.parse(a.slaDueAt) : Infinity) - (b.slaDueAt && !b.slaSatisfiedAt ? Date.parse(b.slaDueAt) : Infinity)
    || Date.parse(a.serviceWindowStart) - Date.parse(b.serviceWindowStart);
  const offGrid = rows.flatMap((r) => r.jobs.filter((j) => place(j).width <= 0).map((job) => ({ job, crew: r.name }))).sort((a, b) => bySla(a.job, b.job));
  return { rows, place, stats, legend, dayStart, nowAt, unassigned: [...unassigned].sort(bySla), offGrid };
};

const windowText = (j: JobWire): string => {
  const at = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return `${at(j.serviceWindowStart)} – ${at(j.serviceWindowEnd)}`;
};
const offTimeline = (ctx: Parameters<Screen>[0], unassigned: readonly JobWire[], offGrid: readonly { job: JobWire; crew: string }[], now: number): VNode => {
  const sla = (j: JobWire) => (j.slaDueAt && !j.slaSatisfiedAt ? StatusPill({ density: ctx.density, status: slaStatus(j, now) }) : html`<span class="s3-muted">—</span>`);
  const jobLink = (j: JobWire) => linkTo(ctx, "detail", { jobId: j.id }, j.id);
  return html`<div class="dispatch-board__off" id="board-off-timeline">
    ${DataGrid({
      density: "console", stack: true, caption: `Unassigned — ${unassigned.length} not on any crew's row`,
      columns: [
        { key: "id", header: "Job #", numeric: true, cell: jobLink },
        { key: "site", header: "Site", cell: (j: JobWire) => html`${j.siteName ?? "Site name unavailable"}${homeMark(j.customerSegment)} <span class="s3-muted">· ${serviceLabel(j.serviceCode)} · ${j.priority}</span>` },
        { key: "window", header: "Window", cell: (j: JobWire) => html`<span class="s3-num">${windowText(j)}</span>` },
        { key: "sla", header: "SLA", cell: sla },
        { key: "act", header: "", align: "end", cell: (j: JobWire) => isDispatchable(j) ? linkTo(ctx, "dispatch", { jobId: j.id }, "Dispatch", "s3-act", `Dispatch job ${j.id} at ${j.siteName ?? "its site"}`) : html`<span class="s3-muted">${j.state}</span>` },
      ],
      rows: unassigned, rowKey: (j: JobWire) => j.id, emptyText: "Every open job is on a crew.",
    })}
    ${offGrid.length ? DataGrid({
      density: "console", stack: true, caption: "Outside 7 AM – 5 PM on this day",
      columns: [
        { key: "id", header: "Job #", numeric: true, cell: (o: { job: JobWire }) => jobLink(o.job) },
        { key: "crew", header: "Crew", cell: (o: { crew: string }) => o.crew },
        { key: "site", header: "Site", cell: (o: { job: JobWire }) => html`${o.job.siteName ?? "Site name unavailable"} <span class="s3-muted">· ${serviceLabel(o.job.serviceCode)} · ${o.job.priority}</span>` },
        { key: "window", header: "Window", cell: (o: { job: JobWire }) => html`<span class="s3-num">${windowText(o.job)}</span>` },
        { key: "sla", header: "SLA", cell: (o: { job: JobWire }) => sla(o.job) },
      ],
      rows: offGrid, rowKey: (o: { job: JobWire }) => o.job.id,
    }) : null}
  </div>`;
};

export const board: Screen = (ctx) => {
  const jobsKey = keyOf("jobs.list", {});
  const jobs = ctx.store.read(jobsKey, () => ctx.shell.gateway.listJobs({}));
  const crews = ctx.store.read(keyOf("crews.list", {}), () => ctx.shell.gateway.listCrews({}));
  const technicians = ctx.store.read(keyOf("technicians.list", {}), () => ctx.shell.gateway.listTechnicians({}));
  const day = dayFor(ctx.store);
  const now = Date.now();

  const shown = new Date(startOfDay(now, day.value));
  const step = (to: number) => { day.value = Math.max(-DAY_REACH, Math.min(DAY_REACH, to)); };
  const withRoster = (view: (jobs: readonly JobWire[], roster: BoardRoster) => VNode): VNode =>
    whenReady(ctx, jobs.value, (out) => whenReady(ctx, crews.value, (c) => whenReady(ctx, technicians.value, (t) => view(out.jobs, { crews: c.crews, technicians: t.technicians }))));

  return html`<section class="s3-board">
    ${pageHead("Dispatch Board", "Each job's stage and SLA state, crew grouping, and idle tech availability in one glance.", html`<div class="dispatch-dashboard__date-controls">
      <button type="button" class="dispatch-dashboard__date" id="board-prev" aria-label="Previous day" disabled=${day.value <= -DAY_REACH} onClick=${() => step(day.value - 1)}>‹ Prev</button>
      <span class="dispatch-dashboard__date is-active" aria-live="polite">${shown.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
      <button type="button" class="dispatch-dashboard__date" id="board-next" aria-label="Next day" disabled=${day.value >= DAY_REACH} onClick=${() => step(day.value + 1)}>Next ›</button>
      <button type="button" class="dispatch-dashboard__date" id="board-today" onClick=${() => { step(0); ctx.store.invalidate("jobs.list"); }}>Today</button>
    </div>`)}

    ${withRoster((list, roster) => statStrip(boardModel(list, now, day.value, roster).stats))}

    ${withRoster((list, roster) => {
      const m = boardModel(list, now, day.value, roster);
      return panel(html`<div class="dispatch-dashboard__board">
        ${m.nowAt === null ? null : html`<div class="dispatch-board__now-track" aria-hidden="true">
          <div class="dispatch-board__now" style=${`left:${m.nowAt}%;`}><span class="dispatch-board__now-tag">${new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span></div>
        </div>`}
        <div class="dispatch-board__header">
          <div class="dispatch-board__label">Technician</div>
          <div class="dispatch-board__hours">
            <span>7 AM</span><span>8 AM</span><span>9 AM</span><span>10 AM</span><span>11 AM</span><span>12 PM</span><span>1 PM</span><span>2 PM</span><span>3 PM</span><span>4 PM</span>
          </div>
        </div>

        ${m.rows.length ? m.rows.map((row, i) => html`${i === 0 || m.rows[i - 1]!.kind !== row.kind ? html`<div class="dispatch-board__group" key=${`group-${row.kind}`} data-kind=${row.kind}>
          ${row.kind === "service" ? "Service technicians" : "Install crews"} <span class="s3-num">${m.rows.filter((r) => r.kind === row.kind).length}</span>
        </div>` : null}<div class="dispatch-board__row" key=${row.key}>
          <div class="dispatch-board__tech">
            <span class="dispatch-board__avatar" data-tone=${row.jobs.length ? boardTone(row.jobs[0]!, now) : "idle"} aria-hidden="true">${row.initials}</span>
            <div class="dispatch-board__meta">
              <strong>${row.name}</strong>
              ${row.members ? html`<small>${row.members}</small>` : null}
              <small>${row.service}</small>
            </div>
          </div>
          <div class="dispatch-board__calendar" role="group" aria-label=${row.jobs.length ? `${row.name}: ${row.jobs.map(describe).join("; ")}` : `${row.name}: ${row.service}`}>
            ${row.jobs.map((job) => {
              const at = m.place(job);
              if (at.width <= 0) return null;
              const tone = boardTone(job, now);
              return html`<a class="dispatch-board__segment" key=${job.id} href=${ctx.router.href("detail", { jobId: job.id })} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate("detail", { jobId: job.id }); }} data-tone=${tone} style=${`left:${at.left}%; width:${at.width}%;`} title=${`${TONE_WORD[tone]} — ${describe(job)}`}>${stateMark(tone)}${shortRef(job.id)}<span>${job.siteName ?? "Site name unavailable"}</span></a>`;
            })}
          </div>
        </div>`) : html`<p class="dispatch-board__empty">No crews or technicians on the roster.</p>`}
      </div>
      ${offTimeline(ctx, m.unassigned, m.offGrid, now)}
      <div class="dispatch-dashboard__legend">
        ${m.legend.map((item) => html`<span class="dispatch-legend__item" data-tone=${item.tone}>${item.tone === "at_risk" || item.tone === "breached" ? html`<span class="dispatch-legend__mark" aria-hidden="true">${STATUS_GLYPH[item.tone].glyph}</span>` : null}${item.label}${"n" in item ? html` <span class="s3-num">${item.n}</span>` : null}</span>`)}
      </div>`);
    })}
  </section>`;
};
