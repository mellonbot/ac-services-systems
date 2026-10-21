import { html, StatusPill, pageHead, panel, statStrip } from "../../../../packages/ui/src/index.ts";
import { HQ_AREAS, HQ_AREA_TITLES, HQ_METRICS, HQ_COMPANY_ONLY } from "../../../../packages/contracts/src/index.ts";
import { whenReady, readMetrics, figures, show, asOfLine, linkTo, regionName, densityStatus, metShare, pct, type Screen } from "./common.ts";
import { metricsOf } from "./area.ts";

/** One region, every figure, grouped by area. */
export const region: Screen = (ctx, params) => {
  const res = readMetrics(ctx);
  const id = params["regionId"] ?? "";
  return html`<section class="s4-region">
    ${whenReady(ctx, res.value, (out) => {
      const f = figures(out);
      const r = f.regions.find((x) => x.id === id);
      if (!r) return html`<p class="s4-empty">No region ${id} in the rollup. ${linkTo(ctx, "overview", {}, "Back to the company view")}</p>`;
      const d = densityStatus(f, r.id);
      return html`
        <nav class="s4-asof" aria-label="Breadcrumb">${linkTo(ctx, "overview", {}, "Company")} <span aria-hidden="true">›</span> <strong>${regionName(r)}</strong></nav>
        ${pageHead(html`${regionName(r)} <span class="s4-muted">${r.code}</span>`, "Every figure for this one region, grouped by area.", asOfLine(ctx, out))}
        <p class="s4-asof">
          ${d ? StatusPill({ density: ctx.density, status: d.status, label: d.word }) : null}
          <span>Answered in time over 30 days: <b class="s4-num">${pct(metShare(f, r.id))}</b></span>
          ${r.active ? null : html`<span>· this region is not active</span>`}
        </p>
        <div class="s4-areas">
          ${HQ_AREAS.map((a) => panel(statStrip(metricsOf(a).filter((k) => !r.placed || !HQ_COMPANY_ONLY.includes(k)).map((k) => ({
            n: show(k, f.of(k, r.id)),
            label: `${HQ_METRICS[k].label}${HQ_METRICS[k].window === "30d" ? ", 30 d" : ""}`,
          }))), HQ_AREA_TITLES[a], undefined, linkTo(ctx, "area", { area: a }, "Compare regions")))}
        </div>`;
    }, () => ctx.store.invalidate("hq."))}
  </section>`;
};
