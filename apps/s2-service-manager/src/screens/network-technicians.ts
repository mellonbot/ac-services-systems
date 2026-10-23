import { html, pageHead, panel, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import {
  TECHNICIAN_SPECIALTIES, TECHNICIAN_ROLES, TECHNICIAN_ROLE_LABEL, mayReadTechnicianAddress, crewKindForRole,
  type AddressWire, type CrewWire, type FirmWire, type Refusal, type RegionWire, type TechnicianRole, type TechnicianSpecialty, type TechnicianWire,
} from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, linkTo, submitAction, type Screen, type ScreenContext } from "./common.ts";
import { OWN_CREWS_LABEL } from "./network.ts";

/**
 * 0020 — the roster on every Technician Network tab: each person who works
 * our jobs, with their phone, specialties, crew and home address. The address
 * is an account owner's or a principal's (the gateway serves it to no one else,
 * and refuses it from anyone else), so the form offers it to those roles only and every
 * other role reads "Restricted" — told it exists or not, never shown.
 */
export const SPECIALTY_WORD: Readonly<Record<TechnicianSpecialty, string>> = Object.freeze({
  residential_hvac: "Residential HVAC", light_commercial: "Light commercial", commercial_rtu: "Commercial RTU", refrigeration: "Refrigeration",
  chillers_boilers: "Chillers & boilers", controls_bas: "Controls / BAS", install: "Install", ductwork: "Ductwork",
});

