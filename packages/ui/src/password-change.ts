import { html, type VNode } from "./render.ts";
import { ACCOUNT_PASSWORD_MIN, PASSWORD_CHANGE_REQUIRED, type Refusal } from "../../contracts/src/index.ts";

/**
 * 0038 — the sign-in that replaces a temporary password. A principal resets a
 * login in S2; the gateway refuses the temporary password alone with
 * `password_change_required` and mints nothing. The same form, on S2, S3 and
 * S5, then asks for a new password and signs in with both.
 *
 * The fields stay up for every refusal that is about the new password — the
 * gateway's floor and "that is the temporary one", and this form's own "the
 * two do not match" — so a typo does not send the person back to the start.
 */
const ABOUT_THE_NEW_PASSWORD: readonly string[] = [PASSWORD_CHANGE_REQUIRED, "password_too_short", "password_too_long", "password_unchanged", "passwords_differ"];

export const choosingNewPassword = (r: Refusal | null): boolean =>
  r?.kind === "admission" && ABOUT_THE_NEW_PASSWORD.includes(r.code);

export const newPasswordFields = (r: Refusal | null): VNode | null => choosingNewPassword(r)
  ? html`<label class="ac-field"><span>New password</span><input class="ac-input" name="newPassword" type="password" required minlength=${ACCOUNT_PASSWORD_MIN} autocomplete="new-password" /><small>At least ${ACCOUNT_PASSWORD_MIN} characters. It replaces the temporary password the office gave you.</small></label>
      <label class="ac-field"><span>Repeat new password</span><input class="ac-input" name="repeatPassword" type="password" required autocomplete="new-password" /></label>`
  : null;

/** The new password from a submitted form: absent when the form is not asking, or a refusal when the two differ. */
export const newPasswordFrom = (f: FormData): { readonly newPassword?: string } | { readonly refusal: Refusal } => {
  const next = f.get("newPassword");
  if (next === null) return {};
  if (String(next) !== String(f.get("repeatPassword") ?? "")) {
    return { refusal: { kind: "admission", code: "passwords_differ", axis: "structural", message: "The two new passwords are not the same. Type it again in both boxes." } };
  }
  return { newPassword: String(next) };
};
