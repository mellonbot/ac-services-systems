import type { Refusal } from "../../../contracts/src/index.ts";
import {
  PRESENCES, PRESENCE_LABEL, STATUS_NOTE_MAX, DISPLAY_NAME_MAX, AVATAR_MAX_BYTES, ACCOUNT_PASSWORD_MIN, ACCOUNT_PASSWORD_MAX,
  type MyAccountWire, type UpdateMyAccountInput, type SetAvatarInput, type ChangePasswordInput, type ChangePasswordOutput, type Presence,
} from "../../../contracts/src/operations.ts";
import { AccountMenuSpec } from "../component.ts";
import { component, html, signal, type VNode } from "../render.ts";
import { notice } from "../layout.ts";
import { RefusalNotice } from "./refusal-notice.ts";
import { PrimaryAction } from "./primary-action.ts";

/**
 * THE ACCOUNT BUTTON (0032) — one control in every signed-in surface's nav,
 * beside Sign out: the person's picture (or initials) and the word Account.
 * It opens a modal dialog where they set their picture, name and status, and
 * change their password. Drawn once here so S2–S8 carry the same control; a
 * surface places it and never redraws it.
 *
 * The state lives in `createAccountMenu`, made once per signed-in shell; the
 * component is the view over it. It takes the generated client's four
 * methods by shape, so this package still names no shell.
 *
 * Presence is what the person says about themselves, not a state the system
 * derived: it is a word in the text ink, never a status colour.
 */
export type AccountGateway = {
  myAccount(): Promise<MyAccountWire>;
  updateMyAccount(input: UpdateMyAccountInput): Promise<MyAccountWire>;
  setAccountAvatar(input: SetAvatarInput): Promise<MyAccountWire>;
  changePassword(input: ChangePasswordInput): Promise<ChangePasswordOutput>;
};

type Section = "picture" | "profile" | "password";
type Outcome = { readonly section: Section } & ({ readonly ok: string } | { readonly refusal: Refusal });

export type AccountMenuState = ReturnType<typeof createAccountMenu>;

export const createAccountMenu = (gateway: AccountGateway, refusalOf: (e: unknown) => Refusal | null) => {
  const open = signal(false);
  const account = signal<MyAccountWire | null>(null);
  const loadRefusal = signal<Refusal | null>(null);
  const busy = signal<Section | null>(null);
  const outcome = signal<Outcome | null>(null);
  const refusal = (e: unknown): Refusal => refusalOf(e) ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : String(e) };

  const load = async () => {
    try { account.value = await gateway.myAccount(); loadRefusal.value = null; }
    catch (e) { loadRefusal.value = refusal(e); }
  };
  const run = async <T>(section: Section, call: () => Promise<T>, ok: (out: T) => string) => {
    busy.value = section;
    outcome.value = null;
    try { const out = await call(); outcome.value = { section, ok: ok(out) }; }
    catch (e) { outcome.value = { section, refusal: refusal(e) }; }
    finally { busy.value = null; }
  };

  void load();
  return {
    open, account, loadRefusal, busy, outcome,
    show: () => { outcome.value = null; open.value = true; void load(); },
    hide: () => { open.value = false; },
    saveProfile: (input: UpdateMyAccountInput) =>
      run("profile", () => gateway.updateMyAccount(input), (a) => { account.value = a; return "Saved."; }),
    setPicture: (dataBase64: string | null) =>
      run("picture", () => gateway.setAccountAvatar({ dataBase64 }), (a) => { account.value = a; return dataBase64 ? "Picture saved." : "Picture removed."; }),
    changePassword: (input: ChangePasswordInput) =>
      run("password", () => gateway.changePassword(input), (out) => {
        if (account.value) account.value = { ...account.value, passwordChangedAt: out.passwordChangedAt };
        return out.endedSessions > 0
          ? `Password changed. ${out.endedSessions} other ${out.endedSessions === 1 ? "session was" : "sessions were"} signed out.`
          : "Password changed.";
      }),
    /** A refusal the menu raised without asking the gateway (a file it could not read, two passwords that differ). */
    refuse: (section: Section, message: string) => { outcome.value = { section, refusal: { kind: "bad_request", message } }; },
  };
};

