# Loading production data — `tools/import`

The importer loads customers, agreements, firms, crews, technicians and crew
documents from CSV files **through the gateway**, signed in as a principal. It
calls the same operations the Service Manager's screens call — no SQL — so
every row is admitted, audited (actor: you, surface: S2) and row-security
checked exactly as if it had been typed in.

```sh
node tools/import/main.ts --gateway https://api.acservice.systems --email you@yourcompany --dry-run tools/import/templates
node tools/import/main.ts --gateway https://api.acservice.systems --email you@yourcompany --verify-credentials path/to/your/csvs
```

- **Password.** Asked for when the import starts, hidden as you type. It is
  never taken from an argument, a file or the environment (`--password` is
  refused). Piped standard input is read as the password's single line — that
  is how the test suite signs in.
- **Principals only.** Any other login is sent away before anything is read.
  A login still holding a temporary password must sign in to the Service
  Manager once and choose its own first.
- **Files.** Name a directory (whichever of the six files it holds is loaded)
  or the files themselves. Each must be named exactly as below.
- **Order.** Always `firms → crews → technicians → credentials → customers →
  agreements`, whatever order you name them in: a crew names its firm, a
  document its crew, an agreement its customer, and a location is admitted
  against the crews already serving its region (D14).
- **`--dry-run`** reads what the gateway holds, checks and matches every row,
  and reports what it *would* create, update or skip. It writes nothing. It
  cannot see every refusal: the gateway still judges each row on its merits
  when it is written (an empty document window, a firm that cannot be
  activated, a duplicate email held by a customer login).
- **`--verify-credentials`** verifies each document as it is recorded (and any
  matching one already on file but unverified), as the Verify button does.
  Use it only for documents you have checked against the originals: the
  dispatch gate trusts a verification.

Exit status: `0` every row landed or was already there · `1` some rows were
rejected (the rest landed) · `2` nothing was loaded (arguments, sign-in, a
file that does not parse or has unknown/missing columns, the gateway stopped
answering).

## What a run prints

Every created, updated or rejected row, by file and line, then a count per
file. A rejected row carries the **gateway's own words** (or, for a check
made before writing, why it was not sent):

```
  credentials.csv:3  REJECTED  license BAD-1 is valid from 2027-06-01 to 2027-01-01 — a window that ends before it starts covers no day at all
  customers.csv:2    REJECTED  region ZZZ is not one we serve from — open it in the Service Manager under People › Regions
```

Technician logins made by the run are listed at the end with their
**temporary passwords — shown once, kept nowhere**. Give each to the person;
they choose their own at their first sign-in (S2, S3 or S5).

## Running it again is safe

Each row is matched on a natural key against what the gateway already holds.
A match is skipped, or updated where an update is safe; it is never written
twice. Fix a rejected row and run the same file again — every other row is
skipped.

| File | Matched on | On a match |
|---|---|---|
| firms | legal name (case and spacing ignored) | `status=active` on an onboarding firm activates it; otherwise skipped |
| crews | label + region + firm (blank = ours) | skipped |
| technicians | login: email · roster record: name + firm | each part made only if missing |
| credentials | crew + kind + identifier | `--verify-credentials` verifies an unverified one; different dates are **rejected** (a document is not edited — record a renewal under its own identifier) |
| customers | organization: `customer_ref` · region node: the customer's node in that region · location: name under the node · site: `site_ref`, else name under the location | a site whose address differs is updated; otherwise skipped |
| agreements | customer + parent-scope MSA + `effective_from` | missing terms are added; a term on file with a **different** value is rejected (a signed term changes by amendment in the Service Manager); a draft is activated when `activate` is yes |

**One row, several writes.** A customers, agreements or technicians row can
take several gateway calls (customer → region node → location → site; MSA →
terms → activation; login → roster record). Everything that can be checked is
checked before the first call, so a bad row normally writes nothing. If the
gateway refuses part-way, the report says what that row already wrote — run
the file again once it is fixed, and the row is completed from where it
stopped.

## Values

- **Dates** `YYYY-MM-DD`. **Yes/no** `yes`/`no` (also `y`/`n`, `true`/`false`, `1`/`0`).
- **`region`** is a region code (`DFW`). Blank means **DFW**, the launch
  region. A region must be open — **People › Regions** in the Service Manager.
  `UNASSIGNED` is never accepted: it holds anonymous visitors and leads.
- **`firm`** is a firm's legal name exactly as in `firms.csv` (case and
  spacing ignored). Blank means one of ours.
- **Money** is whole cents: `labor_rate_minor` `12500` is $125.00.

## The files

Headers are the first row, in any order. Columns marked **req** must be
filled on every row. A column not listed here refuses the whole file — a typo
in a header is caught before anything is loaded. Filled examples:
`tools/import/templates/`.

### firms.csv — contractor firms

```
legal_name,region,settlement_terms_days,diagnostic_data_rights_reserved,msa_signed_at,external_ref,status
```

| Column | | |
|---|---|---|
| legal_name | req | |
| settlement_terms_days | req | whole days |
| diagnostic_data_rights_reserved | req | yes/no — the firm-side position, stated |
| msa_signed_at | | date; required for `status=active` |
| external_ref | | your vendor number |
| status | | `onboarding` (default) or `active`. **A firm's crews are dispatched only while the firm is active.** |

