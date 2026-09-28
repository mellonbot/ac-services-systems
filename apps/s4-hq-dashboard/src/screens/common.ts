import { html, refusalHeading, StatusPill, type VNode, type Router, type Status } from "../../../../packages/ui/src/index.ts";
import type { Shell } from "../../../../packages/shell/src/index.ts";
import { HQ_METRICS, type DensityOf, type HqMetricKey, type HqMetricsOutput, type HqRegionWire } from "../../../../packages/contracts/src/index.ts";
import type { Store, Resource } from "../state.ts";
import { keyOf } from "../state.ts";
import type { SCREENS } from "../screens.ts";

export type ScreenContext = {
  readonly shell: Shell;
  readonly store: Store;
  readonly router: Router<typeof SCREENS>;
  readonly density: DensityOf<"S4">;
  readonly degraded: boolean;
  readonly now: () => number;
};

export type Params = Readonly<Record<string, string>>;
export type Screen = (ctx: ScreenContext, params: Params) => VNode;

export const whenReady = <T>(ctx: ScreenContext, r: Resource<T>, view: (v: T) => VNode, retry?: () => void): VNode => {
  switch (r.state) {
    case "loading": return html`<p class="s4-loading" role="status">Loading…</p>`;
    case "ready": return view(r.value);
    case "refused": return html`<section class="s4-refusal" role="alert" data-kind=${r.refusal.kind} data-density=${ctx.density}>
      <h2 class="s4-refusal__heading">${refusalHeading(r.refusal)}</h2>
      <p class="s4-refusal__message">${r.refusal.message}</p>
      ${retry ? html`<button type="button" class="ac-action" data-kind="primary" data-density=${ctx.density} onClick=${retry}>Try again</button>` : null}
    </section>`;
  }
};

export const linkTo = (ctx: ScreenContext, screen: keyof typeof SCREENS, params: Params, label: string, cls = "s4-link"): VNode =>
  html`<a class=${cls} href=${ctx.router.href(screen, params)} onClick=${(e: Event) => { e.preventDefault(); ctx.router.navigate(screen, params); }}>${label}</a>`;

export const readMetrics = (ctx: ScreenContext) =>
  ctx.store.read(keyOf("hq.metrics", {}), () => ctx.shell.gateway.hqMetrics({}));

// ---------------------------------------------------------------------------
// The figures. Every value in the register is additive across regions, so a
// company figure is a sum of region rows; a rate is two sums divided here.
// ---------------------------------------------------------------------------
export type Figures = {
  readonly regions: readonly HqRegionWire[];
  /** region id → metric → value */
  readonly byRegion: ReadonlyMap<string, ReadonlyMap<string, bigint>>;
  readonly of: (metric: HqMetricKey, regionId?: string) => bigint;
};

export const figures = (out: HqMetricsOutput): Figures => {
  const byRegion = new Map<string, Map<string, bigint>>();
  for (const v of out.values) {
    const m = byRegion.get(v.regionId) ?? new Map<string, bigint>();
    m.set(v.metric, BigInt(v.value));
    byRegion.set(v.regionId, m);
  }
  const of = (metric: HqMetricKey, regionId?: string): bigint => {
    if (regionId) return byRegion.get(regionId)?.get(metric) ?? 0n;
    let t = 0n;
    for (const m of byRegion.values()) t += m.get(metric) ?? 0n;
    return t;
  };
  return { regions: out.regions, byRegion, of };
};

/** SLA met as a share of clocks closed. Null when nothing closed — "no data" is not 0%. */
export const metShare = (f: Figures, regionId?: string): number | null => {
  const closed = f.of("sla_closed_30d", regionId);
  return closed === 0n ? null : Number((f.of("sla_met_30d", regionId) * 1000n) / closed) / 10;
};
export const clearedShare = (f: Figures, regionId?: string): number | null => {
  const crews = f.of("crews_active", regionId);
  return crews === 0n ? null : Number((f.of("crews_cleared_now", regionId) * 1000n) / crews) / 10;
};

export const count = (n: bigint): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const pct = (p: number | null): string => (p === null ? "—" : `${p.toFixed(1)}%`);

/** Minor units → whole dollars, grouped. Money is summed as integers and only divided for display. */
export const money = (minor: bigint, currency = "USD"): string => {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = (abs + 50n) / 100n;
  return `${neg ? "−" : ""}${count(whole)} ${currency}`;
};

export const show = (metric: HqMetricKey, v: bigint): string => (HQ_METRICS[metric].unit === "minor" ? money(v) : count(v));

/** A region at or above its D14 density rule, or not. Null for a region with no rule and no crews. */
export const densityStatus = (f: Figures, regionId: string): { status: Status; word: string } | null => {
  const rule = f.of("min_crew_density", regionId), crews = f.of("crews_active", regionId);
  if (rule === 0n && crews === 0n) return null;
  return crews >= rule ? { status: "ok", word: "Meets density" } : { status: "at_risk", word: "Below density" };
};

/** The one thing S4's degraded line promises: how old the figures are. */
export const freshness = (out: Pick<HqMetricsOutput, "asOf" | "refreshMinutes">, now: number): { status: Status; word: string; age: string } => {
  if (!out.asOf) return { status: "blocked", word: "No rollup yet", age: "the worker has not computed any figures" };
  const mins = Math.max(0, Math.round((now - Date.parse(out.asOf)) / 60_000));
  const age = mins < 1 ? "just now" : mins < 120 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return mins <= out.refreshMinutes * 2 ? { status: "ok", word: "Current", age } : { status: "at_risk", word: "Stale", age };
};

export const asOfLine = (ctx: ScreenContext, out: HqMetricsOutput): VNode => {
  const f = freshness(out, ctx.now());
  return html`<p class="s4-asof" id="as-of">
    ${StatusPill({ density: ctx.density, status: f.status, label: f.word }) ?? html``}
    <span>${out.asOf ? html`Figures as of <time datetime=${out.asOf}>${new Date(out.asOf).toLocaleString()}</time> · ${f.age} · refreshed every ${out.refreshMinutes} min` : f.age}</span>
  </p>`;
};

export const regionName = (r: HqRegionWire): string => (r.placed ? r.name : "Not yet placed");
