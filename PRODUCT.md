# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The platform serves eight principals through eight web surfaces. Design decisions favour the first one when surfaces pull in different directions.

- **Office staff and dispatchers (primary)**: S2 Service Manager and S3 Dispatch Console, the dense `console` screens where most daily work happens. S3 is region-scoped and S2 is org-wide and role-based.
- **Technicians**: S5 web fallback, `field` density, tech credential plus a shift device grant. The fallback exists so the tablet is never a single point of failure.
- **Customers**: S6 Customer Portal, `comfort` density, customer IdP with a tier claim.
- **Also served**: leadership (S4 HQ Dashboard, read-only), subcontractor firms (S8), vendors (S7, Phase 4, disabled), and anonymous visitors (S1 marketing and lead capture).

## Product Purpose

One multi-tenant system for running heating, ventilating and refrigerating service across a network of operating firms: accounts and contracts, dispatch, field work, customer visibility, subcontractor compliance and settlement, and leadership reporting. None of the eight surfaces owns data; each is a scoped view onto one hierarchy, reached only through one gateway.

Success is expensive failures being prevented structurally, not caught by review after the fact.

## Positioning

Every structural invariant is enforced by a reviewed diff on a named file or by a database trigger or policy, not by convention. The repo states it as "expensive failures are erosions, not bugs". Contract terms, tiers and region scoping cannot drift silently, and a refusal names the rule that refused. A neighbouring field-service tool with convention-based rules could not truthfully claim this.

## Operating Context

- Rankine Operating Company is the network and the contracting entity. Operating firms keep their local names and equity. AC Services DFW (Heating, Ventilating, Refrigerating, Dallas, Texas) is Works No. 1.
- Four-tier hierarchy with region-scoped data (`region_id` is derived from the parent edge) and contract terms resolved through a term policy register with override rows.
- Dispatch runs on a board with an offline queue. Field work continues through the S5 fallback when connectivity or the tablet fails.
- Surfaces are static pages served from Cloudflare Pages and talk to a gateway container over an operation catalogue. Phase 1 is in build or built, S4 is Phase 2, S7 is Phase 4.

## Capabilities and Constraints

- Hierarchy, contracts, rate cards, warranty cases, invoices, payments and settlements (S2).
- Assignment, job state, escalation and crew release (S3). Checklists, photos, parts used, time entries and signatures offline-tolerant in the field (S5).
- Customer service requests, photos, payments and contact updates (S6). Compliance documents, crew rosters and settlement acknowledgement (S8, minimum cut for Phase 1).
- Constraints that future work must respect: the tier and term definitions are under change control (a change is a migration that re-admits every override row); each surface writes only what its registry row allows; refusals are rendered, never swallowed.
- Open and undecided product facts are tracked in `docs/OPEN_DECISIONS.md` (pricing architecture OQ1, payment terms D13, supply before signature D14, S8 scope D12). Do not resolve them in design work.

## Brand Commitments

Rankine Operating Company, tagline "Measured, not promised." Theme name Arc Foundry. The visual system is already recorded in `docs/BRAND.md` and governed by the `arc-foundry` skill. It is not restated here.

## Evidence on Hand

- `README.md`, `docs/BACKBONE_CONTRACT.md`, `docs/SURFACES.md` (generated), `docs/OPEN_DECISIONS.md`, `docs/BRAND.md` (generated from `packages/tokens`), `docs/build-notes/22`–`27`, and one critique in `docs/critiques/`.
- Real customer, partner or testimonial content is not recorded in the repo. Do not fabricate it. Amped is the Phase 1 reference customer in test fixtures.

## Product Principles

1. **Refuse visibly.** When a rule blocks an action, show which rule and why. A silent failure or generic error is a product defect.
2. **Scope is the product.** Every screen shows only what its principal's scope allows, and the interface makes that scope legible.
3. **State is evidence, not decoration.** Status, SLA and term values come from computed, traceable sources and are shown with their trace where decisions depend on them.
4. **Degrade, don't disappear.** Offline and degraded modes are first-class states that people can see and work in.
5. **Density follows the job.** `console`, `field` and `comfort` are deliberate registry values, not styling preferences.

## Accessibility & Inclusion

No product-specific accessibility standard has been confirmed. Field use (S5) implies glare, gloves and poor connectivity, but this is an inference, not a stated requirement. Open for the owner to set.
