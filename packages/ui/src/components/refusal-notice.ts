import type { Refusal } from "../../../contracts/src/index.ts";
import { MARK_GLYPHS } from "../../../tokens/src/index.ts";
import { RefusalNoticeSpec } from "../component.ts";
import { component, html } from "../render.ts";
import type { RefusalRoute } from "./refusal-card.ts";

export type RefusalNoticeProps = {
  readonly refusal: Refusal;
  /** Where the person can go from here. The notice renders them; the surface decides what they do. */
  readonly routes?: readonly RefusalRoute[];
  /** For a refusal that answered a form: a way to clear it without leaving the screen. */
  readonly onDismiss?: () => void;
};

/**
 * Only an unanswered request is worth repeating as-is: every other kind is the
 * gateway's considered answer, and "Try again" on it promises a different one.
 */
export const retryable = (r: Refusal): boolean => r.kind === "transport";

/**
 * The heading in the reader's words. The console's `refusalHeading` names the
 * axis and the principal, because the people who act on those sit at a
 * console; a customer, a firm, a vendor or a crew needs to know only what
 * happened and whether it will change.
 */
export const plainHeading = (r: Refusal): string => {
  switch (r.kind) {
    case "transport": return "We can't reach our system right now";
    case "scope": return "This isn't available to your account";
    case "token": return "Please sign in again";
    case "phase_disabled": return "This isn't available yet";
    case "no_route": return "This page isn't available";
    case "bad_request": return "Something in this request wasn't accepted";
    case "throttled": return "Too many tries — please wait a minute";
    case "too_large": return "That's too large to send";
    case "admission": return r.axis === "commercial" ? "This needs Rankine's agreement first" : r.axis === "incomplete" ? "This account isn't fully set up yet" : "This can't be done here";
  }
};

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * The gateway's sentence, verbatim but for two things a reader outside the
 * company cannot use: a transport error's browser text ("Failed to fetch")
 * becomes what to do about it, and a record id is cut to the eight characters
 * a person can read back over the phone.
 */
export const plainMessage = (r: Refusal): string =>
  r.kind === "transport"
    ? "Check your connection. What you see is the last thing we received; try again in a moment."
    : r.message.replace(UUID, (id) => `ref. ${id.slice(0, 8)}`);

/**
 * RefusalCard's plain sibling. The card renders the admission axis, the
 * permitted authoring tiers and the code, because the people who can act on
 * those sit at a console. Everyone else — a customer, a firm, a vendor, a
 * stranger on the marketing page, a crew on a roof, the read-only dashboard —
 * needs what happened in plain words, the gateway's message, and a way forward.
 * Six surfaces each wrote that; this is it, once, with the fault mark the
 * state schedule requires beside the word (colour never carries alone).
 */
export const RefusalNotice = component<typeof RefusalNoticeSpec, RefusalNoticeProps>(RefusalNoticeSpec, (p) => {
  const r = p.refusal;
  return html`<section class="ac-notice" role="alert" data-tone="breached" data-kind=${r.kind} data-density=${p.density}>
    <h2 class="ac-notice__heading"><span class="ac-notice__mark" aria-hidden="true">${MARK_GLYPHS.fault}</span> ${plainHeading(r)}</h2>
    <p class="ac-notice__message">${plainMessage(r)}</p>
    ${p.routes && p.routes.length
      ? html`<div class="ac-notice__routes">
          ${p.routes.map((route) => html`<button type="button" class="ac-action" data-kind=${route.primary ? "primary" : "quiet"} data-density=${p.density} onClick=${route.onSelect}>${route.label}</button>`)}
        </div>`
      : null}
    ${p.onDismiss ? html`<button type="button" class="ac-link ac-link--button" onClick=${p.onDismiss}>Dismiss</button>` : null}
  </section>`;
});