export const addressLine = (a: AddressWire | null): string =>
  a ? [a.line1, a.line2, [a.city, [a.state, a.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ") : "";

const seesAddress = (ctx: ScreenContext) => mayReadTechnicianAddress(ctx.shell.principal.roles);

/** The roster panel. `firmId` null is our own crews. */
export const technicianPanel = (ctx: ScreenContext, firmId: string | null): VNode => {
  const { store, shell } = ctx;
  const techs = store.read(keyOf("technicians.list"), () => shell.gateway.listTechnicians({}));
  const crews = store.read(keyOf("crews.list"), () => shell.gateway.listCrews({}));
  const crewLabel = (id: string | null) => (id && crews.value.state === "ready" ? crews.value.value.crews.find((c) => c.id === id)?.label : undefined) ?? "—";
  return panel(whenReady(ctx, techs.value, (t) => DataGrid({
    density: ctx.density,
    stack: true,
    columns: [
      { key: "name", header: "Name", cell: (x: TechnicianWire) => html`<span>${x.name}${x.active ? "" : html` <small class="s2-muted">inactive</small>`}</span>` },
      { key: "role", header: "Role", cell: (x: TechnicianWire) => TECHNICIAN_ROLE_LABEL[x.role] },
      { key: "homeAddress", header: "Home address", cell: (x: TechnicianWire) => x.addressRestricted ? html`<span class="s2-muted">Restricted</span>` : (addressLine(x.homeAddress) || html`<span class="s2-muted">not on file</span>`) },
      { key: "phone", header: "Phone", cell: (x: TechnicianWire) => x.phone ? html`<a class="ac-link" href=${`tel:${x.phone.replace(/[^\d+]/g, "")}`}><span class="s2-num">${x.phone}</span></a>` : html`<span class="s2-muted">—</span>` },
      { key: "specialties", header: "Specialty", cell: (x: TechnicianWire) => x.specialties.length ? x.specialties.map((s) => SPECIALTY_WORD[s]).join(", ") : html`<span class="s2-muted">none recorded</span>` },
      { key: "crewId", header: "Crew", cell: (x: TechnicianWire) => crewLabel(x.crewId) },
      { key: "actions", header: "", align: "end", cell: (x: TechnicianWire) => linkTo(ctx, "network.technician.edit", { technicianId: x.id }, "Edit") },
    ],
    rows: t.technicians.filter((x) => x.firmId === firmId),
    rowKey: (x: TechnicianWire) => x.id,
    emptyText: firmId ? "No technicians recorded for this firm yet." : `No ${OWN_CREWS_LABEL} technicians recorded yet.`,
  }), () => store.invalidate("technicians.list")),
  "Technicians",
  seesAddress(ctx) ? "Every technician, with home address." : "Home addresses are shown to account owners and principals only.",
  linkTo(ctx, "network.technician.new", firmId ? { firmId } : {}, "+ Technician", "ac-action s2-link--action"), "technicians");
};

type FormState = { readonly key: string; readonly role: TechnicianRole; readonly refusal: Refusal | null; readonly busy: boolean };
const form = signal<FormState>({ key: "", role: "technician", refusal: null, busy: false });

const technicianForm = (ctx: ScreenContext, mode: { readonly firmId: string | null; readonly existing: TechnicianWire | null }): VNode => {
  const { shell, store } = ctx;
  const key = mode.existing?.id ?? `new:${mode.firmId ?? ""}`;
  if (form.value.key !== key) form.value = { key, role: mode.existing?.role ?? "technician", refusal: null, busy: false };
  const f = form.value;
  const t = mode.existing;
  const firmId = t ? t.firmId : mode.firmId;
  const owner = seesAddress(ctx);
  const back = () => ctx.router.navigate("network", firmId ? { firmId } : {});
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const crews = store.read(keyOf("crews.list"), () => shell.gateway.listCrews({}));
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const employer = firmId
    ? (firms.value.state === "ready" ? firms.value.value.firms.find((x: FirmWire) => x.id === firmId)?.legalName : undefined) ?? "this firm"
    : OWN_CREWS_LABEL;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const v = (k: string) => String(data.get(k) ?? "").trim();
    const specialties = data.getAll("specialties").map(String) as TechnicianSpecialty[];
    const address: AddressWire = { line1: v("line1"), line2: v("line2"), city: v("city"), state: v("state"), postal: v("postal") };
    const hasAddress = Boolean(address.line1 || address.city || address.postal);
    form.value = { ...f, refusal: null, busy: true };
    try {
      if (t) {
        await shell.gateway.updateTechnician({
          technicianId: t.id, name: v("name"), phone: v("phone"), role: f.role, specialties, crewId: v("crewId") || null, active: data.get("active") === "on",
          ...(owner ? { homeAddress: hasAddress ? address : null } : {}),
        });
      } else {
        await shell.gateway.recordTechnician({
          name: v("name"), role: f.role, specialties, homeRegionId: v("homeRegionId"),
          ...(firmId ? { firmId } : {}), ...(v("crewId") ? { crewId: v("crewId") } : {}), ...(v("phone") ? { phone: v("phone") } : {}),
          ...(owner && hasAddress ? { homeAddress: address } : {}),
        });
      }
      store.invalidate("technicians.list");
      store.notice.value = [`${v("name")} ${t ? "updated" : `added to ${employer}`}.`];
      form.value = { ...form.value, busy: false };
      back();
    } catch (err) {
      form.value = { ...form.value, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  // 0024: only the kind of crew this role belongs on is offered — a
  // technician's own unit, or an install crew. The gateway refuses the other.
  const crewField = (list: readonly CrewWire[]): VNode => html`<label class="ac-field">
    <span>${f.role === "technician" ? "Unit" : "Install crew"}</span>
    <select name="crewId" class="ac-input">
      <option value="">${f.role === "technician" ? "No unit yet" : "Not on a crew"}</option>
      ${list.filter((c) => c.firmId === firmId && c.active && c.kind === crewKindForRole(f.role)).map((c) => html`<option value=${c.id} selected=${c.id === t?.crewId}>${c.label}</option>`)}
    </select>
    <small>${f.role === "technician"
      ? "A technician is never on a crew. Their unit is theirs alone, and they are dispatched to service and commissioning work."
      : "Installers work on an install crew, sent to install work."}</small>
  </label>`;

  return html`<section class="s2-form-screen">
    ${pageHead(t ? `Edit ${t.name}` : "New technician", `${employer}. Name, phone, specialty and crew are every office role's; the home address is recorded by an account owner or principal.`)}
    <form class="ac-form" onSubmit=${submit} id="technician-form">
      <label class="ac-field"><span>Name</span><input class="ac-input" name="name" required value=${t?.name ?? ""} autocomplete="off" /></label>
      <label class="ac-field"><span>Phone</span><input class="ac-input" name="phone" type="tel" value=${t?.phone ?? ""} autocomplete="off" /></label>
      <label class="ac-field">
        <span>Role</span>
        <select name="role" class="ac-input" onChange=${(e: Event) => { form.value = { ...form.value, role: (e.currentTarget as HTMLSelectElement).value as TechnicianRole }; }}>
          ${TECHNICIAN_ROLES.map((r) => html`<option value=${r} selected=${f.role === r}>${TECHNICIAN_ROLE_LABEL[r]}</option>`)}
        </select>
      </label>
      <fieldset class="s2-fieldset">
        <legend>Specialty</legend>
        <div class="s2-chips">
          ${TECHNICIAN_SPECIALTIES.map((s) => html`<label class="s2-radio"><input type="checkbox" name="specialties" value=${s} checked=${t?.specialties.includes(s) ?? false} /> ${SPECIALTY_WORD[s]}</label>`)}
        </div>
      </fieldset>
      ${owner
        ? html`<fieldset class="s2-fieldset">
            <legend>Home address</legend>
            <label class="ac-field"><span>Street</span><input class="ac-input" name="line1" value=${t?.homeAddress?.line1 ?? ""} autocomplete="off" /></label>
            <label class="ac-field"><span>Unit</span><input class="ac-input" name="line2" value=${t?.homeAddress?.line2 ?? ""} autocomplete="off" /></label>
            <div class="s2-address-row">
              <label class="ac-field"><span>City</span><input class="ac-input" name="city" value=${t?.homeAddress?.city ?? ""} autocomplete="off" /></label>
              <label class="ac-field"><span>State</span><input class="ac-input" name="state" value=${t?.homeAddress?.state ?? "TX"} autocomplete="off" /></label>
              <label class="ac-field"><span>ZIP</span><input class="ac-input" name="postal" inputmode="numeric" value=${t?.homeAddress?.postal ?? ""} autocomplete="off" /></label>
            </div>
            <small>Seen by account owners and principals only.</small>
          </fieldset>`
        : html`<p class="s2-parent">Home address: recorded by an account owner or principal. It is not shown to this role.</p>`}
      ${whenReady(ctx, crews.value, (c) => crewField(c.crews))}
      ${t
        ? html`<label class="s2-radio"><input type="checkbox" name="active" checked=${t.active} /> Active — works our jobs</label>`
        : whenReady(ctx, regions.value, (r) => html`<label class="ac-field">
            <span>Works from</span>
            <select name="homeRegionId" required class="ac-input">${r.regions.filter((x: RegionWire) => x.active).map((x: RegionWire) => html`<option value=${x.id}>${x.name} (${x.code})</option>`)}</select>
          </label>`)}
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Saving…" : t ? "Save technician" : "Add technician", "save-technician")}
        ${linkTo(ctx, "network", firmId ? { firmId } : {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to the roster", onSelect: back }]) : null}
  </section>`;
};

export const networkTechnicianNew: Screen = (ctx, params) => technicianForm(ctx, { firmId: params.firmId ?? null, existing: null });

export const networkTechnicianEdit: Screen = (ctx, params) => {
  const techs = ctx.store.read(keyOf("technicians.list"), () => ctx.shell.gateway.listTechnicians({}));
  return whenReady(ctx, techs.value, (t) => {
    const existing = t.technicians.find((x) => x.id === params.technicianId);
    return existing ? technicianForm(ctx, { firmId: existing.firmId, existing }) : html`<p class="s2-empty">No technician ${params.technicianId} visible in this scope.</p>`;
  });
};
