import { html, pageHead, panel, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CrewWire, DeviceKind, DeviceWire, FirmWire, Refusal, RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, noChoice, noActiveRegion, formValues, linkTo, boundEnd, type Screen } from "./common.ts";

/**
 * D-2a in S2: the hardware a technician signs in to S5 with, and the shift
 * grant that lets them. S5's sign-in (auth.deviceLogin) needs all three to
 * agree — the technician's login, an active device, and a live grant on that
 * device for that technician whose window covers now — and refuses with one
 * word, "invalid credentials", whichever is missing. This is where the office
 * makes the second and third.
 *
 * The grant names a technician's UNIT, not the person: since 0024 a unit is
 * one technician's own, and the gateway resolves its one active login. A
 * shared crew made before 0024 is refused there, not guessed at here.
 */
export const DEVICE_KIND_LABEL: Readonly<Record<DeviceKind, string>> = Object.freeze({
  web_fallback: "Web fallback (browser)",
  android_pilot: "Android pilot",
  yocto_tablet: "Field tablet",
});
const DEVICE_KINDS = Object.keys(DEVICE_KIND_LABEL) as DeviceKind[];

export const devices: Screen = (ctx) => {
  const { shell, store } = ctx;
  const list = store.read(keyOf("devices.list"), () => shell.gateway.listDevices({}));
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const owner = (id: string | null) => id === null ? "Ours" : (firms.value.state === "ready" ? firms.value.value.firms.find((f) => f.id === id)?.legalName : undefined) ?? "a firm";
  return html`<section>
    ${pageHead("Field devices", "The hardware technicians sign in to the field app with. A technician signs in with a device's ID only while a shift grant on it is open.")}
    ${panel(whenReady(ctx, list.value, (d) => DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        { key: "hardwareId", header: "Device ID", cell: (x: DeviceWire) => html`<span class="s2-num">${x.hardwareId}</span>${x.active ? "" : html` <small class="s2-muted">inactive</small>`}` },
        { key: "kind", header: "Kind", cell: (x: DeviceWire) => DEVICE_KIND_LABEL[x.kind] },
        { key: "firmId", header: "Owner", cell: (x: DeviceWire) => owner(x.firmId) },
        { key: "actions", header: "", align: "end", cell: (x: DeviceWire) => x.active ? linkTo(ctx, "devices.grant", { deviceId: x.id }, "Grant shift", undefined, `Grant a shift on ${x.hardwareId}`) : html`` },
      ],
      rows: d.devices,
      rowKey: (x: DeviceWire) => x.id,
      emptyText: "No devices registered yet.",
    }), () => store.invalidate("devices.list")),
    "Devices", null,
    linkTo(ctx, "devices.new", {}, "+ Device", "ac-action s2-link--action"), "devices")}
  </section>`;
};

type FormState = { readonly kind: DeviceKind; readonly refusal: Refusal | null; readonly busy: boolean };
const registerForm = signal<FormState>({ kind: "web_fallback", refusal: null, busy: false });

