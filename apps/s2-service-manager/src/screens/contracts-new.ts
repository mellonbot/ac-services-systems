import { html, pageHead, signal, type VNode } from "../../../../packages/ui/src/index.ts";
import { COOL_CLUB, type AccountWire, type ContractWire, type CreateContractInput, type Refusal, type RegionWire, type Tier } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, submitAction, noChoice, formValues, linkTo, boundEnd, type Screen, type ScreenContext } from "./common.ts";

/**
 * C2 — record an agreement. The form's whole job is to offer only what the
 * catalogue admits, so a refusal is about the agreement and never about the
 * form:
 *
 *   scope       parent binds to the organization; below that the form lists
 *               the nodes and the region is not offered at all, because the
 *               region follows the scope's edge. Offering the field would be
 *               offering the refusal.
 *
 *   OQ5         a THREE-state control, not a checkbox. A checkbox has no way
 *               to say "nobody has decided", so it would default one of the
 *               two positions and record it as though someone had. Unset is
 *               the initial state, the submit is disabled while it holds, and
 *               the gateway is never called — the 400 on the wire is the last
 *               of three lines, not the first.
 */
const KINDS = ["msa", "amendment", "location_agreement", "project_sow", "residential_membership", "one_time"] as const;
const BILLING_PATHS = ["one_time", "residential_membership", "enterprise_sla", "project"] as const;
const SCOPE_TIERS: readonly Tier[] = ["parent", "region", "location", "site"];

export type Oq5 = "unset" | "reserved" | "not_reserved";

type Form = { readonly key: string; readonly scopeTier: Tier; readonly kind: string; readonly oq5: Oq5; readonly refusal: Refusal | null; readonly busy: boolean };
const form = signal<Form>({ key: "", scopeTier: "parent", kind: "msa", oq5: "unset", refusal: null, busy: false });

/** The submit gate, as a function so the test can state the rule without a DOM. */
export const canSubmit = (f: Pick<Form, "oq5" | "busy">, degraded: boolean): boolean => f.oq5 !== "unset" && !f.busy && !degraded;

