import { html, type VNode } from "../../../../packages/ui/src/index.ts";
import type { ResolutionWire, TermPolicy, Tier } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readNodes, treeOf, linkTo, TIER_WORD, type Screen } from "./common.ts";

/**
 * TERMS — what was agreed, as it resolves at one node on one day. The same
 * `terms.resolved` S2's trace panel reads, with the same register behind it:
 * the term's plain-language line comes from `terms.register`, and where the
 * value won (the tier, the node) comes from the resolver's own answer, not a
 * sentence this screen composed.
 *
 * A customer can only resolve at a node it can see — 0006 makes another
 * customer's node, and a sibling location, absent rather than forbidden — and
 * with its own agreements, whatever `orgId` was typed. The `asOf` control is
 * the disputed-February case from the design (09): a customer asking "what
 * was I owed in February" asks February.
 */
const TERM_WORD: Readonly<Record<string, string>> = {
  payment_terms_days: "Payment terms (days)",
  billing_rollup_tier: "Invoice consolidated at",
  invoice_delivery: "Invoice delivery",
  sla_response: "Response commitment",
  sla_credit_pct: "Service credit on a missed response (%)",
  pm_visits_per_year: "Preventive visits per year",
  after_hours_multiplier_milli: "After-hours multiplier (thousandths)",
  labor_rate_minor: "Labor rate",
  vendor_warranty: "Equipment warranty",
  equipment_service_window: "Service window",
  diagnostic_data_rights_reserved: "Diagnostic data rights reserved",
};
const label = (key: string) => TERM_WORD[key] ?? key.replaceAll("_", " ");

export const valueWord = (r: ResolutionWire, policy: TermPolicy | undefined): string => {
  const v = r.value;
  if (v === null || v === undefined) return "—";
  if (policy?.valueKind === "money") return `$${(Number(String(v)) / 100).toFixed(2)}`;
  if (policy?.valueKind === "bool") return v ? "Yes" : "No";
  if (typeof v === "string") return v.replaceAll("_", " ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export const wonWhere = (r: ResolutionWire, nameOf: (id: string) => string | undefined): string => {
  if (r.wonAt === "fallback") return "Standard term — nothing in your agreements sets it";
  if (r.wonAt.tier === "parent") return "Set in the master agreement";
  return `Set at ${TIER_WORD[r.wonAt.tier as keyof typeof TIER_WORD] ?? r.wonAt.tier}: ${nameOf(r.wonAt.id) ?? "a node above"}`;
};

export const terms: Screen = (ctx, params) => {
  const tier = params.tier as Tier;
  const nodeId = params.nodeId ?? "";
  const asOf = params.asOf ?? new Date().toISOString().slice(0, 10);
  const nodes = readNodes(ctx);
  const register = ctx.store.read("terms.register", () => ctx.shell.gateway.termRegister());
  const resolved = ctx.store.read(keyOf("terms.resolved", { tier, nodeId, asOf }), () => ctx.shell.gateway.resolvedTerms({ tier, nodeId, asOf }));
  const tree = nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes) : null;
  const nameOf = (id: string) => (id === ctx.shell.principal.orgId ? ctx.shell.context?.parent.name : tree?.byId.get(id)?.name);
  const here = tier === "parent" ? (ctx.shell.context?.parent.name ?? "the whole account") : (nameOf(nodeId) ?? "this node");
  const policies = register.value.state === "ready" ? new Map(register.value.value.terms.map((t) => [t.key, t])) : new Map<string, TermPolicy>();

  const onAsOf = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (v) ctx.router.navigate("terms", { tier, nodeId, asOf: v });
  };

  return html`<section class="s6-terms">
    <h1 class="s6-h1">Terms at ${here}</h1>
    ${tree && tier !== "parent" ? html`<p class="s6-crumbs">${[ctx.shell.context?.parent.name ?? "", ...tree.crumbs(nodeId)].filter(Boolean).join(" › ")}</p>` : null}
    <label class="s6-field s6-field--inline"><span>As of</span><input class="s6-input" type="date" name="asOf" value=${asOf} onChange=${onAsOf} id="as-of" /></label>
    ${whenReady(ctx, resolved.value, (out) => html`
      <dl class="s6-terms__list">
        ${Object.values(out.resolved).map((r) => termRow(r, policies.get(r.termKey), nameOf))}
      </dl>
      ${Object.keys(out.refused).length ? html`<p class="s6-muted">Not set anywhere on this path: ${Object.keys(out.refused).map(label).join(", ")}.</p>` : null}
    `, () => ctx.store.invalidate("terms.resolved"))}
    <p class="s6-actions">${linkTo(ctx, "sites", {}, "Back to sites")} ${linkTo(ctx, "agreements", {}, "Agreements")}</p>
  </section>`;
};

const termRow = (r: ResolutionWire, policy: TermPolicy | undefined, nameOf: (id: string) => string | undefined): VNode => html`
  <div class="s6-term" data-term=${r.termKey}>
    <dt class="s6-term__key">${label(r.termKey)}</dt>
    <dd class="s6-term__value">${valueWord(r, policy)}</dd>
    <dd class="s6-term__where">${wonWhere(r, nameOf)}</dd>
  </div>`;
