import { html, signal, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { FirmWire, FirmStatus, CrewWire, CrewDocumentSummary, RegionWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * C4 — the network. Left: every subcontractor firm, where it stands on the
 * ladder, how many crews it fields. Right: the selected firm — its terms, its
 * ladder steps, its crews with what the gate would say about each one today,
 * and the way to its documents and its price. With no firm selected, the right
 * side is OUR crews: the employed ones, which have no firm to sit under.
 *
 * Two things are rendered deliberately as something other than a StatusPill:
 *
 *   Firm status — onboarding / active / suspended / terminated is a FILING
 *   state, like a contract's. The status register's four words are about
 *   operational health, and a suspended firm is not "at risk"; it is
 *   suspended. Same mark the agreements list uses (`s2-state`).
 *
 *   Documents — the gate's question asked of today IS a health fact, so it IS
 *   a pill: ok when every required kind is verified and in window; at risk
 *   when something is on file but unverified or expires within thirty days;
 *   blocked when a required kind is missing or has expired. The words beside
 *   the pill say which kinds, because a dispatcher reading "blocked" needs
 *   the next sentence to be "license" and not a click.
 */
export const STATUS_TONE: Readonly<Record<FirmStatus, "pending" | "live" | "held" | "ended">> = Object.freeze({
  onboarding: "pending", active: "live", suspended: "held", terminated: "ended",
});

/** The ladder as the screen offers it — the same edges the handler holds, so the UI offers no step that would be refused. */
export const NEXT_FIRM: Readonly<Record<FirmStatus, readonly Exclude<FirmStatus, "onboarding">[]>> = Object.freeze({
  onboarding: ["active", "terminated"], active: ["suspended", "terminated"], suspended: ["active", "terminated"], terminated: [],
});
const STEP_LABEL: Readonly<Record<Exclude<FirmStatus, "onboarding">, string>> = Object.freeze({ active: "Activate", suspended: "Suspend", terminated: "Terminate" });

/** Thirty days: the same horizon the worker's expiry sweep emits `credential.expiring` at. */
export const EXPIRING_WITHIN_DAYS = 30;

/** The register's kinds are snake_case on the wire; a person reads words. One place, so the pill and the chips beside it never disagree. */
export const readableKinds = (kinds: readonly string[]): string => kinds.map((k) => k.replace(/_/g, " ")).join(", ");

export const documentStatus = (d: CrewDocumentSummary, today: string): { status: "ok" | "at_risk" | "blocked"; label: string } => {
  if (d.missing.length) return { status: "blocked", label: `missing ${readableKinds(d.missing)}` };
  if (d.expired.length) return { status: "blocked", label: `expired ${readableKinds(d.expired)}` };
  if (d.unverified.length) return { status: "at_risk", label: `unverified ${readableKinds(d.unverified)}` };
  if (d.earliestExpiry && daysBetween(today, d.earliestExpiry) <= EXPIRING_WITHIN_DAYS) return { status: "at_risk", label: `expires ${d.earliestExpiry}` };
  return { status: "ok", label: d.earliestExpiry ? `cleared to ${d.earliestExpiry}` : "cleared" };
};
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: string }>({ refusal: null, busy: "" });

export const network: Screen = (ctx, params) => {
  const { store, shell } = ctx;
  const firmId = params.firmId;
  const today = new Date().toISOString().slice(0, 10);
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());

  const firmGrid = (list: readonly FirmWire[]): VNode => html`<section aria-label="Firms">
    <header class="s2-tree__head">
      <h2 class="s2-h2">Firms</h2>
      ${linkTo(ctx, "network.firm.new", {}, "+ Firm", "ac-action s2-link--action")}
    </header>
    ${DataGrid({
      density: ctx.density,
      columns: [
        { key: "legalName", header: "Firm", cell: (f: FirmWire) => linkTo(ctx, "network", { firmId: f.id }, f.legalName) },
        { key: "status", header: "Status", cell: (f: FirmWire) => stateMark(f.status) },
        { key: "activeCrewCount", header: "Crews", align: "end", numeric: true, cell: (f: FirmWire) => `${f.activeCrewCount}/${f.crewCount}` },
      ],
      rows: list, rowKey: (f: FirmWire) => f.id, selectedKey: firmId ?? "",
      onSelect: (f: FirmWire) => ctx.router.navigate("network", { firmId: f.id }),
      emptyText: "No firms recorded yet.",
    })}
    <p class="s2-muted">${linkTo(ctx, "network", {}, "Our crews")}</p>
  </section>`;

  const step = async (f: FirmWire, to: Exclude<FirmStatus, "onboarding">) => {
    if (ctx.degraded || outcome.value.busy) return;
    outcome.value = { refusal: null, busy: f.id };
    try {
      const out = await shell.gateway.updateFirm({ firmId: f.id, status: to });
      store.invalidate("firms.list");
      store.notice.value = [`${f.legalName} is now ${out.status}.`];
      outcome.value = { refusal: null, busy: "" };
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "" };
    }
  };

  const signMsa = async (f: FirmWire, date: string) => {
    if (ctx.degraded || outcome.value.busy || !date) return;
    outcome.value = { refusal: null, busy: f.id };
    try {
      await shell.gateway.updateFirm({ firmId: f.id, msaSignedAt: date });
      store.invalidate("firms.list");
      store.notice.value = [`MSA recorded as signed ${date}.`];
      outcome.value = { refusal: null, busy: "" };
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "" };
    }
  };

  const crewGrid = (crews: readonly CrewWire[], regionList: readonly RegionWire[], caption: string, emptyText: string): VNode => {
    const regionName = (id: string) => regionList.find((r) => r.id === id)?.name ?? id;
    return DataGrid({
      density: ctx.density, caption,
      columns: [
        { key: "label", header: "Crew", cell: (c: CrewWire) => html`<span>${c.label}${c.active ? "" : html` <small class="s2-muted">inactive</small>`}</span>` },
        { key: "homeRegionId", header: "Home region", cell: (c: CrewWire) => regionName(c.homeRegionId) },
        {
          key: "documents", header: "Documents (today)",
          cell: (c: CrewWire) => { const s = documentStatus(c.documents, today); return html`<span class="s2-row-actions">${StatusPill({ density: ctx.density, status: s.status, label: s.label })}</span>`; },
        },
        { key: "actions", header: "", align: "end", cell: (c: CrewWire) => linkTo(ctx, "network.crew.documents", { crewId: c.id }, "Documents") },
      ],
      rows: crews, rowKey: (c: CrewWire) => c.id, emptyText,
    });
  };

  const firmDetail = (f: FirmWire, regionList: readonly RegionWire[]): VNode => {
    const crews = store.read(keyOf("crews.list", { firmId: f.id }), () => shell.gateway.listCrews({ firmId: f.id }));
    const busy = ctx.degraded || outcome.value.busy === f.id;
    return html`<section class="s2-firm" aria-label="Firm">
      <header class="s2-tree__head">
        <h2 class="s2-h2">${f.legalName} ${stateMark(f.status)}</h2>
        <span class="s2-row-actions">
          ${NEXT_FIRM[f.status].map((to) => html`<button type="button" class="s2-link" id=${`step-${to}`} disabled=${busy} onClick=${() => step(f, to)}>${STEP_LABEL[to]}</button>`)}
          ${linkTo(ctx, "network.rates", { firmId: f.id }, "Rate card")}
        </span>
      </header>
      <dl class="s2-terms">
        <dt>Dispatched from</dt><dd>${regionList.find((r) => r.id === f.regionId)?.name ?? f.regionId}</dd>
        <dt>Settlement terms</dt><dd>${f.settlementTermsDays} days (D13)</dd>
        <dt>MSA</dt><dd>${f.msaSignedAt
          ? `signed ${f.msaSignedAt}`
          : html`<form class="s2-form--inline" onSubmit=${(e: Event) => { e.preventDefault(); const d = new FormData(e.currentTarget as HTMLFormElement).get("msaSignedAt"); signMsa(f, String(d ?? "")); }}>
              <span class="s2-muted">not signed — a firm is not activated without one</span>
              <input class="s2-input" type="date" name="msaSignedAt" required aria-label="MSA signed on" />
              <button type="submit" class="s2-link" disabled=${busy}>Record signature</button>
            </form>`}</dd>
        <dt>Data rights (OQ5)</dt><dd>${StatusPill({ density: ctx.density, status: f.diagnosticDataRightsReserved ? "ok" : "at_risk", label: f.diagnosticDataRightsReserved ? "Reserved" : "Not reserved" })}</dd>
        <dt>W-9</dt><dd>${f.w9DocumentKey ?? html`<span class="s2-muted">not on file</span>`}</dd>
      </dl>
      <header class="s2-tree__head">
        <h3 class="s2-h2">Crews</h3>
        ${f.status === "terminated" ? null : linkTo(ctx, "network.crew.new", { firmId: f.id }, "+ Crew", "ac-action s2-link--action")}
      </header>
      ${whenReady(ctx, crews.value, (c) => crewGrid(c.crews, regionList, "", "No crews rostered under this firm."))}
      ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, refusalRoutes(ctx, outcome.value.refusal)) : null}
    </section>`;
  };

  const ourCrews = (regionList: readonly RegionWire[]): VNode => {
    const crews = store.read(keyOf("crews.list"), () => shell.gateway.listCrews({}));
    return html`<section aria-label="Our crews">
      <header class="s2-tree__head">
        <h2 class="s2-h2">Our crews</h2>
        ${linkTo(ctx, "network.crew.new", {}, "+ Crew", "ac-action s2-link--action")}
      </header>
      <p class="s2-muted">Employed crews. A firm's crews are under the firm; the field layer sees neither distinction.</p>
      ${whenReady(ctx, crews.value, (c) => crewGrid(c.crews.filter((x) => x.firmId === null), regionList, "", "No employed crews recorded yet."))}
    </section>`;
  };

  return html`<div class="s2-two-col">
    <aside class="s2-col--orgs">${whenReady(ctx, firms.value, (f) => firmGrid(f.firms))}</aside>
    ${whenReady(ctx, regions.value, (r) =>
      firmId
        ? whenReady(ctx, firms.value, (f) => { const firm = f.firms.find((x) => x.id === firmId); return firm ? firmDetail(firm, r.regions) : html`<p class="s2-empty">No firm ${firmId} visible in this scope.</p>`; })
        : ourCrews(r.regions))}
  </div>`;
};

export const stateMark = (status: FirmStatus): VNode => html`<span class="s2-state" data-tone=${STATUS_TONE[status]}>${status}</span>`;

const refusalRoutes = (ctx: ScreenContext, r: Refusal) => {
  const routes: { label: string; onSelect: () => void; primary?: boolean }[] = [];
  if (r.kind === "admission" && r.code === "msa_unsigned") {
    routes.push({ label: "Record the MSA signature first", onSelect: () => { outcome.value = { refusal: null, busy: "" }; }, primary: true });
  }
  routes.push({ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: "" }; } });
  return routes;
};
