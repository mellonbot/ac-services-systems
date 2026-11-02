# 24 — Item 9: the S6 site card, and a clock that was five hours wrong

**Date:** 2026-09-21
**Reads as:** the next in-house item after `claude/22`/`23` closed Phase 1's
surface set. Asked for in one sentence — *"connect each site block to a site
card: address and map, the major equipment with serials and last service, the
invoices and jobs in date order, the on-site manager's name and number, and a
Request service button near the header"* — and built the way items 6, 7 and 8
were: read the schema as the customer first, then the surface.

---

## 1. What the card is

A site's name on the Sites tree (and a job's site on Work) opens
`/site/:siteId`. Five panels over seven reads, no filter anywhere:

| Panel | Reads | What it shows |
|---|---|---|
| **Where** | `accounts.list` (now with `address`), `sites.imagery` | the address as recorded; a `geo:` handoff to the user's own maps app (names no third party); the roof from above, or a plain sentence saying why not |
| **Who is there** | `contacts.list` | the site's own contacts first, then the location's, each marked with the node it belongs to; `tel:`/`mailto:` |
| **Right now** | `jobs.list`, `serviceRequests.list`, `equipment.list` | open jobs, requests waiting, units on record, the site's clock |
| **Equipment** | `equipment.list` | count line ("3 units — 2 RTU · 1 Exhaust"), then the grid: label, kind, make/model, serial, tons, installed, **last serviced** |
| **History at this site** | `jobs.list`, `serviceRequests.list`, `invoices.list` | ONE ledger, newest first: a request, the job opened against it, the invoice line that billed it; a job sits on the day of its visit, not the day it was typed |

Two **Request service** controls: a `PrimaryAction` in the masthead of every
signed-in screen (`#nav-request`), and the card's own (`#site-request`), which
preselects the site.

## 2. Read as a customer, before any screen existed

The doc-20 method. Bound as a facility manager at one Austin site:

| Table | Policy before | What the manager could read |
|---|---|---|
| `equipment` | **none** — RLS never enabled | every unit of every customer, with serials |
| `invoices` | `org_id = ac.org_id` (0002) | the parent's every invoice, nationwide |
| `invoice_lines` | **none** | every line of every invoice of every customer |
| `job_media`, `parts_used`, `warranty_cases` | **none** | every photo key, every part, every claim and its amount |

None of it through a screen. **Migration 0009 is the item's substance**:

- `ac_node_row_visible(account)` / `ac_job_row_visible(job)` — an EXISTS against
  the table whose policy already answers the question, so a row off a node is
  visible exactly when the node is and a row off a job exactly when the job is,
  for every namespace at once. Equipment and contacts follow their node;
  `job_equipment`, `job_media`, `parts_used`, `warranty_cases` follow their job.
- `ac_invoice_line_visible` — own org, and the job's rule (or, for a line with
  no job, the location's). `ac_invoice_visible` — own org and one visible line.
  A location-scoped manager therefore reads the consolidated parent invoice
  with **its own lines and its own subtotal beside the header total** — the gap
  between the two is the consolidation, shown rather than hidden.
- INSERT/UPDATE for the internal namespace alone on every table a customer
  reads — 0006's lesson, applied rather than relearned.
- `ac_job_equipment_is_at_the_jobs_site` — a job names units at its own site,
  from every path.

Two tables are new. **`job_equipment`** (written by `jobs.create`'s new
`equipmentIds`) makes "last serviced" a fact about the work: a LATERAL over the
completed jobs that named the unit, never a stored date. **`account_contacts`**
gives S6's `contact_update` — on the allowlist since `05` — a table to land in;
the write itself stays the office's (`contacts.set`, S2) until OPEN-S6-CONTACTS
is decided.

## 3. The imagery decision

The obvious build is `<img src="https://provider…?center={lat},{lng}&key=…">`.
It was not built, for three reasons that are each a rule this repository
already has: a key in a bundle anyone can read; every customer's coordinates
sent to a third party from the customer's browser; and a surface holding a
URL, which non-negotiable #14 forbids. It also cannot carry the cookie
session's CSRF header.

So the **gateway fetches it**. `sites.imagery` resolves the site under RLS,
reads `lat`/`lng` off `accounts.address`, renders `AC_IMAGERY_URL` (a template
with `{lat} {lng} {zoom} {w} {h}`), fetches with a 5 s budget, caches per site
for a day, and returns a `data:` URL with the provider's attribution. Unset →
`unavailable: "not_configured"` and the card draws the address alone. Every
failure mode is an answer, not a 500. The whole pipe executes in the wire test
and the browser drive against a stub provider this repository runs itself. The
provider, its licence and its cost are **OPEN-S6-IMAGERY**.

## 4. Proven

- 11 handler tests (`site-record.test.ts`, `imagery.test.ts`), 4 render tests
  in `apps/s6-customer-portal/src/app.test.ts`.
