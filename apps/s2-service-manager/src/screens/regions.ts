import { html, panel, pageHead, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { Refusal, RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, linkTo, submitAction, confirmPanel, type Screen, type ScreenContext } from "./common.ts";

/**
 * 0039 — REGIONS, inside People and with the same gate: a principal's to
 * open, rename and close (regions.* are principal-only at the gateway).
 *
 * Unassigned (pre-account) is listed so nobody wonders where the visitors and
 * leads live, and is never a choice: it has no page and no action, and every
 * create form in S2 offers only `assignable` regions.
 */
const regions = (ctx: ScreenContext) => ctx.store.read(keyOf("regions.list"), () => ctx.shell.gateway.listRegions());
const failed = (ctx: ScreenContext, err: unknown): Refusal => ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) };

const standing = (r: RegionWire): VNode =>
  r.assignable ? html`<span class="s2-state" data-tone="settled">Active</span>`
    : r.active ? html`<span class="s2-muted">Pre-account — never offered</span>`
      : html`<span class="s2-state" data-tone="ended">Closed</span>`;

/** The Regions panel on the People screen. */
export const regionsPanel = (ctx: ScreenContext): VNode => panel(
  whenReady(ctx, regions(ctx).value, (r) => DataGrid({
    density: ctx.density,
    stack: true,
    columns: [
      { key: "code", header: "Code", cell: (x: RegionWire) => html`<span class="s2-num">${x.code}</span>` },
      { key: "name", header: "Name", cell: (x: RegionWire) => x.name },
      { key: "timezone", header: "Days counted in", cell: (x: RegionWire) => x.timezone },
      { key: "active", header: "Standing", cell: standing },
      { key: "actions", header: "", align: "end", cell: (x: RegionWire) => x.assignable || !x.active ? linkTo(ctx, "people.region", { regionId: x.id }, "Open", undefined, `Open ${x.name}`) : null },
    ],
    rows: r.regions,
    rowKey: (x: RegionWire) => x.id,
    emptyText: "No regions.",
  }), () => ctx.store.invalidate("regions.list")),
  "Regions", "Where we serve from. Every customer, crew, login and job belongs to one; a code is printed in its job numbers and never changes.",
  linkTo(ctx, "people.region.new", {}, "+ Region", "ac-action s2-link--action"), "regions");

const newForm = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

export const regionNew: Screen = (ctx) => {
  const f = newForm.value;
  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const v = (k: string) => String(data.get(k) ?? "").trim();
    newForm.value = { refusal: null, busy: true };
    try {
      const out = await ctx.shell.gateway.createRegion({ code: v("code"), name: v("name"), timezone: v("timezone") });
      ctx.store.invalidate("regions.list");
      ctx.store.notice.value = [`${v("name")} is open.`];
      newForm.value = { refusal: null, busy: false };
      ctx.router.navigate("people.region", { regionId: out.id });
    } catch (err) {
      newForm.value = { refusal: failed(ctx, err), busy: false };
    }
  };
  return html`<section class="s2-form-screen">
    ${pageHead("New region", "A region we serve from. Customers, crews, logins and devices are filed under one, and Dispatch sees one at a time.")}
    <form class="ac-form" onSubmit=${submit} id="region-form">
      <label class="ac-field"><span>Code</span><input class="ac-input" name="code" required autocomplete="off" maxlength="8" /><small>2 to 8 capitals and digits, e.g. DFW. It starts every job number and cannot be changed.</small></label>
      <label class="ac-field"><span>Name</span><input class="ac-input" name="name" required autocomplete="off" /></label>
      <label class="ac-field"><span>Days counted in</span><input class="ac-input" name="timezone" required value="America/Chicago" autocomplete="off" /><small>The region's timezone, as an IANA name.</small></label>
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Saving…" : "Open region", "save-region")}
        ${linkTo(ctx, "people", {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to people", onSelect: () => ctx.router.navigate("people", {}) }]) : null}
  </section>`;
};

type RegionState = { readonly regionId: string; readonly refusal: Refusal | null; readonly busy: boolean; readonly confirm: boolean };
const regionForm = signal<RegionState>({ regionId: "", refusal: null, busy: false, confirm: false });

const regionView = (ctx: ScreenContext, r: RegionWire): VNode => {
  const { shell, store } = ctx;
  if (regionForm.value.regionId !== r.id) regionForm.value = { regionId: r.id, refusal: null, busy: false, confirm: false };
  const f = regionForm.value;

  const act = async (fn: () => Promise<unknown>, notice: string) => {
    regionForm.value = { ...f, refusal: null, busy: true };
    try {
      await fn();
      store.invalidate("regions.list");
      store.notice.value = [notice];
      regionForm.value = { ...regionForm.value, busy: false, confirm: false };
    } catch (err) {
      regionForm.value = { ...regionForm.value, refusal: failed(ctx, err), busy: false, confirm: false };
    }
  };
  const rename = (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const name = String(new FormData(e.currentTarget as HTMLFormElement).get("name") ?? "").trim();
    void act(() => shell.gateway.updateRegion({ regionId: r.id, name }), `Renamed ${name}.`);
  };
  const flip = () => act(() => shell.gateway.setRegionActive({ regionId: r.id, active: !r.active }),
    r.active ? `${r.name} is closed.` : `${r.name} is open again.`);

  return html`<section class="s2-form-screen">
    ${pageHead(r.name, html`Code <span class="s2-num">${r.code}</span> · days counted in ${r.timezone}.`)}
    <form class="ac-form" onSubmit=${rename} id="region-form">
      <label class="ac-field"><span>Name</span><input class="ac-input" name="name" required value=${r.name} autocomplete="off" /><small>The code stays ${r.code}: it is in the job numbers already issued.</small></label>
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Saving…" : "Rename", "save-region")}
        ${linkTo(ctx, "people", {}, "Back to people")}
      </div>
    </form>
    ${panel(html`<div class="s2-row-actions">
        <button type="button" class=${`s2-mutation${r.active ? " s2-mutation--danger" : ""}`} id="set-region-active" aria-expanded=${f.confirm} disabled=${ctx.degraded || f.busy || f.confirm} onClick=${() => { regionForm.value = { ...f, confirm: true }; }}>${r.active ? "Close region" : "Open again"}</button>
      </div>
      ${f.confirm ? confirmPanel({
        id: "confirm-region", title: r.active ? `Close ${r.name}?` : `Open ${r.name} again?`,
        detail: r.active
          ? "Nothing new can be filed under it. It is refused while any login, crew, customer or open job is still in it — the refusal names them."
          : "It is offered again on every form that picks a region.",
        confirmLabel: r.active ? "Close region" : "Open again", danger: r.active, busy: f.busy, disabled: ctx.degraded,
        onConfirm: () => { void flip(); }, onCancel: () => { regionForm.value = { ...regionForm.value, confirm: false }; },
      }) : null}`, "Standing", standing(r))}
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to people", onSelect: () => ctx.router.navigate("people", {}) }]) : null}
  </section>`;
};

export const regionPage: Screen = (ctx, params) => whenReady(ctx, regions(ctx).value, (rs) => {
  const r = rs.regions.find((x) => x.id === params.regionId && (x.assignable || !x.active));
  return r ? regionView(ctx, r) : html`<p class="s2-empty">No region ${params.regionId} to keep here.</p>`;
});
