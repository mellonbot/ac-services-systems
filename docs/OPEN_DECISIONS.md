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

**OPEN-S6-IMAGERY — which provider draws the roof, under whose key, at what cost?**

Item 9 (2026-09-21) built the site card with overhead imagery served BY THE
GATEWAY: `sites.imagery` reads the site's coordinates off `accounts.address`,
renders `AC_IMAGERY_URL` (a URL template with `{lat}`, `{lng}`, `{zoom}`,
`{w}`, `{h}`), fetches the picture, caches it per site for a day and returns it
inline as a data: URL. The customer's browser never reaches a third party with
a customer's address, and no key is in a bundle — the two reasons the obvious
`<img src="https://provider…">` was not built. The whole pipe executes in
`test/integration/s6-site-card.test.ts` and `tools/ci/drive-s6.ts` against a
stub provider this repository runs itself.

What is not decided: the provider (a static-map API, an aerial-imagery tile
service, a county GIS), the licence its attribution line and caching terms
impose, who holds the key, and the per-fetch cost against a portal that will
open a few thousand site cards a month. Unset, the card says *"Overhead imagery
is not enabled for this portal"* under the address and is complete without it.
Also unset: WHO records coordinates. `accounts.update` takes `lat`/`lng` inside
the address object; nothing geocodes an address, and S2 has no field for it yet.

Lands in: the gateway's environment (`AC_IMAGERY_URL`, `AC_IMAGERY_ATTRIBUTION`),
`apps/gateway/src/handlers/imagery.ts` if the provider needs a header rather
than a key in the URL, and an S2 field (or a geocoding step) for the
coordinates.

**OPEN-S6-CONTACTS — may the customer edit its own on-site contacts?**

`contact_update` has been on S6's write allowlist since `05`. Item 9 gave it a
table (`account_contacts`, 0009) and the office a write (`contacts.set`, S2);
the customer READS contacts on the site card and edits nothing. Whether a
facility manager may name their own replacement, or change the desk's number at
2 a.m. when the crew is at the gate, is a product decision with a security edge:
a contact is who a crew is told to trust on arrival. If yes, it is one
operation admitted to S6 under the `contact_update` label, with 0009's INSERT
policy widened from the internal namespace to "the customer, at a node in its
own scope" — a reviewed diff on the migration, not a flag.

Lands in: `packages/contracts/src/operations.ts` (`contacts.set` surfaces, or a
narrower `contacts.updateOwn`), a 0010 policy, and an S6 form on the card.

**OPEN-S8-D12 — the firm's writes, as built, are the registry's line; D12 ratifies or edits it.**

`00` §2 keeps D12 (S8 scope in Phase 1) open and says: *"the minimum cut is
compliance document intake plus settlement visibility. In code, D12 is S8's
write allowlist — one reviewed line."* Item 7 (2026-09-18) built exactly the
line as written — `compliance_doc`, `crew_roster`, `settlement_ack`, `dispute` —
each as its own operation (`credentials.submit`, `crews.enroll`/`crews.retire`,
`settlements.acknowledge`, `settlements.dispute`), each held at the table by
0007's triggers so the entity label and the row agree. Closing D12 is therefore
confirming the four, or deleting a word from `SURFACES.S8.writes`: an entity
removed there makes its operation a scope refusal on the next request, with
nothing else to change.

Three things D12's owner should know were decided in the build:
- **Roster before activation.** An onboarding firm rosters crews and files
  their documents; a suspended or terminated firm does not. The office verifies
  documents before the first job either way, so a firm that cannot roster until
  it is active cannot be made active with a cleared crew.
- **A dispute is not withdrawn by the firm.** issued → acknowledged, and
  issued|acknowledged → disputed, are the firm's steps; every other step on a
  statement is ours (WS-E's ladder, D13). A firm that disputed in error tells
  the office, which answers on the row.
- **Statements are still rows.** There is no operation that issues one; that is
  WS-E (E4/E5). The tests seed them by SQL. `settlements.list`/`.lines` read
  what that work will write, with `acknowledged_at`, `disputed_at` and
  `dispute_reason` already on the table (0007 + regenerated 0001).

Also from item 7, not blocking anything: **`sessions` has no row-level policy.**
A bound external principal can read every session row (ids, principal, expiry —
no token, no secret). `users` was closed by 0007 (own row); `sessions` was left
because the gateway reads it under every kind of binding and a device grant's
session names the grant, not the technician. One policy, one wire test; do it
when the next migration opens.

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

**OPEN-S1-CEILING — what is S1 allowed to promise? (D7a, OQ6, action plan F9)**

`05` §S1 says availability and response-time language on the marketing surface
is bounded by **OQ6** (the single-site constraint) and **D7a** (the response
obligation behind a single named owner), and adds the sentence that made this
an item rather than a copy review: *"neither of which is visible to whoever
writes the copy"*. F9 is where the ceiling gets written down.

Item 8 (2026-09-18) did not wait for it and did not guess at it. It set the
ceiling to **zero** and made that a mechanism rather than an intention:

- `apps/s1-marketing/src/app.test.ts` fails on a rendered page containing a
  response window, a "24/7", a "same-day", a guarantee, an uptime figure or the
  word SLA;
- `tools/ci/drive-s1.ts` runs the same list against the **painted** page in a
  real browser, so a claim that arrives through a stylesheet fails too.

So a sentence promising a time fails in the commit that adds it, and nobody has
to remember why. **When F9 lands, those two lists are what changes** — they are
the ceiling, written in the only place that enforces it.

The related half is the coverage map, and it is already closed: the metros are
read from `regions` through `ac_public_coverage()` (migration 0008), never from
a list in the bundle, so a map claiming a metro with no crews behind it is not
expressible. `min_crew_density` — D14's rule — is deliberately not in that
function's result, because a supply figure on a public page is a promise.

**OPEN-S1-ABUSE — a public write with no credential in front of it.**

`leads.submit` is the first mutation in the system a stranger can reach. It is
bounded in every way the frame already provides — a session row per visit that
an operator can revoke, a write allowlist of two entities, a tenancy that is a
constant, field lengths, and a unique `submission_id` that makes a retry
idempotent — but **none of those is a rate limit**, and the gateway has no rate
limiter today.

What that means concretely: a script can mint anonymous sessions and write
leads as fast as it can open sockets. The blast radius is bounded (rows in
PROSPECT/UNASSIGNED, and an office inbox full of noise — no customer data is
reachable, and `test/integration/s1.test.ts` holds that), but the cost is real
and it lands on whoever works the intake queue.

This is an infrastructure decision more than a code one, and it should be taken
deliberately rather than discovered:
- at the edge (a WAF or CDN rule on `POST /auth/anonymous` and `POST /s1/leads`),
  which is where rate limiting belongs and where it does not become a stateful
  thing inside the gateway; or
- in the gateway, which means a shared counter, which means another piece of
  infrastructure.

Until one is chosen, S1 should not be exposed on a public domain. Naming the
owner is D7's; the choice is the infrastructure memo's (`02`).
