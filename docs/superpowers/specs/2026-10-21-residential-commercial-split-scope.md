# Residential and commercial customers

**2026-10-21 · Scope · Owner: unassigned**

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

## Decisions for the partners

| # | Question | Default if nobody decides |
|---|---|---|
| R1 | Is the segment set by the office at creation, or ever changed later (a landlord's homes becoming a portfolio account)? | Set at creation; changing it is an S2 edit, audited, and never moves rows |
| R2 | Membership plans: one plan, or tiers (e.g. Basic/Plus with different included visits and response times)? | One plan per contract, its fee and visits as terms; tiers are just different contracts |
| R3 | Email provider for invites and resets (Cloudflare Email, Postmark, SES…) and the sending domain | Blocks (7). Without it, the office keeps making residential logins by hand |
| R4 | Does a homeowner sign up from S1 without a lead call (self-serve), or only by invite after the office converts the lead? | Invite only. Self-serve sign-up is a public write with a credential at the end of it — OPEN-S1-ABUSE applies twice |
| R5 | Residential response time: the same `sla_response` register values, or a residential default (e.g. next business day, emergency same day)? | Same register; set per membership contract |
| R6 | One login per household, or several (two homeowners, a tenant)? | Several, all at the parent tier — a household sees one home |

## Work

| Piece | Size | Depends on |
|---|---|---|
| Migration: `organizations.segment`, backfill `commercial`, check constraint | S | R1 |
| `customers.createResidential` + S2 "New residential customer" form | S | — |
| `leads.convert` + S2 lead list action | S | createResidential |
| Membership terms in the register (+ R_term_registry), path tests at a real fee | S | R2, partner sign-off on the register |
| S6 residential layout (home card, membership card, work orders), segment in the hierarchy context | M | segment |
| S2/S3 segment column, filter and mark | S | segment |
| Outbound email module + invite and password-reset operations, S6 set-password screen | M | R3 |
| Integration tests: one-step creation produces a valid one-branch tree, conversion is once-only, a residential login sees only its home, the membership bills its fee and overage | S | the above |

Roughly **2½ weeks** for one builder without the email work, **3½** with it.

## Recommended order

1. **Segment + one-step creation + lead conversion.** Small, unblocked, and the
   office can start carrying homeowners as real customers immediately — they
   already work in Intake and Open job on the one-branch tree.
2. **S6 residential layout and the S2/S3 marks.** The homeowner's portal stops
   looking like a facilities account.
3. **Membership terms**, once the partners sign off on the register entries
   (R2). Until then, membership contracts should not be invoiced.
4. **Email, invite and reset**, once R3 is decided. Until then, residential
   logins are made in the AC Logins app.

## Non-goals

- A new tier, or a second hierarchy for homes.
- Segment-based row security. Who sees what stays the tier and scope rules.
- Invoicing and payment for memberships — that is the payments scope (2026-10-21 §2), which this depends on for actual billing.
- Self-serve sign-up from S1 (R4) in the first pass.
