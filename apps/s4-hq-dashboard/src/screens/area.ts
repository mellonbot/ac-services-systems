import { html, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import { HQ_AREAS, HQ_AREA_TITLES, HQ_METRICS, HQ_METRIC_KEYS, HQ_COMPANY_ONLY, type HqArea, type HqMetricKey, type HqHistoryOutput, type HqRegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readMetrics, figures, show, asOfLine, linkTo, regionName, type Screen, type ScreenContext, type Figures } from "./common.ts";

export const metricsOf = (area: HqArea): readonly HqMetricKey[] => HQ_METRIC_KEYS.filter((k) => HQ_METRICS[k].area === area);

/** Leads have no region until worked, so only Growth shows the unplaced row. */
export const rowsFor = (area: HqArea, regions: readonly HqRegionWire[]): readonly HqRegionWire[] =>
  regions.filter((r) => r.placed || area === "growth");

const COMPANY: HqRegionWire = { id: "company", code: "ALL", name: "Company", active: true, placed: true };

const chosen = signal<Partial<Record<HqArea, HqMetricKey>>>({});

export const areaGrid = (ctx: ScreenContext, area: HqArea, f: Figures): VNode => {
  // A company-wide distinct figure has no per-region value to tabulate; it is on the trend and in the list below.
  const keys = metricsOf(area).filter((k) => !HQ_COMPANY_ONLY.includes(k));
  const rows = [...rowsFor(area, f.regions), COMPANY];
  return html`<div class="s4-scroll">${DataGrid<HqRegionWire>({
    density: ctx.density,
    caption: `${HQ_AREA_TITLES[area]} by region`,
    rowKey: (r) => r.id,
    rows,
    columns: [
      { key: "region", header: "Region", cell: (r) => (r.id === COMPANY.id ? html`<strong>Company</strong>` : linkTo(ctx, "region", { regionId: r.id }, regionName(r))) },
      ...keys.map((k) => ({
        key: k, header: HQ_METRICS[k].label, numeric: true, align: "end" as const,
        cell: (r: HqRegionWire) => {
          const v = show(k, r.id === COMPANY.id ? f.of(k) : f.of(k, r.id));
          return r.id === COMPANY.id ? html`<strong class="s4-num">${v}</strong>` : html`<span class="s4-num">${v}</span>`;
        },
      })),
    ],
  })}</div>`;
};

/** A day-by-day line, drawn to one scale from zero. The end point is marked and its value printed. */
export const sparkline = (points: readonly { day: string; value: bigint }[], label: string, metric: HqMetricKey): VNode => {
  const values = points.map((p) => Number(p.value));
  const max = Math.max(1, ...values);
  const x = (i: number) => (points.length <= 1 ? 100 : (i / (points.length - 1)) * 100);
  const y = (v: number) => 38 - (v / max) * 34;
  const line = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const last = points.at(-1);
  return html`<figure class="s4-trend">
    <h3><span>${label}</span><span class="s4-num">${last ? show(metric, last.value) : "—"}</span></h3>
    ${points.length === 0 ? html`<p class="s4-muted">No history yet.</p>` : html`
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label=${`${label}: ${points.length} days, latest ${last ? show(metric, last.value) : "none"}`}>
      <line class="s4-trend__grid" x1="0" y1="38" x2="100" y2="38" vector-effect="non-scaling-stroke" />
      <polygon class="s4-trend__area" points=${`0,38 ${line} ${x(points.length - 1).toFixed(2)},38`} />
      <polyline class="s4-trend__line" points=${line} vector-effect="non-scaling-stroke" />
      <circle class="s4-trend__end" cx=${x(points.length - 1)} cy=${y(values.at(-1) ?? 0)} r="1.6" />
    </svg>
    <figcaption class="s4-sub">${points[0]!.day} → ${last!.day}</figcaption>`}
  </figure>`;
};

/** History → one series per region plus the company sum per day. */
export const series = (out: HqHistoryOutput, regions: readonly HqRegionWire[]): { id: string; label: string; points: { day: string; value: bigint }[] }[] => {
  const days = [...new Set(out.points.map((p) => p.day))].sort();
  const at = new Map(out.points.map((p) => [`${p.day}|${p.regionId}`, BigInt(p.value)]));
  const per = regions.map((r) => ({ id: r.id, label: regionName(r), points: days.filter((d) => at.has(`${d}|${r.id}`)).map((d) => ({ day: d, value: at.get(`${d}|${r.id}`)! })) }));
  const total = { id: "company", label: "Company", points: days.map((d) => ({ day: d, value: regions.reduce((s, r) => s + (at.get(`${d}|${r.id}`) ?? 0n), 0n) })) };
  return [total, ...per];
};

export const area: Screen = (ctx, params) => {
  const a = params["area"] as HqArea;
  if (!(HQ_AREAS as readonly string[]).includes(a)) return html`<p class="s4-empty">No area "${params["area"]}". ${linkTo(ctx, "overview", {}, "Back to the company view")}</p>`;
  const keys = metricsOf(a);
  const metric = chosen.value[a] ?? keys[0]!;
  const res = readMetrics(ctx);
  const hist = ctx.store.read(keyOf("hq.history", { metric, days: 30 }), () => ctx.shell.gateway.hqHistory({ metric, days: 30 }));
  return html`<section class="s4-area-screen">
    <nav class="s4-asof" aria-label="Areas">${linkTo(ctx, "overview", {}, "Company")} <span aria-hidden="true">›</span>
      ${HQ_AREAS.map((x) => (x === a ? html`<strong>${HQ_AREA_TITLES[x]}</strong>` : linkTo(ctx, "area", { area: x }, HQ_AREA_TITLES[x])))}</nav>
    ${whenReady(ctx, res.value, (out) => {
      const f = figures(out);
      const regions = rowsFor(a, f.regions);
      return html`
        <div class="s4-head"><h1 class="s4-h1">${HQ_AREA_TITLES[a]}</h1>${asOfLine(ctx, out)}</div>
        ${areaGrid(ctx, a, f)}
        <h2 class="s4-h2">Trend, last 30 days</h2>
        <div class="s4-metrics" role="group" aria-label="Figure to chart">
          ${keys.map((k) => html`<button type="button" class="s4-metric" aria-pressed=${k === metric ? "true" : "false"} onClick=${() => { chosen.value = { ...chosen.value, [a]: k }; }}>${HQ_METRICS[k].label}</button>`)}
        </div>
        ${whenReady(ctx, hist.value, (h) => html`<div class="s4-trends" id="trends">
          ${series(h, regions).map((s) => sparkline(s.points, s.label, metric))}
        </div>`, () => ctx.store.invalidate("hq.history"))}
        <h2 class="s4-h2">What each figure means</h2>
        <ul class="s4-means">${keys.map((k) => html`<li><b>${HQ_METRICS[k].label}</b> (${HQ_METRICS[k].window === "30d" ? "30 days" : "now"}) — ${HQ_METRICS[k].means}</li>`)}</ul>`;
    }, () => ctx.store.invalidate("hq."))}
  </section>`;
};
