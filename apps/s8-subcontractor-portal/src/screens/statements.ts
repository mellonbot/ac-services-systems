import { html, pageHead, panel, statStrip, signal, DataGrid, StatusPill, type Status, type VNode } from "../../../../packages/ui/src/index.ts";
import type { SettlementWire, SettlementLineWire, SettlementState, Refusal } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, submitAction, refusalView, linkTo, when, money, type Screen, type ScreenContext } from "./common.ts";

/**
 * STATEMENTS — the firm's money (D12: settlement visibility, settlement_ack,
 * dispute). `settlements.list` returns the firm's own statements once issued
 * (0007: a draft is ours), and `settlements.lines` the lines of a statement
 * the firm can see. The two writes are the firm's position: the statement is
 * right (acknowledge) or it is wrong and here is why (dispute). Every other
 * column on the row is refused to the firm by the trigger, whatever the
 * handler is asked.
 *
 * The state ladder is worded from the firm's side: "Waiting on you" is an
 * issued statement; "In dispute" is one the office owes an answer on.
 */
const STATE: Readonly<Record<SettlementState, { status: Status; word: string }>> = {
  draft: { status: "blocked", word: "Draft" },   // never reaches the firm; here so the record is total
  issued: { status: "at_risk", word: "Waiting on you" },
  acknowledged: { status: "ok", word: "Acknowledged" },
  disputed: { status: "at_risk", word: "In dispute" },
  paid: { status: "ok", word: "Paid" },
};

export const statements: Screen = (ctx) => {
  const list = ctx.store.read(keyOf("settlements.list", {}), () => ctx.shell.gateway.listSettlements({}));
  return html`<section class="s8-statements">
    ${pageHead("Statements", "What Rankine owes your firm for work done, period by period.")}
    ${panel(html`<p class="s8-scope">What Rankine owes your firm for each period, by job and rate. Acknowledge a statement that is right; dispute one that is not, with the line and the reason.</p>
    ${whenReady(ctx, list.value, (out) => DataGrid<SettlementWire>({
      density: ctx.density,
      caption: "Statements issued to your firm",
      emptyText: "No statements have been issued yet.",
      rows: out.settlements,
      rowKey: (s) => s.id,
      columns: [
        { key: "period", header: "Period", cell: (s) => `${s.periodFrom} → ${s.periodTo}` },
        { key: "total", header: "Total", numeric: true, align: "end", cell: (s) => money(s.totalMinor, s.currency) },
        { key: "lines", header: "Lines", numeric: true, align: "end", cell: (s) => String(s.lineCount) },
        { key: "state", header: "State", cell: (s) => StatusPill({ density: ctx.density, status: STATE[s.state].status, label: STATE[s.state].word }) ?? html`` },
        { key: "issuedAt", header: "Issued", cell: (s) => when(s.issuedAt) },
        { key: "open", header: "", cell: (s) => linkTo(ctx, "statement", { settlementId: s.id }, "Open") },
      ],
    }) ?? html``, () => ctx.store.invalidate("settlements.list"))}`)}
  </section>`;
};

type Outcome = { kind: "idle" } | { kind: "busy" } | { kind: "acknowledged" } | { kind: "disputed" } | { kind: "refused"; refusal: Refusal };
const outcome = signal<Outcome>({ kind: "idle" });
export const resetStatementForm = () => { outcome.value = { kind: "idle" }; };

