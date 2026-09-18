import { html, signal, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CredentialWire, CredentialKind, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readCrews, submitAction, refusalView, linkTo, kindWord, day, type Screen, type ScreenContext } from "./common.ts";

/**
 * DOCUMENTS — one crew's compliance, and the intake (D12: compliance_doc).
 * The list is `credentials.list` for the crew; an unverified document is on
 * it AS unverified — "Awaiting Rankine" — because a firm that cannot see
 * what it filed cannot see what is missing.
 *
 * The form is S8's own operation, `credentials.submit`: kind, identifier,
 * the window, and the stored file's key. It has no verified field to send,
 * and the gateway has no way to accept one — 0005's trigger refuses a
 * verified INSERT from every path, and only S2 sets it afterwards, once.
 * What the firm does here is put the document in front of the office.
 */
const KINDS: readonly CredentialKind[] = ["insurance", "license", "certification", "background_check"];

type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "filed"; what: string } | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
export const resetDocumentForm = () => { outcome.value = { kind: "idle" }; };

const status = (d: CredentialWire, today: string): { status: "ok" | "at_risk" | "blocked"; word: string } => {
  if (d.validTo < today) return { status: "blocked", word: "Expired" };
  if (!d.verifiedAt) return { status: "at_risk", word: "Awaiting Rankine" };
  return { status: "ok", word: "Verified" };
};

export const documents: Screen = (ctx, params) => {
  const crewId = params.crewId ?? "";
  const crews = readCrews(ctx);
  const docs = ctx.store.read(keyOf("credentials.list", { crewId }), () => ctx.shell.gateway.listCredentials({ crewId }));
  const crew = crews.value.state === "ready" ? crews.value.value.crews.find((c) => c.id === crewId) ?? null : null;
  const today = new Date().toISOString().slice(0, 10);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    const form = e.currentTarget as HTMLFormElement;
    const f = new FormData(form);
    const kind = String(f.get("kind") ?? "") as CredentialKind;
    const identifier = String(f.get("identifier") ?? "");
    const documentKey = String(f.get("documentKey") ?? "").trim();
    outcome.value = { kind: "busy" };
    try {
      await ctx.shell.gateway.submitCredential({
        crewId, kind, identifier, validFrom: String(f.get("validFrom") ?? ""), validTo: String(f.get("validTo") ?? ""),
        ...(documentKey ? { documentKey } : {}),
      });
      outcome.value = { kind: "filed", what: `${kindWord(kind)} ${identifier}` };
      ctx.store.invalidate("credentials.list");
      ctx.store.invalidate("crews.list");
      form.reset();
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };

  const o = outcome.value;
  return html`<section class="s8-documents">
    <p class="s8-crumbs">${linkTo(ctx, "crews", {}, "Crews")} › ${crew?.label ?? "Crew"}</p>
    <h1 class="s8-h1">${crew ? `${crew.label} — documents` : "Documents"}</h1>
    ${crew ? html`<p class="s8-scope">The gate requires: ${crew.documents.required.map(kindWord).join(", ")}.
      ${crew.documents.missing.length ? html`<strong>Missing: ${crew.documents.missing.map(kindWord).join(", ")}.</strong>` : null}</p>` : null}
    ${whenReady(ctx, docs.value, (out) => DataGrid<CredentialWire>({
      density: ctx.density,
      caption: "Documents on file for this crew",
      emptyText: "Nothing on file for this crew yet.",
      rows: [...out.credentials].sort((a, b) => a.kind.localeCompare(b.kind) || b.validTo.localeCompare(a.validTo)),
      rowKey: (d) => d.id,
      columns: [
        { key: "kind", header: "Kind", cell: (d) => kindWord(d.kind) },
        { key: "identifier", header: "Identifier" },
        { key: "window", header: "Valid", cell: (d) => `${d.validFrom} → ${d.validTo}` },
        { key: "status", header: "Status", cell: (d) => { const s = status(d, today); return StatusPill({ density: ctx.density, status: s.status, label: s.word }) ?? html``; } },
        { key: "verifiedAt", header: "Verified", cell: (d) => (d.verifiedAt ? day(d.verifiedAt) : "—") },
      ],
    }) ?? html``, () => ctx.store.invalidate("credentials.list"))}

    ${outcomeView(ctx, o)}

    <h2 class="s8-h2">File a document</h2>
    <form class="s8-form" id="document-form" onSubmit=${submit}>
      <label class="s8-field"><span>Kind</span>
        <select class="s8-input" name="kind" required id="document-kind">
          ${KINDS.map((k) => html`<option value=${k}>${kindWord(k)}</option>`)}
        </select>
      </label>
      <label class="s8-field"><span>Identifier</span>
        <input class="s8-input" name="identifier" required maxlength="120" id="document-identifier" placeholder="Policy, licence or certificate number" />
      </label>
      <div class="s8-field--pair">
        <label class="s8-field"><span>Valid from</span><input class="s8-input" name="validFrom" type="date" required id="document-from" /></label>
        <label class="s8-field"><span>Valid to</span><input class="s8-input" name="validTo" type="date" required id="document-to" /></label>
      </div>
      <label class="s8-field"><span>Stored file (optional)</span>
        <input class="s8-input" name="documentKey" maxlength="200" id="document-key" placeholder="The key from your upload, when the scan is ready" />
      </label>
      <p class="s8-muted">Filed documents are verified by Rankine before they count. Until then the crew reads "Awaiting Rankine".</p>
      ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "File document", "document-send", o.kind === "busy")}
    </form>
  </section>`;
};

const outcomeView = (ctx: ScreenContext, o: Outcome): VNode | null => {
  switch (o.kind) {
    case "filed": return html`<p class="s8-sent" role="status" id="document-outcome">Filed — ${o.what} is with the office for verification.</p>`;
    case "refused": return refusalView(ctx, o.refusal, [{ label: "Edit and file again", onSelect: resetDocumentForm, primary: true }]);
    default: return null;
  }
};
