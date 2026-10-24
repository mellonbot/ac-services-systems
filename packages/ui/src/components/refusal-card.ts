import { TERMS, type Refusal, type Tier, type AdmissionAxis, type MissingTerm } from "../../../contracts/src/index.ts";
import { MARK_GLYPHS } from "../../../tokens/src/index.ts";
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
  incomplete: "A contract term is missing. Contracts has to set it before this can go ahead.",
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
    case "throttled": return "Too many requests — wait a minute";
    case "too_large": return "Refused — the request is too large";
    case "transport": return "Gateway unreachable";
  }
};

/**
 * A missing term, in the words of the person who hit it and cannot fix it.
 * Built from the gateway's facts and the register's label — not a second
 * table of reasons, because nothing here decides WHY; the register did.
 */
export const missingTermHeading = (m: MissingTerm): string =>
  `No agreed ${termLabel(m.termKey).toLowerCase()} for ${m.customer}`;
export const missingTermSentence = (m: MissingTerm): string =>
  `A job at ${m.siteName} can't be opened until Contracts sets the ${termLabel(m.termKey).toLowerCase()} in the agreement with ${m.customer}.`;
const termLabel = (key: string): string => TERMS[key]?.label ?? key;

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
  if (r.kind === "admission" && r.missingTerm) return missingTermCard(p, r, r.missingTerm);
  const axis: AdmissionAxis | null = r.kind === "admission" ? r.axis : null;
  const policy = p.termKey ? TERMS[p.termKey] : undefined;
  const permitted = policy?.authoring ?? null;
  const code = "code" in r ? r.code : r.kind === "scope" ? r.error : null;
  return html`<section class="ac-refusal" role="alert" data-kind=${r.kind} data-axis=${axis ?? undefined} data-density=${p.density}>
    <h2 class="ac-refusal__heading"><span class="ac-refusal__mark" aria-hidden="true">${MARK_GLYPHS.fault}</span> ${refusalHeading(r)}</h2>
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

/**
 * The same card for a refusal that names a missing term: what is missing and
 * who sets it first, the facts beside it, the gateway's message verbatim
 * behind Details for whoever has to trace it.
 */
const missingTermCard = (p: RefusalCardProps & { readonly density: string }, r: Extract<Refusal, { kind: "admission" }>, m: MissingTerm) =>
  html`<section class="ac-refusal" role="alert" data-kind=${r.kind} data-axis=${r.axis} data-density=${p.density}>
    <h2 class="ac-refusal__heading"><span class="ac-refusal__mark" aria-hidden="true">${MARK_GLYPHS.fault}</span> ${missingTermHeading(m)}</h2>
    <p class="ac-refusal__lede">${missingTermSentence(m)}</p>
    <dl class="ac-refusal__facts">
      <dt>Missing</dt><dd>${termLabel(m.termKey)}</dd>
      <dt>Site</dt><dd>${m.siteName}</dd>
      <dt>As of</dt><dd>${m.asOf}</dd>
    </dl>
    ${p.routes && p.routes.length
      ? html`<div class="ac-refusal__routes">
          ${p.routes.map((route) => html`<button type="button" class="ac-action" data-kind=${route.primary ? "primary" : "quiet"} data-density=${p.density} onClick=${route.onSelect}>${route.label}</button>`)}
        </div>`
      : null}
    <details class="ac-refusal__detail"><summary>Details</summary>
      <p class="ac-refusal__message">${r.message}</p>
      <p class="ac-refusal__code"><code>${r.code}</code> · <code>${m.termKey}</code></p>
    </details>
  </section>`;