- **`test/integration/s6-site-card.test.ts` — 7 wire tests**, four customer
  principals: Austin's three units, last-serviced = the PM's window end, the
  open repair not moving it; Reno's unit `unknown_site`; contacts nearest-first
  with the location's marked inherited, a replace that adds no row; one
  two-line parent invoice read three ways; the imagery pipe — one fetch, then
  the cache, `no_coordinates`, `unknown_site`; at the binding Austin's units,
  one line, zero rows on three job-hung tables, forged unit/contact/line-edit
  refused at the table; S6 refused both writes by surface.
- **`tools/ci/drive-s6.ts` — 15 checks** (was 12). Checks 7, 8 and 15 are the
  card: opened by clicking the site's name; the roof drawn from the gateway's
  data URL at 640×360 with its credit; the count line; serials; both RTUs
  serviced by the PM; the manager's dialable number; the desk marked inherited;
  ledger order job → invoice → job by visit date; `$425.00` and NOT the header
  total; the crew's label nowhere; **`scrollWidth ≤ innerWidth`** (doc `25`
  item 1's lesson made a check); the card's button preselecting its site; the
  masthead button a `<button>` within 300 px of the top; a deep link outside
  scope a sentence, not a card; the executive's Reno card with no coordinates
  and nothing of Austin's. Screenshots are full-page for the card screens.
- Everything else unchanged and green on a fresh 0001→0009 database and on a
  second run: schema-guard 238 files; **300** zero-install + **125** rendered
  unit tests; **136** integration; `drive-s2-c4` 13/13, `drive-s6` 15/15,
  `drive-s8` 11/11, `drive-s1` 12/12; typecheck, lint, both emitters current.

## 5. Found on the way, and fixed

**Every instant the gateway put on the wire was in the cluster's local time,
labelled Z.** `to_char(timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` formats in
the SESSION's zone; every earlier cluster this ran on was UTC, so nobody saw it.
The site-card wire test compared a typed ISO instant with the one that came
back and got `08:00` for `13:00` on a `America/Chicago` cluster. On such a
cluster every SLA due time, job opening, request time, shift end and statement
date on the wire was five hours early — the dispatcher's board would have
shown a timer breached that had five hours to run. Fixed with
`AT TIME ZONE 'UTC'` in `jobs.ts`, `devices.ts`, `service-requests.ts`,
`settlements.ts` and the new handler, with a regression in the wire test that
reads the cluster's zone and asserts the instant byte-identical. This joins the
risk register as the seventh instance of *a mechanism that had never run under
the conditions it will run under* — here, a clock other than UTC.

Three surface defects the browser found that the string-render tests passed:
the count line lost its space to htm's whitespace collapse ("3 units —1
Exhaust"); units ordered alphabetically by kind put the exhaust fan above the
rooftop units (now the closed list's order, big iron first); and a completed
job whose timer row was never satisfied printed "Response due" — a closed job's
response is now history or nothing. Doc `25`'s recommendation stands: a
screenshot the drive keeps is where these are found.

## 6. Not built, named

- **S2 screens** for `equipment.register` and `contacts.set`. The operations
  exist and are proven over the wire; the office records units and contacts
  through them in the tests. The forms are one sitting.
- **S5 stamping a unit from the roof** (`job_equipment` from the device
  namespace — the INSERT policy already admits it). Until then the office names
  the units when it opens the job.
- **Geocoding.** `accounts.update` takes `lat`/`lng` in the address; nothing
  computes them.
- **Timestamps in the site's zone, without seconds** — doc `25` item 7, still
  open, and more visible on a page that is mostly dates.
- **Invoice issuance** is WS-E (D13). The fixture seeds the header and lines by
  SQL, as `s8.test.ts` seeds statements.

## 7. Files

New: `packages/schema/migrations/0009_site_record.sql`,
`apps/gateway/src/handlers/{site-record,imagery}.ts` (+ tests),
`apps/s6-customer-portal/src/screens/site.ts`,
`test/integration/s6-site-card.test.ts`, this doc.
Changed: `packages/schema/src/tables/{hierarchy,index}.ts` and the regenerated
`0001_bootstrap.sql`; `packages/contracts/src/{operations,entities,events,surfaces}.ts`
and the regenerated `packages/sdk/src/generated/client.ts`;
`apps/gateway/src/main.ts`, `handlers/{jobs,hierarchy,devices,service-requests,settlements}.ts`;
`apps/s6-customer-portal/src/{app,screens,styles}.ts`, `screens/{sites,work}.ts`,
`app.test.ts`; `apps/s2-service-manager/src/{app,screens-c2}.test.ts` (the
`address` field on the fixture rows); `tools/ci/drive-s6.ts`; emitted
`apps/s2-service-manager/{README.md,src/main.ts}`, `docs/SURFACES.md`;
`docs/OPEN_DECISIONS.md`; `README.md`.