### crews.csv — install crews, ours and firms'

```
label,region,firm,kind
```

`kind` **req**: `install` (an install crew) or `service` (a one-technician
unit). A technician with a login gets their own unit from `technicians.csv` —
do not list it here.

### technicians.csv — people in the field, with or without a login

```
name,region,firm,role,crew,email,phone,specialties
```

| Column | | |
|---|---|---|
| name | req | |
| role | | `technician` (default), `lead_installer`, `installer`, `helper` |
| email | | **makes a login** (`people.createTechnician`) with the technician's own service unit, labelled with their name. Technicians only; leave `crew` blank |
| crew | | an install crew's label (from `crews.csv`) for an installer or helper |
| phone | | |
| specialties | | `;`-separated: residential_hvac, light_commercial, commercial_rtu, refrigeration, chillers_boilers, controls_bas |

Every row also makes the technician's roster record (Technician Network).

### credentials.csv — the documents the dispatch gate reads

```
crew,region,firm,kind,identifier,valid_from,valid_to,document_key
```

`crew` **req** is a crew's label — for a technician with a login, their name
(their own unit). `kind` **req**: `license`, `background_check`, `insurance`,
`certification`. `identifier`, `valid_from`, `valid_to` **req**; both dates
inclusive. `document_key` optional.

**The gate** (`packages/domain/src/compliance/gate.ts`) assigns a crew only
when it holds a **verified** document of each required kind covering **the
whole service window**, with no override:

- our crews: `license` and `background_check`
- a firm's crews: `insurance`, `license` and `background_check` — and the firm active

### customers.csv — customers, their locations and sites

```
customer_ref,customer_name,segment,region,region_node_name,location_name,site_name,site_ref,address_line1,address_line2,city,state,postal,country,contact_name,contact_phone,contact_email
```

One row per **site**; repeat the customer's columns on each of its rows.

| Column | | |
|---|---|---|
| customer_ref | req | your customer number — the key a re-run matches on |
| customer_name | req | |
| segment | | `commercial` (default) or `residential`. Fixed once set |
| address_line1 | req | the site's address; `address_line2`, `city`, `state`, `postal`, `country` optional |
| location_name | req for commercial | the campus or property the site belongs to |
| site_name | req for commercial | the building, roof or room work happens at |
| site_ref | | the site's own reference; matches a site even if renamed |
| region_node_name | | default "*customer* — *region name*" |
| contact_name, contact_phone, contact_email | | residential only: the homeowner |

A **residential** row makes the household, its home and the **standard home
agreement**, active from today (`customers.createResidential`) — it needs no
agreements row.

### agreements.csv — a commercial customer's MSA and its terms

```
customer_ref,region,billing_path,signed_at,effective_from,effective_to,diagnostic_data_rights_reserved,activate,sla_response,sla_credit_pct,pm_visits_per_year,payment_terms_days,labor_rate_minor
```

One row is one parent-scope MSA for a customer in `customers.csv`.

| Column | | |
|---|---|---|
| customer_ref | req | |
| signed_at, effective_from | req | dates; `effective_to` optional (blank = evergreen) |
| diagnostic_data_rights_reserved | req | yes/no — the agreement's position, also authored as its term |
| billing_path | | `enterprise_sla` (default), `one_time`, `project`, `residential_membership` |
| region | | the region the agreement is administered from; default the customer's first region node's |
| activate | | yes (default): the agreement goes active once its terms are on it |
| *term columns* | | any term the register lets the parent set: `sla_response`, `sla_credit_pct`, `pm_visits_per_year`, `payment_terms_days`, `labor_rate_minor`, `after_hours_multiplier_milli`, `billing_rollup_tier`, `invoice_delivery`. Blank = not authored |

A term's value is checked against the register (`packages/contracts/src/terms.ts`)
before anything is written — `sla_response` is one of `1_hour`, `2_hour`,
`4_hour`, `same_day`, `next_day`, `48_hour`.

**What a job needs to open.** `jobs.create` derives the job's response time
from the site's resolved `sla_response`. A site whose agreements set **no**
response time is **not refused**: it opens on the register default, `4_hour`,
and the SLA timer's trace says "register default"
(test/integration/s3-s5.test.ts). A job is refused only when the term cannot
be resolved — an override looser than the one above it, two in force at one
node, a value off the register — and those are Contracts' to fix in the
Service Manager (S3 offers *Hold for Contracts* when the refusal names a
missing term). So: load the customer's real `sla_response` here if it is not
4 hours; a customer with no agreement yet can still be dispatched, on 4 hours.

## Before the first production run

1. Deploy — migration 0039 opens **DFW, Dallas–Fort Worth**.
2. In the Service Manager, **People**: move every staff login whose home region
   is still *Unassigned* to DFW (open the person, Home region). A technician's
   region follows their unit.
3. Fill the six files from `tools/import/templates/`, run with `--dry-run`,
   fix every reject, then run without it. Keep the printed temporary passwords
   only until each has been handed over.
