# AC Logins — Companies (the HVAC license a technician works under)

**2026-10-21 · Design · Owner: Ethan M.** · Extends `2026-10-20-logins-app-design.md`.

## Why

A technician belongs to one company — they work under that company's HVAC
license. The platform models that company as a **crew** (`crews`): the unit
that is dispatched to a job and that holds the license, insurance and
certifications (`crew_credentials`) the compliance gate checks. AC Logins today
can only put a technician under an existing *employed* crew, calls it "Crew",
and cannot create one. Production has **no crews and no subcontractor firms**,
so no technician can be added there at all.

Ethan wants to add and remove these companies from AC Logins, for both our own
company and outside contractors, with the wording that matches how he thinks
about them.

## Wording — AC Logins only

In AC Logins, "Crew" becomes **"Company (HVAC license)"** wherever a technician's
crew is shown or chosen (the Technician list column, Add and Edit forms). The
rest of the platform (Service Manager, Dispatch, API, schema) keeps "crew". No
rename of any table, type or operation.

## The Companies entry

A new sidebar entry **Companies**, below the login kinds, separate from them
(it lists companies, not logins). Its table:

| Column | Source |
|---|---|
| Company | `crews.label` |
| Type | **Ours** (`employment_type='employed'`) or **Contractor** (`subcontracted`) |
| Firm | contractor firm's `legal_name` (blank for Ours) |
| Region | `crews.home_region_id` → region code |
| Technicians | count of **active** `users` (any namespace/role) with this `crew_id` — the same count the Remove guard uses |
| Documents | read-only, the Service Manager's own rule: `summarizeDocuments(employmentType, credentials, today)` from `apps/gateway/src/handlers/network.ts` (pure; required set from `REQUIRED` in `packages/domain/src/compliance/gate.ts` — employed: license + background check; contractor: insurance + license + background check). Shows **Ready**, or what is missing / unverified / expired |
| Firm status | contractor only: `subcontractor_firms.status` (onboarding / active / suspended / terminated) |

**Show inactive** lists removed companies with **Reactivate**.

### + Add company

- **Ours:** name, region. Writes one `crews` row: `employment_type='employed'`,
  `firm_id NULL`, `org_id = INTERNAL_ORG_ID`, `region_id = home_region_id =` the
  region. Same shape as the gateway's `createCrew` for employed.
