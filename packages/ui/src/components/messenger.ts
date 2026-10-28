import type { Refusal } from "../../../contracts/src/index.ts";
import {
  PRESENCE_LABEL, STAFF_MESSAGE_MAX,
  type StaffColleagueWire, type StaffDirectoryOutput, type StaffMessageWire, type StaffPendingOutput, type StaffRecentOutput,
  type SendStaffMessageInput, type SendStaffMessageOutput, type DismissStaffMessageInput, type DismissStaffMessageOutput,
} from "../../../contracts/src/operations.ts";
import { MessengerSpec } from "../component.ts";
import { component, html, signal, type Signal } from "../render.ts";
import { notice } from "../layout.ts";
import { RefusalNotice } from "./refusal-notice.ts";
import { PrimaryAction } from "./primary-action.ts";

/**
 * COMPANY MESSAGES (0035) — one control in the nav of S2, S3, S4 and S5.
 * Incoming messages sit in the bottom-right corner. The same corner opens
 * the composer: one employee, or everyone employed by AC Services.
 *
 * Customers, subcontractors and vendors are not in it. When the gateway says
 * this sign-in is not an employee, the control draws nothing.
 *
 * Presence is a word, never a status colour. The count of open pop-ups is a
 * numeral, so it uses the instrument face.
 */
const POLL_MS = 8_000;
const POP_CAP = 3;

export type MessengerGateway = {
  listColleagues(): Promise<StaffDirectoryOutput>;
  pendingMessages(): Promise<StaffPendingOutput>;
  recentMessages(): Promise<StaffRecentOutput>;
  sendMessage(input: SendStaffMessageInput): Promise<SendStaffMessageOutput>;
  dismissMessage(input: DismissStaffMessageInput): Promise<DismissStaffMessageOutput>;
};

export type MessengerState = {
  readonly open: Signal<boolean>;
  readonly available: Signal<boolean>;
  readonly people: Signal<readonly StaffColleagueWire[]>;
  readonly pending: Signal<readonly StaffMessageWire[]>;
  readonly recent: Signal<readonly StaffMessageWire[]>;
  readonly busy: Signal<boolean>;
  readonly loadRefusal: Signal<Refusal | null>;
  readonly outcome: Signal<{ ok: string } | { refusal: Refusal } | null>;
  readonly popupRefusal: Signal<Refusal | null>;
  show(): void;
  hide(): void;
  refresh(): Promise<void>;
  sendTo(userId: string, body: string): Promise<void>;
  sendEveryone(body: string): Promise<void>;
  dismiss(messageId: string): Promise<void>;
  stop(): void;
};

const notStaff = (r: Refusal | null): boolean => r?.kind === "admission" && r.code === "not_staff";

export const createMessenger = (gateway: MessengerGateway, refusalOf: (e: unknown) => Refusal | null): MessengerState => {
  const open = signal(false);
  const available = signal(true);
  const people = signal<readonly StaffColleagueWire[]>([]);
  const pending = signal<readonly StaffMessageWire[]>([]);
  const recent = signal<readonly StaffMessageWire[]>([]);
  const busy = signal(false);
  const loadRefusal = signal<Refusal | null>(null);
  const outcome = signal<{ ok: string } | { refusal: Refusal } | null>(null);
  const popupRefusal = signal<Refusal | null>(null);

  const refused = (e: unknown): Refusal => refusalOf(e) ?? { kind: "transport", status: null, message: e instanceof Error ? e.message : "the message was not sent" };

  const refresh = async (): Promise<void> => {
    try {
      pending.value = (await gateway.pendingMessages()).messages ?? [];
      popupRefusal.value = null;
    } catch (e) {
      const r = refused(e);
      if (notStaff(r)) available.value = false;
      // A missed poll stays quiet while the corner is closed. A 404 on a
      // route the shell does not have must not paint a refusal into the nav.
      else if (open.value) loadRefusal.value = r;
    }
  };

  const loadPanel = async (): Promise<void> => {
    try {
      const [dir, rec] = await Promise.all([gateway.listColleagues(), gateway.recentMessages()]);
      people.value = dir.people ?? [];
      recent.value = rec.messages ?? [];
      loadRefusal.value = null;
    } catch (e) {
      const r = refused(e);
      if (notStaff(r)) available.value = false;
      else loadRefusal.value = r;
    }
  };

  const deliver = async (input: SendStaffMessageInput): Promise<void> => {
    if (busy.value) return;
    busy.value = true;
    outcome.value = null;
    try {
      const out = await gateway.sendMessage(input);
      outcome.value = { ok: out.recipients === 1 ? "Sent." : `Sent to ${out.recipients}.` };
      await loadPanel();
    } catch (e) {
      const r = refused(e);
      if (notStaff(r)) available.value = false;
      outcome.value = { refusal: r };
    } finally {
      busy.value = false;
    }
  };

  let stop = (): void => {};
  if (typeof document !== "undefined") {
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    const onVis = (): void => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVis);
    stop = () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }
  void refresh();

  return {
    open, available, people, pending, recent, busy, loadRefusal, outcome, popupRefusal,
    show: () => { outcome.value = null; open.value = true; void loadPanel(); },
    hide: () => { open.value = false; },
    refresh,
    sendTo: (userId, body) => deliver({ body, toUserId: userId }),
    sendEveryone: (body) => deliver({ body, everyone: true }),
    dismiss: async (messageId) => {
      try {
        await gateway.dismissMessage({ messageId });
        pending.value = pending.value.filter((m) => m.messageId !== messageId);
        popupRefusal.value = null;
        if (open.value) recent.value = recent.value.map((m) => m.messageId === messageId ? { ...m, dismissed: true } : m);
      } catch (e) {
        popupRefusal.value = refused(e);
      }
    },
    stop,
  };
};

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const audienceOf = (m: StaffMessageWire): string => m.audience === "everyone" ? "To everyone" : m.direction === "sent" && m.recipientName ? `To ${m.recipientName}` : "To you";
const rolesOf = (roles: readonly string[]): string => roles.map((r) => r.replaceAll("_", " ")).join(", ");

