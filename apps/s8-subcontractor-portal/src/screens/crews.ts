import { html, signal, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { CrewWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { whenReady, readCrews, readFirm, firmOf, readiness, submitAction, refusalView, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * CREWS — the roster (D12: crew_roster). Every crew the gateway returned is
 * the firm's own (0005); the readiness column is the gate's summary as the
 * gateway computed it, in the firm's words — "Cannot be sent", "Awaiting
 * Rankine", "Ready to dispatch" — so a firm reads today what the dispatcher
 * will read tomorrow.
 *
 * Two writes. ENROLL takes a label and nothing else: the firm, the type and
 * the region are the principal's, derived by the handler and held by 0007's
 * trigger against any row that says otherwise. RETIRE takes a crew off the
 * roster; a crew holding a live assignment is refused by name (the office
 * releases work, on S3, with a reason) and the refusal is rendered as the
 * heading and the gateway's words.
 */
type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "enrolled"; label: string } | { kind: "retired"; label: string } | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
export const resetRosterForm = () => { outcome.value = { kind: "idle" }; };

export const crews: Screen = (ctx) => {
  const list = readCrews(ctx);
  const firmRes = readFirm(ctx);
  const f = firmRes.value.state === "ready" ? firmOf(firmRes.value.value) : null;
  const mayRoster = f !== null && (f.status === "onboarding" || f.status === "active");

  const enroll = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    const form = e.currentTarget as HTMLFormElement;
    const label = String(new FormData(form).get("label") ?? "");
    outcome.value = { kind: "busy" };
    try {
      await ctx.shell.gateway.enrollCrew({ label });
      outcome.value = { kind: "enrolled", label };
      ctx.store.invalidate("crews.list");
      ctx.store.invalidate("firms.list");
      form.reset();
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };

  const retire = async (c: CrewWire) => {
    if (ctx.degraded) return;
    outcome.value = { kind: "busy" };
    try {
      await ctx.shell.gateway.retireCrew({ crewId: c.id, active: false });
      outcome.value = { kind: "retired", label: c.label };
      ctx.store.invalidate("crews.list");
      ctx.store.invalidate("firms.list");
    } catch (err) {
      outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } };
    }
  };

  const o = outcome.value;
  return html`<section class="s8-crews">
    <h1 class="s8-h1">Crews</h1>
    <p class="s8-scope">Your roster. A crew is dispatched when every document the gate requires is on file, verified by Rankine, and in date for the whole service window.</p>
    ${whenReady(ctx, list.value, (out) => DataGrid<CrewWire>({
      density: ctx.density,
      caption: "Crews on your roster",
      emptyText: "No crews yet. Enroll one below, then file its documents.",
      rows: [...out.crews].sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label)),
      rowKey: (c) => c.id,
      columns: [
        { key: "label", header: "Crew" },
        { key: "readiness", header: "Today", cell: (c) => { const r = readiness(c); return StatusPill({ density: ctx.density, status: r.status, label: r.word }) ?? html``; } },
        { key: "detail", header: "Documents", cell: (c) => readiness(c).detail },
        { key: "actions", header: "", cell: (c) => html`<span class="s8-row__actions">
            ${linkTo(ctx, "documents", { crewId: c.id }, "Documents")}
            ${c.active ? html`<button type="button" class="s8-link s8-link--button" data-retire=${c.id} onClick=${() => retire(c)} disabled=${ctx.degraded || o.kind === "busy"}>Retire</button>` : null}
          </span>` },
      ],
    }) ?? html``, () => ctx.store.invalidate("crews.list"))}

    ${outcomeView(ctx, o)}

    <h2 class="s8-h2">Enroll a crew</h2>
    ${firmRes.value.state === "ready" && !mayRoster
      ? html`<p class="s8-muted" id="enroll-closed">Your firm is ${f?.status ?? "not on record"}; the roster does not change until the office ${f?.status === "suspended" ? "lifts the suspension" : "records otherwise"}.</p>`
      : html`<form class="s8-form" id="enroll-form" onSubmit=${enroll}>
        <label class="s8-field"><span>Crew name</span>
          <input class="s8-input" name="label" required maxlength="120" id="enroll-label" placeholder="As it should read on a job — e.g. Crew 2 (Reyes / Okafor)" />
        </label>
        <p class="s8-muted">Subcontracted, under ${f?.legalName ?? "your firm"}, dispatched from your region — none of that is typed here.</p>
        ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "Enroll", "enroll-send", o.kind === "busy")}
      </form>`}
  </section>`;
};

const outcomeView = (ctx: ScreenContext, o: Outcome): VNode | null => {
  switch (o.kind) {
    case "enrolled": return html`<p class="s8-sent" role="status" id="roster-outcome">${o.label} is on the roster. File its documents next — nothing is dispatched until they are verified.</p>`;
    case "retired": return html`<p class="s8-sent" role="status" id="roster-outcome">${o.label} is off the roster. Its documents stay on file.</p>`;
    case "refused": return refusalView(ctx, o.refusal, [{ label: "Dismiss", onSelect: resetRosterForm, primary: true }]);
    default: return null;
  }
};
