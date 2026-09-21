# ac-platform

The Rankine Operating Company platform monorepo. Eight web surfaces, one
gateway, one hierarchy, one backbone.

Rankine is the network and the contracting entity: it owns the surfaces, the
gateway and the standard, and it is what a customer signs with. The operating
firms keep their own names — **AC Services DFW** is Works No. 1 — because a
local firm's name, reviews and search equity are worth more than a rebrand. The
structure is in `packages/tokens/src/brand.ts` and the marks it carries are
documented in `docs/BRAND.md`, both generated from the tokens rather than
written down twice.

**State (2026-09-16): Step 0 (the frame), Step 1 (the backbone) and Step 2 (S0,
the shared shell) are built and verified; Step 3 (the surface runtime and S2,
designed in `09_Surface_Runtime_and_S2_Design.md`) is built through item 7 —
refusal codes (migration 0004, `refusals.ts`), the browser session
(`session.ts`), the surface runtime (`packages/ui` on Preact + htm + signals
behind one package boundary, the frame emitted from the registry,
`build-surface.ts` as the one build step, five guards), C1: the seven hierarchy
operations in the catalogue with their handlers and S2's first screens — login,
the tree, new node, move — C2: the five agreement and register operations,
`handlers/contracts.ts`, S2's agreements list, the three-state OQ5 form, the
register-driven override form and the resolution trace, and C4: the eleven
network operations, `handlers/network.ts`, migration 0005, and S2's five
network screens — the firm, the crew, the document and the price. Every flow is
driven in a real browser against the real gateway.**
C3 (Amped recorded in full through the real operations against a live gateway)
closed step 3 on 2026-09-17 once OQ1/OQ5 were answered. **Structural build order
item 4 (`00_MASTER_SYSTEM_PLAN.md` §2.8) is built: S3 Dispatch Console and S5
Technician Web Fallback** — the board and dispatch screens, the offline-first
mutation queue, the device-shaped login — and **proven over the wire
(`test/integration/s3-s5.test.ts`, 10 tests)**, which found that
`auth.deviceLogin` had refused every technician against a live database: the
login transaction had no scope bound and `crews` is behind row security. Fixed
at the login path for devices and people alike. **Item 6 is built (2026-09-17):
S6 Customer Portal** — sites, work, agreements, terms and the one write, a
service request — over **migration 0006**, which is the item's substance: a
customer principal now sees work at its own sites (not every job in its
region), its own agreements (not any org's by id), its own breadcrumb (so a
region-tier term applies to a location-scoped manager), and no crew, document,
clearance or assignment at all. Tier scoping is the acceptance test:
`test/integration/s6.test.ts` (10) and `tools/ci/drive-s6.ts` (12 checks in a
real browser, two principals, one bundle). Detail: `claude/20_S6_Customer_Portal_Built.md`.
Item 5 (the Yocto tablet) is contracted (D11). **Item 7 is built (2026-09-18):
S8 Subcontractor Portal** — the firm, its roster, a crew's documents, its work
and its statements, with D12's four writes (`credentials.submit`, `crews.enroll`,
`crews.retire`, `settlements.acknowledge`, `settlements.dispute`) — over
**migration 0007**, which is the item's substance the way 0006 was item 6's:
read as a firm, the tables answered every South job of every customer, every
firm's settlement lines (the other firm's price by division), our float, every
user row with its password hash, and the audit log. Now a firm sees work its
own crews were assigned, the site it was sent to, its own issued statements —
and the two things a firm may write are held at the table by two triggers.
Proven: `test/integration/s8.test.ts` (10) and `tools/ci/drive-s8.ts` (11
checks in a real browser, two firms, one bundle). The same read found that the
**worker's sweeps had read zero rows since 0002** — an unbound transaction
under RLS — so the SLA cascade never escalated and the expiry sweep never
warned; fixed, with `test/integration/worker.test.ts` (4). And a Chromium
defect the S6 drive surfaced: pages in the back/forward cache held their event
streams open until the live page could not open a request; the shell now closes
the stream on `pagehide` and reopens it on `pageshow`. Detail:
`claude/21_S8_Subcontractor_Portal_Built.md`.

