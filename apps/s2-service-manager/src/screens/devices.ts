import { html, pageHead, panel, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { DeviceGrantWire, DeviceKind, DeviceWire, FirmWire, Refusal, RegionWire, ShiftTechnicianWire } from "../../../../packages/contracts/src/index.ts";
import type { Store } from "../state.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, type Screen, type ScreenContext } from "./common.ts";

/**
 * FIELD DEVICES — what a technician needs, besides their login, to open S5:
 * a registered device and a shift on it (D-2a). `auth.deviceLogin` reads both;
 * a login made in AC Logins and nothing here is a technician who cannot sign
 * in. Registering is once per device; a shift is granted per technician per
 * window, and the gateway refuses one that overlaps a live grant on the same
 * device or names a technician off their unit.
 */
export const KIND_WORD: Readonly<Record<DeviceKind, string>> = Object.freeze({
  web_fallback: "Browser (web fallback)", android_pilot: "Android pilot", yocto_tablet: "Field tablet",
});

const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

export const refreshDevices = (store: Store): void => { store.invalidate("devices."); };

const act = async (ctx: ScreenContext, fn: () => Promise<string>): Promise<boolean> => {
  if (ctx.degraded || outcome.value.busy) return false;
  outcome.value = { refusal: null, busy: true };
  try {
    const msg = await fn();
    refreshDevices(ctx.store);
    ctx.store.notice.value = [msg];
    outcome.value = { refusal: null, busy: false };
    return true;
  } catch (err) {
    outcome.value = { refusal: ctx.shell.refusalOf(err) ?? { kind: "bad_request", message: err instanceof Error ? err.message : String(err) }, busy: false };
    return false;
  }
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A grant's place against now: on shift, or not yet. Ended grants are not listed. Filing marks, not the status ramp. */
const shiftState = (g: DeviceGrantWire, now: number): VNode => Date.parse(g.windowStart) <= now
  ? html`<span class="s2-state" data-tone="live">On shift now</span>`
  : html`<span class="s2-state" data-tone="pending">Upcoming</span>`;

/** The window a new grant asks for: from the typed start (blank is now) for so many hours. */
export const shiftWindow = (start: string | undefined, hours: string | undefined, now: number): { windowStart: string; windowEnd: string } => {
  const from = start ? new Date(start).getTime() : now;
  const length = Number(hours || "10");
  return { windowStart: new Date(from).toISOString(), windowEnd: new Date(from + length * 3600_000).toISOString() };
};

export const devices: Screen = (ctx) => {
  const { shell, store } = ctx;
  const list = store.read(keyOf("devices.list", {}), () => shell.gateway.listDevices({}));
  const shifts = store.read(keyOf("devices.shifts"), () => shell.gateway.listDeviceShifts());
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const firmName = (id: string | null) => id === null ? "Ours" : (firms.value.state === "ready" ? firms.value.value.firms.find((f: FirmWire) => f.id === id)?.legalName : undefined) ?? "A firm";
  const now = Date.now();

  const grant = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const v = formValues(form);
    const tech = shifts.value.state === "ready" ? shifts.value.value.technicians.find((t) => t.id === v.technicianId) : undefined;
    const device = list.value.state === "ready" ? list.value.value.devices.find((d) => d.id === v.deviceId) : undefined;
    if (!tech || !device) return;
    void act(ctx, async () => {
      await shell.gateway.grantDeviceShift({ deviceId: device.id, crewId: tech.crewId, technicianId: tech.id, ...shiftWindow(v.windowStart, v.hours, Date.now()) });
      form.reset();
      return `${tech.name} can sign in on ${device.hardwareId} for this shift: at /technician, with that device ID, their email and their password.`;
    });
  };
  const register = (e: Event) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const v = formValues(form);
    void act(ctx, async () => {
      await shell.gateway.registerDevice({
        hardwareId: v.hardwareId ?? "", kind: (v.kind ?? "web_fallback") as DeviceKind, regionId: v.regionId ?? "",
        ...(v.publicKey ? { publicKey: v.publicKey } : {}), ...(v.firmId ? { firmId: v.firmId } : {}),
      });
      form.reset();
      return `Device ${v.hardwareId} registered. Grant a shift on it to let a technician sign in.`;
    });
  };

  const live = (ds: readonly DeviceWire[]) => ds.filter((d) => d.active);
  return html`<section class="s2-devices">
    ${pageHead("Field devices", "A technician signs in to the field app with their login, a registered device and a shift on it. Register the device once; grant a shift for each window they work.")}

    ${panel(html`${whenReady(ctx, shifts.value, (s) => DataGrid({
      density: ctx.density,
      stack: true, caption: "Shifts not yet over, soonest first",
      rows: s.grants, rowKey: (g: DeviceGrantWire) => g.id, emptyText: "No shifts granted. Until one is, no technician can sign in to the field app.",
      columns: [
        { key: "technicianName", header: "Technician" },
        { key: "crewLabel", header: "Unit" },
        { key: "hardwareId", header: "Device", cell: (g: DeviceGrantWire) => html`<span class="s2-num">${g.hardwareId}</span>` },
        { key: "windowStart", header: "From", cell: (g: DeviceGrantWire) => html`<span class="s2-num">${when(g.windowStart)}</span>` },
        { key: "windowEnd", header: "Until", cell: (g: DeviceGrantWire) => html`<span class="s2-num">${when(g.windowEnd)}</span>` },
        { key: "state", header: "", cell: (g: DeviceGrantWire) => shiftState(g, now) },
      ],
    }), () => store.invalidate("devices.shifts"))}
    <form class="ac-form ac-form--inline" onSubmit=${grant} id="grant-form">
      <label class="ac-field"><span>Technician</span><select class="ac-input" name="technicianId" required>
        <option value="">Choose…</option>
        ${whenReady(ctx, shifts.value, (s) => html`${s.technicians.map((t: ShiftTechnicianWire) => html`<option value=${t.id}>${t.name} · ${t.email}</option>`)}`)}
      </select></label>
      <label class="ac-field"><span>Device</span><select class="ac-input" name="deviceId" required>
        <option value="">Choose…</option>
        ${whenReady(ctx, list.value, (d) => html`${live(d.devices).map((x) => html`<option value=${x.id}>${x.hardwareId}</option>`)}`)}
      </select></label>
      <label class="ac-field"><span>Starts</span><input class="ac-input" name="windowStart" type="datetime-local" /><small>Blank is now.</small></label>
      <label class="ac-field"><span>Hours</span><input class="ac-input" name="hours" type="number" min="1" max="24" step="1" inputmode="numeric" defaultValue="10" required /></label>
      <div class="s2-form__actions">${submitAction(ctx, outcome.value.busy ? "Granting…" : "Grant shift", "grant-shift")}</div>
    </form>
    <p class="s2-policy">Technicians are the logins made in AC Logins with a unit of their own. One device holds one shift at a time.</p>`, "Shifts", undefined, undefined, "shifts")}

    ${panel(html`${whenReady(ctx, list.value, (d) => DataGrid({
      density: ctx.density,
      stack: true, caption: "Every registered device",
      rows: d.devices, rowKey: (x: DeviceWire) => x.id, emptyText: "No devices registered yet.",
      columns: [
        { key: "hardwareId", header: "Device ID", cell: (x: DeviceWire) => html`<span class="s2-num">${x.hardwareId}</span>` },
        { key: "kind", header: "Kind", cell: (x: DeviceWire) => KIND_WORD[x.kind] },
        { key: "firmId", header: "Owner", cell: (x: DeviceWire) => firmName(x.firmId) },
        { key: "active", header: "", cell: (x: DeviceWire) => x.active ? "" : html`<span class="s2-state" data-tone="ended">Retired</span>` },
      ],
    }), () => store.invalidate("devices.list"))}
    <form class="ac-form ac-form--inline" onSubmit=${register} id="device-form">
      <label class="ac-field"><span>Device ID</span><input class="ac-input" name="hardwareId" required autocomplete="off" placeholder="van-12-ipad" /></label>
      <label class="ac-field"><span>Kind</span><select class="ac-input" name="kind">${(Object.keys(KIND_WORD) as DeviceKind[]).map((k) => html`<option value=${k}>${KIND_WORD[k]}</option>`)}</select></label>
      <label class="ac-field"><span>Region</span><select class="ac-input" name="regionId" required>${whenReady(ctx, regions.value, (r) => html`${r.regions.filter((x: RegionWire) => x.active).map((x: RegionWire) => html`<option value=${x.id}>${x.name}</option>`)}`)}</select></label>
      <label class="ac-field"><span>Owner</span><select class="ac-input" name="firmId">
        <option value="">Ours</option>
        ${whenReady(ctx, firms.value, (f) => html`${f.firms.filter((x: FirmWire) => x.status !== "terminated").map((x: FirmWire) => html`<option value=${x.id}>${x.legalName}</option>`)}`)}
      </select></label>
      <label class="ac-field"><span>Device key</span><input class="ac-input" name="publicKey" autocomplete="off" /><small>Base64, from the device. A browser has none: leave it blank.</small></label>
      <div class="s2-form__actions">${submitAction(ctx, "Register device", "register-device")}</div>
    </form>`, "Devices")}
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: false }; } }]) : null}
  </section>`;
};
