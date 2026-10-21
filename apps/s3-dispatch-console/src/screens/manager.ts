import { html, signal, DataGrid, StatusPill, pageHead, statStrip, panel, type Column, type Signal, type VNode, type StatTile } from "../../../../packages/ui/src/index.ts";
import { ROLES, type ManagerOverviewOutput, type ManagerWaitStep, type CredentialStanding } from "../../../../packages/contracts/src/index.ts";
import { keyOf, type Store } from "../state.ts";
import { whenReady, type Screen } from "./common.ts";
import { initials } from "./jobs.ts";

/**
 * THE MANAGER DASHBOARD — the company on one page: how work flows from
 * request to invoiced, where it waits, how each branch is doing, who is on
 * the team. Every figure is `manager.overview`, read live; the gateway serves
 * it to leadership at company scope only (seesManagerOverview), and the tab
 * is hidden from anyone it would refuse.
 *
 * Money is QuickBooks Online's, the ledger of record, through the worker's
 * mirror (0018): billed, collected and invoiced → paid. Until the mirror has
 * synced, those say "QuickBooks not connected" rather than $0.
 *
 * Not drawn, because nothing records them yet: customer rating (no reviews),
 * onboarding paperwork.
 * Utilization is labour hours over 40 per technician-week, said on the tile:
 * there is no record of paid hours to divide by.
 */
type Overview = ManagerOverviewOutput;
type Person = Overview["team"][number];
type Branch = Overview["branches"][number];

const HOURS_PER_TECH_WEEK = 40;

const WAIT_STEPS: Readonly<Record<ManagerWaitStep, { step: string; sub: string; goal?: number }>> = {
  request_to_scheduled: { step: "Request to scheduled", sub: "Dispatch picks it up · goal 2 days", goal: 2 },
  scheduled_to_on_site: { step: "Scheduled to on site", sub: "Waiting for the visit" },
  on_site_to_finished: { step: "On site to finished", sub: "Work on the job" },
  finished_to_invoiced: { step: "Finished to invoiced", sub: "Pricing, review, send · goal 3 days", goal: 3 },
  invoiced_to_paid: { step: "Invoiced to paid", sub: "Waiting on the customer · from QuickBooks" },
};