**Item 8 is built (2026-09-18): S1 Marketing / Lead-Gen** — the first surface
whose principal is nobody. Three things are new rather than another instance of
something: a **third boot path** in S0 (`openAnonymousShell` — no login, no
`session.me`, the principal a shared constant in `packages/contracts` so
neither side invents it, and the session minted lazily at the first write); a
**durable buffer** in the browser that queues a lead, survives the tab, replays
under a client-minted `submission_id` and reads the unique index answering as
success rather than failure; and **migration 0008**, which is the item's
substance the way 0006 was item 6's and 0007 was item 7's. Read as a stranger,
the tables answered: every lead ever captured — name, email, phone, the
free-text note — every call record, `regions` (our shard boundary and
`min_crew_density`, which is D14's supply rule), every session row, every field
tablet and shift grant, and the crews' checklists and time entries. All of it
reachable by every external namespace, none of it through a screen — the third
time that sentence has been the finding. Now an anonymous principal **writes
twice and reads nothing**, and the coverage map is `regions` through
`ac_public_coverage()`, two columns, so widening the public claim is a diff on
a migration. The copy ceiling that D7a and OQ6 have never written down
(action plan F9) is enforced as **zero** by a test on the rendered page and
another on the painted one. Proven: `test/integration/s1.test.ts` (15),
`apps/s1-marketing/src/app.test.ts` (16) and `tools/ci/drive-s1.ts` (12 checks
in a real browser — the only drive that starts the SITE before the GATEWAY,
because the claim under test is that the page is up when the gateway is not).
The same pass found and fixed a live defect in the worker: the
credential-expiry sweep compared a UTC date against `occurred_at::date`, which
casts in the session's timezone, so on any cluster west of UTC it re-warned
every run from local evening until midnight — invisible in CI, which is UTC.
Detail: `claude/22_S1_Marketing_Built.md`. Next in-house item: 9, S4 (Phase 2).
`docs/BACKBONE_CONTRACT.md` is the
B2 deliverable — the interface every block codes against, ratified by the
partners 2026-09-15 — and every statement in it names the mechanism that
enforces it and the test that proved it against PostgreSQL 16. S0 is the layer
every surface boots through: the **operation catalogue**
(`packages/contracts/src/operations.ts`), the client **generated** from it
(`packages/sdk/src/generated/client.ts`), and the shell that logs in, resolves
the hierarchy context, subscribes to events and turns refusals into typed
decisions (`packages/shell`). The gateway's route table is built from the same
catalogue, so routes and client methods are provably one list. Surfaces S2–S8
start here; S1 is static and separate.

Built to the frame in `06_Software_Architecture_Frame.md`, whose governing idea
is worth restating because every structural decision here is an instance of it:

> The expensive failures in this system are not bugs — they are **erosions**: a
> nullable `region_id` added under deadline, a `force` flag on the compliance
> gate, a helpful import between two invoicing paths, one handler that queries
> the database directly. Each is individually reasonable. Each is individually
> invisible. Together they are the difference between Tier 3 being a routing
> change and Tier 3 being a rewrite.
>
> **Make each erosion cost a reviewed diff on a named file, instead of costing
> nothing.**

## Running it

```bash
# Zero install — a laptop with Node 22.18+ and nothing else.
node tools/ci/schema-guard.ts       # every structural invariant, against the definitions
npm run guard:test                  # 278 unit tests: resolver, admission, gate, sync, SLA, money, D14, uow, auth, session, refusals, hierarchy, contract, network, settlement and lead handlers, catalogue, sdk, shell (incl. the page lifecycle), tokens→CSS, the accent gate, the brand layer, the badge, PR titles
npm run guard:all                   # both
npm run sdk:generate                # regenerate the client from the operation catalogue
npm run sdk:check                   # fail on drift (the guard runs this too)
node tools/ci/emit-surfaces.ts      # regenerate apps/s*/{package.json,src/main.ts,frame.html,README.md} + docs/SURFACES.md from SURFACES
npm run surfaces:check              # fail on drift (the guard runs this too)

# A database.
export DATABASE_URL=postgres://user:pass@host/db
node tools/ci/migrate.ts            # versioned migrations + the repeatable term-register mirror
node tools/ci/migrate.ts --assert   # region_id is total in the LIVE schema
npm run test:integration            # 129 tests: the contract with RLS on (29) + the shell and the browser session over the wire (19) + C1 (12) + C2 (11) + C4 (8) + item 4, S3/S5: the gated door, the shift token, the offline replay (10) + item 6, S6: tier scoping as four customer principals see it (10) + item 7, S8: firm visibility as two firms and the office see it, and the four writes (10) + item 8, S1: what a stranger's binding reads (nothing) and its two writes (15) + the worker's sweeps bound under RLS and on the right calendar day, on a scratch database (5)
npm run drive:s2-c4                 # 13 checks through a REAL browser: the C4 screens end to end against the live gateway.
npm run drive:s6                    # 12 checks through a REAL browser: a facility manager and then the executive, same bundle — AC_DRIVE_SHOTS=<dir> keeps a PNG per screen
npm run drive:s8                    # 11 checks through a REAL browser: Firm A enrolls, files, acknowledges, disputes, is refused a retire; then Firm B, same bundle, sees none of it
npm run drive:s1                    # 12 checks through a REAL browser, and the only one that starts the SITE BEFORE THE GATEWAY: the page renders
                                    #   with nothing listening, the form queues, the queue survives a reload, and it flushes itself when the
                                    #   gateway comes up — one row, under the id the browser minted
                                    #   Needs a browser (AC_CHROME, or found on PATH) and a database. Skips on a laptop that
                                    #   has neither; in CI a skip is a failure, because a check that stops checking is worse
                                    #   than no check — it reports green.

# The toolchain layer.
pnpm install
pnpm typecheck && pnpm guard:lint   # tsc strict; eslint with the eight ac/ rules (verified: they fire)
npm run test:ui                     # 121 tests rendered to a string under node --test: packages/ui + S1, S2 (C1, C2, C4), S3, S5, S6 and S8 screens through the real shell against a scripted gateway. Need preact, hence here
AC_GATEWAY=http://127.0.0.1:8080 node tools/ci/build-surface.ts S2   # stamp the gateway origin into the frame for a dev build
node tools/ci/build-surface.ts S2   # THE ONE BUILD STEP: esbuild src/main.ts → apps/s2-service-manager/dist/{index.html,bundle.js,ui.css}
node tools/ci/build-surface.ts --all --minify

# Run it.
#   AC_SITE=ac.example → production posture: Secure cookies, CORS origins https://<app>.<AC_SITE> for every enabled surface.
#   unset             → development posture: cookies not Secure, origins from AC_DEV_ORIGINS (or none — bearer only).
npm run gateway                     # :8080 — every route is a row in packages/contracts/src/operations.ts
npm run worker                      # outbox relay (1s), SLA cascade (60s), credential expiry (1h)
```

## What is here

```
apps/gateway/         the sole access path
  src/auth.ts           Ed25519 tokens, claims validation, scrypt passwords    (node:crypto, no library)
  src/context.ts        hierarchy context at login; the scope binding RLS reads
  src/unit-of-work.ts   allowlist · role · tenancy · topic → audit + outbox in one tx
  src/pg-tx.ts          THE ONLY FILE THAT IMPORTS A DATABASE DRIVER
  src/handlers/         terms (admission + resolution), assignment (the gate), sync (device replay), hierarchy (C1: org+first region node in one uow, node create/move/update; D14; structure left to the triggers), contracts (C2: the agreement's own shape — scope region, OQ5, the window, the amendment's MSA, the state ladder; scope existence left to the trigger), network (C4: the firm's door — tenant root and operational row in one uow — the status ladder behind a signed MSA, a crew's tenancy following its employment, a document that arrives unverified, a rate set from a day forward; verification and overlap left to the database; item 7: the firm's own leg — enroll and retire a crew whose firm, type and region are the principal's, and file a document under the firm's own entity), settlements (item 7: the statement as the firm reads it and answers it — acknowledge, dispute with a reason; what else may change on the row left to 0007's trigger)
  src/main.ts           node:http + SSE; route table built from OPERATIONS, handlers typed over OperationId
  src/session.ts        the browser session: httpOnly cookie, x-ac-surface as the CSRF line, CORS derived from SURFACES under AC_SITE
  src/refusals.ts       SQLSTATE → 422/403 with the database's message; InputRefused for inputs a handler cannot resolve
apps/worker/          outbox relay (SKIP LOCKED), credential-expiry sweep, SLA cascade — each bound as the worker (workerScope) before its first statement; unbound, RLS answered zero rows and both sweeps ran green for a week doing nothing
packages/contracts/   TIERS · TERMS (the policy register, two axes) · TOPICS · SURFACES · OPERATIONS (the catalogue, 52 rows) · refusals (the axis) · Claims/Principal
packages/sdk/         generated/client.ts (emitted from OPERATIONS by tools/ci/emit-sdk.ts) + runtime.ts (THE ONLY FILE ABOVE THE GATEWAY THAT TOUCHES THE WIRE)
packages/shell/       S0: createShell (registry checks), connectShell (login → me → shell), openAnonymousShell (item 8: no login and no round trip at boot, so the site renders when the gateway does not; the session is minted lazily at the first write), subscribe (SSE, dedupe; closed on pagehide, reopened from the back/forward cache), refusalOf, degraded driven by the wire; brand.ts installs a tenant's block BEFORE login — a portal is branded on its sign-in screen
packages/tokens/      primitives → semantic → density → white-label (contrast-validated against every ground each ink is permitted on); brand.ts holds the marks and the badge geometry; type.ts the five type roles; css.ts emits it all as :root variables per density and per surface (field is a fixed dark ground, not a theme); brandCss scopes a tenant block away from the plate
packages/ui/          THE RENDERER BOUNDARY: preact/htm/signals pinned here alone (render.ts); components typed to their spec's densities — StatusPill, PrimaryAction, DataGrid, ComplianceBadge, RefusalCard, DegradedBanner; router over the History API from a SCREENS registry; UI_CSS (roles only, no colours)
apps/s1 … s8/         generated from SURFACES by tools/ci/emit-surfaces.ts — package.json, src/main.ts, frame.html (density, tokens, degraded slot, brand slot on a whiteLabel surface, mount), README; each boots through the shell and can call nothing else
apps/s2-service-manager/src/  the first surface with screens: screens.ts (the registry the guard reads), app.ts (cookie boot → login or tree; router; degraded slot; account, contract and network events → refetch), state.ts (resources as signals, invalidated by prefix), screens/ (accounts-tree, accounts-new, accounts-move, organizations-new, contracts-list, contracts-new, terms-override, terms-resolved, network, network-new, network-documents, network-rates)
packages/domain/src/supply/   D14 as a decision function: rule unset → caveat; set and unmet → commercial refusal
tools/ci/             schema-guard (zero-install) · emit-schema · emit-sdk · emit-surfaces (--check) · build-surface (esbuild; the only step that needs an install) · migrate
packages/schema/      operationalTable() and 44 tables; migrations 0001 (generated), 0002 (guardrails), 0003 (assert), 0004 (refusal codes — every trigger raises with an ERRCODE), 0005 (the network registry — verification earned and immutable, firm isolation), 0006 (customer visibility — work by site, agreements by org, the breadcrumb, no crew; agreements writable by us alone), 0007 (firm visibility — work by the firm's own assignments, the site it was sent to, statements once issued with their lines; the roster and the statement's position held by trigger; organizations, users, audit_log, outbox, settlement_lines and working_capital_positions closed to external namespaces; the statement's position columns), 0008 (anonymous intake — leads and call_records write-only for a stranger and pinned to PROSPECT/UNASSIGNED by policy and trigger; regions, sessions, devices, device_grants, checklist_items and time_entries closed, all six of which had no policy at all; ac_public_coverage() as the one door the public claim goes through; leads.submission_id and its unique index, the replay key), repeatable/
packages/domain/      no I/O: inheritance/{resolve,admit} · compliance · sync · sla · money · billing
apps/s6-customer-portal/src/  item 6: screens.ts, app.ts (brand first, then the cookie boot), state.ts, screens/ (sites, work, agreements, terms, request) — no filter anywhere; the rows are the scope
apps/gateway/src/handlers/service-requests.ts  item 6: S6's one write — inputs the handler's, visibility the database's, tenancy the site's
apps/s8-subcontractor-portal/src/  item 7: screens.ts, app.ts (no brand: a firm works under Rankine's plate), state.ts, screens/ (firm, crews, documents, work, statements) — no filter anywhere; two firms run one bundle
apps/s1-marketing/src/        item 8: screens.ts (three screens, no login, no read of a lead), app.ts (NO booting phase — the page renders before anything answers), buffer.ts (the durable queue: storage-backed, replays one submission id, reads the unique index as success), state.ts, styles.ts, screens/ (home, coverage, enquire)
apps/gateway/src/handlers/leads.ts  item 8: S1's two writes and one read — inputs the handler's, tenancy a constant, visibility 0008's. There is no read of a lead in this file, and that is its most important line
test/integration/     backbone.test.ts — the contract against a live Postgres · s0-shell.test.ts — the shell against a spawned gateway · s2-c1 · s2-c2 · s2-c4 · s3-s5 (item 4) · s6 (item 6) · s8 (item 7) · s1 (item 8) · worker (the sweeps under RLS and on the right calendar day, on a scratch database)
docs/BACKBONE_CONTRACT.md   B2
```

## Where each non-negotiable is held

| # | Commitment | Mechanism | Proven by |
|---|---|---|---|
| 1 | Four-tier hierarchy, per-level override, **term policy register** | `TIERS`; `TERMS` as authoring-tier × combine-rule; resolver with trace; admission at insert (trigger + EXCLUDE + ratchet); the register mirrored into `term_registry`, SELECT-only | 19 resolver/admission tests on the Amped fixture; 5 integration tests |
| 2 | `region_id` on every operational row — **our service region, never the customer's grouping** | `operationalTable()`; `ac_assert_region_id_everywhere()`; trigger derives `region_id` from the parent edge and cascades; `customer_group` is an attribute | guard §1–2; migrate `--assert`; 5 integration tests |
| 3 | Gateway as sole access path | one driver import (guard-enforced); `.npmrc` isolation; four roles, surfaces hold none; RLS with `FORCE`; `SET LOCAL ROLE` + scope binding per tx; bearer or httpOnly cookie, cookie requests must name their surface; per-request session revocation check; DB refusals are 422/403, never 500 | guard; 4 RLS integration tests; 7 session + 5 refusal unit tests; 10 session/refusal wire tests |
| 4 | Immutable audit log | same-transaction write by the unit of work; no update/delete on the interface; INSERT+SELECT grant; trigger raises for any role | uow tests; "refuses UPDATE and DELETE even from the superuser" |
| 5 | Object storage behind our interface | branded `StorageKey`; lint + guard | guard |
| 6 | Offline-first sync | device = intent, server = truth; policy is data; `(device, mutation_id)` UNIQUE; `assignments` server-authoritative; state machine; human queue | 10 sync tests; 2 integration tests |
| 7 | Consolidated parent invoicing, per-location lines | `allocate()` exact by construction; `invoice_lines.location_id` NOT NULL; `payment_terms_days` and `billing_rollup_tier` are parent-only terms | money tests; finding 1 tests |
| 8 | Compliance gate, no override by any path | a type with an unexported symbol; whole-window evaluation; trigger re-verifies; clearance row cites credentials; `ac/no-clearance-forgery`; **and since C4 the credentials it reads cannot be forged either — see the C4 row** | 6 gate tests; 5 integration tests including the raw-INSERT bypass |
| 9 | One field experience regardless of employment | `employment_type` read only by the gate; lint + guard bar it from S5 | guard |
| 10–13 | Infrastructure as code, restore tests, monitoring, named owner + response obligation | Operational. Owner: Ethan M. (D7). D7a open. **No code mechanism can defend these.** | — |
| 14 | **No surface writes its own fetch call**; every surface reaches the gateway through one shell and one generated client | `OPERATIONS` is the single source for the gateway's routes and the generated client; guard byte-compares the client and checks handler parity; `fetch`/`EventSource`/`XMLHttpRequest`/`WebSocket`/wire libraries fail guard + `ac/no-fetch-in-surface` anywhere in `apps/s*`, `packages/{shell,ui,tokens}`; surfaces import nothing below the shell; no client method takes a URL; degraded written by the transport wrapper only; a package with sources and no test fails the guard | 12 catalogue + 9 sdk + 19 shell tests; 9 over-the-wire integration tests; all guards proven to fire on planted violations |
| 1/2 (C1) | **The hierarchy enters through one door**: a parent is created with its first region node in one unit of work; `region_id` is an input for a region node only and derives from the edge below; a move changes one column and the shard key follows by trigger; D14 asked before a location is signed in | `handlers/hierarchy.ts` decides inputs; `ac_accounts_derive_region` / `ac_accounts_cascade` decide structure (no second copy of the ladder in the handler); `supply_below_density` is a commercial refusal, rule-unset a caveat; S2's forms do not offer a region field below the region tier | 10 handler tests against a scripted Tx; 4 D14 tests; 12 wire tests (parent+node atomic and refused whole; region_id typed below region → 422; site under region node → 422 with the trigger's words; move → descendant's `region_id` and `path` follow; D14 both ways); the same flow driven in headless Chromium through the cookie session |
| 7/OQ5 (C2) | **An agreement states its position before it is recorded**, and a term override belongs to the document that agreed to it | `handlers/contracts.ts` decides the agreement's own shape — `region_id` is an input at parent scope alone and derives from the scope node below it; OQ5 absent or non-boolean is a **400**, because nothing was refused on its merits; an inverted window is `empty_window` said by the handler, since Postgres raises 22000 there and 22000 would reach the surface as a 500; `draft → active → expired \| terminated`, a step off it `illegal_transition`. Scope existence at the declared tier stays with `ac_contract_scope_exists`. S2's form is a THREE-state OQ5 control that does not submit unset, and the override form is rendered from `terms.register` rather than eleven hard-coded inputs | 8 handler tests against a scripted Tx; 9 screen tests; 11 wire tests (finding 1 → 422 `illegal_tier` structural, finding 2 → 422 `ratchet_loosened` commercial with the resolver agreeing, OQ5 unstated → 400, the overlap-then-orphan chain, the ladder, the trigger's own words for a mis-declared tier); 22 checks driven in headless Chromium, including zero gateway calls with OQ5 unstated |
| 8/C4 | **Only S2 verifies a credential, once, and a verified credential is immutable** — the sentence the gate has depended on since 05 Rev D, made into a mechanism. The write allowlist could not hold it: `crew_credential` is an entity label the unit of work checks, while the TABLE is reachable by any role with INSERT on it and S8's compliance intake will write the same table | `ac_credential_verification_is_earned` (0005) refuses a verified INSERT **from every path including the superuser's**, admits NULL → set only for an internal principal acting AS S2 with `verified_by` equal to the acting principal, and refuses any change to a verified row — a clearance may already cite it by id, so a correction is a new document. `handlers/network.ts` adds `already_verified` so a second click is a named refusal rather than an AC403. 0005 also closes a hole 0002 left: crews and crew_credentials were bound by REGION only, so a firm principal could list every crew in its region including other firms' — firm isolation is now a policy on `subcontractor_firms`, `crews` and `crew_credentials`. A firm enters through one door (tenant root + operational row, one id, one uow; `organizations.create` refuses kind subcontractor); activation is behind a signed MSA; a crew's tenancy follows its employment; a rate is set from a day forward, the row in effect closed at it as its own audited mutation, and overlap left to the EXCLUDE constraint | 13 handler tests against a scripted Tx; 12 screen tests; 8 wire tests (the forged INSERT, the S3-binding verification, the second verification, the edit of a verified row — all four refused; a firm on S8 seeing one firm, its own crews, its own documents and no other firm's price; the close rolling back with the refused insert); and **`tools/ci/drive-s2-c4.ts` — 13 checks through a real browser, committed and run by CI**, which is where the two defects C4 shipped with actually lived: it walks record → refuse → sign → activate → crew → document → verify → two rates, and it is proven to fire on both of them planted back in |
| S0/09 | **Surface runtime** — the renderer behind one package; screens as a registry checked against the catalogue; colour as a role; the frame rendered from the registry | `packages/ui/src/render.ts` is the only file importing preact/htm/signals and `from "preact"` in `apps/s*` fails the guard; every `uses` in `apps/s*/src/screens.ts` must be a catalogue operation admitting that surface; `#rrggbb`/`rgb(` outside `packages/tokens` fails; a surface reaching a third-party font host fails, because the tier that most depends on aligned digits is the tier least likely to have a network; `emit-surfaces.ts --check` byte-compares every emitted file including `frame.html`; a component handed a density outside its spec is a type error at the call and a throw at render | 32 ui tests (density contract at the type level via `@ts-expect-error`, render-to-string, router, stylesheet variables resolve for every density, no accent ink in a state-bearing column, the script confined to the masthead); all four guards proven to fire on planted violations; the S2 frame + every component executed in headless Chromium — 36px controls on console, 56px and a dark surface on the field frame, degraded slot flips |

| 6/S6 | **One codebase, four scopes — scoping enforced at the gateway, never by client-side filtering** (05 §S6; 00 §2.8 build order item 6: "tier scoping is the acceptance test"). Before 0006 the sentence held for `accounts` alone: a customer bound to South could read every South job of every customer, resolve any org's terms by typing its id, and list our crews and their documents by region; and a location-scoped manager could not see the region node above them, so a term authored at the region tier silently did not apply | Migration 0006: `ac_work_visible` (a job, its timer, its state events and a service request are visible to a customer exactly when the site is — the EXISTS runs under `accounts`' own policy); `ac_agreement_visible` on `contracts` and `contract_term_overrides` (own org; nothing for a firm) with INSERT/UPDATE for the internal namespace alone — the table says what the allowlist says; the customer namespace closed on `crews`, `crew_credentials`, `compliance_clearances`, `assignments`; `ac_scope_ancestors()` (SECURITY DEFINER) makes the scope node's own path visible. `login()` binds the principal's scope before resolving its context; `terms.resolved`, `accounts.list`, `contracts.list` take the org from the token for a non-internal principal; a parent-tier customer's unit of work writes into any region its org is served from (the row's region is the site's). `handlers/service-requests.ts` decides inputs; 0006 decides visibility. S6 itself: `auth.login` serves S6 as the Phase 1 door (OPEN-S6-IDP names federation as the replacement of the credential check, nothing downstream); five screens over `accounts.list`, `jobs.list`, `serviceRequests.*`, `contracts.list`, `terms.resolved`, `terms.register`; RefusalCard is console-only by spec, so the customer reads the heading and the gateway's words | 5 handler tests; 2 uow tests; 10 render tests; **10 wire tests** — four customer principals (a manager at Austin, one at Reno, the executive, another customer's manager): the subtree and the breadcrumb, work by site across our regions with the crew invisible, zero rows on four tables at the binding, a REGION-tier override applying to a location-scoped manager, `orgId` inert, the one write landing in the site's tenancy and refused for an invisible site, six authoring operations refused by scope, a raw INSERT refused at the table; **`tools/ci/drive-s6.ts` — 12 checks in a real browser, run by CI** |
| 7/S8 | **A firm sees its own crews, its own jobs, its own compliance and its own money — never another firm's rate card** (00 §2.8 build order item 7; the registry's degraded line for S8). Before 0007 the sentence held on the four network tables alone (0005): a firm bound to South could read every South job, assignment, clearance, timer and service request of every customer, the customer's whole tree, every firm's `settlement_lines` (the other firm's price by division), `working_capital_positions` (our float), and — from ANY external namespace, S6's customer included — `organizations`, `users` with password hashes, `audit_log` and `outbox`. None of it through a screen; none of it a mechanism | Migration 0007: `ac_firm_work_visible(job)` — a job, its timer and its state events are the firm's when one of its crews has been assigned to it, live or released, and the EXISTS runs under `assignments`' and `crews`' own firm rules; the firm's `accounts` rule is the site a visible job names; `service_requests` closed to the firm; `settlements` split into read (own firm, issued — a draft is ours), insert (ours) and update (own firm), with `ac_settlement_position_is_the_firms` holding that a firm changes state, `acknowledged_at`, `disputed_at`, `dispute_reason` and no other column, forward only (issued → acknowledged, issued|acknowledged → disputed with a reason); `settlement_lines` follow their statement; `working_capital_positions` internal; `ac_crew_roster_is_the_firms` — a firm's INSERT names itself and `subcontracted`, its UPDATE changes label and active alone; `organizations`, `users`, `audit_log`, `outbox` admit the unbound gateway (login, the worker) and the internal namespace, an external principal its own row or nothing, with INSERT on the two logs open to every bound transaction. `ac_unbound()` names the gateway acting as itself. D12's four entities each have their own operation with the firm, type and region taken from the principal, never an input; S8 reads `jobs.list` (now with `siteName`) and the two settlement reads | 10 handler tests against a scripted Tx; 11 render tests; **10 wire tests** — two firms and the office: the job its crew was sent to with its own crew and the site's name, not the other firm's or the unassigned one; at the binding its own work, site, issued statement, root and user row and zero rows on eleven tables; enroll → a subcontracted crew under the firm in its region, retire refused while assigned (`crew_assigned`), the other firm's crew `unknown_crew`, a crew under the other firm / an employed crew / a change of employer refused at the table; a document filed unverified under `compliance_doc`, a verified INSERT and a firm's verification refused by 0005 from the firm's own binding, then S2 verifies and the firm reads it; the statement read (own, issued; the draft and the other firm's `unknown_settlement`), acknowledged then disputed with the reason on the row and both events in the outbox, each refused by name the second time, the office reading the reason and refused a position of its own; at the table the total, the period, the firm and every off-ladder step refused, the other firm's row zero rows to update; **`tools/ci/drive-s8.ts` — 11 checks in a real browser, run by CI** |

| 8/S1 | **An anonymous principal writes twice and reads nothing** — and the public coverage claim is read from the hierarchy, never from the bundle (05 §S1; 00 §2.8 build order item 8: "off the critical path, ship whenever a hand is free"). S1 is the first surface with no principal, and reading the schema as one found the condition 0006 and 0007 each found for the customer and the firm, now in its widest form: `leads` and `call_records` had **no policy at all**, so every stranger, every customer and every firm could read every lead ever captured — the name, email, phone number and free-text note a member of the public typed into a form. `regions` had none either, which put `min_crew_density` — D14's supply rule, the number this surface exists in order NOT to publish — inside the marketing surface's own binding. Nor did `sessions` (who is signed in, where), `devices` and `device_grants` (the tablets and the shift roster), or `checklist_items` and `time_entries` (the field's work and its hours) | Migration 0008: `leads`/`call_records` SELECT for us alone, INSERT admitted for `anonymous` only into PROSPECT/UNASSIGNED, with `ac_lead_is_anonymous_intake` holding what may be in the row (a contact we can answer, a source off the list, no `converted_account_id` — conversion is S2's) and `ac_lead_is_not_the_strangers_to_change` holding that it is ours once made; `regions`, `sessions`, `devices`, `device_grants`, `checklist_items`, `time_entries` closed to every external namespace, `sessions` split read/append because `auth.deviceLogin` inserts its own session on an already-device-bound transaction; `ac_public_coverage()` (SECURITY DEFINER, two columns, active rows) as the single definition of the public claim; `leads.submission_id` UNIQUE as the replay key — `(device, mutation_id)` cut down to what a page needs. Above it: `openAnonymousShell` as S0's third boot path, `ANONYMOUS_PRINCIPAL` as shared data rather than an assertion by either side, and a browser buffer that queues, persists, replays one id and reads the unique index as success. The copy ceiling D7a/OQ6 never wrote down is enforced as ZERO by a list of patterns run against the rendered page and again against the painted one | 11 handler tests against a scripted Tx; 16 render tests; **15 wire tests** — the binding's zero on twenty-two tables (counted as us first, so an empty table cannot pass it vacuously), the PROSPECT root as the one row it may see, the same closure for the customer namespace, four table-level refusals on what a stranger may put in a lead, the coverage read's two columns, no session row per page view, the lead landing in PROSPECT/UNASSIGNED with a real anonymous session and an envelope carrying no contact details, the replay refused by name, an anonymous token opening nothing else, and a device login still resolving its own region after `regions` closed; **`tools/ci/drive-s1.ts` — 12 checks in a real browser, run by CI**, which starts the site before the gateway and reads the page in between |

## Conventions

Erasable TypeScript syntax only — no enums, no parameter properties, no
namespaces — so guards and tests run under Node's type stripping with zero
build step. Intra-repo imports are relative `.ts` paths for the same reason.
Money is integer minor units as `bigint`, enforced by lint; across jsonb and on
the wire it is a **string**. Quantities are integer thousandths. `packages/domain` reads no clock,
no RNG, no `node:` module; every function takes the instant it evaluates at.

Surfaces: no JSX (type stripping cannot erase it). Templates are `html\`…\``
from `@ac/ui`; **components are called, elements are tagged** —
`html\`<div>${StatusPill({ density, status })}</div>\`` — because a tagged
component slot is typed `unknown`, and the call is where the density contract
is checked. A component tagged anyway still throws on a density its spec does
not admit. Colours are `var(--color-*)` roles; the only hex values in the
repository are in `packages/tokens/src/primitives.ts`. A form field that
carries a default uses `defaultValue`, not `value`: the renderer sets `value`
as a DOM property, and a `form.reset()` then restores the field to an empty
**attribute** — which is how the second rate of a session silently stopped
reaching the gateway until a browser drive caught it (09 §3.11). That drive is
now `tools/ci/drive-s2-c4.ts` and runs in CI, so the rule above is enforced
rather than remembered: put `value` back and check 11 fails by name.

## The brand, and why it is enforced rather than documented

`docs/BRAND.md` is generated from the tokens. Two things in it are mechanisms
rather than guidance:

**The accent gate.** A tenant accent within 30° of a state ink converts
decoration into apparent state — a dispatcher learns red-ish means breached,
then opens a portal where red-ish means a logo. `admitAccent()` returns two
independent verdicts, hue separation and each ground, and narrows the slot
rather than rejecting the tenant.

**The brand layer.** The house red measures 1.2° from the fault ink and fails
that same gate, so it is fenced by the same mechanism: surfaces declare
`stateRamp`, and `tokenCss` resolves the brand roles to Ink Black wherever it is
true. S1 marketing wears the red; every surface that shows state does not. The
default is the safe one — a surface that forgets to declare renders neutral —
and the tests hold the line that no accent ink enters a state-bearing column.

We ask a tenant to give up their brand colour on a board they paid for. That
only holds because the house gave up its own on the same test.

## Consolidation note

Three divergent copies of this repository existed on 2026-09-14 (a git bundle,
a "frame" tarball, a "step0" tarball). This is the union: the bundle's history,
schema emitter, migration runner and CI; step0's zero-install discipline;
the frame tarball's sync state machine and SLA cascade; and the D2 findings
(`claude/07_D2_Hierarchy_Findings.md`) as code. The other two copies are
superseded and should be deleted, not kept as reference.
