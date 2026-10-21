# Residential and commercial customers

**2026-10-21 · Scope · Owner: unassigned · Partner answers recorded 2026-10-21 (R1, R2, R4–R7); R3 open (provider due 2026-10-21)**

Today there is one kind of customer. Everything built so far — the S6 work
orders home, Intake, photos, Open job — was shaped by commercial accounts:
an organization with regions, locations and sites, an account card, site
filters, an Enterprise SLA. A homeowner arriving through S1 has none of that
structure, pays differently, and signs in differently. This document scopes
what it takes to serve both, what the partners must decide first, and the
order to build it in.

---

## What exists

| Piece | State | Where |
|---|---|---|
| Customer kind | One: `organizations.kind = 'customer'`. Nothing records residential vs. commercial | `packages/schema/src/tables/roots.ts` |
| Hierarchy | `parent → region → location → site`, ratified under change control (D2). A single home fits it as a one-branch tree | `packages/contracts/src/tiers.ts` |
| Creating a customer | `organizations.create` makes the org and its first region node; locations and sites are separate `accounts.create` calls in S2 — four steps for one house | `operations.ts`, S2 |
| Residential billing | A `residential_membership` contract kind and billing path exist. The path reads `membership_fee_minor` and `included_visits` — **neither is in the term register**, so today a membership bills a $0 fee with no visits included | `packages/domain/src/billing/paths/residential_membership/`, `packages/contracts/src/terms.ts` |
| Invoicing | No issuance operation, no paid state (OPEN-PAYMENTS, scope of 2026-10-21 §2) | — |
| S1 leads | A stranger's lead lands in PROSPECT; nothing converts a lead into a customer | `leads.submit` |
| Customer logins | Created by the office only (AC Logins app or the seed script). No self sign-up, no invite, no password reset | `tools/logins-app`, `tools/ci/seed-test-logins.ts` |
| Email | **None.** Nothing in the repo sends mail | — |
| S6 | One layout for every customer, written for multi-site accounts | `apps/s6-customer-portal` |

## The shape — no new tier

A residential customer is a **segment**, not a different structure. A home is
an organization with one region node (the region we serve it from), one
location (the household) and one site (the equipment at that address). The
tier ladder, row security, terms resolution, SLA derivation, Intake and Open
job all work on that tree unchanged. Changing `TIERS` would be a change-
controlled migration that re-admits every override row, and buys nothing.

What changes is how the tree is **created**, how it is **shown**, and how it
is **billed**:

1. **A segment on the customer.** `organizations.segment` —
   `'residential' | 'commercial'`, required when `kind = 'customer'`, null
   otherwise. Existing customers backfill as `commercial` (every one of them
   was created through the multi-node path). It is a classifier for screens,
   defaults and reporting — never a scope rule; RLS does not read it.
   *Not derived from the contract:* a homeowner may have no membership (one-
   time work) and a commercial account may have a one-time job, so the
   billing path cannot say which a customer is.