const ROLE_TITLE: Readonly<Record<string, string>> = {
  principal: "Owner / Principal", ops_leadership: "Operations leadership", account_owner: "Account owner", office_manager: "Office manager",
  dispatcher: "Dispatcher", foreman: "Foreman", technician: "Technician", warehouse: "Warehouse", finance: "Finance", readonly: "Read-only",
};
/** A person's title is their most senior role, in the order ROLES lists them. */
export const titleOf = (roles: readonly string[]): string => {
  const top = ROLES.find((r) => roles.includes(r));
  return top ? ROLE_TITLE[top]! : roles[0] ?? "—";
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const days = (d: number) => `${d.toFixed(1)} days`;
const pct = (num: number, den: number) => `${Math.round((num / den) * 100)}%`;
const money = (minor: string, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(minor) / 100);

const waitOf = (o: Overview, s: ManagerWaitStep) => o.waits.find((w) => w.step === s) ?? { step: s, avgDays: null, jobs: 0 };

/** A step against its goal: on target, or over — the only two figures here that are states. */
const goalTile = (o: Overview, s: ManagerWaitStep, label: string, overTone: "at_risk" | "breached", overWord: string): StatTile => {
  const w = waitOf(o, s), goal = WAIT_STEPS[s].goal!;
  if (w.avgDays === null) return { n: "—", label, sub: `No job made this step in 30 days · goal ${goal} days` };
  const over = w.avgDays > goal;
  return { n: days(w.avgDays), label, sub: `${over ? overWord : "On target"} · goal ${goal} days`, tone: over ? overTone : "ok" };
};

const sameCurrency = (a: Overview["billed"], currency: string) => a.find((x) => x.currency === currency);
const total = (a: Overview["billed"]) => a.length ? a.map((b) => money(b.minor, b.currency)).join(" · ") : money("0", "USD");
const vsLastMonth = (now: string, prior: string, nothing: string) =>
  Number(prior) > 0 ? `${signed(Math.round(((Number(now) - Number(prior)) / Number(prior)) * 100))}% vs. same point last month` : nothing;

export const figures = (o: Overview): StatTile[] => {
  const ledger = (label: string, tile: () => StatTile): StatTile =>
    o.ledgerSyncedAt ? tile() : { n: "—", label, sub: "QuickBooks not connected" };
  return [
    ledger("Billed this month", () => {
      const b = o.billed[0];
      return { n: total(o.billed), label: "Billed this month", sub: b ? vsLastMonth(b.minor, b.priorMinor, "Nothing invoiced by this point last month") : "Nothing invoiced yet this month" };
    }),
    ledger("Cash collected", () => {
      const c = o.collected[0], b = c && sameCurrency(o.billed, c.currency);
      return { n: total(o.collected), label: "Cash collected", sub: !c ? "Nothing collected yet this month" : b && Number(b.minor) > 0 ? `${pct(Number(c.minor), Number(b.minor))} of what was billed` : "Nothing billed yet this month" };
    }),
    { n: String(o.completed.now), label: "Jobs completed", sub: `${signed(o.completed.now - o.completed.prior)} vs. same point last month` },
    { n: o.completed.now ? pct(o.fixedFirstVisit, o.completed.now) : "—", label: "Fixed on first visit", sub: `${o.fixedFirstVisit} of ${o.completed.now} completed this month` },
    goalTile(o, "request_to_scheduled", "Request to scheduled", "at_risk", "Over goal"),
    goalTile(o, "finished_to_invoiced", "Finished to invoiced", "breached", "Slow"),
    { n: o.labor.techs ? pct(o.labor.hours, o.labor.techs * HOURS_PER_TECH_WEEK) : "—", label: "Technician utilization", sub: `Labour hours ÷ ${HOURS_PER_TECH_WEEK} h per technician, last 7 days` },
  ];
};

export type AttentionItem = { title: string; sub: string; tone: "breached" | "at_risk"; word: string };
/** What will cost money or trust this week, from the figures; nothing is listed at zero. */
export const attention = (o: Overview): AttentionItem[] => {
  const items: AttentionItem[] = [];
  const u = o.unbilled;
  const unbilled = u.complete + u.needsPricing + u.awaitingPo + u.awaitingPictures + u.invoiceTrouble;
  if (unbilled) {
    const parts = [[u.needsPricing, "need pricing"], [u.invoiceTrouble, "were kicked back"], [u.awaitingPo, "wait on a PO"], [u.awaitingPictures, "wait on pictures"], [u.complete, "are ready to send"]] as const;
    items.push({ title: `${unbilled} finished ${unbilled === 1 ? "job is" : "jobs are"} not invoiced yet`, sub: `${parts.filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(", ")}.`, tone: "breached", word: "Costing money" });
  }
  for (const r of o.urgentUnassigned) {
    const where = o.branches.find((b) => b.regionId === r.regionId)?.name ?? "an unplaced region";
    items.push({ title: `${r.count} urgent ${r.count === 1 ? "job" : "jobs"} in ${where} ${r.count === 1 ? "has" : "have"} no technician`, sub: "Emergency or urgent priority, not yet dispatched.", tone: "breached", word: "Urgent" });
  }
  if (o.credentials.expired) items.push({ title: `${o.credentials.expired} ${o.credentials.expired === 1 ? "crew has" : "crews have"} a lapsed credential`, sub: "They cannot be assigned until it is renewed.", tone: "breached", word: "Lapsed" });
  if (o.credentials.expiring) items.push({ title: `${o.credentials.expiring} ${o.credentials.expiring === 1 ? "crew's credential expires" : "crews' credentials expire"} within 30 days`, sub: "They cannot be assigned once a credential lapses.", tone: "at_risk", word: "Soon" });
  if (o.nearOvertime) items.push({ title: `${o.nearOvertime} ${o.nearOvertime === 1 ? "technician is" : "technicians are"} at 36 hours or more this week`, sub: "Overtime pay starts at 40.", tone: "at_risk", word: "Soon" });
  return items;
};

/** The team filter, per store: a name fragment and one title, or every title. */
const teamFilters = new WeakMap<Store, Signal<{ q: string; title: string | null }>>();
const teamFilterFor = (store: Store): Signal<{ q: string; title: string | null }> => {
  let f = teamFilters.get(store);
  if (!f) { f = signal<{ q: string; title: string | null }>({ q: "", title: null }); teamFilters.set(store, f); }
  return f;
};

export const teamRows = (team: readonly Person[], q: string, title: string | null): Person[] =>
  team.filter((p) => (!title || titleOf(p.roles) === title) && p.name.toLowerCase().includes(q.trim().toLowerCase()));

const bar = (value: number, scale: number, over = false): VNode =>
  html`<span class="s3-mgr-bar" aria-hidden="true"><span class="s3-mgr-bar__fill" data-over=${over ? "true" : undefined} style=${`inline-size:${Math.min(100, (value / scale) * 100)}%`}></span></span>`;

const waitsPanel = (o: Overview): VNode => {
  const scale = Math.max(1, ...o.waits.map((w) => Math.max(w.avgDays ?? 0, WAIT_STEPS[w.step].goal ?? 0))) * 1.15;
  return panel(
    html`<ul class="s3-mgr-waits">${o.waits.map((w) => {
      const meta = WAIT_STEPS[w.step];
      const over = meta.goal !== undefined && w.avgDays !== null && w.avgDays > meta.goal;
      return html`<li class="s3-mgr-wait">
        <span class="s3-mgr-wait__step"><strong>${meta.step}</strong><small>${meta.sub}</small></span>
        ${bar(w.avgDays ?? 0, scale, over)}
        <span class="s3-mgr-wait__n s3-num" data-over=${over ? "true" : undefined}>${w.avgDays === null ? "—" : `${w.avgDays.toFixed(1)} d`}${over ? html`<small>Over goal</small>` : html`<small>${w.jobs} ${w.jobs === 1 ? "job" : "jobs"}</small>`}</span>
      </li>`;
    })}</ul>`,
    "Where jobs wait", "Average days at each step, for the jobs that finished it in the last 30 days.", undefined, "mgr-waits");
};

const attentionPanel = (o: Overview): VNode => {
  const items = attention(o);
  return panel(
    items.length
      ? html`<ul class="s3-mgr-attn">${items.map((a) => html`<li class="s3-mgr-attn__item">
          ${StatusPill({ density: "console", status: a.tone, label: a.word })}
          <span><strong>${a.title}</strong><small>${a.sub}</small></span>
        </li>`)}</ul>`
      : html`<p class="s3-muted">Nothing unbilled, unassigned, lapsing or near overtime.</p>`,
    "Needs your attention", "The few things that will cost money or trust if nobody picks them up this week.", undefined, "mgr-attention");
};

const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Two series on one axis, told apart by line form (solid, dashed) and a direct label as well as ink. */
const trendChart = (weeks: Overview["weeks"]): VNode => {
  if (!weeks.length) return html`<p class="s3-muted">No weeks to draw yet.</p>`;
  const W = 640, H = 260, L = 36, R = 92, T = 12, B = 28;
  const MAX = Math.max(10, Math.ceil(Math.max(...weeks.flatMap((w) => [w.completed, w.invoiced])) / 10) * 10);
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((MAX / 5) * i));
  const x = (i: number) => L + (weeks.length === 1 ? 0 : (i * (W - L - R)) / (weeks.length - 1));
  const y = (v: number) => T + (1 - v / MAX) * (H - T - B);
  const line = (vs: readonly number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = weeks.length - 1;
  const series = [
    { cls: "completed", name: "Completed", values: weeks.map((w) => w.completed) },
    { cls: "invoiced", name: "Invoiced", values: weeks.map((w) => w.invoiced) },
  ];
  return html`<figure class="s3-mgr-chart">
    <figcaption class="s3-mgr-legend">
      <span class="s3-mgr-legend__item" data-series="completed">Jobs completed</span>
      <span class="s3-mgr-legend__item" data-series="invoiced">Jobs invoiced</span>
    </figcaption>
    <svg class="s3-mgr-chart__svg" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`Jobs completed and invoiced per week, week of ${weekLabel(weeks[0]!.weekStart)} to week of ${weekLabel(weeks[last]!.weekStart)}. This week: ${weeks[last]!.completed} completed, ${weeks[last]!.invoiced} invoiced.`}>
      ${ticks.map((v) => html`<g><line class="s3-mgr-chart__grid" x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} /><text class="s3-mgr-chart__tick" x=${L - 8} y=${y(v) + 4} text-anchor="end">${v}</text></g>`)}
      ${weeks.map((w, i) => i % 2 === 0 || i === last ? html`<text class="s3-mgr-chart__tick" x=${x(i)} y=${H - 8} text-anchor="middle">${weekLabel(w.weekStart)}</text>` : null)}
      ${series.map((s) => html`<g class="s3-mgr-chart__series" data-series=${s.cls}>
        <path d=${line(s.values)} />
        ${s.values.map((v, i) => html`<circle cx=${x(i)} cy=${y(v)} r="4"><title>${`Week of ${weekLabel(weeks[i]!.weekStart)}: ${v} ${s.name.toLowerCase()}`}</title></circle>`)}
        <text class="s3-mgr-chart__end" x=${x(last) + 10} y=${y(s.values[last]!) + 4}>${s.name} ${s.values[last]}</text>
      </g>`)}
    </svg>
  </figure>`;
};