- **Contractor:** creates the **firm and its company together**, in one
  transaction, the same rows the gateway's `createFirm` + `createCrew` write:
  - firm fields: legal name, region, **payment terms (days, integer ≥ 0,
    prefilled 30 — Ethan's choice)**, **diagnostic data rights reserved
    (Yes / No — no default, must be chosen)**, MSA signed date (optional);
  - `organizations` row (`kind='subcontractor'`, id = firm id, name = legal
    name); `subcontractor_firms` row (`org_id = id`, `status='onboarding'`);
  - company name (defaults to the firm's legal name, editable);
    `crews` row `employment_type='subcontracted'`, `firm_id` = firm,
    `org_id` = firm's org, `region_id = home_region_id` = the firm's region.
  - Adding a second company under an existing firm: the Contractor form offers
    "Existing firm" (picker) or "New firm". Terminated firms are not offered and
    are refused in `db.ts` — the gateway's `createCrew` rule (`firm_ended`).
    Suspended firms are offered, labelled "suspended", exactly as `createCrew`
    allows. *(Claude's call: match S2, not S8's stricter `enrollCrew`.)*
- **Duplicate names are refused** (case-insensitive, trimmed): an active
  company with the same name, or a firm with the same legal name. *(Claude's
  call: nothing in the schema is unique here, and the technician default is
  found by name.)*

### Remove / Reactivate

- **Remove** sets `crews.active = false`. Refused, with a plain reason, when the
  company has **active technicians** ("Move its N technicians to another
  company first" — Ethan's choice: refuse and explain, no bulk move) or **live assignments** (`assignments.released_at IS NULL`,
  same rule as the gateway's crew retire: "It has N jobs assigned — release
  them in Dispatch first"). On Production it asks "Remove <company>?" like
  login Remove; on Local it does not.
- Removing a company does not change its firm. Firms are not removed from AC
  Logins.
- **Reactivate** sets `active = true`. Refused when its firm is terminated
  (same rule as Add).
- Remove and the technician writes below lock the company row
  (`SELECT … FOR UPDATE` / `FOR SHARE`) so a Remove and an Add/Edit racing on
  the same company cannot leave an active technician under a removed one.

## Technicians

- The Add/Edit company picker offers **every active company, Ours and
  Contractor**, grouped by type. (Replaces the earlier "employed crews only".)
- New technicians **default to the company labelled "AC Services DFW"** (Ours)
  when it exists and is active; otherwise nothing is preselected.
- **A technician can only be placed under, moved to, or reactivated under an
  active company.** `addLogin`, `editLogin` (crew change) and `reactivate` (for a
  user with a `crew_id`) refuse with "<company> has been removed — choose
  another company" when it is inactive. Edit of a technician whose current
  company is inactive shows it as "<name> (removed)" so the form can open; saving
  without moving them is allowed (name-only edit), moving them requires an
  active company. *(Claude's call — closes "a technician left under a removed
  company".)*
- Technician rows keep today's shape — `namespace='internal'`, role
  `technician`, `crew_id` = the company, region = the company's home region —
  for both types. *(Claude's call: this is the shape `auth.deviceLogin` accepts
  and every existing test uses; it checks only `crew_id`, `active` and the
  password; `grantDeviceShift` checks only `users.crew_id` and an active crew.)*
  Contractor technicians use the technician app like ours. A device shift for a
  contractor company is stamped with the firm's org; nothing found refuses that,
  so the integration tests must prove a contractor technician can be granted a
  shift and sign in on S5 end to end.
- Moving a technician to another company still signs them out (existing
  `accessChanged` on `crew_id`).

## Left to the Service Manager

- Entering and verifying licenses, insurance and other credentials.
- Moving a contractor firm from onboarding to active (needs the signed MSA) —
  Ethan's choice: activation stays in the Service Manager.
- Renaming companies and firms, terminating firms.

Until a company has verified documents (and, for contractors, an active firm),
it cannot be dispatched — that is the platform's compliance gate, unchanged.

## How writes run

- Company and firm writes run as `ac_gateway` **bound as an internal org-wide
  principal** (the existing `INTERNAL_READ_BINDING` values), in one
  transaction, committed. Unbound is refused: `crews` and
  `subcontractor_firms` policies (0005/0006) admit internal parent-tier; the
  `ac_crew_roster_is_the_firms` trigger (0007) only constrains the
  subcontractor namespace. `organizations` admits internal (0007).
- No audit_log or outbox rows — same as login writes (no principal of its own).
  Consequence: a Service Manager or Subcontractor screen already open does not
  live-refresh on a new company; it shows it on reload. Nothing else consumes
  `crew.created` / `firm.created`.
- Login writes are unchanged (unbound).

## Rollout

After the app update is built and checked, Claude creates **"AC Services DFW"**
(Ours, region DFW) on Production through the app's own Add company — Ethan
gave the go-ahead on 2026-10-21.

## Goals

- Add and remove companies (ours and contractors, with their firm) without the
  Service Manager.
- Put a technician under any active company; default to AC Services DFW.
- "Company (HVAC license)" wording in AC Logins.

## Non-goals

- Credentials, licenses, insurance, firm activation, rate cards — Service Manager.
- Renaming "crew" anywhere outside AC Logins.
- Deleting companies or firms.
- The residential / commercial customer split (separate project, next).

## Anti-goals

- A company row the gateway's `createCrew` would refuse (employed with a firm,
  contractor without one, under a terminated firm).
- A technician left under a removed company.
- Taking a company off while it holds live work.
- A firm created with a guessed answer for payment terms or data rights.

## Left to the builder

- Exact layout of the Companies table and forms within layout A and Arc Foundry
  tokens.
- Tests: unit tests for company/firm row building (one per type), integration
  tests against `ac_dev` for: add Ours → technician added under it is granted a
  device shift and signs in on S5; the same for a Contractor company; add Contractor
  (new firm) → firm + org + crew rows exist with gateway-equivalent values;
  remove refused with an active technician; remove refused with a live
  assignment; remove → reactivate; reactivate refused under a terminated firm;
  technician add/move/reactivate refused onto a removed company; duplicate
  company / firm name refused.
