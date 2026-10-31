import { html, pageHead, panel, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import { ROLES, type FirmWire, type PersonWire, type Refusal, type RegionWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, linkTo, submitAction, noChoice, noActiveRegion, confirmPanel, type Screen, type ScreenContext } from "./common.ts";

/**
 * 0038 — PEOPLE. The company's logins, kept by a principal: staff, and
 * technicians made together with their own service unit. The gateway refuses
 * every other role (people.* are principal-only); the tab is hidden from them
 * so the refusal is the guard, not the experience.
 *
 * A password is never typed here. A new login and a reset each come back with
 * a temporary password, shown once on the person's page and held only in this
 * tab's memory until "Done"; the person replaces it at their next sign-in.
 */
export const ROLE_WORD: Readonly<Record<(typeof ROLES)[number], string>> = Object.freeze({
  principal: "Principal", ops_leadership: "Ops leadership", account_owner: "Account owner", office_manager: "Office manager",
  dispatcher: "Dispatcher", foreman: "Foreman", technician: "Technician", warehouse: "Warehouse", finance: "Finance", readonly: "Read only",
});
const STAFF_ROLES = ROLES.filter((r) => r !== "technician");
const roleWords = (roles: readonly string[]) => roles.map((r) => ROLE_WORD[r as keyof typeof ROLE_WORD] ?? r).join(", ");

export const mayManagePeople = (ctx: ScreenContext): boolean => ctx.shell.principal.roles.includes("principal");

/** A temporary password, between the call that issued it and the principal's "Done". Never stored anywhere else. */
type Issued = { readonly userId: string; readonly password: string; readonly why: "created" | "reset" };
const issued = signal<Issued | null>(null);

const people = (ctx: ScreenContext) => ctx.store.read(keyOf("people.list"), () => ctx.shell.gateway.listPeople());

const standing = (x: PersonWire): VNode =>
  !x.active ? html`<span class="s2-state" data-tone="ended">Removed</span>`
    : x.mustChangePassword ? html`<span class="s2-state" data-tone="pending">Temporary password</span>`
      : html`<span class="s2-state" data-tone="settled">Active</span>`;

const scopeWord = (x: PersonWire): VNode => x.scope === "org" ? html`Company-wide` : html`Region <span class="s2-num">${x.regionCode}</span>`;

export const peopleList: Screen = (ctx) => {
  const list = people(ctx);
  return html`<section>
    ${pageHead("People", "Who can sign in: office staff, and technicians with their own service unit. A new login and a password reset each give a one-time temporary password.")}
    ${panel(whenReady(ctx, list.value, (p) => DataGrid({
      density: ctx.density,
      stack: true,
      columns: [
        { key: "displayName", header: "Name", cell: (x: PersonWire) => x.displayName },
        { key: "email", header: "Email", cell: (x: PersonWire) => x.email },
        { key: "roles", header: "Role", cell: (x: PersonWire) => x.kind === "technician" ? html`Technician <small class="s2-muted">${x.firmName ?? "ours"}</small>` : roleWords(x.roles) },
        { key: "scope", header: "Sees", cell: scopeWord },
        { key: "active", header: "Standing", cell: standing },
        { key: "actions", header: "", align: "end", cell: (x: PersonWire) => linkTo(ctx, "people.person", { userId: x.userId }, "Open", undefined, `Open ${x.displayName}`) },
      ],
      rows: p.people,
      rowKey: (x: PersonWire) => x.userId,
      emptyText: "No logins yet.",
    }), () => ctx.store.invalidate("people.list")),
    "Logins", null,
    html`<span class="s2-row-actions">${linkTo(ctx, "people.new", { kind: "staff" }, "+ Staff login", "ac-action s2-link--action")}${linkTo(ctx, "people.new", { kind: "technician" }, "+ Technician", "ac-action s2-link--action")}</span>`, "people")}
  </section>`;
};

const failed = (ctx: ScreenContext, err: unknown): Refusal => ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) };

const newForm = signal<{ readonly refusal: Refusal | null; readonly busy: boolean }>({ refusal: null, busy: false });

const regionSelect = (ctx: ScreenContext, name: string, label: string, selected?: string): VNode => {
  const regions = ctx.store.read(keyOf("regions.list"), () => ctx.shell.gateway.listRegions());
  return whenReady(ctx, regions.value, (r) => !r.regions.some((x) => x.active) ? noChoice(label, "No region of ours is active.") : html`<label class="ac-field">
    <span>${label}</span>
    <select name=${name} required class="ac-input">${r.regions.filter((x: RegionWire) => x.active).map((x: RegionWire) => html`<option value=${x.id} selected=${x.id === selected}>${x.name} (${x.code})</option>`)}</select>
  </label>`);
};

const roleBoxes = (held: readonly string[]): VNode => html`<fieldset class="s2-fieldset">
  <legend>Roles</legend>
  <div class="s2-chips">${STAFF_ROLES.map((r) => html`<label class="s2-radio"><input type="checkbox" name="roles" value=${r} checked=${held.includes(r)} /> ${ROLE_WORD[r]}</label>`)}</div>
  <small>Principal manages logins. A technician is made with New technician, which gives them their own unit.</small>
</fieldset>`;