const branchColumns: readonly Column<Branch>[] = [
  { key: "name", header: "Branch", cell: (b) => html`<strong>${b.name}</strong>` },
  { key: "techs", header: "Techs", numeric: true, align: "end", cell: (b) => b.techs },
  { key: "util", header: "Utilization", cell: (b) => b.techs
    ? html`<span class="s3-mgr-util">${bar(b.laborHours, b.techs * HOURS_PER_TECH_WEEK)}<span class="s3-num">${pct(b.laborHours, b.techs * HOURS_PER_TECH_WEEK)}</span></span>`
    : html`<span class="s3-muted">No technicians</span>` },
  { key: "unbilled", header: "Unbilled", numeric: true, align: "end", cell: (b) => b.unbilled },
];

const CREDENTIAL_WORD: Readonly<Record<CredentialStanding, string>> = { ok: "All current", at_risk: "Expires within 30 days", breached: "Lapsed" };

const teamColumns: readonly Column<Person>[] = [
  { key: "name", header: "Employee", cell: (p) => html`<span class="s3-tech"><span class="dispatch-board__avatar" aria-hidden="true">${initials(p.name)}</span>${p.name}</span>` },
  { key: "title", header: "Title", cell: (p) => titleOf(p.roles) },
  { key: "branch", header: "Branch", cell: (p) => p.branch },
  { key: "today", header: "Today", cell: (p) => p.onJob ? html`<span class="s3-flag">On a job</span>` : html`<span class="s3-muted">—</span>` },
  { key: "hours", header: "Hours this week", numeric: true, align: "end", cell: (p) => p.hoursThisWeek === null ? html`<span class="s3-muted">—</span>` : p.hoursThisWeek.toFixed(1) },
  { key: "credential", header: "Credentials", cell: (p) => p.credential ? StatusPill({ density: "console", status: p.credential, label: CREDENTIAL_WORD[p.credential] }) : html`<span class="s3-muted">—</span>` },
];

