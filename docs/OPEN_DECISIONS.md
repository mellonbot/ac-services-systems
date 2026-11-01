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

The customer portal signs in with a gateway-held password (`PASSWORD_LOGIN`).
Federation replaces that credential check inside `auth.login` and nothing
else: the claims it mints stay the same. `users.external_idp_subject` is the
column that mapping lands in. Building it needs a customer's IdP to test
against (Amped's IT). There is no `AC_IDP_ISSUER` branch in the meantime — a
configured issuer that refused every customer password was a door that could
not open. Provisioning stays SQL-seeded until that exchange exists.

**~~OPEN-S6-IMAGERY~~ — which provider draws the roof, under whose key, at what cost?**

**CLOSED 2026-10-28.** MapTiler, using the same `AC_MAPTILER_KEY` already
used for S2 tiles and geocoding. When the key is set and `AC_IMAGERY_URL` is
unset, `imageryConfigFromEnv` builds a static-map URL
(`https://api.maptiler.com/maps/streets/static/{lng},{lat},{zoom}/{w}x{h}.png?key=…`)
and sets the required attribution. An explicit `AC_IMAGERY_URL` still wins.
Coordinates are recorded by the existing `sites.locate` path (S2 home map
calls it; the point is written onto `accounts.address`). Caching remains one
day for a hit, one minute for a failure. Cost is MapTiler's static-map
pricing; a few thousand cards a month is well inside a normal plan.

**~~OPEN-S6-CONTACTS~~ — may the customer edit its own on-site contacts?**

**CLOSED 2026-10-28.** Yes. `contacts.set` is admitted to S6. Migration 0037
widens the write on `account_contacts` so a customer principal can insert or
update a contact exactly when `ac_node_row_visible(account_id)` is true.
The S6 site card has a form that posts to it. Internal continues to write as
before. A contact is still who a crew is told to trust on arrival; the table
holds the rule.

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
decision, not an implementation detail, and it is not blocking.

*Item 10 (2026-09-27):* S4 is built and **enabled** on the partners' instruction,
ahead of the Phase 2 gate in 00 §5.5 ("ships only once regions demonstrably run
without it"). The instruction was *see everything, change nothing*, so `writes`
stays `[]`, the catalogue serves S4 two reads, and migration 0010 grants the
gateway role no write on `hq_metrics`. Annotation remains open as above.

**OPEN-MONEY-IN-JSONB.** Contract term values arrive from `jsonb`. A JSON number
is an IEEE754 double, so a money amount stored as a JSON number is a float in the
money path wearing a jsonb costume — silently lossy past 2^53 minor units. The
code requires money and quantity terms to be **strings**, converted with
`BigInt(String(x))`. Worth confirming this matches how the contract engine's UI
will author terms.

**OPEN-S1-CEILING — what is S1 allowed to promise? (D7a, OQ6, action plan F9)**

`05` §S1 says availability and response-time language on S1 (the marketing surface then; the front door since 2026-11-01)
is bounded by **OQ6** (the single-site constraint) and **D7a** (the response
obligation behind a single named owner), and adds the sentence that made this
an item rather than a copy review: *"neither of which is visible to whoever
writes the copy"*. F9 is where the ceiling gets written down.

Item 8 (2026-09-18) did not wait for it and did not guess at it. It set the
ceiling to **zero** and made that a mechanism rather than an intention:

- `apps/s1-front-door/src/app.test.ts` fails on a rendered page containing a
  response window, a "24/7", a "same-day", a guarantee, an uptime figure or the
  word SLA;
- `tools/drive/drive-s1.ts` runs the same list against the **painted** page in a
  real browser, so a claim that arrives through a stylesheet fails too.

So a sentence promising a time fails in the commit that adds it, and nobody has
to remember why. **When F9 lands, those two lists are what changes** — they are
the ceiling, written in the only place that enforces it.

The related half was the coverage map. S1 no longer shows one (2026-11-01);
`ac_public_coverage()` (migration 0008) stays in the schema, and if a coverage
claim comes back it comes back through that function, never a list in a bundle.

**~~OPEN-S1-ABUSE~~ — a public door with no credential in front of it.**

**CLOSED 2026-10-28; the door changed 2026-11-01.** Edge rate limiting via
Cloudflare WAF on the zone. S1 is now the front door and takes no write, so the
one rule is on its sign-in (documented in `docs/CLOUDFLARE_PAGES.md`):

- `POST /auth/sign-in` — 30 requests per minute per IP, block 10 minutes

The October rules on `/auth/anonymous` and `/s1/leads` guard routes that no
longer exist and can be deleted. The rule is a dashboard/API object on the
zone, not a file here. S1 should not be public until it exists. Behind it, the
gateway counts sign-ins per address itself (`LOGIN_BY_ADDRESS`, 120 a minute).

**OPEN-S7 — enable the vendor portal (D9).** *Item 11 (2026-09-27)* built
procurement and S7 in full, with S7 left `enabled: false` (Phase 4). The
partners asked to show it in the clickable demo for a few days: `tools/demo/build.ts`
switches it on in the demo's bundles only (`DEMO_ONLY_ENABLED`); the product
registry, gateway and database are unchanged. Enabling it for real is the one
registry line, and the vendor-side wire tests then run as written.

**OPEN-PAYMENTS.** Customer half built by 0030. **Webhook scaffold 2026-10-28:**
`payments.webhook` accepts a processor callback when `AC_PAYMENT_WEBHOOK_SECRET`
is set and records a succeeded payment the same way the office does. Unset, it
refuses. Y1–Y5 (ledger of record, processor choice, who may pay a consolidated
invoice, card fees, merchant of record) and the vendor paid state remain open.

**OPEN-RLS-REMAINDER.** Three tables still have row security off entirely:
`brand_themes`, `subscriptions`, `sync_conflicts` (`storage_objects` got its rule
in 0017, when request photos first wrote to it). The 0011
audit bound a vendor and found them empty on the test database, so nothing was
read; but `sync_conflicts` can carry a job's payload once the field layer
queues conflicts, and an empty table is not a policy. Each needs its own rule,
decided with its own reader (S5 for sync conflicts), rather than a blanket one.

