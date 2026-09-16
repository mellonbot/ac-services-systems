import { html, signal, DataGrid, RefusalCard, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, ContractWire, Refusal, TermOverrideWire, TermPolicy, Tier } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, submitAction, formValues, linkTo, type Screen, type ScreenContext } from "./common.ts";

/**
 * C2 — author a term override, with the form DRAWN FROM THE REGISTER.
 *
 * The alternative was eleven hard-coded inputs, and the cost of that is not
 * the typing: it is that the form and the register drift, and the form is
 * where the drift is invisible. Here the register decides the tiers the scope
 * select offers, the control the value gets (a select for an enum, a number
 * for an int, a text box for money-as-minor-units), and the sentence shown
 * under it. A twelfth term is a diff on packages/contracts/src/terms.ts and
 * this screen follows without being touched.
 *
 * The region and org the override is written into come from the CHOSEN
 * AGREEMENT, not from the surface's own context — an override belongs to the
 * document that agreed to it, and it is administered from that document's
 * region.
 *
 * A refusal here is the load-bearing case of 05 Rev D: it renders as a
 * decision carrying its axis, because `illegal_tier` (nothing to escalate —
 * the row is wrong) and `ratchet_loosened` (someone has to agree and price
 * it) are two different days of work and a generic validation error is
 * neither.
 */
type Form = {
  readonly key: string; readonly contractId: string; readonly termKey: string;
  readonly scopeTier: Tier | ""; readonly refusal: Refusal | null; readonly busy: boolean;
};
const form = signal<Form>({ key: "", contractId: "", termKey: "", scopeTier: "", refusal: null, busy: false });

/** The tiers this term may be authored at — the register's first axis, rendered. */
export const authoringTiers = (policy: TermPolicy | undefined): readonly Tier[] => policy?.authoring ?? [];

/** What the register says this value looks like on a form. One place, so "money is a string" is not re-decided per term. */
export const valueControl = (policy: TermPolicy, current?: unknown): VNode => {
  const v = current === undefined || current === null ? "" : String(current);
  switch (policy.valueKind) {
    case "enum":
      return html`<select name="termValue" required class="s2-input">
        ${(policy.values ?? []).map((o) => html`<option value=${o} selected=${o === v}>${o}</option>`)}
      </select>`;
    case "int":
      return html`<input class="s2-input" name="termValue" type="number" step="1" required value=${v} />`;
    case "bool":
      return html`<select name="termValue" required class="s2-input">
        <option value="true" selected=${v === "true"}>true</option>
        <option value="false" selected=${v === "false"}>false</option>
      </select>`;
    case "money":
      return html`<input class="s2-input" name="termValue" inputmode="numeric" pattern="-?[0-9]+" required value=${v} placeholder="integer minor units, e.g. 18500" />`;
    case "text":
      return html`<input class="s2-input" name="termValue" required value=${v} />`;
  }
};

/**
 * Form string → the value the register admits. Money and quantity stay
 * STRINGS across jsonb, because a JSON number is an IEEE754 double and a money
 * amount stored as one is a float wearing a jsonb costume.
 */
export const parseValue = (policy: TermPolicy, raw: string): unknown => {
  switch (policy.valueKind) {
    case "int": return Number.parseInt(raw, 10);
    case "bool": return raw === "true";
    case "money": return raw;
    default: return raw;
  }
};

