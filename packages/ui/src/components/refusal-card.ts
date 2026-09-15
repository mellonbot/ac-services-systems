import { TERMS, type Refusal, type Tier, type AdmissionAxis } from "../../../contracts/src/index.ts";
import { RefusalCardSpec } from "../component.ts";
import { component, html } from "../render.ts";

export type RefusalRoute = {
  readonly label: string;
  readonly onSelect: () => void;
  readonly primary?: boolean;
};

export type RefusalCardProps = {
  readonly refusal: Refusal;
  /** The term the row tried to set, when the refusal is about a term. Selects the permitted tiers from the register. */
  readonly termKey?: string;
  /** The tier the row was attempted at. */
  readonly tierAttempted?: Tier;
  /** Where the person can go from here. The card renders them; the surface decides what they do. */
  readonly routes?: readonly RefusalRoute[];
};

/**
 * What each axis means for the person reading it. The gateway's message says
 * WHAT was refused; this says what KIND of problem it is, which decides who
 * has to be involved — nobody, or the person who prices the account.
 */
export const AXIS_SENTENCE: Readonly<Record<AdmissionAxis, string>> = Object.freeze({
  structural: "This row can never be valid here.",
  commercial: "Someone has to agree to this and price it.",
});

/** The heading for a refusal of any kind — admission carries its axis; the others their nature. */
export const refusalHeading = (r: Refusal): string => {
  switch (r.kind) {
    case "admission": return `Refused — ${r.axis}`;
    case "scope": return "Refused — not permitted for this principal";
    case "token": return "Session ended";
    case "phase_disabled": return "Not available in this phase";
    case "no_route": return "Unknown request";
    case "bad_request": return "Refused — the request did not parse";
    case "transport": return "Gateway unreachable";
  }
};

/**
 * 05 Rev D: every refusal states the term, the tier attempted, the permitted
 * tiers, and which of the two kinds it is; a commercial refusal routes to the
 * person who prices it, inside the surface.
 *
 * The message text is the gateway's, verbatim, in its own element. The card
 * adds the axis, the tiers and the routes and nothing else — a surface that
 * paraphrases a refusal is a surface with a second table of reasons.
 */
export const RefusalCard = component<typeof RefusalCardSpec, RefusalCardProps>(RefusalCardSpec, (p) => {
  const r = p.refusal;
  const axis: AdmissionAxis | null = r.kind === "admission" ? r.axis : null;
  const policy = p.termKey ? TERMS[p.termKey] : undefined;
  const permitted = policy?.authoring ?? null;
  const code = "code" in r ? r.code : r.kind === "scope" ? r.error : null;
  return html`<section class="ac-refusal" role="alert" data-kind=${r.kind} data-axis=${axis ?? undefined} data-density=${p.density}>
    <h2 class="ac-refusal__heading"><span class="ac-refusal__mark" aria-hidden="true">■</span> ${refusalHeading(r)}</h2>
    <p class="ac-refusal__message">${r.message}</p>
    ${p.termKey || p.tierAttempted || permitted
      ? html`<dl class="ac-refusal__facts">
          ${p.termKey ? html`<dt>Term</dt><dd><code>${p.termKey}</code></dd>` : null}
          ${p.tierAttempted ? html`<dt>Attempted at</dt><dd>${p.tierAttempted}</dd>` : null}
          ${permitted ? html`<dt>Authoring tiers</dt><dd>${permitted.join(", ")}</dd>` : null}
          ${code ? html`<dt>Code</dt><dd><code>${code}</code></dd>` : null}
        </dl>`
      : code ? html`<p class="ac-refusal__code"><code>${code}</code></p>` : null}
    ${axis ? html`<p class="ac-refusal__axis">${AXIS_SENTENCE[axis]}</p>` : null}
    ${p.routes && p.routes.length
      ? html`<div class="ac-refusal__routes">
          ${p.routes.map((route) => html`<button type="button" class="ac-action" data-kind=${route.primary ? "primary" : "quiet"} data-density=${p.density} onClick=${route.onSelect}>${route.label}</button>`)}
        </div>`
      : null}
  </section>`;
});