export const statement: Screen = (ctx, params) => {
  const id = params.settlementId ?? "";
  const list = ctx.store.read(keyOf("settlements.list", {}), () => ctx.shell.gateway.listSettlements({}));
  const lines = ctx.store.read(keyOf("settlements.lines", { settlementId: id }), () => ctx.shell.gateway.listSettlementLines({ settlementId: id }));
  const s = list.value.state === "ready" ? list.value.value.settlements.find((x) => x.id === id) ?? null : null;

  const done = () => { ctx.store.invalidate("settlements.list"); };
  const acknowledge = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    outcome.value = { kind: "busy" };
    try { await ctx.shell.gateway.acknowledgeSettlement({ settlementId: id }); outcome.value = { kind: "acknowledged" }; done(); }
    catch (err) { outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } }; }
  };
  const dispute = async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded) return;
    const form = e.currentTarget as HTMLFormElement;
    const reason = String(new FormData(form).get("reason") ?? "");
    outcome.value = { kind: "busy" };
    try { await ctx.shell.gateway.disputeSettlement({ settlementId: id, reason }); outcome.value = { kind: "disputed" }; done(); form.reset(); }
    catch (err) { outcome.value = { kind: "refused", refusal: ctx.shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) } }; }
  };

  const o = outcome.value;
  return html`<section class="s8-statement">
    <p class="s8-crumbs">${linkTo(ctx, "statements", {}, "Statements")} › ${s ? `${s.periodFrom} → ${s.periodTo}` : "Statement"}</p>
    ${pageHead(s ? `Statement ${s.periodFrom} → ${s.periodTo}` : "Statement", "One statement's lines, and your position on it: acknowledge it, or dispute it and say why.",
      s ? StatusPill({ density: ctx.density, status: STATE[s.state].status, label: STATE[s.state].word }) : null)}
    ${whenReady(ctx, list.value, () => {
      if (!s) return html`<p class="s8-empty">No statement ${id} is on record for your firm.</p>`;
      return html`
        ${statStrip([{ n: html`<span id="statement-total">${money(s.totalMinor, s.currency)}</span>`, label: "Total", sub: `Issued ${when(s.issuedAt)}${s.acknowledgedAt ? ` · acknowledged ${when(s.acknowledgedAt)}` : ""}` }])}
        ${s.disputedAt ? html`<p class="s8-scope">Disputed ${when(s.disputedAt)}: “${s.disputeReason}”</p>` : null}`;
    }, () => ctx.store.invalidate("settlements.list"))}

    ${panel(whenReady(ctx, lines.value, (out) => DataGrid<SettlementLineWire>({
      density: ctx.density,
      caption: "Lines",
      emptyText: "This statement carries no lines.",
      rows: out.lines,
      rowKey: (l) => l.id,
      columns: [
        { key: "site", header: "Site", cell: (l) => l.siteName ?? "—" },
        { key: "service", header: "Service", cell: (l) => l.serviceCode ?? "—" },
        { key: "rate", header: "Rate", numeric: true, align: "end", cell: (l) => (l.rateMinor && s ? money(l.rateMinor, s.currency) : "—") },
        { key: "qty", header: "Quantity", numeric: true, align: "end", cell: (l) => thousandths(l.quantityMilli) },
        { key: "amount", header: "Amount", numeric: true, align: "end", cell: (l) => (s ? money(l.amountMinor, s.currency) : l.amountMinor) },
      ],
    }) ?? html``, () => ctx.store.invalidate("settlements.lines")))}

    ${outcomeView(ctx, o)}
    ${s && (s.state === "issued" || s.state === "acknowledged") ? positionForms(ctx, s, o, acknowledge, dispute) : null}
  </section>`;
};

const positionForms = (ctx: ScreenContext, s: SettlementWire, o: Outcome, acknowledge: (e: Event) => void, dispute: (e: Event) => void): VNode => html`
  <div class="s8-position">
    ${s.state === "issued" ? panel(html`<form class="ac-form" id="acknowledge-form" onSubmit=${acknowledge}>
      <p class="s8-muted">Acknowledging starts the payment clock at the office under your settlement terms. It does not close a line you later find wrong — you can still dispute.</p>
      ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "Acknowledge", "acknowledge-send", o.kind === "busy")}
    </form>`, "This statement is right") : null}
    ${panel(html`<form class="ac-form" id="dispute-form" onSubmit=${dispute}>
      <label class="ac-field"><span>What, and why</span>
        <textarea class="ac-input ac-textarea" name="reason" required rows="4" maxlength="2000" id="dispute-reason" placeholder="Name the line — the job, the rate or the quantity — and what it should read."></textarea>
      </label>
      ${submitAction(ctx, o.kind === "busy" ? "Sending…" : "Dispute", "dispute-send", o.kind === "busy")}
    </form>`, "Something is wrong")}
  </div>`;

const outcomeView = (ctx: ScreenContext, o: Outcome): VNode | null => {
  switch (o.kind) {
    case "acknowledged": return html`<p class="ac-notice" data-tone="ok" role="status" id="statement-outcome">Acknowledged. The office has your position.</p>`;
    case "disputed": return html`<p class="ac-notice" data-tone="ok" role="status" id="statement-outcome">Disputed. The office reads your reason on the statement and answers there.</p>`;
    case "refused": return refusalView(ctx, o.refusal, [{ label: "Dismiss", onSelect: resetStatementForm, primary: true }]);
    default: return null;
  }
};

/** Integer thousandths as a string → a quantity with up to three decimals, trailing zeros dropped. */
export const thousandths = (milli: string): string => {
  const neg = milli.startsWith("-");
  const d = (neg ? milli.slice(1) : milli).padStart(4, "0");
  const frac = d.slice(-3).replace(/0+$/, "");
  return `${neg ? "−" : ""}${d.slice(0, -3)}${frac ? `.${frac}` : ""}`;
};
