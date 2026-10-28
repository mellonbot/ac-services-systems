import { randomUUID } from "node:crypto";
import type { Tx } from "../unit-of-work.ts";
import { InputRefused, BadInput } from "../refusals.ts";
import type { AccountActor } from "./account.ts";
import {
  PRESENCES, STAFF_MESSAGE_MAX, STAFF_EVERYONE_GAP_SECONDS,
  type Presence, type StaffAudience, type StaffColleagueWire, type StaffDirectoryOutput, type StaffMessageWire,
  type StaffPendingOutput, type StaffRecentOutput, type SendStaffMessageInput, type SendStaffMessageOutput,
  type DismissStaffMessageInput, type DismissStaffMessageOutput,
} from "../../../../packages/contracts/src/operations.ts";

/**
 * COMPANY MESSAGES (0035). The caller is the token's subject: a person, or on
 * S5 the technician behind the shift. Only an AC Services employee may call
 * these, and only another employee can be named.
 *
 * An employee is an active internal login with no firm of their own, and not
 * sitting on a crew that belongs to a firm. That is the office, dispatch, HQ
 * and an employed technician. A customer, a vendor, a firm's coordinator and
 * a person on a firm's crew are none of those, so they are not in the
 * directory, not a recipient, and not a sender.
 *
 * The gateway runs this as itself. Every statement still names the subject.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `alias` is a users correlation name we wrote, not input. */
const employee = (alias: string): string =>
  `${alias}.namespace = 'internal' AND ${alias}.active AND ${alias}.firm_id IS NULL AND (${alias}.crew_id IS NULL OR EXISTS (SELECT 1 FROM crews c WHERE c.id = ${alias}.crew_id AND c.firm_id IS NULL))`;

type Person = { id: string; org_id: string; region_id: string; display_name: string };

const actor = async (tx: Tx, a: AccountActor): Promise<Person> => {
  const row = (await tx.query<Person>(
    `SELECT id, org_id, region_id, display_name FROM users u WHERE u.id = $1 AND ${employee("u")}`,
    [a.principal.subjectId],
  ))[0];
  if (!row) throw new InputRefused("this sign-in is not an AC Services employee", "not_staff");
  return row;
};

const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new BadInput(`${field} must be a uuid`);
  return v;
};

const bodyOf = (v: unknown): string => {
  if (typeof v !== "string") throw new BadInput("body must be text");
  const body = v.trim();
  if (!body) throw new InputRefused("the message is empty", "blank_message");
  if (body.length > STAFF_MESSAGE_MAX) throw new InputRefused(`a message is at most ${STAFF_MESSAGE_MAX} characters`, "too_long");
  return body;
};

const rolesOf = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const presenceOf = (v: string): Presence => (PRESENCES as readonly string[]).includes(v) ? v as Presence : "available";

type MessageRow = {
  message_id: string; sender_id: string; sender_name: string; audience: StaffAudience;
  recipient_id: string | null; recipient_name: string | null; body: string; created_at: Date;
  sent: boolean; dismissed_at: Date | null;
};

const wire = (r: MessageRow): StaffMessageWire => ({
  messageId: r.message_id,
  senderId: r.sender_id,
  senderName: r.sender_name,
  audience: r.audience,
  recipientId: r.recipient_id,
  recipientName: r.recipient_name,
  body: r.body,
  sentAt: new Date(r.created_at).toISOString(),
  direction: r.sent ? "sent" : "received",
  dismissed: r.dismissed_at !== null,
});

const MESSAGE_COLUMNS = `m.id AS message_id, m.sender_id, su.display_name AS sender_name, m.audience,
  m.recipient_id, ru.display_name AS recipient_name, m.body, m.created_at`;

export const listColleagues = async (tx: Tx, a: AccountActor): Promise<StaffDirectoryOutput> => {
  const me = await actor(tx, a);
  const rows = await tx.query<{ id: string; display_name: string; presence: string; roles: unknown }>(
    `SELECT id, display_name, presence, roles FROM users u
      WHERE ${employee("u")} AND u.id <> $1
      ORDER BY lower(u.display_name), u.id`,
    [me.id],
  );
  const people: StaffColleagueWire[] = rows.map((r) => ({
    userId: r.id, displayName: r.display_name, presence: presenceOf(r.presence), roles: rolesOf(r.roles),
  }));
  return { people };
};