const scopeRadios = (scope: "org" | "region"): VNode => html`<fieldset class="s2-fieldset">
  <legend>Sees</legend>
  <label class="s2-radio"><input type="radio" name="scope" value="org" checked=${scope === "org"} /> The whole company — Service Manager and HQ</label>
  <label class="s2-radio"><input type="radio" name="scope" value="region" checked=${scope === "region"} /> One region — the dispatch board</label>
</fieldset>`;

export const peopleNew: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const kind = params.kind === "technician" ? "technician" : "staff";
  const firms = store.read(keyOf("firms.list"), () => shell.gateway.listFirms({}));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const f = newForm.value;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const v = (k: string) => String(data.get(k) ?? "").trim();
    newForm.value = { refusal: null, busy: true };
    try {
      const out = kind === "technician"
        ? await shell.gateway.createTechnicianLogin({ email: v("email"), displayName: v("displayName"), homeRegionId: v("regionId"), ...(v("firmId") ? { firmId: v("firmId") } : {}) })
        : await shell.gateway.createStaffLogin({ email: v("email"), displayName: v("displayName"), roles: data.getAll("roles").map(String), scope: v("scope") === "region" ? "region" : "org", regionId: v("regionId") });
      issued.value = { userId: out.userId, password: out.temporaryPassword, why: "created" };
      store.invalidate("people.list");
      if (kind === "technician") store.invalidate("crews.list");
      newForm.value = { refusal: null, busy: false };
      ctx.router.navigate("people.person", { userId: out.userId });
    } catch (err) {
      newForm.value = { refusal: failed(ctx, err), busy: false };
    }
  };

  return html`<section class="s2-form-screen">
    ${pageHead(kind === "technician" ? "New technician" : "New staff login",
      kind === "technician"
        ? "A technician's login, made with their own service unit — the unit Dispatch sends them on and a shift grant names."
        : "An office login. It signs in to the Service Manager and HQ company-wide, or to one region's dispatch board.")}
    <form class="ac-form" onSubmit=${submit} id="person-form">
      <label class="ac-field"><span>Name</span><input class="ac-input" name="displayName" required autocomplete="off" /></label>
      <label class="ac-field"><span>Email</span><input class="ac-input" name="email" type="email" required autocomplete="off" /><small>What they sign in with.</small></label>
      ${kind === "technician"
        ? html`${regionSelect(ctx, "regionId", "Dispatched from")}
            ${whenReady(ctx, firms.value, (fs) => html`<label class="ac-field">
              <span>Employer</span>
              <select name="firmId" class="ac-input">
                <option value="">Ours</option>
                ${fs.firms.filter((x: FirmWire) => x.status !== "terminated").map((x: FirmWire) => html`<option value=${x.id}>${x.legalName}</option>`)}
              </select>
              <small>Their unit is made under whoever employs them.</small>
            </label>`)}`
        : html`${roleBoxes([])}${scopeRadios("org")}${regionSelect(ctx, "regionId", "Home region")}`}
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Saving…" : kind === "technician" ? "Make technician login" : "Make staff login", "save-person", noActiveRegion(regions.value))}
        ${linkTo(ctx, "people", {}, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to people", onSelect: () => ctx.router.navigate("people", {}) }]) : null}
  </section>`;
};

type PersonState = { readonly userId: string; readonly refusal: Refusal | null; readonly busy: boolean; readonly confirm: "reset" | "active" | null };
const personForm = signal<PersonState>({ userId: "", refusal: null, busy: false, confirm: null });

const temporaryPanel = (x: PersonWire, i: Issued): VNode => panel(html`
  <p>Give this to ${x.displayName} in person or by phone. It is shown once: it is not kept anywhere and cannot be shown again. At their next sign-in — the Service Manager, the dispatch board or the field app — they choose their own.</p>
  <code class="s2-secret" id="temporary-password">${i.password}</code>
  <div class="s2-form__actions"><button type="button" class="s2-mutation" id="temporary-done" onClick=${() => { issued.value = null; }}>Done — I have given it to them</button></div>`,
  i.why === "created" ? "Temporary password" : "New temporary password", null, null, "temporary");