export const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const avatar = (a: MyAccountWire | null, cls: string): VNode =>
  a?.avatar
    ? html`<img class=${cls} src=${`data:${a.avatar.contentType};base64,${a.avatar.image}`} alt="" />`
    : html`<span class=${cls}>${initialsOf(a?.displayName ?? "")}</span>`;

/**
 * Center-crop and scale a picked file to a square JPEG under AVATAR_MAX_BYTES,
 * in the browser, so the gateway is sent a thumbnail and never a phone photo.
 * Returns base64. Browser-only: it needs a canvas.
 */
export const AVATAR_EDGE = 192;
export const squareThumbnail = async (file: Blob): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_EDGE;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= AVATAR_MAX_BYTES) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    }
  }
  throw new Error(`that picture could not be made smaller than ${AVATAR_MAX_BYTES / 1024} KB`);
};

const when = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

export type AccountMenuProps = { readonly menu: AccountMenuState };

export const AccountMenu = component<typeof AccountMenuSpec, AccountMenuProps>(AccountMenuSpec, ({ density, menu }) => {
  const a = menu.account.value;
  const busy = menu.busy.value;
  const out = menu.outcome.value;
  const result = (section: Section): VNode | null =>
    !out || out.section !== section ? null
      : "ok" in out ? notice("ok", out.ok, `ac-account-${section}-result`)
        : RefusalNotice({ density, refusal: out.refusal });

  const pickPicture = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    let b64: string;
    try { b64 = await squareThumbnail(file); }
    catch (err) { menu.refuse("picture", err instanceof Error && err.message.startsWith("that picture") ? err.message : "that file could not be read as a picture — choose a JPEG or PNG"); return; }
    await menu.setPicture(b64);
  };
  const submitProfile = (e: Event) => {
    e.preventDefault();
    if (menu.busy.value) return;
    const f = new FormData(e.currentTarget as HTMLFormElement);
    void menu.saveProfile({
      displayName: String(f.get("displayName") ?? ""),
      presence: String(f.get("presence") ?? "available") as Presence,
      statusNote: String(f.get("statusNote") ?? "").trim() || null,
    });
  };
  const submitPassword = (e: Event) => {
    e.preventDefault();
    if (menu.busy.value) return;
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const next = String(f.get("newPassword") ?? "");
    if (next !== String(f.get("confirmPassword") ?? "")) { menu.refuse("password", "the two new passwords do not match"); return; }
    void menu.changePassword({ currentPassword: String(f.get("currentPassword") ?? ""), newPassword: next }).then(() => {
      if (menu.outcome.value && "ok" in menu.outcome.value) form.reset();
    });
  };

  return html`<span class="ac-account-wrap">
    <button type="button" class="ac-account" id="account-menu" aria-haspopup="dialog" aria-expanded=${menu.open.value ? "true" : "false"}
      aria-label=${a ? `Account — ${a.displayName}, ${PRESENCE_LABEL[a.presence]}` : "Account"} onClick=${menu.show}>
      ${avatar(a, "ac-account__avatar")}<span class="ac-account__label">Account</span>
    </button>
    ${menu.open.value ? html`<dialog class="ac-account__dialog" data-density=${density} aria-labelledby="ac-account-title"
        ref=${(el: HTMLDialogElement | null) => { if (el && !el.open) el.showModal(); }}
        onClose=${menu.hide}>
      <header class="ac-account__head">
        ${avatar(a, "ac-account__avatar ac-account__avatar--large")}
        <div>
          <h2 class="ac-account__title" id="ac-account-title">${a?.displayName ?? "Your account"}</h2>
          ${a ? html`<p class="ac-account__meta">${a.email}</p><p class="ac-account__meta">${PRESENCE_LABEL[a.presence]}${a.statusNote ? ` — ${a.statusNote}` : ""}</p>` : null}
        </div>
      </header>
      ${menu.loadRefusal.value ? RefusalNotice({ density, refusal: menu.loadRefusal.value }) : null}
      ${a ? html`
      <section class="ac-account__section" aria-labelledby="ac-account-picture">
        <h3 class="ac-account__section-title" id="ac-account-picture">Picture</h3>
        <div class="ac-account__row">
          <label class="ac-account__file"><input type="file" accept="image/jpeg,image/png" onChange=${pickPicture} aria-describedby="ac-account-picture-hint" /><span>${busy === "picture" ? "Saving…" : a.avatar ? "Change picture" : "Add a picture"}</span></label>
          ${a.avatar ? html`<button type="button" class="ac-link ac-link--button" onClick=${() => menu.setPicture(null)}>Remove</button>` : null}
        </div>
        <p class="ac-field__hint" id="ac-account-picture-hint">A JPEG or PNG. It is cropped square and made small before it is sent.</p>
        ${result("picture")}
      </section>
      <form class="ac-form ac-account__section" onSubmit=${submitProfile} aria-labelledby="ac-account-profile">
        <h3 class="ac-account__section-title" id="ac-account-profile">Name and status</h3>
        <label class="ac-field"><span>Your name</span><input class="ac-input" name="displayName" required maxLength=${DISPLAY_NAME_MAX} autocomplete="name" value=${a.displayName} /></label>
        <label class="ac-field"><span>Status</span><select class="ac-input" name="presence">
          ${PRESENCES.map((p) => html`<option value=${p} selected=${p === a.presence}>${PRESENCE_LABEL[p]}</option>`)}
        </select></label>
        <label class="ac-field"><span>Status note</span><input class="ac-input" name="statusNote" maxLength=${STATUS_NOTE_MAX} value=${a.statusNote ?? ""} placeholder="On a roof in Plano until 3" /><small>Optional, one line.</small></label>
        ${PrimaryAction({ density, type: "submit", label: busy === "profile" ? "Saving…" : "Save", id: "account-save" })}
        ${result("profile")}
      </form>
      <form class="ac-form ac-account__section" onSubmit=${submitPassword} aria-labelledby="ac-account-password">
        <h3 class="ac-account__section-title" id="ac-account-password">Password</h3>
        <p class="ac-field__hint">${a.passwordChangedAt ? `Last changed ${when(a.passwordChangedAt)}.` : "Not changed since this login was made."} Changing it signs you out everywhere else.</p>
        <input type="text" name="username" autocomplete="username" value=${a.email} hidden />
        <label class="ac-field"><span>Current password</span><input class="ac-input" name="currentPassword" type="password" required autocomplete="current-password" /></label>
        <label class="ac-field"><span>New password</span><input class="ac-input" name="newPassword" type="password" required minLength=${ACCOUNT_PASSWORD_MIN} maxLength=${ACCOUNT_PASSWORD_MAX} autocomplete="new-password" /><small>At least ${ACCOUNT_PASSWORD_MIN} characters.</small></label>
        <label class="ac-field"><span>New password, again</span><input class="ac-input" name="confirmPassword" type="password" required minLength=${ACCOUNT_PASSWORD_MIN} maxLength=${ACCOUNT_PASSWORD_MAX} autocomplete="new-password" /></label>
        ${PrimaryAction({ density, type: "submit", label: busy === "password" ? "Changing…" : "Change password", id: "account-change-password" })}
        ${result("password")}
      </form>` : html`<p class="ac-account__meta" role="status">${menu.loadRefusal.value ? "" : "Loading…"}</p>`}
      <footer class="ac-account__foot">
        <button type="button" class="ac-account__close" onClick=${(e: Event) => (e.currentTarget as HTMLElement).closest("dialog")?.close()}>Close</button>
      </footer>
    </dialog>` : null}
  </span>`;
});
