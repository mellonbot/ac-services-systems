import { randomUUID } from "node:crypto";
import type { Tx } from "../db/unit-of-work.ts";
import { InputRefused, BadInput } from "../http/refusals.ts";
import { hashPasswordAsync, verifyPasswordAsync } from "../auth/auth.ts";
import { revokeUserSessions } from "../auth/sessions.ts";
import type { Principal } from "../../../../packages/contracts/src/scope.ts";
import type { SurfaceId } from "../../../../packages/contracts/src/surfaces.ts";
import {
  PRESENCES, STATUS_NOTE_MAX, DISPLAY_NAME_MAX, AVATAR_MAX_BYTES, ACCOUNT_PASSWORD_MIN, ACCOUNT_PASSWORD_MAX, sniffPhoto,
  type MyAccountWire, type AvatarContentType, type Presence, type UpdateMyAccountInput, type SetAvatarInput, type ChangePasswordInput, type ChangePasswordOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * THE ACCOUNT BUTTON (0032) — the caller's own users row, and only that row.
 *
 * Every statement here is `WHERE id = $actor`, where the actor is the token's
 * subject: a person or, on S5, the technician behind the shift grant. There is
 * no input naming whose account, so there is nobody else's to reach. The
 * gateway runs these as itself (the caller's tx is bound to `system` by the
 * session check), the way login reads users and logout writes sessions —
 * identity is the gateway's, not a surface's write allowlist.
 *
 * Each write leaves an audit row in the same transaction. The picture's bytes
 * and the password hash never go into one: the row says that they changed.
 */
type Row = {
  id: string; org_id: string; region_id: string; email: string; display_name: string;
  presence: Presence; status_note: string | null; avatar: Buffer | null; avatar_type: AvatarContentType | null;
  password_changed_at: Date | null;
};
const COLUMNS = "id, org_id, region_id, email, display_name, presence, status_note, avatar, avatar_type, password_changed_at";

export type AccountActor = { readonly principal: Principal; readonly surfaceId: SurfaceId; readonly requestId: string };

const wire = (r: Row): MyAccountWire => ({
  userId: r.id, email: r.email, displayName: r.display_name, presence: r.presence, statusNote: r.status_note,
  avatar: r.avatar && r.avatar_type ? { contentType: r.avatar_type, image: r.avatar.toString("base64") } : null,
  passwordChangedAt: r.password_changed_at ? new Date(r.password_changed_at).toISOString() : null,
});

const own = async (tx: Tx, a: AccountActor, lock = false): Promise<Row & { password_hash: string | null }> => {
  const r = (await tx.query<Row & { password_hash: string | null }>(
    `SELECT ${COLUMNS}, password_hash FROM users WHERE id = $1 AND active${lock ? " FOR UPDATE" : ""}`, [a.principal.subjectId]))[0];
  if (!r) throw new InputRefused("this sign-in has no account of its own to show", "no_account");
  return r;
};

const audit = (tx: Tx, a: AccountActor, r: Row, action: string, before: unknown, after: unknown) =>
  tx.query(
    `INSERT INTO audit_log (event_id, actor_id, surface_id, session_id, request_id, action, entity, entity_id, before, after, region_id, org_id)
     VALUES ($1,$2,$3,$4,$5,$6,'user',$2,$7,$8,$9,$10)`,
    [randomUUID(), r.id, a.surfaceId, a.principal.sessionId, a.requestId, action, JSON.stringify(before), JSON.stringify(after), r.region_id, r.org_id],
  );

export const readMyAccount = async (tx: Tx, a: AccountActor): Promise<MyAccountWire> => wire(await own(tx, a));

const oneLine = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string") throw new BadInput(`${field} must be a string`);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > max) throw new InputRefused(`${field} is at most ${max} characters`, "too_long");
  return s;
};

