# Open decisions this repo is waiting on

The frame is built so these plug in without structural change. Where a decision
would otherwise leak into the schema, the code holds a *shape* instead of an
assumption. Each row names the file that changes when the decision lands.

| ID | Decision | What the code holds today | Lands in |
|----|----------|---------------------------|----------|
| **D2** | Four-tier hierarchy as a structural constraint | `TIERS` is one constant; the resolver and scope model derive from it | `packages/contracts/src/tiers.ts` — **must close before schema freeze (M1/B2).** The frame cannot protect against changing the ladder afterwards |
| **D7** | One named infrastructure owner | Nothing. This is the only non-negotiable with no mechanism | — |
| **D9** | Phase 1 scope and deferrals | Surfaces are registry rows with `phase` and `enabled`. Deferring one is a data change | `packages/contracts/src/surfaces.ts` |
| **D12** | S8 scope in Phase 1 | Write allowlist is the minimum cut: compliance intake + settlement visibility. Widening it is one reviewed line | `surfaces.ts` → `SURFACES.S8.writes` |
| **D13** | Payment terms / working capital | `working_capital_positions` exists so the float is measured from day one rather than sized after it hurts | `packages/schema/src/tables/billing.ts` |
| **D14** | Supply before signature | `regions.min_crew_density` holds the rule and is `0` until set. The account-authoring check reads it and reports *"rule not set"* rather than silently passing | `packages/schema/src/tables/roots.ts` |
| **OQ1** | Pricing architecture | Determines invoice path *internals*, not the path structure. All four paths exist regardless | `packages/domain/src/billing/paths/*` |
| **OQ5** | Diagnostic data rights | `diagnostic_data_rights_reserved` is `NOT NULL` on both the customer contract and the subcontractor firm. A contract cannot be recorded without stating its position — the Phase 4 licensing question is answered at signature time instead of discovered in year six | `tables/contracts.ts`, `tables/network.ts` |

## Raised by this scaffold

**OPEN-S4 — can the HQ dashboard write annotations?**

`05_Web_Surface_Architecture.md` Rev B lists S4's writes as *"annotation,
acknowledgement only"*. `06_Software_Architecture_Frame.md` Rev A says
`SURFACES.S4.writes` is `[]` — *"Nobody has to remember it."*

The code implements the stricter reading: **empty**. Both documents agree on the
reason (if HQ can reassign a crew from the dashboard, regional autonomy is
decorative), and an empty list is the version that cannot be argued into
something larger under pressure.

The distinction is real, though: an annotation carries no region-scoped
operational state — it is commentary on a rollup. If the partners want it, the
clean mechanism is a second, separate list (`annotates`) rather than loosening
`writes`, so that "S4 can comment" never becomes "S4 can act". That is a
decision, not an implementation detail, and S4 is Phase 2 — so it is not blocking.

**OPEN-MONEY-IN-JSONB.** Contract term values arrive from `jsonb`. A JSON number
is an IEEE754 double, so a money amount stored as a JSON number is a float in the
money path wearing a jsonb costume — silently lossy past 2^53 minor units. The
code requires money and quantity terms to be **strings**, converted with
`BigInt(String(x))`. Worth confirming this matches how the contract engine's UI
will author terms.
