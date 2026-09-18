import { html, DataGrid, StatusPill, type Status } from "../../../../packages/ui/src/index.ts";
import type { ContractWire } from "../../../../packages/contracts/src/index.ts";
import { keyOf } from "../state.ts";
import { whenReady, readNodes, treeOf, linkTo, type Screen } from "./common.ts";

/**
 * AGREEMENTS — the customer's own paper, as recorded. `contracts.list` is the
 * operation S2 reads; for a customer principal 0006 returns its own org's
 * rows and nothing else, whatever `orgId` said. Each row links to the terms
 * as they resolve at its scope, which is where the customer reads what was
 * actually agreed (the override form that authored them is S2's alone).
 *
 * OQ5 is shown because it was answered at signature per agreement, and a
 * customer reading its own contract is entitled to see the position it took.
 */
const STATE: Readonly<Record<ContractWire["state"], { status: Status; word: string }>> = {
  draft: { status: "blocked", word: "Draft — not yet in force" },
  active: { status: "ok", word: "In force" },
  expired: { status: "at_risk", word: "Expired" },
  terminated: { status: "blocked", word: "Terminated" },
};
const KIND: Readonly<Record<ContractWire["kind"], string>> = {
  msa: "Master agreement", amendment: "Amendment", location_agreement: "Location agreement", project_sow: "Project statement of work",
  residential_membership: "Membership", one_time: "One-time work",
};

export const agreements: Screen = (ctx) => {
  const nodes = readNodes(ctx);
  const contracts = ctx.store.read(keyOf("contracts.list", {}), () => ctx.shell.gateway.listContracts({ orgId: ctx.shell.principal.orgId }));
  const scopeName = (c: ContractWire) => {
    if (c.scopeTier === "parent") return ctx.shell.context?.parent.name ?? "Whole account";
    return (nodes.value.state === "ready" ? treeOf(nodes.value.value.nodes).byId.get(c.scopeId)?.name : undefined) ?? "A node outside your view";
  };
  return html`<section class="s6-agreements">
    <h1 class="s6-h1">Agreements</h1>
    ${whenReady(ctx, contracts.value, (out) => DataGrid<ContractWire>({
      density: ctx.density,
      caption: "Agreements recorded for this account",
      emptyText: "No agreements recorded for this account.",
      rows: out.contracts,
      rowKey: (c) => c.id,
      columns: [
        { key: "kind", header: "Kind", cell: (c) => KIND[c.kind] },
        { key: "scope", header: "Covers", cell: (c) => scopeName(c) },
        { key: "state", header: "State", cell: (c) => StatusPill({ density: ctx.density, status: STATE[c.state].status, label: STATE[c.state].word }) ?? html`` },
        { key: "effective", header: "Effective", cell: (c) => `${c.effectiveFrom} → ${c.effectiveTo ?? "open"}` },
        { key: "signedAt", header: "Signed" },
        { key: "data", header: "Diagnostic data", cell: (c) => (c.diagnosticDataRightsReserved ? "Rights reserved to Rankine" : "Rights not reserved") },
        { key: "terms", header: "", cell: (c) => linkTo(ctx, "terms", { tier: c.scopeTier, nodeId: c.scopeId }, "Terms at this scope") },
      ],
    }) ?? html``, () => ctx.store.invalidate("contracts.list"))}
  </section>`;
};