export const contractsNew: Screen = (ctx, params) => {
  const { shell, store } = ctx;
  const orgId = params.orgId!;
  if (form.value.key !== orgId) form.value = { key: orgId, scopeTier: "parent", kind: "msa", oq5: "unset", refusal: null, busy: false };
  const f = form.value;

  const tree = store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId }));
  const regions = store.read(keyOf("regions.list"), () => shell.gateway.listRegions());
  const existing = store.read(keyOf("contracts.list", { orgId }), () => shell.gateway.listContracts({ orgId }));

  const submit = async (e: Event) => {
    e.preventDefault();
    // Three lines say OQ5, and this is the first: nothing reaches the wire unstated.
    if (!canSubmit(form.value, ctx.degraded)) return;
    const v = formValues(e.currentTarget as HTMLFormElement);
    const input: CreateContractInput = {
      orgId,
      scopeTier: f.scopeTier,
      scopeId: f.scopeTier === "parent" ? orgId : (v.scopeId ?? ""),
      kind: f.kind as CreateContractInput["kind"],
      billingPath: (v.billingPath ?? "enterprise_sla") as CreateContractInput["billingPath"],
      signedAt: v.signedAt ?? "",
      effectiveFrom: v.effectiveFrom ?? "",
      diagnosticDataRightsReserved: f.oq5 === "reserved",
      ...(f.scopeTier === "parent" ? { regionId: v.regionId ?? "" } : {}),
      ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}),
      ...(f.kind === "amendment" && v.parentContractId ? { parentContractId: v.parentContractId } : {}),
      ...(v.documentKey ? { documentKey: v.documentKey } : {}),
    };
    form.value = { ...f, refusal: null, busy: true };
    try {
      await shell.gateway.createContract(input);
      store.invalidate(keyOf("contracts.list", { orgId }));
      store.notice.value = [`Recorded a ${input.kind.replace(/_/g, " ")} — draft until it is activated.`];
      ctx.router.navigate("contracts.list", { orgId });
    } catch (err) {
      form.value = { ...form.value, refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: false };
    }
  };

  const scopeNodes = (nodes: readonly AccountWire[]) => nodes.filter((n) => n.tier === f.scopeTier);
  const activeRegions = (rs: readonly RegionWire[]) => rs.filter((r) => r.active);
  const amendable = (cs: readonly ContractWire[]) => cs.filter((c) => c.state === "draft" || c.state === "active");
  // Only once the list is read: while it loads there is nothing yet to say is missing.
  const blocked =
    f.scopeTier !== "parent" && tree.value.state === "ready" && scopeNodes(tree.value.value.nodes).length === 0 ? `This customer has no ${f.scopeTier} to bind to.`
    : f.scopeTier === "parent" && regions.value.state === "ready" && activeRegions(regions.value.value.regions).length === 0 ? "No region of ours is active to administer it from."
    : f.kind === "amendment" && existing.value.state === "ready" && amendable(existing.value.value.contracts).length === 0 ? "There is no draft or active agreement to amend."
    : null;

  const scopeField = (nodes: readonly AccountWire[]): VNode =>
    f.scopeTier === "parent"
      ? html`<p class="s2-parent">Binds to the organization itself.</p>`
      : scopeNodes(nodes).length === 0
        ? noChoice(`Which ${f.scopeTier}`, `This customer has no ${f.scopeTier} yet.`, linkTo(ctx, "accounts.tree", { orgId }, "Add one in the tree"))
      : html`<label class="ac-field">
          <span>Which ${f.scopeTier}</span>
          <select name="scopeId" required class="ac-input">
            ${scopeNodes(nodes).map((n) => html`<option value=${n.id}>${n.name}</option>`)}
          </select>
          <small>The region follows this node's edge; it is not chosen here.</small>
        </label>`;

  const regionField = (regions: readonly RegionWire[]): VNode => activeRegions(regions).length === 0
    ? noChoice("Administered from", "No region of ours is active.")
    : html`<label class="ac-field">
    <span>Administered from</span>
    <select name="regionId" required class="ac-input">
      ${activeRegions(regions).map((r) => html`<option value=${r.id}>${r.name} (${r.code})</option>`)}
    </select>
  </label>`;

  const amendmentField = (contracts: readonly ContractWire[]): VNode => amendable(contracts).length === 0
    ? noChoice("Amends", "There is no draft or active agreement to amend.")
    : html`<label class="ac-field">
    <span>Amends</span>
    <select name="parentContractId" required class="ac-input">
      ${amendable(contracts).map((c) => html`<option value=${c.id}>${c.kind} · ${c.effectiveFrom} → ${c.effectiveTo ?? "evergreen"}</option>`)}
    </select>
  </label>`;

  /** OQ5. Three states, and "not stated" is where it starts. */
  const oq5Field = (): VNode => html`<fieldset class="ac-field s2-oq5" id="oq5">
    <legend>Diagnostic data rights (OQ5)</legend>
    ${([
      ["reserved", "Reserved — we retain rights to the diagnostic data this agreement produces"],
      ["not_reserved", "Not reserved — the customer retains them"],
    ] as const).map(([value, label]) => html`<label class="s2-radio">
      <input type="radio" name="oq5" value=${value} checked=${f.oq5 === value} onChange=${() => { form.value = { ...form.value, oq5: value }; }} />
      <span>${label}</span>
    </label>`)}
    ${f.oq5 === "unset"
      ? html`<small class="s2-oq5__unset" role="status">Not stated. An agreement cannot be recorded without a position — the Phase 4 licensing question is answered at signature, per record, or discovered in year six.</small>`
      : null}
  </fieldset>`;

  return html`<section class="s2-form-screen">
    ${pageHead("New agreement", "Record a signed agreement for this customer, offering only the scope, billing path and data rights position the catalogue admits.")}
    <form class="ac-form" onSubmit=${submit} id="contract-form">
      <label class="ac-field">
        <span>Binds to</span>
        <select name="scopeTier" class="ac-input" onChange=${(e: Event) => { form.value = { ...form.value, scopeTier: (e.currentTarget as HTMLSelectElement).value as Tier }; }}>
          ${SCOPE_TIERS.map((t) => html`<option value=${t} selected=${f.scopeTier === t}>${t}</option>`)}
        </select>
      </label>
      ${whenReady(ctx, tree.value, (t) => scopeField(t.nodes))}
      ${f.scopeTier === "parent" ? html`<details class="s2-help"><summary>Why a region is needed</summary><p>A parent-scope agreement has no edge to take a region from, so name the region it is administered from.</p></details>` : null}
      ${f.scopeTier === "parent" ? whenReady(ctx, regions.value, (r) => regionField(r.regions)) : null}
      <label class="ac-field">
        <span>Kind</span>
        <select name="kind" class="ac-input" onChange=${(e: Event) => { form.value = { ...form.value, kind: (e.currentTarget as HTMLSelectElement).value }; }}>
          ${KINDS.map((k) => html`<option value=${k} selected=${f.kind === k}>${k === "residential_membership" ? `residential membership — ${COOL_CLUB.name}` : k.replace(/_/g, " ")}</option>`)}
        </select>
      </label>
      ${f.kind === "amendment" ? whenReady(ctx, existing.value, (c) => amendmentField(c.contracts)) : null}
      ${f.kind === "amendment" ? html`<details class="s2-help"><summary>Why ended agreements are unavailable</summary><p>An agreement that has already ended is not offered — a child of one binds nobody.</p></details>` : null}
      <label class="ac-field">
        <span>Billing path</span>
        <select name="billingPath" class="ac-input">${BILLING_PATHS.map((b) => html`<option value=${b}>${b.replace(/_/g, " ")}</option>`)}</select>
      </label>
      <details class="s2-help"><summary>How billing path is used</summary><p>Choose one of the four paths at signature. It defines how the agreement bills; it is not a flag on one function.</p></details>
      <label class="ac-field"><span>Signed</span><input class="ac-input" type="date" name="signedAt" required /></label>
      <label class="ac-field"><span>Effective from</span><input class="ac-input" type="date" name="effectiveFrom" required onInput=${boundEnd("effectiveTo")} /></label>
      <label class="ac-field"><span>Effective to</span><input class="ac-input" type="date" name="effectiveTo" /><small>Leave empty for evergreen.</small></label>
      <label class="ac-field"><span>Signed document</span><input class="ac-input" name="documentKey" /><small>The storage key of the signed PDF.</small></label>
      ${oq5Field()}
      <div class="s2-form__actions">
        ${oq5Submit(ctx, f, blocked)}
        ${linkTo(ctx, "contracts.list", { orgId }, "Cancel")}
      </div>
    </form>
    ${f.refusal ? refusalView(ctx, f.refusal, refusalRoutes(ctx, f.refusal, orgId)) : null}
  </section>`;
};