export type MessengerProps = { readonly menu: MessengerState };

export const Messenger = component<typeof MessengerSpec, MessengerProps>(MessengerSpec, ({ density, menu }) => {
  if (!menu.available.value) return null;
  const pending = menu.pending.value ?? [];
  const shown = pending.slice(0, POP_CAP);
  const extra = pending.length - shown.length;
  const open = menu.open.value;
  const people = menu.people.value ?? [];
  const recent = menu.recent.value ?? [];
  const count = pending.length;

  const submit = (e: Event) => {
    e.preventDefault();
    if (menu.busy.value) return;
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const body = String(f.get("body") ?? "");
    const to = String(f.get("to") ?? "");
    const done = to === "everyone" ? menu.sendEveryone(body) : menu.sendTo(to, body);
    void done.then(() => { if (menu.outcome.value && "ok" in menu.outcome.value) (e.currentTarget as HTMLFormElement).reset(); });
  };
  const out = menu.outcome.value;

  return html`<span class="ac-messages-wrap">
    <button type="button" class="ac-account" id="messages-menu" aria-expanded=${open ? "true" : "false"} aria-controls="messages-dock"
      aria-label=${count ? `Messages, ${count} new` : "Messages"} onClick=${() => { if (open) menu.hide(); else menu.show(); }}>
      <span class="ac-account__label">Messages</span>${count ? html`<span class="ac-num">${count}</span>` : null}
    </button>
    <div class="ac-messages-dock" id="messages-dock">
      ${open ? html`<section class="ac-messages-panel" aria-labelledby="messages-title">
        <header class="ac-messages-panel__head">
          <h2 class="ac-messages-panel__title" id="messages-title">Messages</h2>
          <button type="button" class="ac-messages__close" onClick=${menu.hide}>Close</button>
        </header>
        ${menu.loadRefusal.value ? RefusalNotice({ density, refusal: menu.loadRefusal.value }) : null}
        <form class="ac-form" onSubmit=${submit}>
          <label class="ac-field"><span>To</span>
            <select class="ac-input" name="to" required>
              <option value="everyone">Everyone at AC Services</option>
              ${people.map((p) => html`<option value=${p.userId}>${p.displayName}${rolesOf(p.roles) ? ` — ${rolesOf(p.roles)}` : ""} · ${PRESENCE_LABEL[p.presence]}</option>`)}
            </select>
          </label>
          <label class="ac-field"><span>Message</span>
            <textarea class="ac-input ac-messages__body" name="body" required maxLength=${STAFF_MESSAGE_MAX} rows="3"></textarea>
          </label>
          ${PrimaryAction({ density, type: "submit", label: menu.busy.value ? "Sending…" : "Send", id: "messages-send" })}
          ${out ? ("ok" in out ? notice("ok", out.ok, "messages-sent") : RefusalNotice({ density, refusal: out.refusal })) : null}
        </form>
        <ul class="ac-messages-recent">
          ${recent.length ? recent.map((m) => html`<li>
            <span class="ac-messages-popup__who">${m.senderName}</span>
            <span class="ac-messages-popup__to">${audienceOf(m)}</span>
            <span class="ac-num ac-messages-popup__when">${when(m.sentAt)}</span>
            <p class="ac-messages-popup__body">${m.body}</p>
          </li>`) : html`<li class="ac-messages-recent__empty">No messages yet.</li>`}
        </ul>
      </section>` : null}
      <div class="ac-messages-stack" aria-live="polite">
        ${menu.popupRefusal.value ? RefusalNotice({ density, refusal: menu.popupRefusal.value }) : null}
        ${shown.map((m) => html`<article class="ac-messages-popup" id=${`message-${m.messageId}`}>
          <header class="ac-messages-popup__head">
            <span class="ac-messages-popup__who">${m.senderName}</span>
            <span class="ac-messages-popup__to">${audienceOf(m)}</span>
          </header>
          <p class="ac-messages-popup__body">${m.body}</p>
          <button type="button" class="ac-messages__dismiss" onClick=${() => { void menu.dismiss(m.messageId); }}>Dismiss</button>
        </article>`)}
        ${extra > 0 ? html`<button type="button" class="ac-messages__more" onClick=${menu.show}><span class="ac-num">${extra}</span> more</button>` : null}
      </div>
    </div>
  </span>`;
});
