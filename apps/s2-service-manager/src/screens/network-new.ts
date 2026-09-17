import { html, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CreateFirmInput, CreateCrewInput, EmploymentType, FirmWire, RegionWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * C4 intake — a firm, and a crew.
 *
 * The firm form carries OQ5 as the same THREE-state control the agreement form
 * carries, for the same reason and with the same third line on the wire: a
 * checkbox cannot say "nobody has decided", so it would record a position
 * nobody took. OQ5 firm-side is answered in the MSA, per firm.
 *
 * The crew form offers a firm ONLY when the employment shape is subcontracted,
 * and offers only firms that are not terminated. Both are refusals the handler
 * would give (`firm_not_an_input`, `firm_required`, `firm_ended`) — offering
 * the field would be offering the refusal, the same rule the contract form
 * follows for the region.
 */
export type Oq5 = "unset" | "reserved" | "not_reserved";

type FirmForm = { readonly oq5: Oq5; readonly refusal: Refusal | null; readonly busy: boolean };
const firmForm = signal<FirmForm>({ oq5: "unset", refusal: null, busy: false });

/** The submit gate, as a function so the test can state the rule without a DOM. */
export const canSubmitFirm = (f: Pick<FirmForm, "oq5" | "busy">, degraded: boolean): boolean => f.oq5 !== "unset" && !f.busy && !degraded;

export const networkFirmNew: Screen = (ctx) => {
  const { shell, store } = ctx;
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const f = firmForm.value;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmitFirm(firmForm.value, ctx.degraded)) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const input: CreateFirmInput = {
      legalName: v.legalName ?? "",
      regionId: v.regionId ?? "",
      settlementTermsDays: Number(v.settlementTermsDays ?? "30"),
      diagnosticDataRightsReserved: f.oq5 === "reserved",
      ...(v.msaSignedAt ? { msaSignedAt: v.msaSignedAt } : {}),
      ...(v.w9DocumentKey ? { w9DocumentKey: v.w9DocumentKey } : {}),
      ...(v.externalRef ? { externalRef: v.externalRef } : {}),
    };
    firmForm.value = { ...f, refusal: null, busy: true };
    try {
      const out = await shell.gateway.createFirm(input);
      store.invalidate("firms.list");
      store.notice.value = [`${input.legalName} recorded — onboarding until its MSA is signed and it is activated.`];
      firmForm.value = { oq5: "unset", refusal: null, busy: false };
      ctx.router.navigate("network", { firmId: out.id });
    } catch (err) {
      firmForm.value = { ...firmForm.value, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const oq5Field = (): VNode => html`<fieldset class="s2-field s2-oq5" id="firm-oq5">
    <legend>Diagnostic data rights (OQ5, firm side)</legend>
    ${([
      ["reserved", "Reserved — the MSA retains our rights to the diagnostic data this firm's work produces"],
      ["not_reserved", "Not reserved — the firm retains them"],
    ] as const).map(([value, label]) => html`<label class="s2-radio">
      <input type="radio" name="oq5" value=${value} checked=${f.oq5 === value} onChange=${() => { firmForm.value = { ...firmForm.value, oq5: value }; }} />
      <span>${label}</span>
    </label>`)}
    ${f.oq5 === "unset" ? html`<small class="s2-oq5__unset" role="status">Not stated. A firm cannot be recorded without a position — the Phase 4 licensing question is answered in the MSA, per firm, or discovered in year six.</small>` : null}
  </fieldset>`;

  return html`<section class="s2-form-screen">
    <h2 class="s2-h2">New subcontractor firm</h2>
    <p class="s2-muted">A firm is recorded with its own tenant root in one step — the organization we settle with and the firm we dispatch are one row's worth of truth, created together or not at all.</p>
    <form class="s2-form" onSubmit=${submit} id="firm-form">
      <label class="s2-field"><span>Legal name</span><input class="s2-input" name="legalName" required /></label>
      ${whenReady(ctx, regions.value, (r) => html`<label class="s2-field">
        <span>Dispatched from</span>
        <select name="regionId" required class="s2-input">${r.regions.filter((x: RegionWire) => x.active).map((x: RegionWire) => html`<option value=${x.id}>${x.name} (${x.code})</option>`)}</select>
        <small>Our region. The firm's crews are dispatched from here and its rows live in this shard.</small>
      </label>`)}
      <label class="s2-field"><span>Settlement terms (days)</span><input class="s2-input" type="number" name="settlementTermsDays" min="0" defaultValue="30" required /><small>D13 — measured from day one.</small></label>
      <label class="s2-field"><span>MSA signed</span><input class="s2-input" type="date" name="msaSignedAt" /><small>Leave empty until it is signed; the firm cannot be activated without it.</small></label>
      <label class="s2-field"><span>W-9</span><input class="s2-input" name="w9DocumentKey" placeholder="storage key of the W-9" /></label>
      <label class="s2-field"><span>External reference</span><input class="s2-input" name="externalRef" /></label>
      ${oq5Field()}
      <div class="s2-form__actions">
        ${f.oq5 === "unset" && !ctx.degraded
          ? html`<button type="submit" class="ac-action" id="record-firm" disabled aria-disabled="true" title="State the diagnostic data rights position first">Record firm</button>`
          : submitAction(ctx, f.busy ? "Recording…" : "Record firm", "record-firm")}
        ${linkTo(ctx, "network", {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to the network", onSelect: () => ctx.router.navigate("network", {}) }]) : null}
  </section>`;
};

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------
type CrewForm = { readonly key: string; readonly employmentType: EmploymentType; readonly refusal: Refusal | null; readonly busy: boolean };
const crewForm = signal<CrewForm>({ key: "", employmentType: "employed", refusal: null, busy: false });

export const networkCrewNew: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const firmId = params.firmId ?? "";
  if (crewForm.value.key !== firmId) crewForm.value = { key: firmId, employmentType: firmId ? "subcontracted" : "employed", refusal: null, busy: false };
  const f = crewForm.value;

  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const input: CreateCrewInput = {
      label: v.label ?? "",
      employmentType: f.employmentType,
      homeRegionId: v.homeRegionId ?? "",
      // Named only where the handler admits it. An employed crew that declared
      // a firm would be `firm_not_an_input`, which is a refusal the form can
      // simply not produce.
      ...(f.employmentType === "subcontracted" ? { firmId: v.firmId ?? firmId } : {}),
    };
    crewForm.value = { ...f, refusal: null, busy: true };
    try {
      await shell.gateway.createCrew(input);
      store.invalidate("crews.list");
      store.invalidate("firms.list");
      store.notice.value = [`${input.label} recorded. It clears nothing until its documents are on file and verified.`];
      crewForm.value = { ...crewForm.value, busy: false };
      ctx.router.navigate("network", firmId ? { firmId } : {});
    } catch (err) {
      crewForm.value = { ...crewForm.value, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const firmField = (list: readonly FirmWire[]): VNode => html`<label class="s2-field">
    <span>Firm</span>
    <select name="firmId" required class="s2-input">
      ${list.filter((x) => x.status !== "terminated").map((x) => html`<option value=${x.id} selected=${x.id === firmId}>${x.legalName} (${x.status})</option>`)}
    </select>
    <small>A terminated firm is not offered — a crew rostered under one is a crew nobody can dispatch.</small>
  </label>`;

  return html`<section class="s2-form-screen">
    <h2 class="s2-h2">New crew</h2>
    <form class="s2-form" onSubmit=${submit} id="crew-form">
      <label class="s2-field"><span>Label</span><input class="s2-input" name="label" required /></label>
      <label class="s2-field">
        <span>Employment</span>
        <select name="employmentType" class="s2-input" onChange=${(e: Event) => { crewForm.value = { ...crewForm.value, employmentType: (e.currentTarget as HTMLSelectElement).value as EmploymentType }; }}>
          ${(["employed", "subcontracted"] as const).map((t) => html`<option value=${t} selected=${f.employmentType === t}>${t}</option>`)}
        </select>
        <small>Read by the compliance gate and by nothing else. The field experience is identical either way.</small>
      </label>
      ${f.employmentType === "subcontracted" ? whenReady(ctx, firms.value, (x) => firmField(x.firms)) : html`<p class="s2-parent">An employed crew is ours — no firm is named, and none is offered.</p>`}
      ${whenReady(ctx, regions.value, (r) => html`<label class="s2-field">
        <span>Home region</span>
        <select name="homeRegionId" required class="s2-input">${r.regions.filter((x: RegionWire) => x.active).map((x: RegionWire) => html`<option value=${x.id}>${x.name} (${x.code})</option>`)}</select>
        <small>Where the crew is normally dispatched from. A crew that changes region is a new crew with a new document set.</small>
      </label>`)}
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Recording…" : "Record crew", "record-crew")}
        ${linkTo(ctx, "network", firmId ? { firmId } : {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, crewRefusalRoutes(ctx, f.refusal)) : null}
  </section>`;
};

const crewRefusalRoutes = (ctx: ScreenContext, r: Refusal) => {
  const routes: { label: string; onSelect: () => void; primary?: boolean }[] = [];
  if (r.kind === "admission" && r.code === "firm_ended") {
    routes.push({ label: "Pick another firm", onSelect: () => { crewForm.value = { ...crewForm.value, key: "", refusal: null }; }, primary: true });
  }
  routes.push({ label: "Back to the network", onSelect: () => ctx.router.navigate("network", {}) });
  return routes;
};
