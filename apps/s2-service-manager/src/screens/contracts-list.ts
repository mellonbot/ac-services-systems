import { html, DataGrid, StatusPill, type VNode } from "../../../../packages/ui/src/index.ts";
import type { AccountWire, ContractWire, ContractState, OrganizationWire, Refusal } from "../../../../packages/contracts/src/index.ts";
import { signal } from "../../../../packages/ui/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, refusalView, linkTo, type Screen } from "./common.ts";

/**
 * C2 — the agreements a customer is served under. One row per signed
 * document, saying what it binds to, which of the four billing paths it
 * chose, the window it covers, and where it stands on the ladder.
 *
 * Two columns earn their place here and nowhere else:
 *
 *   Data rights (OQ5) — visible per record, because "which agreements did we
 *   sign without reserving diagnostic rights" is the Phase 4 licensing
 *   question, and the answer has to be readable before Phase 4, not
 *   discovered in it.
 *
 *   State — the transitions live on the row rather than behind a detail page,
 *   because activating an agreement is the moment its terms start resolving.
 *
 * State is deliberately NOT a StatusPill. The status register holds four words
 * — on track, at risk, breached, blocked — and all four are about operational
 * HEALTH. A draft agreement is not blocked and an expired one is not breached;
 * borrowing that vocabulary here would print a dispatcher's alarm words on a
 * contract administrator's filing state. OQ5 *is* a pill, because "not
 * reserved" is a real liability carried until somebody renegotiates it.
 */
const STATE_TONE: Readonly<Record<ContractState, "pending" | "live" | "ended">> = Object.freeze({
  draft: "pending", active: "live", expired: "ended", terminated: "ended",
});

/** Which endings the ladder admits from here — the same list the handler holds, asked of the row so the UI offers no step that would be refused. */
const NEXT: Readonly<Record<ContractState, readonly ("active" | "expired" | "terminated")[]>> = Object.freeze({
  draft: ["active"], active: ["expired", "terminated"], expired: [], terminated: [],
});

const outcome = signal<{ readonly refusal: Refusal | null; readonly busy: string }>({ refusal: null, busy: "" });

export const contractsList: Screen = (ctx, params) => {
  const { store, shell } = ctx;
  const orgId = params.orgId;
  const orgs = store.read(keyOf("organizations.list", { kind: "customer" }), () => shell.gateway.listOrganizations({ kind: "customer" }));

  const orgGrid = (list: readonly OrganizationWire[]): VNode =>
    DataGrid({
      density: ctx.density, caption: "Customers",
      columns: [{ key: "name", header: "Customer", cell: (o: OrganizationWire) => linkTo(ctx, "contracts.list", { orgId: o.id }, o.name) }],
      rows: list, rowKey: (o: OrganizationWire) => o.id, selectedKey: orgId ?? "",
      onSelect: (o: OrganizationWire) => ctx.router.navigate("contracts.list", { orgId: o.id }),
      emptyText: "No customers yet.",
    });

  const transition = async (c: ContractWire, to: "active" | "expired" | "terminated") => {
    if (ctx.degraded || outcome.value.busy) return;
    outcome.value = { refusal: null, busy: c.id };
    try {
      const out = await shell.gateway.transitionContract({ contractId: c.id, to });
      store.invalidate(keyOf("contracts.list", { orgId: orgId! }));
      store.notice.value = [`Agreement is now ${out.state}.`];
      outcome.value = { refusal: null, busy: "" };
    } catch (err) {
      outcome.value = { refusal: shell.refusalOf(err) ?? { kind: "transport", status: null, message: String(err) }, busy: "" };
    }
  };

  const scopeName = (c: ContractWire, nodes: readonly AccountWire[], org: OrganizationWire | undefined): string =>
    c.scopeTier === "parent" ? (org?.name ?? c.scopeId) : (nodes.find((n) => n.id === c.scopeId)?.name ?? c.scopeId);

  const grid = (contracts: readonly ContractWire[], nodes: readonly AccountWire[], org: OrganizationWire | undefined): VNode => html`
    <section class="s2-contracts" aria-label="Agreements">
      <header class="s2-tree__head">
        <h2 class="s2-h2">${org?.name ?? "Customer"} — agreements</h2>
        <span class="s2-row-actions">
          ${linkTo(ctx, "contracts.new", { orgId: orgId! }, "+ Agreement", "ac-action s2-link--action")}
          ${linkTo(ctx, "terms.override", { orgId: orgId! }, "Term overrides")}
          ${linkTo(ctx, "terms.resolved", { orgId: orgId! }, "Resolved terms")}
        </span>
      </header>
      ${DataGrid({
        density: ctx.density,
        columns: [
          { key: "scopeId", header: "Binds to", cell: (c: ContractWire) => html`<span data-tier=${c.scopeTier}>${scopeName(c, nodes, org)} <small class="s2-muted">${c.scopeTier}</small></span>` },
          { key: "kind", header: "Kind" },
          { key: "billingPath", header: "Billing path" },
          { key: "effectiveFrom", header: "Effective", cell: (c: ContractWire) => `${c.effectiveFrom} → ${c.effectiveTo ?? "evergreen"}` },
          {
            key: "diagnosticDataRightsReserved", header: "Data rights (OQ5)",
            cell: (c: ContractWire) => StatusPill({ density: ctx.density, status: c.diagnosticDataRightsReserved ? "ok" : "at_risk", label: c.diagnosticDataRightsReserved ? "Reserved" : "Not reserved" }),
          },
          { key: "state", header: "State", cell: (c: ContractWire) => html`<span class="s2-state" data-tone=${STATE_TONE[c.state]}>${c.state}</span>` },
          {
            key: "actions", header: "", align: "end",
            cell: (c: ContractWire) => html`<span class="s2-row-actions">
              ${NEXT[c.state].map((to) => html`<button type="button" class="s2-link" disabled=${ctx.degraded || outcome.value.busy === c.id} onClick=${() => transition(c, to)}>${to === "active" ? "Activate" : to === "expired" ? "Expire" : "Terminate"}</button>`)}
              ${linkTo(ctx, "terms.override", { orgId: orgId! }, "Overrides")}
            </span>`,
          },
        ],
        rows: contracts, rowKey: (c: ContractWire) => c.id,
        emptyText: "No agreements recorded for this customer yet.",
      })}
      ${outcome.value.refusal ? refusalView(ctx, outcome.value.refusal, [{ label: "Dismiss", onSelect: () => { outcome.value = { refusal: null, busy: "" }; } }]) : null}
    </section>`;

  if (!orgId) {
    return html`<div class="s2-two-col">
      <aside class="s2-col--orgs">${whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations))}</aside>
      <p class="s2-empty">Pick a customer to see what they are served under.</p>
    </div>`;
  }

  const contracts = store.read(keyOf("contracts.list", { orgId }), () => shell.gateway.listContracts({ orgId }));
  const tree = store.read(keyOf("accounts.list", { orgId }), () => shell.gateway.listAccounts({ orgId }));

  return html`<div class="s2-two-col">
    <aside class="s2-col--orgs">${whenReady(ctx, orgs.value, (o) => orgGrid(o.organizations))}</aside>
    ${whenReady(ctx, contracts.value, (c) =>
      whenReady(ctx, tree.value, (t) =>
        whenReady(ctx, orgs.value, (o) => grid(c.contracts, t.nodes, o.organizations.find((x) => x.id === orgId)))))}
  </div>`;
};