export const termsOverride: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const orgId = params.orgId!;
  if (form.value.key !== orgId) form.value = { key: orgId, contractId: "", termKey: "", scopeTier: "", refusal: null, busy: false };
  const f = form.value;

  const register = store.read(keyOf("terms.register"), () => shell.gateway.termRegister());
  const contracts = store.read(keyOf("contracts.list", { orgId }), () => shell.gateway.listContracts({ orgId }));
  const tree = store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId }));
  const overrides = store.read(
    keyOf("terms.overrides.list", { orgId, contractId: f.contractId }),
    () => shell.gateway.listTermOverrides({ orgId, ...(f.contractId ? { contractId: f.contractId } : {}) }),
  );

  const submit = (policy: TermPolicy, contract: ContractWire) => async (e: Event) => {
    e.preventDefault();
    if (ctx.degraded || f.busy) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    form.value = { ...form.value, refusal: null, busy: true };
    try {
      await shell.gateway.authorTermOverride({
        contractId: contract.id,
        scopeTier: (v.scopeTier ?? "") as Tier,
        scopeId: v.scopeId ?? "",
        termKey: policy.key,
        termValue: parseValue(policy, v.termValue ?? ""),
        effectiveFrom: v.effectiveFrom ?? "",
        ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}),
        // The document decides the tenancy: an override belongs to the agreement that agreed to it.
        orgId,
        regionId: contract.regionId,
      });
      store.invalidate(keyOf("terms.overrides.list", { orgId, contractId: f.contractId }));
      store.notice.value = [`Override recorded: ${policy.key} at ${v.scopeTier}.`];
      form.value = { ...form.value, busy: false };
    } catch (err) {
      form.value = { ...form.value, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const existingGrid = (rows: readonly TermOverrideWire[], nodes: readonly AccountWire[]): VNode =>
    DataGrid({
      density: ctx.density, caption: "Overrides on record",
      columns: [
        { key: "termKey", header: "Term" },
        { key: "scopeTier", header: "At", cell: (o: TermOverrideWire) => `${o.scopeTier} · ${nodes.find((n) => n.id === o.scopeId)?.name ?? "organization"}` },
        { key: "termValue", header: "Value", cell: (o: TermOverrideWire) => String(o.termValue) },
        { key: "effectiveFrom", header: "Effective", cell: (o: TermOverrideWire) => `${o.effectiveFrom} → ${o.effectiveTo ?? "open"}` },
      ],
      rows, rowKey: (o: TermOverrideWire) => o.id,
      emptyText: "Nothing overridden yet — every term resolves from the register's fallback or refuses.",
    });

  const scopeOptions = (policy: TermPolicy, nodes: readonly AccountWire[], tier: Tier): VNode =>
    tier === "parent"
      ? html`<input type="hidden" name="scopeId" value=${orgId} /><p class="s2-parent">At the organization. ${policy.rationale}</p>`
      : html`<label class="s2-field">
          <span>Which ${tier}</span>
          <select name="scopeId" required class="s2-input">
            ${nodes.filter((n) => n.tier === tier).map((n) => html`<option value=${n.id}>${n.name}</option>`)}
          </select>
        </label>`;

  const authorForm = (terms: readonly TermPolicy[], list: readonly ContractWire[], nodes: readonly AccountWire[]): VNode => {
    const contract = list.find((c) => c.id === f.contractId);
    const policy = terms.find((t) => t.key === f.termKey);
    const tiers = authoringTiers(policy);
    const tier = (f.scopeTier || tiers[0] || "") as Tier | "";
    return html`<form class="s2-form" onSubmit=${policy && contract ? submit(policy, contract) : (e: Event) => e.preventDefault()} id="override-form">
      <label class="s2-field">
        <span>Under which agreement</span>
        <select name="contractId" required class="s2-input" onChange=${(e: Event) => { form.value = { ...form.value, contractId: (e.currentTarget as HTMLSelectElement).value }; }}>
          <option value="">Choose…</option>
          ${list.map((c) => html`<option value=${c.id} selected=${c.id === f.contractId}>${c.kind} · ${c.scopeTier} · ${c.state}</option>`)}
        </select>
        <small>The override is written into this agreement's region — the document decides where it lives.</small>
      </label>
      <label class="s2-field">
        <span>Term</span>
        <select name="termKey" required class="s2-input" onChange=${(e: Event) => { form.value = { ...form.value, termKey: (e.currentTarget as HTMLSelectElement).value, scopeTier: "" }; }}>
          <option value="">Choose…</option>
          ${terms.map((t) => html`<option value=${t.key} selected=${t.key === f.termKey}>${t.key}</option>`)}
        </select>
      </label>
      ${policy
        ? html`
          <p class="s2-policy" data-combine=${policy.combine.kind}>
            <strong>${policy.combine.kind === "ratchet" ? `ratchet — stricter is ${policy.combine.stricter}` : policy.combine.kind}</strong>
            · authored at ${tiers.join(", ")} · ${policy.valueKind}
          </p>
          <p class="s2-rationale">${policy.rationale}</p>
          <label class="s2-field">
            <span>At which tier</span>
            <select name="scopeTier" required class="s2-input" onChange=${(e: Event) => { form.value = { ...form.value, scopeTier: (e.currentTarget as HTMLSelectElement).value as Tier }; }}>
              ${tiers.map((t) => html`<option value=${t} selected=${t === tier}>${t}</option>`)}
            </select>
            <small>Only the tiers the register admits for this term. A tier it does not admit is a row that can never be right, so it is not offered.</small>
          </label>
          ${tier ? scopeOptions(policy, nodes, tier as Tier) : null}
          <label class="s2-field"><span>Value</span>${valueControl(policy)}</label>
          <label class="s2-field"><span>Effective from</span><input class="s2-input" type="date" name="effectiveFrom" required /></label>
          <label class="s2-field"><span>Effective to</span><input class="s2-input" type="date" name="effectiveTo" /><small>Leave empty for open-ended. Two rows in effect at once are refused — there is no tie-break that produces an invoice anyone can check.</small></label>
          <div class="s2-form__actions">
            ${submitAction(ctx, f.busy ? "Recording…" : "Record override", "author")}
            ${linkTo(ctx, "contracts.list", { orgId }, "Back to agreements")}
          </div>`
        : html`<p class="s2-empty">Choose a term. The form is built from the register, so what you are offered is what can be admitted.</p>`}
    </form>`;
  };

  return html`<section class="s2-form-screen">
    <h2 class="s2-h2">Term overrides</h2>
    ${whenReady(ctx, register.value, (r) =>
      whenReady(ctx, contracts.value, (c) =>
        whenReady(ctx, tree.value, (t) => authorForm(r.terms, c.contracts, t.nodes))))}
    ${f.refusal ? overrideRefusal(ctx, f, orgId) : null}
    ${whenReady(ctx, overrides.value, (o) => whenReady(ctx, tree.value, (t) => existingGrid(o.overrides, t.nodes)))}
  </section>`;
};

/** The refusal as a decision: its axis, the term and tier it was attempted at, and where it can go (09 §3.8). */
export const overrideRefusal = (ctx: ScreenContext, f: { refusal: Refusal | null; termKey: string; scopeTier: Tier | "" }, orgId: string): VNode => {
  const r = f.refusal!;
  const routes: { label: string; onSelect: () => void; primary?: boolean }[] = [];
  if (r.kind === "admission" && r.axis === "commercial") {
    routes.push({
      label: "Request commercial review",
      primary: true,
      onSelect: () => { ctx.store.notice.value = [`Commercial review requested: ${r.message}`]; ctx.router.navigate("contracts.list", { orgId }); },
    });
  }
  if (r.kind === "admission" && (r.code === "illegal_tier" || r.code === "ac_admit_term_override")) {
    routes.push({ label: "See what resolves here today", onSelect: () => ctx.router.navigate("terms.resolved", { orgId }), primary: true });
  }
  routes.push({ label: "Back to agreements", onSelect: () => ctx.router.navigate("contracts.list", { orgId }) });
  // Not the shared refusalView: this card is handed the term and the tier the
  // row was attempted at, so it can name the tiers the register DOES admit —
  // which is the difference between "refused" and "author it here instead".
  return RefusalCard({
    density: ctx.density, refusal: r, routes,
    ...(f.termKey ? { termKey: f.termKey } : {}),
    ...(f.scopeTier ? { tierAttempted: f.scopeTier as Tier } : {}),
  }) ?? html``;
};
