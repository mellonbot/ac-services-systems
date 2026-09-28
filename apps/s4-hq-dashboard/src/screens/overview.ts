import { html, StatusPill, DataGrid, type VNode, type Status } from "../../../../packages/ui/src/index.ts";
import { HQ_AREAS, HQ_AREA_TITLES, type HqArea, type HqRegionWire } from "../../../../packages/contracts/src/index.ts";
import {
  whenReady, readMetrics, figures, metShare, clearedShare, count, pct, money, densityStatus, asOfLine, linkTo, regionName,
  type Screen, type ScreenContext, type Figures,
} from "./common.ts";

type Tile = { readonly label: string; readonly figure: string; readonly sub?: string; readonly state?: { status: Status; word: string } };

/** The company figure per area, summary before detail. A state pill appears only where the number is a state. */
export const headline = (f: Figures): Readonly<Record<HqArea, readonly Tile[]>> => {
  const atRisk = f.of("jobs_at_risk_now"), breached = f.of("sla_breached_30d"), disputed = f.of("settlements_disputed"), overdue = f.of("settlements_overdue");
  const unverified = f.of("credentials_unverified");
  return {
    service: [
      { label: "Answered in time, 30 days", figure: pct(metShare(f)), sub: `${count(f.of("sla_met_30d"))} of ${count(f.of("sla_closed_30d"))} response clocks` },
      { label: "Open jobs", figure: count(f.of("jobs_open_now")), sub: `${count(f.of("jobs_unassigned_now"))} unassigned` },
      { label: "At risk now", figure: count(atRisk), ...(atRisk > 0n ? { state: { status: "at_risk" as const, word: "At risk" } } : {}) },
      { label: "Breached, 30 days", figure: count(breached), ...(breached > 0n ? { state: { status: "breached" as const, word: "Breached" } } : {}) },
    ],
    money: [
      { label: "Invoiced, 30 days", figure: money(f.of("invoiced_minor_30d")) },
      { label: "Past due date", figure: money(f.of("invoices_past_due_minor")), sub: "payments not yet recorded" },
      { label: "Statements unpaid", figure: money(f.of("settlements_open_minor")), sub: `${count(overdue)} past the firm's terms`, ...(overdue > 0n ? { state: { status: "at_risk" as const, word: "Past terms" } } : {}) },
      { label: "Statements in dispute", figure: count(disputed), ...(disputed > 0n ? { state: { status: "at_risk" as const, word: "Needs an answer" } } : {}) },
    ],
    network: [
      { label: "Active crews", figure: count(f.of("crews_active")), sub: `${count(f.of("crews_subcontracted_active"))} subcontracted` },
      { label: "Cleared to dispatch today", figure: pct(clearedShare(f)), sub: `${count(f.of("crews_cleared_now"))} crews` },
      { label: "Awaiting verification", figure: count(unverified), ...(unverified > 0n ? { state: { status: "at_risk" as const, word: "Unverified" } } : {}) },
      { label: "Active firms", figure: count(f.of("firms_active")), sub: `${count(f.of("firms_onboarding"))} onboarding` },
    ],
    growth: [
      { label: "Leads, 30 days", figure: count(f.of("leads_30d")), sub: `${count(f.of("leads_web_form_30d"))} web form · ${count(f.of("leads_call_button_30d"))} call button · ${count(f.of("leads_referral_30d"))} referral` },
      { label: "Service requests, 30 days", figure: count(f.of("service_requests_30d")) },
      { label: "Customers", figure: count(f.of("customers_total")), sub: `${count(f.of("customers_new_total_30d"))} new in 30 days` },
      { label: "Sites", figure: count(f.of("sites_active")) },
    ],
  };
};

const tiles = (ctx: ScreenContext, list: readonly Tile[]): VNode => html`<dl class="s4-tiles">
  ${list.map((t) => html`<div class="s4-tile">
    <dt>${t.label}</dt>
    <dd><span class="s4-figure">${t.figure}</span>${t.state ? StatusPill({ density: ctx.density, status: t.state.status, label: t.state.word }) : null}</dd>
    ${t.sub ? html`<dd class="s4-sub">${t.sub}</dd>` : null}
  </div>`)}
</dl>`;

/** Regions side by side. Rows are what the gateway returned; nothing is filtered here. */
export const regionGrid = (ctx: ScreenContext, f: Figures): VNode => {
  const placed = f.regions.filter((r) => r.placed);
  const num = (s: string) => html`<span class="s4-num">${s}</span>`;
  return html`<div class="s4-scroll">${DataGrid<HqRegionWire>({
    density: ctx.density,
    caption: "By region",
    rowKey: (r) => r.id,
    rows: placed,
    emptyText: "No regions recorded.",
    columns: [
      { key: "name", header: "Region", cell: (r) => linkTo(ctx, "region", { regionId: r.id }, regionName(r)) },
      { key: "open", header: "Open jobs", numeric: true, align: "end", cell: (r) => num(count(f.of("jobs_open_now", r.id))) },
      { key: "risk", header: "At risk", numeric: true, align: "end", cell: (r) => { const n = f.of("jobs_at_risk_now", r.id); return n > 0n ? StatusPill({ density: ctx.density, status: "at_risk", label: count(n) }) : num("0"); } },
      { key: "met", header: "In time, 30 d", numeric: true, align: "end", cell: (r) => num(pct(metShare(f, r.id))) },
      { key: "invoiced", header: "Invoiced, 30 d", numeric: true, align: "end", cell: (r) => num(money(f.of("invoiced_minor_30d", r.id))) },
      { key: "crews", header: "Crews / rule", numeric: true, align: "end", cell: (r) => num(`${count(f.of("crews_active", r.id))} / ${count(f.of("min_crew_density", r.id))}`) },
      { key: "d14", header: "D14", cell: (r) => { const d = densityStatus(f, r.id); return d ? StatusPill({ density: ctx.density, status: d.status, label: d.word }) : html`<span class="s4-muted">—</span>`; } },
    ],
  })}</div>`;
};

export const overview: Screen = (ctx) => {
  const res = readMetrics(ctx);
  return html`<section class="s4-overview">
    ${whenReady(ctx, res.value, (out) => {
      const f = figures(out);
      const h = headline(f);
      return html`
        <div class="s4-head"><h1 class="s4-h1">Rankine Operating Company</h1>${asOfLine(ctx, out)}</div>
        ${out.day === null ? html`<p class="s4-empty">No figures yet. The worker computes them every ${out.refreshMinutes} minutes; the first run fills this page.</p>` : html`
          <div class="s4-areas">
            ${HQ_AREAS.map((a) => html`<section class="s4-area" id=${`area-${a}`}>
              <div class="s4-area__head"><h2 class="s4-h2">${HQ_AREA_TITLES[a]}</h2>${linkTo(ctx, "area", { area: a }, "By region")}</div>
              ${tiles(ctx, h[a])}
            </section>`)}
          </div>
          ${regionGrid(ctx, f)}`}
        <p class="s4-readonly">Read only. Nothing on this dashboard changes an operation; the regions run their own work in Service Manager and Dispatch.</p>`;
    }, () => ctx.store.invalidate("hq."))}
  </section>`;
};