const teamPanel = (store: Store, team: readonly Person[]): VNode => {
  const f = teamFilterFor(store);
  const titles = [...new Set(team.map((p) => titleOf(p.roles)))];
  return panel(html`
    <div class="s3-chips" role="group" aria-label="Filter the team by title">
      <button type="button" class="ac-chip" aria-pressed=${f.value.title === null ? "true" : "false"} onClick=${() => { f.value = { ...f.value, title: null }; }}><span class="s3-num">${team.length}</span> people</button>
      ${titles.map((t) => html`<button type="button" class="ac-chip" aria-pressed=${f.value.title === t ? "true" : "false"} onClick=${() => { f.value = { ...f.value, title: t }; }}><span class="s3-num">${team.filter((p) => titleOf(p.roles) === t).length}</span> ${t}</button>`)}
    </div>
    <div class="s3-grid-scroll">${DataGrid({ density: "console", columns: teamColumns, rows: teamRows(team, f.value.q, f.value.title), rowKey: (p: Person) => p.userId, emptyText: "Nobody on the team matches.", stack: true })}</div>`,
    "Team", "Everyone with an office login. A person's title is their most senior role, and decides which screens they can open.",
    html`<div class="s3-mgr-team-tools">
      <input class="ac-input" type="search" placeholder="Search by name" aria-label="Search the team by name" value=${f.value.q}
        onInput=${(e: Event) => { f.value = { ...f.value, q: (e.currentTarget as HTMLInputElement).value }; }} />
      <select class="ac-input" aria-label="Filter the team by title" onChange=${(e: Event) => { const v = (e.currentTarget as HTMLSelectElement).value; f.value = { ...f.value, title: v || null }; }}>
        <option value="" selected=${f.value.title === null}>All titles</option>
        ${titles.map((t) => html`<option value=${t} selected=${f.value.title === t}>${t}</option>`)}
      </select>
    </div>`, "mgr-team");
};

export const manager: Screen = (ctx) => {
  const overview = ctx.store.read(keyOf("manager.overview", {}), () => ctx.shell.gateway.managerOverview());
  return html`<section class="s3-mgr">
    ${pageHead("Manager Dashboard", "The health of the whole company on one page: how work flows from request to paid, where it gets stuck, how each branch is doing, and who is on the team.")}
    ${whenReady(ctx, overview.value, (o) => html`
      <p class="s3-mgr-example s3-muted">As of ${new Date(o.asOf).toLocaleString()}. ${o.ledgerSyncedAt ? `QuickBooks last synced ${new Date(o.ledgerSyncedAt).toLocaleString()}.` : "QuickBooks is not connected: billed, collected and invoiced → paid are unknown."} Months and weeks run in UTC; weeks start Monday.</p>
      ${statStrip(figures(o), "mgr-figures")}
      <div class="s3-mgr-pair">${waitsPanel(o)}${attentionPanel(o)}</div>
      <div class="s3-mgr-pair">
        ${panel(trendChart(o.weeks), "Completed vs. invoiced, by week", "When the two lines drift apart, finished work is piling up unbilled.", undefined, "mgr-trend")}
        ${panel(html`<div class="s3-grid-scroll">${DataGrid({ density: "console", columns: branchColumns, rows: o.branches, rowKey: (b: Branch) => b.regionId, emptyText: "No branches yet." })}</div>`,
          "Branches", "The same health measures for each region, so a new one is easy to compare with home.", undefined, "mgr-branches")}
      </div>
      ${teamPanel(ctx.store, o.team)}`)}
  </section>`;
};
