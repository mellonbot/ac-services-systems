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
C3 (Amped recorded in full through the screens) waits on OQ1/OQ5 and is the
last item in step 3. **Structural build order item 4 (`00_MASTER_SYSTEM_PLAN.md`
§2.8) is built (2026-09-17): S3 Dispatch Console and S5 Technician Web
Fallback** — the board and dispatch screens, the offline-first mutation queue,
the device-shaped login, unit- and render-tested (23 new tests; 334 unit tests
total), schema-guard clean, and driven in headless Chromium against a static
build of all six enabled surfaces. Detail: `claude/19_S3_S5_UI_Built.md`. A
live-gateway integration proof mirroring `test/integration/s2-c4.test.ts` and
`tools/ci/drive-s2-c4.ts` is the next rung and is not yet run — it needs a
Postgres and a browser this sandbox does not carry both of at once.
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
npm run guard:test                  # 193 unit tests: resolver, admission, gate, sync, SLA, money, D14, uow, auth, session, refusals, hierarchy and contract handlers, catalogue, sdk, shell, tokens→CSS, the accent gate, the brand layer, the badge, PR titles
npm run guard:all                   # both
npm run sdk:generate                # regenerate the client from the operation catalogue
npm run sdk:check                   # fail on drift (the guard runs this too)
node tools/ci/emit-surfaces.ts      # regenerate apps/s*/{package.json,src/main.ts,frame.html,README.md} + docs/SURFACES.md from SURFACES
npm run surfaces:check              # fail on drift (the guard runs this too)

# A database.
export DATABASE_URL=postgres://user:pass@host/db
node tools/ci/migrate.ts            # versioned migrations + the repeatable term-register mirror
node tools/ci/migrate.ts --assert   # region_id is total in the LIVE schema
npm run test:integration            # 79 tests: the contract with RLS on (29) + the shell and the browser session over the wire (19) + C1 over the wire (12) + C2 over the wire (11) + C4 over the wire: the forged verification refused on every path, firm isolation, the rate that closes the one before it (8)
npm run drive:s2-c4                 # 13 checks through a REAL browser: the C4 screens end to end against the live gateway.
                                    #   Needs a browser (AC_CHROME, or found on PATH) and a database. Skips on a laptop that
                                    #   has neither; in CI a skip is a failure, because a check that stops checking is worse
                                    #   than no check — it reports green.

# The toolchain layer.
pnpm install
pnpm typecheck && pnpm guard:lint   # tsc strict; eslint with the eight ac/ rules (verified: they fire)
npm run test:ui                     # 61 tests rendered to a string under node --test: packages/ui + S2's screens (C1, C2 and C4) through the real shell against a scripted gateway. Need preact, hence here
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
  src/handlers/         terms (admission + resolution), assignment (the gate), sync (device replay), hierarchy (C1: org+first region node in one uow, node create/move/update; D14; structure left to the triggers), contracts (C2: the agreement's own shape — scope region, OQ5, the window, the amendment's MSA, the state ladder; scope existence left to the trigger), network (C4: the firm's door — tenant root and operational row in one uow — the status ladder behind a signed MSA, a crew's tenancy following its employment, a document that arrives unverified, a rate set from a day forward; verification and overlap left to the database)
  src/main.ts           node:http + SSE; route table built from OPERATIONS, handlers typed over OperationId
  src/session.ts        the browser session: httpOnly cookie, x-ac-surface as the CSRF line, CORS derived from SURFACES under AC_SITE
  src/refusals.ts       SQLSTATE → 422/403 with the database's message; InputRefused for inputs a handler cannot resolve
apps/worker/          outbox relay (SKIP LOCKED), credential-expiry sweep, SLA cascade
packages/contracts/   TIERS · TERMS (the policy register, two axes) · TOPICS · SURFACES · OPERATIONS (the catalogue, 34 rows) · refusals (the axis) · Claims/Principal
packages/sdk/         generated/client.ts (emitted from OPERATIONS by tools/ci/emit-sdk.ts) + runtime.ts (THE ONLY FILE ABOVE THE GATEWAY THAT TOUCHES THE WIRE)
packages/shell/       S0: createShell (registry checks), connectShell (login → me → shell), subscribe (SSE, dedupe), refusalOf, degraded driven by the wire; brand.ts installs a tenant's block BEFORE login — a portal is branded on its sign-in screen
packages/tokens/      primitives → semantic → density → white-label (contrast-validated against every ground each ink is permitted on); brand.ts holds the marks and the badge geometry; type.ts the five type roles; css.ts emits it all as :root variables per density and per surface (field is a fixed dark ground, not a theme); brandCss scopes a tenant block away from the plate
packages/ui/          THE RENDERER BOUNDARY: preact/htm/signals pinned here alone (render.ts); components typed to their spec's densities — StatusPill, PrimaryAction, DataGrid, ComplianceBadge, RefusalCard, DegradedBanner; router over the History API from a SCREENS registry; UI_CSS (roles only, no colours)
apps/s1 … s8/         generated from SURFACES by tools/ci/emit-surfaces.ts — package.json, src/main.ts, frame.html (density, tokens, degraded slot, brand slot on a whiteLabel surface, mount), README; each boots through the shell and can call nothing else
apps/s2-service-manager/src/  the first surface with screens: screens.ts (the registry the guard reads), app.ts (cookie boot → login or tree; router; degraded slot; account, contract and network events → refetch), state.ts (resources as signals, invalidated by prefix), screens/ (accounts-tree, accounts-new, accounts-move, organizations-new, contracts-list, contracts-new, terms-override, terms-resolved, network, network-new, network-documents, network-rates)
packages/domain/src/supply/   D14 as a decision function: rule unset → caveat; set and unmet → commercial refusal
tools/ci/             schema-guard (zero-install) · emit-schema · emit-sdk · emit-surfaces (--check) · build-surface (esbuild; the only step that needs an install) · migrate
packages/schema/      operationalTable() and 44 tables; migrations 0001 (generated), 0002 (guardrails), 0003 (assert), 0004 (refusal codes — every trigger raises with an ERRCODE), 0005 (the network registry — verification earned and immutable, firm isolation), repeatable/
packages/domain/      no I/O: inheritance/{resolve,admit} · compliance · sync · sla · money · billing
test/integration/     backbone.test.ts — the contract against a live Postgres · s0-shell.test.ts — the shell against a spawned gateway · s2-c1 · s2-c2 · s2-c4
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