/** The submit, with the reason it is disabled said out loud rather than rendered as a dead button. */
const oq5Submit = (ctx: ScreenContext, f: Form, blocked: string | null): VNode =>
  blocked || ctx.degraded ? submitAction(ctx, "Record agreement", "record", blocked)
  : f.oq5 === "unset"
    ? html`<span class="ac-action-wrap"><button type="button" class="ac-action" id="record" aria-disabled="true">Record agreement</button><span class="ac-action__reason" role="note">State the diagnostic data rights position first.</span></span>`
    : submitAction(ctx, f.busy ? "Recording…" : "Record agreement", "record");

export const refusalRoutes = (ctx: ScreenContext, r: Refusal, orgId: string) => {
  const routes: { label: string; onSelect: () => void; primary?: boolean }[] = [];
  if (r.kind === "admission" && r.code === "amendment_needs_parent") {
    routes.push({ label: "Pick the agreement it amends", onSelect: () => { form.value = { ...form.value, kind: "amendment", refusal: null }; }, primary: true });
  }
  if (r.kind === "admission" && r.code === "ac_contract_scope_exists") {
    routes.push({ label: "Check the tree", onSelect: () => ctx.router.navigate("accounts.tree", { orgId }), primary: true });
  }
  routes.push({ label: "Back to the agreements", onSelect: () => ctx.router.navigate("contracts.list", { orgId }) });
  return routes;
};
