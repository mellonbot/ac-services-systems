# Open decisions this repo is waiting on

**Updated 2026-09-15 after the partner meeting.** D2 is ratified — `TIERS`, `TERMS`
and the derive-region trigger are the agreed interface and are now under change
control (see the banner at the top of `docs/BACKBONE_CONTRACT.md`). D7 confirmed.
D1, D6, D8, D10, D11 also closed that morning; none of them has a shape in this
repo beyond what is already here. The rows below are what is still open.

The frame is built so these plug in without structural change. Where a decision
would otherwise leak into the schema, the code holds a *shape* instead of an
assumption. Each row names the file that changes when the decision lands.

| ID | Decision | What the code holds today | Lands in |
|----|----------|---------------------------|----------|
| ~~**D2**~~ | ~~Four-tier hierarchy, term policy register, `region_id` semantics~~ | **CLOSED — ratified as built 2026-09-15.** `TIERS`; `TERMS` as two axes mirrored into `term_registry`; `region_id` derived from the parent edge by trigger with `customer_group` as the attribute. A change to any of these is now a migration that re-admits every override row, not an edit | `packages/contracts/src/{tiers,terms}.ts`, `migrations/0002` — change-controlled |
| ~~**D7**~~ | ~~One named infrastructure owner~~ | **CLOSED** — Ethan M. (2026-09-14, confirmed jointly 2026-09-15). **D7a** — the response obligation — is still open; it is a vendor contract, not a shape in this repo | — |
| **D9** | Phase 1 scope and deferrals | Surfaces are registry rows with `phase` and `enabled`. Deferring one is a data change. D11 (closed 2026-09-15) took the scope-cut lever; D9 confirms the list | `packages/contracts/src/surfaces.ts` |
| **D12** | S8 scope in Phase 1 | Write allowlist is the minimum cut: compliance intake + settlement visibility. Widening it is one reviewed line | `surfaces.ts` → `SURFACES.S8.writes` |
| **D13** | Payment terms / working capital | `working_capital_positions` exists so the float is measured from day one rather than sized after it hurts | `packages/schema/src/tables/billing.ts` |
| **D14** | Supply before signature | `regions.min_crew_density` holds the rule and is `0` until set. The account-authoring check reads it and reports *"rule not set"* rather than silently passing | `packages/schema/src/tables/roots.ts` |
| **OQ1** | Pricing architecture | Determines invoice path *internals*, not the path structure. All four paths exist regardless | `packages/domain/src/billing/paths/*` |
| **OQ5** | Diagnostic data rights | `diagnostic_data_rights_reserved` is `NOT NULL` on both the customer contract and the subcontractor firm. A contract cannot be recorded without stating its position — the Phase 4 licensing question is answered at signature time instead of discovered in year six | `tables/contracts.ts`, `tables/network.ts` |

## Raised by this scaffold

**OPEN-S6-IDP — when does the customer portal federate?**

`05` and the surface registry say S6's auth is *"customer IdP + tier claim"*.
Item 6 (2026-09-17) built the portal with a **password held at our gateway** as
the Phase 1 door: `auth.login` now serves S6 (`packages/contracts/src/operations.ts`,
`PASSWORD_LOGIN`), and customer users carry a `password_hash` like ours do.

The claims a customer token carries — namespace, org, scope tier, scope node —
are the same whichever way the credential is checked, and everything the
acceptance test measures (RLS, the context walk, tier scoping) is proven against
those claims. Federation therefore replaces the credential check inside `login()`
and nothing downstream of it. What it needs is a customer's identity provider to
test against — Amped's IT — and a decision on how the IdP's tier claim maps to a
scope node (the `users` row already holds `external_idp_subject` and the scope
columns; that mapping is the one design question left).

Lands in: `apps/gateway/src/main.ts` (`login`), `PASSWORD_LOGIN`, and a users
provisioning operation (there is none yet — customer principals are seeded by
SQL, which does not survive the third account).

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
