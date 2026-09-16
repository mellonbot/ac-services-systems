import { html, signal, DataGrid, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, ResolutionWire, ResolvedTermsOutput, TraceStepWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, linkTo, type Screen } from "./common.ts";

/**
 * C2 — every term resolved at a node as of a date, WITH THE TRACE.
 *
 * The trace is the point. "Austin pays net-45" is an answer a contract
 * administrator cannot check; "net-45, won at the parent, and the location
 * row that would have said net-30 was not walked because payment_terms_days
 * is parent-only" is one they can. A resolver that returns only the value
 * returns confidently wrong answers with nothing to argue with, which is the
 * failure D2 was written against.
 *
 * `asOf` is a field and not today's date, because a disputed February job
 * reprices against February by saying "February" here.
 *
 * A trace outcome is not a StatusPill either (see contracts-list.ts): "this
 * rung set nothing" is not a health state, and the pill's four words are.
 */
const q = signal<{ readonly key: string; readonly nodeId: string; readonly asOf: string; readonly termKey: string; readonly open: string }>(
  { key: "", nodeId: "", asOf: "", termKey: "", open: "" },
);

/** What each trace outcome means to the person reading it, once, rather than in each row. */
export const OUTCOME_SENTENCE: Readonly<Record<TraceStepWire["outcome"], string>> = Object.freeze({
  won: "this rung set the value",
  candidate: "this rung had a row, and a nearer one beat it",
  no_override: "this rung set nothing",
  not_walked: "the register does not let this term be authored here, so the rung was never consulted",
});

export const termsResolved: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const orgId = params.orgId!;
  const routeNode = params.nodeId ?? "";
  if (q.value.key !== orgId) q.value = { key: orgId, nodeId: routeNode, asOf: "", termKey: "", open: "" };
  const s = q.value;

  const tree = store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId }));
  const register = store.read(keyOf("terms.register"), () => shell.gateway.termRegister());

  const nodeId = s.nodeId || routeNode;
  const node = (nodes: readonly AccountWire[]) => nodes.find((n) => n.id === nodeId);

  const results = (tier: string) =>
    store.read(
      keyOf("terms.resolved", { orgId, nodeId, tier, asOf: s.asOf, termKeys: s.termKey }),
      () => shell.gateway.resolvedTerms({
        orgId, nodeId, tier: tier as AccountWire["tier"],
        ...(s.asOf ? { asOf: s.asOf } : {}),
        ...(s.termKey ? { termKeys: s.termKey } : {}),
      }),
    );

  const tracePanel = (r: ResolutionWire): VNode => html`<tr class="s2-trace-row">
    <td colspan="4">
      <ol class="s2-trace">
        ${r.trace.map((t) => html`<li class="s2-trace__step" data-outcome=${t.outcome}>
          <span class="s2-trace__outcome" data-outcome=${t.outcome}>${t.outcome.replace(/_/g, " ")}</span>
          <span class="s2-trace__tier">${t.tier}</span>
          <span class="s2-trace__value">${t.value === undefined ? "—" : String(t.value)}</span>
          <span class="s2-trace__note">${t.note ?? OUTCOME_SENTENCE[t.outcome]}</span>
        </li>`)}
      </ol>
      <p class="s2-rationale">${r.policy.rationale}</p>
    </td>
  </tr>`;

  const table = (out: ResolvedTermsOutput): VNode => {
    const rows = Object.values(out.resolved);
    const refused = Object.entries(out.refused);
    return html`<section>
      ${DataGrid({
        density: ctx.density, caption: `Resolved as of ${rows[0]?.asOf ?? "today"}`,
        columns: [
          { key: "termKey", header: "Term" },
          { key: "value", header: "Value", cell: (r: ResolutionWire) => String(r.value) },
          { key: "wonAt", header: "Won at", cell: (r: ResolutionWire) => (r.wonAt === "fallback" ? "register fallback" : `${r.wonAt.tier}`) },
          {
            key: "trace", header: "", align: "end",
            cell: (r: ResolutionWire) => html`<button type="button" class="s2-link" onClick=${() => { q.value = { ...q.value, open: q.value.open === r.termKey ? "" : r.termKey }; }}>
              ${q.value.open === r.termKey ? "Hide trace" : "Trace"}
            </button>`,
          },
        ],
        rows, rowKey: (r: ResolutionWire) => r.termKey,
        emptyText: "Nothing resolves here.",
      })}
      ${s.open && out.resolved[s.open] ? html`<table class="s2-trace-table"><tbody>${tracePanel(out.resolved[s.open]!)}</tbody></table>` : null}
      ${refused.length
        ? html`<ul class="s2-refused">${refused.map(([k, e]) => html`<li><strong>${k}</strong> — ${e.message} <small>(${e.code})</small></li>`)}</ul>`
        : null}
    </section>`;
  };

  const picker = (nodes: readonly AccountWire[], termKeys: readonly string[]): VNode => html`<form class="s2-form s2-form--inline" onSubmit=${(e: Event) => e.preventDefault()} id="resolve-form">
    <label class="s2-field">
      <span>At which node</span>
      <select name="nodeId" class="s2-input" onChange=${(e: Event) => { q.value = { ...q.value, nodeId: (e.currentTarget as HTMLSelectElement).value, open: "" }; }}>
        <option value="">Choose…</option>
        ${nodes.map((n) => html`<option value=${n.id} selected=${n.id === nodeId}>${n.name} (${n.tier})</option>`)}
      </select>
    </label>
    <label class="s2-field">
      <span>As of</span>
      <input class="s2-input" type="date" name="asOf" value=${s.asOf} onChange=${(e: Event) => { q.value = { ...q.value, asOf: (e.currentTarget as HTMLInputElement).value, open: "" }; }} />
      <small>A February job reprices against February.</small>
    </label>
    <label class="s2-field">
      <span>One term</span>
      <select name="termKey" class="s2-input" onChange=${(e: Event) => { q.value = { ...q.value, termKey: (e.currentTarget as HTMLSelectElement).value, open: "" }; }}>
        <option value="">All registered terms</option>
        ${termKeys.map((k) => html`<option value=${k} selected=${k === s.termKey}>${k}</option>`)}
      </select>
    </label>
  </form>`;

  return html`<section class="s2-form-screen">
    <header class="s2-tree__head">
      <h2 class="s2-h2">Resolved terms</h2>
      ${linkTo(ctx, "contracts.list", { orgId }, "Back to agreements")}
    </header>
    ${whenReady(ctx, tree.value, (t) => whenReady(ctx, register.value, (r) => picker(t.nodes, r.terms.map((p) => p.key))))}
    ${whenReady(ctx, tree.value, (t) => {
      const n = node(t.nodes);
      if (!n) return html`<p class="s2-empty">Pick a node to see what it is served under.</p>`;
      return whenReady(ctx, results(n.tier).value, table);
    })}
  </section>`;
};