export const updateMyAccount = async (tx: Tx, a: AccountActor, input: UpdateMyAccountInput): Promise<MyAccountWire> => {
  const r = await own(tx, a, true);
  const next = { displayName: r.display_name, presence: r.presence, statusNote: r.status_note };
  if (input.displayName !== undefined) {
    next.displayName = oneLine(input.displayName, "your name", DISPLAY_NAME_MAX);
    if (!next.displayName) throw new InputRefused("your name cannot be blank", "blank_name");
  }
  if (input.presence !== undefined) {
    if (!(PRESENCES as readonly string[]).includes(input.presence)) throw new BadInput(`presence is one of ${PRESENCES.join(", ")}`);
    next.presence = input.presence;
  }
  if (input.statusNote !== undefined) next.statusNote = input.statusNote === null ? null : oneLine(input.statusNote, "your status", STATUS_NOTE_MAX) || null;
  const out = (await tx.query<Row>(
    `UPDATE users SET display_name = $2, presence = $3, status_note = $4 WHERE id = $1 RETURNING ${COLUMNS}`,
    [r.id, next.displayName, next.presence, next.statusNote]))[0]!;
  await audit(tx, a, r, "account.update", { displayName: r.display_name, presence: r.presence, statusNote: r.status_note }, next);
  return wire(out);
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const setMyAvatar = async (tx: Tx, a: AccountActor, input: SetAvatarInput): Promise<MyAccountWire> => {
  let bytes: Buffer | null = null;
  let type: AvatarContentType | null = null;
  if (input.dataBase64 !== null) {
    if (typeof input.dataBase64 !== "string" || input.dataBase64.length === 0) throw new BadInput("dataBase64 is a base64 string, or null to clear the picture");
    if (input.dataBase64.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4) throw new InputRefused(`a picture is at most ${AVATAR_MAX_BYTES / 1024} KB`, "avatar_too_large");
    if (!BASE64.test(input.dataBase64)) throw new BadInput("dataBase64 is not base64");
    bytes = Buffer.from(input.dataBase64, "base64");
    if (bytes.length > AVATAR_MAX_BYTES) throw new InputRefused(`a picture is at most ${AVATAR_MAX_BYTES / 1024} KB`, "avatar_too_large");
    const sniffed = sniffPhoto(new Uint8Array(bytes));
    if (sniffed !== "image/jpeg" && sniffed !== "image/png") throw new InputRefused("that file is not a JPEG or PNG picture", "not_a_photo");
    type = sniffed;
  }
  const r = await own(tx, a, true);
  const out = (await tx.query<Row>(`UPDATE users SET avatar = $2, avatar_type = $3 WHERE id = $1 RETURNING ${COLUMNS}`, [r.id, bytes, type]))[0]!;
  await audit(tx, a, r, "account.set_avatar", { avatar: r.avatar !== null }, { avatar: bytes !== null, bytes: bytes?.length ?? 0 });
  return wire(out);
};

/** The sign-in throttle, owned by main.ts: a wrong current password is a failed sign-in for this email. */
export type PasswordGuard = { readonly allowed: (email: string) => boolean; readonly failed: (email: string) => void };

export const changeMyPassword = async (tx: Tx, a: AccountActor, input: ChangePasswordInput, guard: PasswordGuard): Promise<ChangePasswordOutput> => {
  if (typeof input.currentPassword !== "string" || typeof input.newPassword !== "string") throw new BadInput("currentPassword and newPassword are required");
  const r = await own(tx, a, true);
  const who = r.email.toLowerCase();
  if (!guard.allowed(who)) throw new InputRefused("too many wrong passwords — wait a few minutes and try again", "throttled");
  if (!(await verifyPasswordAsync(input.currentPassword, r.password_hash))) {
    guard.failed(who);
    throw new InputRefused("your current password is not right", "wrong_password");
  }
  if (input.newPassword.length < ACCOUNT_PASSWORD_MIN) throw new InputRefused(`a new password is at least ${ACCOUNT_PASSWORD_MIN} characters`, "password_too_short");
  if (input.newPassword.length > ACCOUNT_PASSWORD_MAX) throw new InputRefused(`a new password is at most ${ACCOUNT_PASSWORD_MAX} characters`, "password_too_long");
  if (input.newPassword === input.currentPassword) throw new InputRefused("the new password is the same as the current one", "password_unchanged");
  const changed = (await tx.query<{ password_changed_at: Date }>(
    "UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1 RETURNING password_changed_at",
    [r.id, await hashPasswordAsync(input.newPassword)]))[0]!;
  // Every other session the person holds ends: their other browsers, and a
  // technician's device sessions. A password changed because it leaked is
  // otherwise still signed in wherever it leaked to.
  const endedSessions = await revokeUserSessions((sql, params) => tx.query(sql, params ?? []), r.id, a.principal.sessionId);
  await audit(tx, a, r, "account.change_password", null, { endedSessions });
  return { ok: true, passwordChangedAt: new Date(changed.password_changed_at).toISOString(), endedSessions };
};