export const listPending = async (tx: Tx, a: AccountActor): Promise<StaffPendingOutput> => {
  const me = await actor(tx, a);
  const rows = await tx.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS}, false AS sent, r.dismissed_at
       FROM staff_message_receipts r
       JOIN staff_messages m ON m.id = r.message_id
       JOIN users su ON su.id = m.sender_id
       LEFT JOIN users ru ON ru.id = m.recipient_id
      WHERE r.user_id = $1 AND r.dismissed_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT 20`,
    [me.id],
  );
  return { messages: rows.map(wire) };
};

export const listRecent = async (tx: Tx, a: AccountActor): Promise<StaffRecentOutput> => {
  const me = await actor(tx, a);
  const rows = await tx.query<MessageRow>(
    `SELECT ${MESSAGE_COLUMNS}, (m.sender_id = $1) AS sent, r.dismissed_at
       FROM staff_messages m
       JOIN users su ON su.id = m.sender_id
       LEFT JOIN users ru ON ru.id = m.recipient_id
       LEFT JOIN staff_message_receipts r ON r.message_id = m.id AND r.user_id = $1
      WHERE m.sender_id = $1 OR r.user_id = $1
      ORDER BY m.created_at DESC
      LIMIT 40`,
    [me.id],
  );
  return { messages: rows.map(wire) };
};

export const sendStaffMessage = async (tx: Tx, a: AccountActor, input: SendStaffMessageInput): Promise<SendStaffMessageOutput> => {
  const me = await actor(tx, a);
  const body = bodyOf(input.body);
  const everyone = input.everyone === true;
  const named = input.toUserId !== undefined && input.toUserId !== "";
  if (everyone && named) throw new BadInput("name one person, or everyone, not both");
  if (!everyone && !named) throw new BadInput("name one person, or everyone");

  let recipient: Person | null = null;
  if (!everyone) {
    const to = uuid(input.toUserId, "toUserId");
    if (to === me.id) throw new InputRefused("you cannot message yourself", "not_yourself");
    recipient = (await tx.query<Person>(
      `SELECT id, org_id, region_id, display_name FROM users u WHERE u.id = $1 AND ${employee("u")}`,
      [to],
    ))[0] ?? null;
    if (!recipient) throw new InputRefused("that person is not an AC Services employee", "not_a_colleague");
  } else {
    const recent = await tx.query(
      `SELECT 1 FROM staff_messages WHERE sender_id = $1 AND audience = 'everyone' AND created_at > now() - make_interval(secs => $2::int)`,
      [me.id, STAFF_EVERYONE_GAP_SECONDS],
    );
    if (recent.length) throw new InputRefused("wait a moment before sending to everyone again", "everyone_too_soon");
  }

  const message = (await tx.query<{ id: string; created_at: Date }>(
    `INSERT INTO staff_messages (org_id, region_id, sender_id, audience, recipient_id, body)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [me.org_id, me.region_id, me.id, everyone ? "everyone" : "direct", recipient?.id ?? null, body],
  ))[0]!;

  const copies = everyone
    ? await tx.query<{ user_id: string }>(
      `INSERT INTO staff_message_receipts (org_id, region_id, message_id, user_id)
       SELECT u.org_id, u.region_id, $1, u.id FROM users u
        WHERE ${employee("u")} AND u.id <> $2
       RETURNING user_id`,
      [message.id, me.id],
    )
    : await tx.query<{ user_id: string }>(
      `INSERT INTO staff_message_receipts (org_id, region_id, message_id, user_id) VALUES ($1, $2, $3, $4) RETURNING user_id`,
      [recipient!.org_id, recipient!.region_id, message.id, recipient!.id],
    );

  await tx.query(
    `INSERT INTO audit_log (event_id, actor_id, surface_id, session_id, request_id, action, entity, entity_id, before, after, region_id, org_id)
     VALUES ($1,$2,$3,$4,$5,'messages.send','staff_message',$6,NULL,$7,$8,$9)`,
    [randomUUID(), me.id, a.surfaceId, a.principal.sessionId, a.requestId, message.id,
      JSON.stringify({ audience: everyone ? "everyone" : "direct", recipientId: recipient?.id ?? null, bodyLength: body.length, recipients: copies.length }),
      me.region_id, me.org_id],
  );
  return { messageId: message.id, sentAt: new Date(message.created_at).toISOString(), recipients: copies.length };
};

export const dismissStaffMessage = async (tx: Tx, a: AccountActor, input: DismissStaffMessageInput): Promise<DismissStaffMessageOutput> => {
  const me = await actor(tx, a);
  const messageId = uuid(input.messageId, "messageId");
  const row = (await tx.query<{ dismissed_at: Date | null }>(
    `SELECT dismissed_at FROM staff_message_receipts WHERE message_id = $1 AND user_id = $2`,
    [messageId, me.id],
  ))[0];
  if (!row) throw new InputRefused("that message was not sent to you", "not_yours");
  if (!row.dismissed_at) {
    await tx.query(
      `UPDATE staff_message_receipts SET dismissed_at = now() WHERE message_id = $1 AND user_id = $2`,
      [messageId, me.id],
    );
  }
  return { ok: true };
};