const personView = (ctx: ScreenContext, x: PersonWire): VNode => {
  const { shell, store } = ctx;
  if (personForm.value.userId !== x.userId) personForm.value = { userId: x.userId, refusal: null, busy: false, confirm: null };
  const f = personForm.value;
  const self = x.userId === shell.principal.subjectId;
  const shown = issued.value?.userId === x.userId ? issued.value : null;

  const act = async (fn: () => Promise<void>, notice: string) => {
    personForm.value = { ...f, refusal: null, busy: true };
    try {
      await fn();
      store.invalidate("people.list");
      store.notice.value = [notice];
      personForm.value = { ...personForm.value, busy: false, confirm: null };
    } catch (err) {
      personForm.value = { ...personForm.value, refusal: failed(ctx, err), busy: false, confirm: null };
    }
  };

  const save = (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const v = (k: string) => String(data.get(k) ?? "").trim();
    void act(() => shell.gateway.updatePerson({
      userId: x.userId, email: v("email"), displayName: v("displayName"),
      ...(x.kind === "staff" ? { roles: data.getAll("roles").map(String), scope: v("scope") === "region" ? "region" as const : "org" as const, regionId: v("regionId") } : {}),
    }).then(() => {}), `${v("displayName")} saved.`);
  };
  const reset = () => act(async () => {
    const out = await shell.gateway.resetPersonPassword({ userId: x.userId });
    issued.value = { userId: x.userId, password: out.temporaryPassword, why: "reset" };
  }, `${x.displayName}'s password was reset; every session they held has ended.`);
  const flip = () => act(() => shell.gateway.setPersonActive({ userId: x.userId, active: !x.active }).then(() => {}),
    x.active ? `${x.displayName} can no longer sign in.` : `${x.displayName} can sign in again.`);

  return html`<section class="s2-form-screen">
    ${pageHead(x.displayName, x.kind === "technician"
      ? `Technician on their own unit, ${x.crewLabel ?? "—"} — ${x.firmName ?? "ours"}, region ${x.regionCode}.`
      : `${roleWords(x.roles)} · ${x.scope === "org" ? "company-wide" : `region ${x.regionCode}`}.`)}
    ${shown ? temporaryPanel(x, shown) : null}
    <form class="ac-form" onSubmit=${save} id="person-form">
      <label class="ac-field"><span>Name</span><input class="ac-input" name="displayName" required value=${x.displayName} autocomplete="off" /></label>
      <label class="ac-field"><span>Email</span><input class="ac-input" name="email" type="email" required value=${x.email} autocomplete="off" /></label>
      ${x.kind === "staff"
        ? html`${roleBoxes(x.roles)}${scopeRadios(x.scope)}${regionSelect(ctx, "regionId", "Home region", x.regionId)}`
        : html`<p class="s2-parent">A technician's role and region follow their unit.</p>`}
      <div class="s2-form__actions">
        ${submitAction(ctx, f.busy ? "Saving…" : "Save", "save-person")}
        ${linkTo(ctx, "people", {}, "Back to people")}
      </div>
    </form>
    ${panel(html`<div class="s2-row-actions">
        ${self ? html`<p class="s2-parent">Your own password is changed from the Account button.</p>`
          : x.active ? html`<button type="button" class="s2-mutation" id="reset-password" aria-expanded=${f.confirm === "reset"} disabled=${ctx.degraded || f.busy || f.confirm !== null} onClick=${() => { personForm.value = { ...f, confirm: "reset" }; }}>Reset password</button>` : null}
        <button type="button" class=${`s2-mutation${x.active ? " s2-mutation--danger" : ""}`} id="set-active" aria-expanded=${f.confirm === "active"} disabled=${ctx.degraded || f.busy || f.confirm !== null} onClick=${() => { personForm.value = { ...f, confirm: "active" }; }}>${x.active ? "Remove login" : "Bring back"}</button>
      </div>
      ${f.confirm === "reset" ? confirmPanel({
        id: "confirm-reset", title: `Reset ${x.displayName}'s password?`,
        detail: "Every session they hold ends now. You get a temporary password to give them; they choose their own at their next sign-in.",
        confirmLabel: "Reset password", busy: f.busy, disabled: ctx.degraded,
        onConfirm: () => { void reset(); }, onCancel: () => { personForm.value = { ...personForm.value, confirm: null }; },
      }) : null}
      ${f.confirm === "active" ? confirmPanel({
        id: "confirm-active", title: x.active ? `Remove ${x.displayName}'s login?` : `Bring ${x.displayName} back?`,
        detail: x.active
          ? `They are signed out everywhere and cannot sign in.${x.kind === "technician" ? " Their unit is retired unless it still holds work Dispatch has not released." : ""}`
          : `They can sign in again with their current password.${x.kind === "technician" ? " Their unit comes back with them." : ""}`,
        confirmLabel: x.active ? "Remove login" : "Bring back", danger: x.active, busy: f.busy, disabled: ctx.degraded,
        onConfirm: () => { void flip(); }, onCancel: () => { personForm.value = { ...personForm.value, confirm: null }; },
      }) : null}`, "Access", standing(x))}
    ${f.refusal ? refusalView(ctx, f.refusal, [{ label: "Back to people", onSelect: () => ctx.router.navigate("people", {}) }]) : null}
  </section>`;
};

export const peoplePerson: Screen = (ctx, params) => whenReady(ctx, people(ctx).value, (p) => {
  const x = p.people.find((y) => y.userId === params.userId);
  return x ? personView(ctx, x) : html`<p class="s2-empty">No login ${params.userId}.</p>`;
});