export const devicesNew: Screen = (ctx) => {
  const { shell, store } = ctx;
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const f = registerForm.value;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const hardwareId = v.hardwareId ?? "";
    registerForm.value = { ...f, refusal: null, busy: true };
    try {
      await shell.gateway.registerDevice({
        hardwareId, kind: f.kind, regionId: v.regionId ?? "",
        ...(v.publicKey ? { publicKey: v.publicKey } : {}), ...(v.firmId ? { firmId: v.firmId } : {}),
      });
      store.invalidate("devices.list");
      store.notice.value = [`${hardwareId} registered. Grant a shift on it before a technician signs in.`];
      registerForm.value = { kind: "web_fallback", refusal: null, busy: false };
      ctx.router.navigate("devices", {});
    } catch (err) {
      registerForm.value = { ...registerForm.value, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  return html`<section class="s2-form-screen">
    ${pageHead("New device", "Register a device a technician will sign in to the field app with.")}
    <form class="ac-form" onSubmit=${submit} id="device-form">
      <label class="ac-field"><span>Device ID</span><input class="ac-input" name="hardwareId" required autocomplete="off" /><small>What the technician types on the field app's sign-in. Unique across every device.</small></label>
      <label class="ac-field">
        <span>Kind</span>
        <select name="kind" class="ac-input" onChange=${(e: Event) => { registerForm.value = { ...registerForm.value, kind: (e.currentTarget as HTMLSelectElement).value as DeviceKind }; }}>
          ${DEVICE_KINDS.map((k) => html`<option value=${k} selected=${f.kind === k}>${DEVICE_KIND_LABEL[k]}</option>`)}
        </select>
      </label>
      ${f.kind === "web_fallback"
        ? null
        : html`<label class="ac-field"><span>Public key</span><input class="ac-input" name="publicKey" required autocomplete="off" /><small>Base64, from the device. Recorded now; not yet checked at sign-in.</small></label>`}
      ${whenReady(ctx, regions.value, (r) => !r.regions.some((x) => x.active) ? noChoice("Region", "No region of ours is active.") : html`<label class="ac-field">
        <span>Region</span>
        <select name="regionId" required class="ac-input">${r.regions.filter((x: RegionWire) => x.active).map((x: RegionWire) => html`<option value=${x.id}>${x.name} (${x.code})</option>`)}</select>
      </label>`)}
      ${whenReady(ctx, firms.value, (fs) => html`<label class="ac-field">
        <span>Owner</span>
        <select name="firmId" class="ac-input">
          <option value="">Ours</option>
          ${fs.firms.filter((x: FirmWire) => x.status !== "terminated").map((x: FirmWire) => html`<option value=${x.id}>${x.legalName}</option>`)}
        </select>
        <small>A firm's own hardware carries the firm's tenancy.</small>
      </label>`)}
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Registering…" : "Register device", "register-device", noActiveRegion(regions.value))}
        ${linkTo(ctx, "devices", {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to devices", onSelect: () => ctx.router.navigate("devices", {}) }]) : null}
  </section>`;
};

const grantForm = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

/** A `datetime-local` value is the browser's wall clock; the wire takes an instant. */
export const instantOf = (local: string): string => new Date(local).toISOString();

export const devicesGrant: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const list = store.read(keyOf("devices.list"), () => shell.gateway.listDevices({}));
  const crews = store.read(keyOf("crews.list"), () => shell.gateway.listCrews({}));
  const f = grantForm.value;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    grantForm.value = { refusal: null, busy: true };
    try {
      await shell.gateway.grantDeviceShift({
        deviceId: v.deviceId ?? "", crewId: v.crewId ?? "",
        windowStart: instantOf(v.windowStart ?? ""), windowEnd: instantOf(v.windowEnd ?? ""),
      });
      store.notice.value = ["Shift granted. The technician can sign in on that device until the shift ends."];
      grantForm.value = { refusal: null, busy: false };
      ctx.router.navigate("devices", {});
    } catch (err) {
      grantForm.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const deviceField = (d: readonly DeviceWire[]): VNode => {
    const active = d.filter((x) => x.active);
    return active.length === 0
      ? noChoice("Device", "No active device is registered.", linkTo(ctx, "devices.new", {}, "Register one"))
      : html`<label class="ac-field">
          <span>Device</span>
          <select name="deviceId" required class="ac-input">${active.map((x) => html`<option value=${x.id} selected=${x.id === params.deviceId}>${x.hardwareId} — ${DEVICE_KIND_LABEL[x.kind]}</option>`)}</select>
        </label>`;
  };
  const unitField = (c: readonly CrewWire[]): VNode => {
    const units = c.filter((x) => x.active && x.kind === "service");
    return units.length === 0
      ? noChoice("Technician", "No active technician unit exists. A technician's unit is made with their login.")
      : html`<label class="ac-field">
          <span>Technician</span>
          <select name="crewId" required class="ac-input">${units.map((x) => html`<option value=${x.id}>${x.label}</option>`)}</select>
          <small>The technician's own unit. Their login on it is the one granted.</small>
        </label>`;
  };
  const blocked = list.value.state === "ready" && !list.value.value.devices.some((x) => x.active) ? "No active device to grant."
    : crews.value.state === "ready" && !crews.value.value.crews.some((x) => x.active && x.kind === "service") ? "No technician unit to grant." : null;

  return html`<section class="s2-form-screen">
    ${pageHead("Grant a shift", "This device, this technician, this window. The technician signs in on the device only inside the window, and the session ends when it does.")}
    <form class="ac-form" onSubmit=${submit} id="grant-form">
      ${whenReady(ctx, list.value, (d) => deviceField(d.devices))}
      ${whenReady(ctx, crews.value, (c) => unitField(c.crews))}
      <label class="ac-field"><span>Shift starts</span><input class="ac-input" type="datetime-local" name="windowStart" required onInput=${boundEnd("windowEnd")} /></label>
      <label class="ac-field"><span>Shift ends</span><input class="ac-input" type="datetime-local" name="windowEnd" required /><small>A device holds one grant at a time; an overlapping window is refused.</small></label>
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Granting…" : "Grant shift", "grant-shift", blocked)}
        ${linkTo(ctx, "devices", {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to devices", onSelect: () => ctx.router.navigate("devices", {}) }]) : null}
  </section>`;
};