2. **One-step residential creation.** `customers.createResidential` (S2): a
   name and an address → org (`segment = residential`) + region node +
   location + site in one unit of work, the region chosen by the office (or
   later, from S1's coverage lookup). The four-step path stays for commercial.
3. **Lead → customer.** `leads.convert` (S2): a PROSPECT lead becomes a
   residential customer through (2), carrying its contact details, and the
   lead row records what it became. This closes S1's arc 1, which today ends
   at "the office called them back".
4. **Membership terms registered.** `membership_fee_minor` (money, authored at
   parent) and `included_visits` (int, parent) added to `TERMS` and the
   repeatable term-registry migration, so the residential path bills what was
   agreed. Adding entries does not change any existing entry's axes, but it is
   the ratified register — it goes to the partners with the rest of this.
5. **S6 by segment.** Same bundle, same operations, same scope rules; the
   screens read `segment` from the hierarchy context and draw:
   - **commercial** — unchanged (account card, site filters, agreements);
   - **residential** — "Your home": the address and the equipment there, a
     membership card (plan, visits used of included, next planned visit),
     request service, and the work orders. No sites tree, no site filters, no
     location breadcrumbs, no Enterprise tag.
6. **S2 and S3 show it.** A segment column and filter on S2's customer list;
   a residential/commercial mark on S3 Intake and the board, so a dispatcher
   can tell a homeowner's 2 p.m. "no cooling" from a data closet's.
7. **Getting a homeowner signed in.** Residential volume rules out the office
   hand-making every login. The minimum is an **invite**: S2 issues a one-time
   link the homeowner opens to set a password, plus **password reset** — both
   need outbound email, which does not exist (R3). Commercial keeps office-made
   logins until its own IdP federation (OPEN-S6-IDP).

## Decisions

### Answered (2026-10-21)

| # | Question | Answer | What it changes |
|---|---|---|---|
| R1 | Can a customer's segment change later? | **No.** | `segment` is set at creation and never updated — a trigger refuses the change (AC422), so a landlord's homes becoming a portfolio is a new commercial customer, not an edit. |
| R2 | One membership plan, or tiers? | **Several tiers.** | A **plan catalogue** (below) instead of typing a fee per home. |
| R4 | Self-serve sign-up, or invite only? | **Invite only.** | No public sign-up write; S1 stays lead-only. A homeowner's first login comes from an invite the office sends. |
| R5 | A residential response-time default? | **Yes.** | Each plan tier carries its own response time; a home with no membership (one-time work) gets a residential default. The values are still to be set (proposal: emergency same day, otherwise next business day). |
| R6 | Several logins per household? | **Yes — with different jobs.** E.g. one parent pays the balance, the other submits requests. | **Customer roles** (below), not just more logins. |
| R7 | Who may invite a second household member? | **The office, and the household member who pays.** | An invite screen in S6 for a `payer`, beside S2's. A payer invites into their own household only, and chooses the new login's roles (payer, requester, or both). |

### Still open

| # | Question | Blocks |
|---|---|---|
| R3 | Email provider (Cloudflare Email, Postmark, SES…) and the sending domain | Invites and password reset — and with R4, every homeowner login |
| R5a | The residential default response time, and each tier's | The plan catalogue's values (not its build) |

### The plan catalogue (R2, R5)

`membership_plans` — authored in S2, one row per tier: name (e.g. Basic,
Plus, Premium), monthly or annual fee, included visits per year, response
time, PM visits per year, active. A residential membership contract names
its plan; when the contract is signed its terms are **written from the plan**
as ordinary term overrides on that contract. The resolver, the SLA
derivation and the billing path keep reading terms exactly as they do now —
the plan is where the office picks values, never a second source the
runtime consults. Changing a plan's price changes new contracts, not signed
ones.

### Household roles (R6)

Customer logins carry no roles today. Two are added, and a login may hold
both:

| Role | May |
|---|---|
| `payer` | see invoices and balances; pay (when payments exist) |
| `requester` | request service, attach photos, message on a job |

Everyone in the household reads the home, its work orders and its
agreements. Writes are gated by role at the unit of work, the same way S2–S4
roles gate staff writes, so a request from a payer-only login is refused at
the gateway, not hidden in the bundle. The first login on a home holds both.
A household is never made to have more than one login: one person
registering on a home becomes its payer and its requester, and roles only
narrow when the office adds a second person and gives them one job. This
serves commercial accounts unchanged and for free: the AP clerk is a
`payer`, the facility manager a `requester`.

## Work

| Piece | Size | Depends on |
|---|---|---|
| Migration: `organizations.segment`, backfill `commercial`, check constraint, immutability trigger (R1) | S | — |
| `customers.createResidential` + S2 "New residential customer" form | S | — |
| `leads.convert` + S2 lead list action | S | createResidential |
| Membership terms in the register (+ R_term_registry), path tests at a real fee | S | partner sign-off on the register entries |
| Plan catalogue: `membership_plans`, S2 plans screen, contract → plan, terms written from the plan at signature | M | the terms above; R5a for the values |
| Residential default response time for homes with no membership | S | R5a |
| Household roles `payer` / `requester`: registry, role gate on S6 writes, AC Logins app and S2 assign them | S | — |
| S6 residential layout (home card, membership card with tier and visits used, work orders); writes shown or hidden by role | M | segment, roles |
| S2/S3 segment column, filter and mark | S | segment |
| Outbound email module + invite and password-reset operations, S6 set-password screen, S6 invite screen for a payer (R7) | M | R3 |
| Integration tests: one-step tree, segment immutable, conversion once-only, a payer-only login refused a request, a residential login sees only its home, a tier's terms land on its contract and the membership bills its fee and overage | M | the above |

Roughly **3½ weeks** for one builder without the email work, **4½** with it.

## Recommended order

> **Step 1 built (2026-10-21):** migration 0019 (`organizations.segment`,
> fixed by trigger, customers only; existing customer logins backfilled to
> payer + requester), `customers.createResidential`, `leads.list`,
> `leads.convert`, `CUSTOMER_ROLES` with `writeRoles` gated in the unit of
> work, S2's New customer (commercial / residential) and Leads screens, and
> household roles in the AC Logins app. Lead conversion needed a leads list
> first — none existed, so no screen showed a lead to the office.

> **Step 2, S6 part built (2026-10-21):** the hierarchy context carries the
> customer's `segment`; a residential login's S6 home is "Your home" — the
> address and its equipment, a membership card (PM visits this year against
> the resolved `pm_visits_per_year`, the next planned visit, member since), the
> request form with no site to choose, and the work orders with no site
> filters; no Sites tab. A payer-only login sees no form and no request
> button. The AC Logins app's Customer Portal tab filters by
> residential / commercial and the add form narrows the customer list by it.
> S2/S3 marks are still to do.

1. **Segment (immutable) + one-step creation + lead conversion + household
   roles.** Unblocked. The office can carry homeowners as real customers, and
   the roles exist before the first second login does.
2. **S6 residential layout and the S2/S3 marks.**
3. **Membership terms and the plan catalogue**, once the partners sign off on
   the register entries; values once R5a is set. Until then, membership
   contracts should not be invoiced.
4. **Email, invite and reset** once R3 is decided. Invite-only (R4)
   means this is the door every homeowner comes through — until it exists,
   residential logins are made in the AC Logins app.

## Non-goals

- A new tier, or a second hierarchy for homes.
- Segment-based row security. Who sees what stays the tier and scope rules.
- Invoicing and payment for memberships — that is the payments scope (2026-10-21 §2), which this depends on for actual billing.
- Self-serve sign-up from S1 — decided out (R4).
