import { html, pageHead, panel, signal, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { FirmWire, FirmStatus, CrewWire, CrewDocumentSummary, RegionWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { technicianPanel } from "./network-technicians.ts";
import { whenReady, refusalView, linkTo, confirmPanel, type Screen, type ScreenContext } from "./common.ts";

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
/** Our employed crews: this screen with no firm selected, and the first tab under Technician Network. */
export const OWN_CREWS_LABEL = "AC Services DFW";

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

const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: string; readonly pending: { readonly id: string; readonly to: Exclude<FirmStatus, "onboarding"> } | null }>({ refusal: null, busy: "", pending: null });

export const network: Screen = (ctx, params) => {
  const { store, shell } = ctx;
  const firmId = params.firmId;
  const today = new Date().toISOString().slice(0, 10);
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());

  const firmGrid = (list: readonly FirmWire[]): VNode => panel(html`
    ${DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        { key: "legalName", header: "Firm", cell: (f: FirmWire) => linkTo(ctx, "network", { firmId: f.id }, f.legalName) },
        { key: "status", header: "Status", cell: (f: FirmWire) => stateMark(f.status) },
        { key: "activeCrewCount", header: "Crews", align: "end", numeric: true, cell: (f: FirmWire) => `${f.activeCrewCount}/${f.crewCount}` },
      ],
      rows: list, rowKey: (f: FirmWire) => f.id, selectedKey: firmId ?? "",
      onSelect: (f: FirmWire) => ctx.router.navigate("network", { firmId: f.id }),
      emptyText: "No firms recorded yet.",
    })}
    <p class="s2-muted">${linkTo(ctx, "network", {}, OWN_CREWS_LABEL)}</p>`,
    "Firms", undefined, linkTo(ctx, "network.firm.new", {}, "+ Firm", "ac-action s2-link--action"), "firms");

  const step = async (f: FirmWire, to: Exclude<FirmStatus, "onboarding">) => {
    if (ctx.degraded || outcome.value.busy) return;
    outcome.value = { refusal: null, busy: f.id, pending: { id: f.id, to } };
    try {
      const out = await shell.gateway.updateFirm({ firmId: f.id, status: to });
      store.invalidate("firms.list");
      store.notice.value = [`${f.legalName} is now ${out.status}.`];
      outcome.value = { refusal: null, busy: "", pending: null };
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "", pending: null };
    }
  };

  const signMsa = async (f: FirmWire, date: string) => {
    if (ctx.degraded || outcome.value.busy || !date) return;
    outcome.value = { refusal: null, busy: f.id, pending: null };
    try {
      await shell.gateway.updateFirm({ firmId: f.id, msaSignedAt: date });
      store.invalidate("firms.list");
      store.notice.value = [`MSA recorded as signed ${date}.`];
      outcome.value = { refusal: null, busy: "", pending: null };
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "", pending: null };
    }
  };

  const crewGrid = (crews: readonly CrewWire[], regionList: readonly RegionWire[], caption: string, emptyText: string): VNode => {
    const regionName = (id: string) => regionList.find((r) => r.id === id)?.name ?? id;
    return DataGrid({
      density: ctx.density,
      stack: true, caption,
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
    return html`<div class="s2-firm">
      ${panel(html`<dl class="s2-terms">
        <dt>Dispatched from</dt><dd>${regionList.find((r) => r.id === f.regionId)?.name ?? f.regionId}</dd>
        <dt>Settlement terms</dt><dd>${f.settlementTermsDays} days (D13)</dd>
        <dt>MSA</dt><dd>${f.msaSignedAt
          ? `signed ${f.msaSignedAt}`
          : html`<form class="ac-form--inline" id="msa-form" onSubmit=${(e: Event) => { e.preventDefault(); const d = new FormData(e.currentTarget as HTMLFormElement).get("msaSignedAt"); signMsa(f, String(d ?? "")); }}>
              <span class="s2-muted">not signed — a firm is not activated without one</span>
              <input class="ac-input" type="date" name="msaSignedAt" required aria-label="MSA signed on" />
              <button type="submit" class="s2-mutation" disabled=${busy}>Record signature</button>
            </form>`}</dd>
        <dt>Data rights (OQ5)</dt><dd>${StatusPill({ density: ctx.density, status: f.diagnosticDataRightsReserved ? "ok" : "at_risk", label: f.diagnosticDataRightsReserved ? "Reserved" : "Not reserved" })}</dd>
        <dt>W-9</dt><dd>${f.w9DocumentKey ?? html`<span class="s2-muted">not on file</span>`}</dd>
      </dl>`, html`${f.legalName} ${stateMark(f.status)}`, undefined, html`<span class="s2-row-actions">
        ${NEXT_FIRM[f.status].map((to) => {
          const pending = outcome.value.pending?.id === f.id && outcome.value.pending.to === to;
          const destructive = to === "terminated" || to === "suspended";
          return html`<button type="button" class=${`s2-mutation${destructive ? " s2-mutation--danger" : ""}`} id=${`step-${to}`} aria-expanded=${pending} aria-controls=${pending ? `confirm-firm-${f.id}` : undefined} disabled=${busy || outcome.value.pending !== null} onClick=${() => { outcome.value = { ...outcome.value, pending: { id: f.id, to } }; }}>${STEP_LABEL[to]}</button>
            ${pending ? confirmPanel({
              id: `confirm-firm-${f.id}`,
              title: `${STEP_LABEL[to]} this firm?`,
              detail: `${f.legalName} · currently ${f.status}. This changes the firm's recorded operating state.`,
              confirmLabel: `${STEP_LABEL[to]} firm`,
              danger: destructive,
              busy: outcome.value.busy === f.id,
              disabled: ctx.degraded,
              onConfirm: () => { void step(f, to); },
              onCancel: () => { outcome.value = { ...outcome.value, pending: null }; },
            }) : null}`;
        })}
        ${linkTo(ctx, "network.rates", { firmId: f.id }, "Rate card")}
      </span>`, "firm")}
      ${panel(whenReady(ctx, crews.value, (c) => crewGrid(c.crews, regionList, "", "No crews rostered under this firm.")),
        "Crews", undefined, f.status === "terminated" ? null : linkTo(ctx, "network.crew.new", { firmId: f.id }, "+ Crew", "ac-action s2-link--action"))}
      ${technicianPanel(ctx, f.id)}
      ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, refusalRoutes(ctx, outcome.value.refusal)) : null}
    </div>`;
  };

  const ourCrews = (regionList: readonly RegionWire[]): VNode => {
    const crews = store.read(keyOf("crews.list"), () => shell.gateway.listCrews({}));
    return html`<div class="s2-firm">
      ${panel(whenReady(ctx, crews.value, (c) => crewGrid(c.crews.filter((x) => x.firmId === null), regionList, "", "No employed crews recorded yet.")),
        OWN_CREWS_LABEL, "Our employed crews. A firm's crews are under the firm; the field layer sees neither distinction.",
        linkTo(ctx, "network.crew.new", {}, "+ Crew", "ac-action s2-link--action"), "our-crews")}
      ${technicianPanel(ctx, null)}
    </div>`;
  };

  return html`${pageHead("Technician Network", `Our own ${OWN_CREWS_LABEL} crews and the subcontractor firms we dispatch, and whether each crew's documents clear the gate today.`)}<div class="s2-two-col">
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
    routes.push({ label: "Record the MSA signature first", onSelect: () => { outcome.value = { refusal: null, busy: "", pending: null }; }, primary: true });
  }
  routes.push({ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: "", pending: null }; } });
  return routes;
};
