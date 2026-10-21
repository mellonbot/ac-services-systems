import { html, signal, DataGrid, StatusPill, pageHead, statStrip, panel, type Column, type Signal, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import type { Store } from "../state.ts";
import type { Screen } from "./common.ts";
import { initials } from "./jobs.ts";

/**
 * THE MANAGER DASHBOARD — the whole company on one page: how work flows from
 * request to paid, where it gets stuck, how each branch is doing, who is on
 * the team.
 *
 * EXAMPLE FIGURES. Nothing S3 may call returns invoices, timesheets, ratings
 * or employees (OPERATIONS admits S3 to jobs, dispatch and session only), so
 * every number here is the layout's own and the page says so in its head.
 * When those operations exist, each block swaps its constant for a read and
 * the screen's `uses` names them.
 */

type Tone = "ok" | "at_risk" | "breached";

const FIGURES: readonly { n: string; label: string; sub: string; tone?: Tone }[] = [
  { n: "$184,200", label: "Billed this month", sub: "+6% vs. last month" },
  { n: "$131,900", label: "Cash collected", sub: "72% of what was billed" },
  { n: "142", label: "Jobs completed", sub: "+9 vs. same point last month" },
  { n: "87%", label: "Fixed on first visit", sub: "+2 pts · 9% need a return trip" },
  { n: "1.4 days", label: "Request to scheduled", sub: "On target · goal 2 days", tone: "ok" },
  { n: "18 days", label: "Finished to invoiced", sub: "Slow · goal 3 days", tone: "breached" },
  { n: "74%", label: "Technician utilization", sub: "Watch · paid time on jobs", tone: "at_risk" },
  { n: "4.7 / 5", label: "Customer rating", sub: "+0.1 from 63 reviews" },
];

const WAITS: readonly { step: string; sub: string; days: number; goal?: number }[] = [
  { step: "Request to scheduled", sub: "Dispatch picks it up", days: 1.4 },
  { step: "Scheduled to on site", sub: "Waiting for the visit", days: 2.3 },
  { step: "On site to finished", sub: "Work on the job", days: 0.8 },
  { step: "Finished to invoiced", sub: "Pricing, review, send · goal 3 days", days: 18.2, goal: 3 },
  { step: "Invoiced to paid", sub: "Waiting on the customer", days: 21.5 },
];
const WAIT_SCALE = 25;

const ATTENTION: readonly { title: string; sub: string; tone: Tone | null; word: string }[] = [
  { title: "82 finished jobs are not invoiced yet", sub: "57 need pricing, 20 were kicked back, 5 are ready to send.", tone: "breached", word: "Costing money" },
  { title: "2 urgent jobs in Houston have no technician", sub: "Both asked for same-day service.", tone: "breached", word: "Urgent" },
  { title: "3 technician licenses expire within 30 days", sub: "They cannot be assigned once a license lapses.", tone: "at_risk", word: "Soon" },
  { title: "2 technicians will pass 40 hours by Wednesday", sub: "Overtime pay starts after that.", tone: "at_risk", word: "Soon" },
  { title: "1 new hire has not finished onboarding", sub: "Paperwork is still open for Oklahoma City.", tone: null, word: "Note" },
];

const WEEKS = ["Aug 24", "Aug 31", "Sep 7", "Sep 14", "Sep 21", "Sep 28", "Oct 5", "Oct 12"] as const;
const COMPLETED = [31, 34, 29, 36, 38, 35, 40, 42] as const;
const INVOICED = [27, 28, 22, 25, 24, 21, 22, 19] as const;

type Branch = { name: string; sub?: string; techs: number; utilization: number; unbilled: number; rating: number };
const BRANCHES: readonly Branch[] = [
  { name: "Dallas–Fort Worth", sub: "Headquarters", techs: 9, utilization: 79, unbilled: 41, rating: 4.8 },
  { name: "Houston", techs: 5, utilization: 71, unbilled: 29, rating: 4.6 },
  { name: "Oklahoma City", sub: "Opened in September", techs: 3, utilization: 52, unbilled: 12, rating: 4.5 },
];

type Person = { name: string; group: string; title: string; branch: string; today: string; hours: number | null; papers: { status: Status | null; word: string } };
const CURRENT = { status: "ok", word: "All current" } as const;
const TEAM: readonly Person[] = [
  { name: "Dylan Lemons", group: "Leadership", title: "Owner / Admin", branch: "Dallas–Fort Worth", today: "In the office", hours: 34.5, papers: CURRENT },
  { name: "Blake Keating", group: "Field", title: "Lead Technician", branch: "Dallas–Fort Worth", today: "On a job", hours: 36, papers: CURRENT },
  { name: "Brian Martinez", group: "Field", title: "Technician", branch: "Dallas–Fort Worth", today: "On a job", hours: 32, papers: { status: "at_risk", word: "License expires in 21 days" } },
  { name: "Colton Dawson", group: "Field", title: "Technician", branch: "Dallas–Fort Worth", today: "On a job", hours: 40.5, papers: CURRENT },
  { name: "Garrett Howard", group: "Leadership", title: "Owner / Admin", branch: "Houston", today: "In the office", hours: 28, papers: CURRENT },
  { name: "Herberto Vega", group: "Field", title: "Installer", branch: "Houston", today: "On a job", hours: 41, papers: CURRENT },
  { name: "Johnny Fuentez", group: "Field", title: "Apprentice / Helper", branch: "Houston", today: "Off today", hours: 24, papers: { status: null, word: "Training in progress" } },
  { name: "Rachel Ortiz", group: "Dispatch", title: "Dispatcher", branch: "Dallas–Fort Worth", today: "In the office", hours: 33, papers: CURRENT },
  { name: "Priya Nair", group: "Office", title: "Accounting", branch: "Dallas–Fort Worth", today: "In the office", hours: 35, papers: CURRENT },
  { name: "Tom Reyes", group: "Operations", title: "Operations Manager", branch: "Dallas–Fort Worth", today: "In the office", hours: 38, papers: CURRENT },
  { name: "Kayla Brooks", group: "Field", title: "Technician", branch: "Oklahoma City", today: "Onboarding", hours: null, papers: { status: "at_risk", word: "2 forms still open" } },
];
const TITLES = [...new Set(TEAM.map((p) => p.title))];

/** The team filter, per store: a name fragment and one title, or every title. */
const teamFilters = new WeakMap<Store, Signal<{ q: string; title: string | null }>>();
const teamFilterFor = (store: Store): Signal<{ q: string; title: string | null }> => {
  let f = teamFilters.get(store);
  if (!f) { f = signal<{ q: string; title: string | null }>({ q: "", title: null }); teamFilters.set(store, f); }
  return f;
};

export const teamRows = (q: string, title: string | null): Person[] =>
  TEAM.filter((p) => (!title || p.title === title) && p.name.toLowerCase().includes(q.trim().toLowerCase()));

const bar = (value: number, scale: number, over = false): VNode =>
  html`<span class="s3-mgr-bar" aria-hidden="true"><span class="s3-mgr-bar__fill" data-over=${over ? "true" : undefined} style=${`inline-size:${Math.min(100, (value / scale) * 100)}%`}></span></span>`;

const waitsPanel = (): VNode => panel(
  html`<ul class="s3-mgr-waits">${WAITS.map((w) => {
    const over = w.goal !== undefined && w.days > w.goal;
    return html`<li class="s3-mgr-wait">
      <span class="s3-mgr-wait__step"><strong>${w.step}</strong><small>${w.sub}</small></span>
      ${bar(w.days, WAIT_SCALE, over)}
      <span class="s3-mgr-wait__n s3-num" data-over=${over ? "true" : undefined}>${w.days.toFixed(1)} d${over ? html`<small>Over goal</small>` : null}</span>
    </li>`;
  })}</ul>`,
  "Where jobs wait", "Average days a job sits at each step. Work moves quickly until it is finished; the slowdown is getting it billed and paid.", undefined, "mgr-waits");

const attentionPanel = (): VNode => panel(
  html`<ul class="s3-mgr-attn">${ATTENTION.map((a) => html`<li class="s3-mgr-attn__item">
    ${a.tone ? StatusPill({ density: "console", status: a.tone, label: a.word }) : html`<span class="s3-flag">${a.word}</span>`}
    <span><strong>${a.title}</strong><small>${a.sub}</small></span>
  </li>`)}</ul>`,
  "Needs your attention", "The few things that will cost money or trust if nobody picks them up this week.", undefined, "mgr-attention");

/** Two series on one axis, told apart by line form (solid, dashed) and a direct label as well as ink. */
const trendChart = (): VNode => {
  const W = 640, H = 260, L = 36, R = 92, T = 12, B = 28, MAX = 50;
  const x = (i: number) => L + (i * (W - L - R)) / (WEEKS.length - 1);
  const y = (v: number) => T + (1 - v / MAX) * (H - T - B);
  const line = (vs: readonly number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = WEEKS.length - 1;
  const series = [
    { cls: "completed", name: "Completed", values: COMPLETED },
    { cls: "invoiced", name: "Invoiced", values: INVOICED },
  ] as const;
  return html`<figure class="s3-mgr-chart">
    <figcaption class="s3-mgr-legend">
      <span class="s3-mgr-legend__item" data-series="completed">Jobs completed</span>
      <span class="s3-mgr-legend__item" data-series="invoiced">Jobs invoiced</span>
    </figcaption>
    <svg class="s3-mgr-chart__svg" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Jobs completed and invoiced per week, ${WEEKS[0]} to ${WEEKS[last]}. The week of ${WEEKS[last]}: ${COMPLETED[last]} completed, ${INVOICED[last]} invoiced.`}>
      ${[0, 10, 20, 30, 40, 50].map((v) => html`<g><line class="s3-mgr-chart__grid" x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} /><text class="s3-mgr-chart__tick" x=${L - 8} y=${y(v) + 4} text-anchor="end">${v}</text></g>`)}
      ${WEEKS.map((w, i) => i % 2 === 0 || i === last ? html`<text class="s3-mgr-chart__tick" x=${x(i)} y=${H - 8} text-anchor="middle">${w}</text>` : null)}
      ${series.map((s) => html`<g class="s3-mgr-chart__series" data-series=${s.cls}>
        <path d=${line(s.values)} />
        ${s.values.map((v, i) => html`<circle cx=${x(i)} cy=${y(v)} r="4"><title>${`Week of ${WEEKS[i]}: ${v} ${s.name.toLowerCase()}`}</title></circle>`)}
        <text class="s3-mgr-chart__end" x=${x(last) + 10} y=${y(s.values[last]!) + 4}>${s.name} ${s.values[last]}</text>
      </g>`)}
    </svg>
  </figure>`;
};

const trendPanel = (): VNode => panel(trendChart(), "Completed vs. invoiced, by week", "When the two lines drift apart, finished work is piling up unbilled.", undefined, "mgr-trend");

const branchColumns: readonly Column<Branch>[] = [
  { key: "name", header: "Branch", cell: (b) => html`<span class="s3-cust"><strong>${b.name}</strong>${b.sub ? html`<small>${b.sub}</small>` : null}</span>` },
  { key: "techs", header: "Techs", numeric: true, align: "end", cell: (b) => b.techs },
  { key: "util", header: "Utilization", cell: (b) => html`<span class="s3-mgr-util">${bar(b.utilization, 100)}<span class="s3-num">${b.utilization}%</span></span>` },
  { key: "unbilled", header: "Unbilled", numeric: true, align: "end", cell: (b) => b.unbilled },
  { key: "rating", header: "Rating", numeric: true, align: "end", cell: (b) => b.rating.toFixed(1) },
];

const branchesPanel = (): VNode => panel(
  html`<div class="s3-grid-scroll">${DataGrid({ density: "console", columns: branchColumns, rows: BRANCHES, rowKey: (b: Branch) => b.name })}</div>`,
  "Branches", "The same health measures for each location, so a new state is easy to compare with home.", undefined, "mgr-branches");

const teamColumns: readonly Column<Person>[] = [
  { key: "name", header: "Employee", cell: (p) => html`<span class="s3-tech"><span class="dispatch-board__avatar" aria-hidden="true">${initials(p.name)}</span><span class="s3-cust"><strong>${p.name}</strong><small>${p.group}</small></span></span>` },
  { key: "title", header: "Title", cell: (p) => p.title },
  { key: "branch", header: "Branch", cell: (p) => p.branch },
  { key: "today", header: "Today", cell: (p) => html`<span class="s3-flag">${p.today}</span>` },
  { key: "hours", header: "Hours this week", numeric: true, align: "end", cell: (p) => p.hours === null ? html`<span class="s3-muted">—</span>` : p.hours.toFixed(1) },
  { key: "papers", header: "Licenses & paperwork", cell: (p) => p.papers.status ? StatusPill({ density: "console", status: p.papers.status, label: p.papers.word }) : html`<span class="s3-flag">${p.papers.word}</span>` },
];

export const manager: Screen = (ctx) => {
  const f = teamFilterFor(ctx.store);
  const rows = teamRows(f.value.q, f.value.title);
  return html`<section class="s3-mgr">
    ${pageHead("Manager Dashboard", "The health of the whole company on one page: how work flows from request to paid, where it gets stuck, how each branch is doing, and who is on the team.",
      html`<span class="s3-flag">Example figures · Oct 1–13</span>`)}
    <p class="s3-mgr-example s3-muted">Example numbers so the layout can be judged. In the real portal every figure comes from live jobs, invoices and timesheets.</p>
    ${statStrip(FIGURES.map((t) => ({ n: html`<span>${t.n}</span>`, label: t.label, sub: t.sub, ...(t.tone ? { tone: t.tone } : {}) })), "mgr-figures")}
    <div class="s3-mgr-pair">${waitsPanel()}${attentionPanel()}</div>
    <div class="s3-mgr-pair">${trendPanel()}${branchesPanel()}</div>
    ${panel(html`
      <div class="s3-chips" role="group" aria-label="Filter the team by title">
        <button type="button" class="ac-chip" aria-pressed=${f.value.title === null ? "true" : "false"} onClick=${() => { f.value = { ...f.value, title: null }; }}><span class="s3-num">${TEAM.length}</span> people</button>
        ${TITLES.map((t) => html`<button type="button" class="ac-chip" aria-pressed=${f.value.title === t ? "true" : "false"} onClick=${() => { f.value = { ...f.value, title: t }; }}><span class="s3-num">${TEAM.filter((p) => p.title === t).length}</span> ${t}</button>`)}
      </div>
      <div class="s3-grid-scroll">${DataGrid({ density: "console", columns: teamColumns, rows, rowKey: (p: Person) => p.name, emptyText: "Nobody on the team matches.", stack: true })}</div>`,
      "Team", "Everyone with access to the portal. A person's title decides which screens they can open.",
      html`<div class="s3-mgr-team-tools">
        <input class="ac-input" type="search" placeholder="Search by name" aria-label="Search the team by name" value=${f.value.q}
          onInput=${(e: Event) => { f.value = { ...f.value, q: (e.currentTarget as HTMLInputElement).value }; }} />
        <select class="ac-input" aria-label="Filter the team by title" onChange=${(e: Event) => { const v = (e.currentTarget as HTMLSelectElement).value; f.value = { ...f.value, title: v || null }; }}>
          <option value="" selected=${f.value.title === null}>All titles</option>
          ${TITLES.map((t) => html`<option value=${t} selected=${f.value.title === t}>${t}</option>`)}
        </select>
      </div>`, "mgr-team")}
  </section>`;
};
