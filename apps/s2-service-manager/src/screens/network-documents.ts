import { html, signal, DataGrid, ComplianceBadge, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CredentialWire, CredentialKind, CrewWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { readableKinds } from "./network.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, formValues, linkTo, type Screen } from "./common.ts";

/**
 * C4 — a crew's documents, and the one path that verifies one.
 *
 * The screen is built around the sentence the gate depends on: an unverified
 * certificate is not a certificate. So:
 *
 *   - the record form has NO verified field. Not a disabled one, not one that
 *     defaults to false — none. Verification is a separate act, and the form
 *     that records the document cannot express it.
 *   - every row says which it is, with the gate's own mark. A document on file
 *     and unverified is listed AS unverified rather than hidden, because
 *     "we sent them the COI" and "we checked the COI" are different facts and
 *     the second one is the one dispatch is standing on.
 *   - Verify is offered once. After it, the row shows who verified it and
 *     when, and there is no edit: a correction is a new document, because a
 *     clearance may already cite this one by id.
 *
 * What the gate REQUIRES for this crew comes from the wire (the summary the
 * list operation returns), not from a copy of the rule here.
 */
const KINDS: readonly CredentialKind[] = ["insurance", "license", "certification", "background_check"];

const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: string }>({ refusal: null, busy: "" });

/** A document counts today when it is verified and today sits inside its window. The same question the gate asks of a service window. */
export const coversToday = (c: CredentialWire, today: string): boolean => c.verifiedAt !== null && c.validFrom <= today && c.validTo >= today;

export const networkCrewDocuments: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const crewId = params.crewId!;
  const today = new Date().toISOString().slice(0, 10);
  const crews = store.read(keyOf("crews.list"), () => shell.gateway.listCrews({}));
  const docs = store.read(keyOf("credentials.list", { crewId }), () => shell.gateway.listCredentials({ crewId }));

  const verify = async (c: CredentialWire) => {
    if (ctx.degraded || outcome.value.busy) return;
    outcome.value = { refusal: null, busy: c.id };
    try {
      await shell.gateway.verifyCredential({ credentialId: c.id });
      store.invalidate(keyOf("credentials.list", { crewId }));
      store.invalidate("crews.list");
      store.notice.value = [`${c.kind.replace(/_/g, " ")} ${c.identifier} verified. It is immutable from here — a correction is a new document.`];
      outcome.value = { refusal: null, busy: "" };
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "" };
    }
  };

  const record = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || outcome.value.busy) return;
    const form = e.currentTarget as HTMLFormElement;
    const v = formValues(form);
    outcome.value = { refusal: null, busy: "record" };
    try {
      await shell.gateway.recordCredential({
        crewId,
        kind: (v.kind ?? "insurance") as CredentialKind,
        identifier: v.identifier ?? "",
        validFrom: v.validFrom ?? "",
        validTo: v.validTo ?? "",
        ...(v.documentKey ? { documentKey: v.documentKey } : {}),
      });
      store.invalidate(keyOf("credentials.list", { crewId }));
      store.invalidate("crews.list");
      store.notice.value = ["Document on file — unverified. It clears nothing until somebody here has checked it."];
      outcome.value = { refusal: null, busy: "" };
      form.reset();
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "" };
    }
  };

  const grid = (list: readonly CredentialWire[]): VNode =>
    DataGrid({
      density: ctx.density, caption: "Documents on file",
      columns: [
        { key: "kind", header: "Kind", cell: (c: CredentialWire) => c.kind.replace(/_/g, " ") },
        { key: "identifier", header: "Identifier" },
        { key: "validFrom", header: "Valid", cell: (c: CredentialWire) => `${c.validFrom} → ${c.validTo}` },
        {
          key: "verifiedAt", header: "Verification",
          cell: (c: CredentialWire) => c.verifiedAt
            ? ComplianceBadge({ density: ctx.density, cleared: coversToday(c, today), ...(coversToday(c, today) ? {} : { reason: "expired_in_window" }), detail: `verified ${c.verifiedAt.slice(0, 10)}` })
            : ComplianceBadge({ density: ctx.density, cleared: false, reason: "unverified", detail: "on file, never checked — it clears nothing" }),
        },
        {
          key: "actions", header: "", align: "end",
          cell: (c: CredentialWire) => c.verifiedAt
            ? html`<small class="s2-muted">verified — a correction is a new document</small>`
            : html`<button type="button" class="s2-link" id=${`verify-${c.id}`} disabled=${ctx.degraded || outcome.value.busy === c.id} onClick=${() => verify(c)}>Verify</button>`,
        },
      ],
      rows: list, rowKey: (c: CredentialWire) => c.id,
      emptyText: "Nothing on file for this crew.",
    });

  const summary = (crew: CrewWire): VNode => html`<p class="s2-row-actions">
    ${crew.documents.required.map((k) => {
      const ok = crew.documents.satisfied.includes(k);
      const unverified = crew.documents.unverified.includes(k);
      const expired = crew.documents.expired.includes(k);
      return StatusPill({ density: ctx.density, status: ok ? "ok" : unverified ? "at_risk" : "blocked", label: `${readableKinds([k])}${ok ? "" : unverified ? " — unverified" : expired ? " — expired" : " — missing"}` });
    })}
  </p>`;

  return html`<section class="s2-form-screen">
    ${whenReady(ctx, crews.value, (c) => {
      const crew = c.crews.find((x) => x.id === crewId);
      if (!crew) return html`<p class="s2-empty">No crew ${crewId} visible in this scope.</p>`;
      return html`<header class="s2-tree__head">
          <h2 class="s2-h2">${crew.label} — documents</h2>
          ${crew.firmId ? linkTo(ctx, "network", { firmId: crew.firmId }, "Back to the firm") : linkTo(ctx, "network", {}, "Back to our crews")}
        </header>
        <p class="s2-muted">What the gate requires of this crew, as of ${today}:</p>
        ${summary(crew)}`;
    })}
    ${whenReady(ctx, docs.value, (d) => grid(d.credentials))}
    <h3 class="s2-h2">Put a document on file</h3>
    <form class="s2-form" onSubmit=${record} id="credential-form">
      <label class="s2-field">
        <span>Kind</span>
        <select name="kind" class="s2-input">${KINDS.map((k) => html`<option value=${k}>${k.replace(/_/g, " ")}</option>`)}</select>
      </label>
      <label class="s2-field"><span>Identifier</span><input class="s2-input" name="identifier" required placeholder="policy or licence number" /></label>
      <label class="s2-field"><span>Valid from</span><input class="s2-input" type="date" name="validFrom" required /></label>
      <label class="s2-field"><span>Valid to</span><input class="s2-input" type="date" name="validTo" required /><small>The gate checks the whole service window against this, never today — a certificate that expires on Tuesday does not clear a job on Thursday.</small></label>
      <label class="s2-field"><span>Scan</span><input class="s2-input" name="documentKey" placeholder="storage key of the PDF" /></label>
      <div class="s2-form__actions">
        ${submitAction(ctx, outcome.value.busy === "record" ? "Recording…" : "Put on file (unverified)", "record-credential")}
      </div>
      <p class="s2-muted">There is no verified box on this form. Verification is its own act, by this surface, once — and after it the document cannot be edited.</p>
    </form>
    ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: "" }; } }]) : null}
  </section>`;
};
