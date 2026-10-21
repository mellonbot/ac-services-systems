import { html, pageHead, panel, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
import { WORK_DONE_STATES, type FirmStatus } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readFirm, readCrews, firmOf, readiness, linkTo, day, money, type Screen } from "./common.ts";

/**
 * YOUR FIRM — S8's home. The firm's own row as the registry holds it (0005:
 * `firms.list` returns one row to a firm principal, itself), with what the
 * network needs from it in one glance: where it stands on the ladder, whether
 * the MSA is signed, its settlement terms, the position it took on OQ5, and
 * how many of its crews the gate would send today. Nothing here filters; the
 * counts are over the rows the gateway returned.
 */
const STATUS: Readonly<Record<FirmStatus, { status: Status; word: string; sentence: string }>> = {
  onboarding: { status: "at_risk", word: "Onboarding", sentence: "Rankine has recorded your firm. Roster your crews and file their documents; the office activates the firm once the MSA is signed." },
  active: { status: "ok", word: "Active", sentence: "Your crews can be dispatched wherever their documents clear the gate." },
  suspended: { status: "blocked", word: "Suspended", sentence: "No new work is assigned while suspended. Contact the office." },
  terminated: { status: "blocked", word: "Terminated", sentence: "This firm no longer takes work from Rankine." },
};

export const firm: Screen = (ctx) => {
  const firmRes = readFirm(ctx);
  const crews = readCrews(ctx);
  const statements = ctx.store.read(keyOf("settlements.list", {}), () => ctx.shell.gateway.listSettlements({}));
  const jobs = ctx.store.read(keyOf("jobs.list", {}), () => ctx.shell.gateway.listJobs({}));
  const name = firmRes.value.state === "ready" ? firmOf(firmRes.value.value)?.legalName : null;

  return html`<section class="s8-firm">
    ${pageHead(name ?? "Your firm", "Where your firm stands with Rankine, and what its crews, work and statements need from you.")}
    ${whenReady(ctx, firmRes.value, (out) => {
      const f = firmOf(out);
      if (!f) return html`<p class="s8-empty">No firm is on record for this account.</p>`;
      const st = STATUS[f.status];
      return html`
        <p class="s8-scope">${StatusPill({ density: ctx.density, status: st.status, label: st.word }) ?? html``} <span>${st.sentence}</span></p>
        <dl class="ac-facts">
          <div><dt>Master agreement</dt><dd>${f.msaSignedAt ? `Signed ${day(f.msaSignedAt)}` : "Not yet signed"}</dd></div>
          <div><dt>Settlement terms</dt><dd>${f.settlementTermsDays} days from statement</dd></div>
          <div><dt>Diagnostic data</dt><dd>${f.diagnosticDataRightsReserved ? "Rights reserved to Rankine under the MSA" : "Rights not reserved"}</dd></div>
          <div><dt>W-9</dt><dd>${f.w9DocumentKey ? "On file" : "Not on file"}</dd></div>
        </dl>`;
    }, () => ctx.store.invalidate("firms.list"))}

    ${panel(whenReady(ctx, crews.value, (out) => {
      const active = out.crews.filter((c) => c.active);
      const ready = active.filter((c) => readiness(c).status === "ok").length;
      const waiting = active.filter((c) => readiness(c).status === "at_risk").length;
      const blocked = active.length - ready - waiting;
      return html`<p class="s8-summary" id="crew-summary">
        <strong>${active.length}</strong><span>on the roster —</span>
        <span data-count="ready">${ready} ready to dispatch,</span>
        <span data-count="waiting">${waiting} awaiting verification,</span>
        <span data-count="blocked">${blocked} missing or expired documents.</span>
      </p>`;
    }, () => ctx.store.invalidate("crews.list")), "Crews", undefined, linkTo(ctx, "crews", {}, "Roster and documents"))}

    ${panel(whenReady(ctx, jobs.value, (out) => html`<p class="s8-summary" id="work-summary">
      <strong>${out.jobs.filter((j) => ![...WORK_DONE_STATES, "cancelled"].includes(j.state)).length}</strong><span>open job${out.jobs.length === 1 ? "" : "s"} your crews are on.</span>
    </p>`, () => ctx.store.invalidate("jobs.list")), "Work", undefined, linkTo(ctx, "work", {}, "See work"))}

    ${panel(whenReady(ctx, statements.value, (out) => {
      const open = out.settlements.filter((s) => s.state === "issued");
      const disputed = out.settlements.filter((s) => s.state === "disputed");
      return html`<p class="s8-summary" id="statement-summary">
        ${open.length === 0
          ? html`<span>No statement is waiting on you.</span>`
          : html`<strong>${open.length}</strong><span>statement${open.length === 1 ? "" : "s"} waiting for your acknowledgement — ${open.map((s) => money(s.totalMinor, s.currency)).join(", ")}.</span>`}
        ${disputed.length ? html` <span>${disputed.length} in dispute with the office.</span>` : null}
      </p>`;
    }, () => ctx.store.invalidate("settlements.list")), "Statements", undefined, linkTo(ctx, "statements", {}, "Statements"))}
  </section>`;
};
