# The Backbone Contract

**Rev A · 2026-09-14 · Action plan B2. The interface every block codes against.**

This is the frozen surface between the backbone and the three operating blocks. Every statement in it is enforced by something named in the right-hand margin — a type, a trigger, a constraint, a guard, or a test in `test/integration/backbone.test.ts` that ran green against PostgreSQL 16 on the day this was written. A statement that is not enforced is not in this document.

The backbone consists of: the schema (`packages/schema`), the term policy register and event catalogue (`packages/contracts`), the pure domain (`packages/domain`), the gateway (`apps/gateway`), and the worker (`apps/worker`). Surfaces S1–S8 sit above it and hold no database credential. Nothing below this line is a plan; it is what the code does.

---

## 1. Tenancy

Every operational row carries `org_id` and `region_id`, both `NOT NULL`, appended by `operationalTable()` — a caller cannot omit them or make them nullable. There are three table kinds and two short allowlists (`TENANCY_ROOT_TABLES`: `organizations`, `regions`; `GLOBAL_REFERENCE_TABLES`: `currencies`, `part_manufacturers`, `schema_migrations`, `term_registry`). Adding to either list is a reviewed diff in `tenancy.ts` *and* in `0003_assert_region_id.sql`; the schema guard fails if the two disagree. `ac_assert_region_id_everywhere()` re-checks the live schema after every migration. Pre-account rows (leads, call records) belong to the well-known `PROSPECT` organization in the `UNASSIGNED` region; the invariant is total, with no fallback.

`region_id` means **our service region** — where crew supply draws the boundary — and never the customer's administrative grouping. It is the Tier 3 shard key. The customer's own grouping is `accounts.customer_group`, a text attribute on the location: reportable, invoice-groupable, and never structural. A customer reorganising their org chart edits a text column; it does not reshard our database.

*Enforced by:* `packages/schema/src/tenancy.ts`, `tools/ci/schema-guard.ts` §1–2, `migrations/0003`, integration test "region_id is total in the live schema".

## 2. The hierarchy (D2, all three parts)

Four tiers: **parent → region → location → site.**

The parent tier is the `organizations` row, above the region boundary, because a customer parent spans our regions by definition. The other three tiers live in `accounts` with `tier` on the row. A **region node** ("Amped / South") is where a customer's tree meets one of our service regions; its `region_id` is that region and its `parent_id` is null (its parent is the organization). Every location under it, and every site under those, inherits the *same* `region_id` — the trigger `ac_accounts_derive_region()` refuses an insert that declares otherwise, and when a node is moved (`parent_id` changes) its `region_id` follows the new edge and cascades to all descendants. Only we redraw a region, and we do it by rebinding or moving nodes; a customer preference never touches the shard key.

`accounts.path` is the node's ancestor chain as a `uuid[]`, maintained by the same trigger. It is what row-level security reads to answer "is my scope node an ancestor of this row" without a recursive query under RLS.

Rows that hang off a site (`jobs`, `equipment`, `service_requests`) must carry the site's `org_id` and `region_id`; `ac_inherit_tenancy_from_account()` refuses a script that types the wrong one.

*Enforced by:* `migrations/0002` (hierarchy section), integration tests "a location cannot be inserted under a region node with a different region_id", "a site cannot hang off a region", "path is materialised … and moves with the node", "a job's tenancy is inherited from its site".

## 3. Contract terms and the policy register (D2 part two)

A contract term is not a value that cascades. It is a key in `TERMS` (`packages/contracts/src/terms.ts`) that declares two orthogonal properties:

**Authoring** — which tiers may hold an override row. `payment_terms_days` is `["parent"]`; `sla_response` is every tier; `vendor_warranty` is `["site"]`.

**Combine** — how competing values resolve down the path. `nearest` (most specific tier wins), `ratchet` with a declared strict direction (an override may only tighten: lower for response hours, higher for PM visits), or `attach` (binds to one node and never walks — the vendor axis).

Violation is always **raise**. There is no configurable behaviour on violation, because a configurable behaviour is an override flag wearing another name. A term with no register entry raises rather than defaulting to cascade. Money in a term value is a **string** of integer minor units; a JSON number is an IEEE754 double and is refused.

The register is code. It is mirrored into `term_registry` by `tools/ci/emit-schema.ts` on every migrate run (`repeatable/R_term_registry.sql`), and no runtime role may write that table. The mirror exists so the database can refuse an illegal row from a psql session.

Override rows (`contract_term_overrides`) are keyed by `(scope_tier, scope_id, term_key)` with a half-open `daterange`. Three refusals happen **at insert**:

| Refusal | Layer | Failure it prevents |
|---|---|---|
| Authoring tier | trigger `ac_admit_term_override()` reads the mirror | A location setting its own payment terms makes the consolidated invoice unpayable (finding 1) |
| Overlap | `EXCLUDE USING gist (scope_tier, scope_id, term_key, effective &&)` | Two amendments in effect at once; every tie-break produces an invoice that is wrong in a way nobody can see (finding 4) |
| Ratchet direction, both ways | `admitOverride()` in `packages/domain`, called by the gateway | Reno relaxing same-day to 48-hour absorbs an exposure the MSA priced; tightening a parent term above an existing looser child row silently invalidates a term the customer believes they have (finding 2) |

Resolution (`resolveTerm(overrides, path, key, asOf)`) takes an instant, returns the value, the tier it won at, the policy, and a trace naming every rung including the empty ones and the ones an `attach` term did not walk. It re-applies all three checks, so a row that arrived by restore or by a bypassed path is still refused at resolve. A disputed February job reprices against the February rows because the caller says "February"; the domain has no clock.

The eleven terms registered today, with their policies, are the eleven rows of `term_registry`. Adding a term is a reviewed diff on `terms.ts`. Changing a term's *policy* after rows exist is a migration project: every existing row must be re-admitted, and the ones that fail are terms a customer currently has.

*Enforced by:* `terms.ts`, `domain/inheritance/{resolve,admit}.ts` (19 tests against the Amped fixture), `migrations/0002` (term admission section), `0001` EXCLUDE constraint, integration tests "finding 1 at the table", "finding 4 at the table", "the register mirror cannot be edited by a runtime role", "finding 2 through the gateway".

## 4. Identity, tokens, and scope

Every principal is a `users` row (namespaces `internal`, `customer`, `subcontractor`, `vendor`) or a `device_grants` row (namespace `device`: this device, this crew, this shift window). Anonymous S1 traffic is a principal in `PROSPECT`/`UNASSIGNED` and nowhere else.

A token is Ed25519-signed (`node:crypto`, no library) and carries `Claims`: subject, namespace, org, region, scope tier, scope id, roles, and — by namespace — firm, device and shift, or the customer IdP's tier claim. A token carries **where in the hierarchy**, never **what is permitted**; the gateway decides that against the registry and the hierarchy on each request, so an amended contract is never fought by a stale token. `region` is total even in a token: only anonymous principals may be `UNASSIGNED`.

At login the gateway resolves the **hierarchy context**: the principal's scope node's ancestor chain (the resolver's `ScopePath`), the parent, and the visible region nodes. Internal and device principals are scoped to *our* structure — the org, or one of our `regions` rows — never to a node in a customer's tree; a dispatcher serves every customer in the region. A customer principal is scoped to a node in its own org's tree, and a token whose `region` disagrees with that node's parent edge is refused as stale.

Every transaction the gateway opens begins with `SET LOCAL ROLE ac_gateway` and `SET LOCAL` of the **scope binding** — `ac.namespace`, `ac.org_id`, `ac.region_id`, `ac.scope_tier`, `ac.scope_id`, `ac.firm_id`, `ac.device_id`, `ac.actor_id`, `ac.surface_id` — built from the principal and from nothing a surface can set. Row-level security reads only those settings. `SET LOCAL` dies with the transaction, so a pooled connection cannot carry one principal's scope into the next request.

Row-level security, all tables `FORCE`d so the owner is bound too:

| Table(s) | Visible to |
|---|---|
| `accounts` | internal: all · device/subcontractor: own region · customer: own org, subtree under the scope node (`scope_id = ANY(path)`) · anonymous: none |
| `jobs`, `assignments`, `crews`, `crew_credentials`, `compliance_clearances`, `job_state_events`, `projects`, `sla_timers` | org-scoped internal: all · everyone else: own region |
| `rate_cards`, `settlements` | internal: all · a firm: its own rows only |
| `invoices` | internal: all · customer: own org |
| `sync_mutations` | internal: all · a device: its own intents |

A forgotten `WHERE` returns zero rows, not every firm's pricing.

*Enforced by:* `apps/gateway/src/{auth,context}.ts` (18 tests), `migrations/0002` (RLS section), integration tests "RLS: a West dispatcher sees zero South crews", "RLS: a subcontractor firm sees its own rate card", "RLS: a facility manager scoped to Boulder sees Boulder and its sites", "a stale token … is refused".

## 5. The gateway and the unit of work

The gateway is the sole access path. `apps/gateway/src/pg-tx.ts` is the only file in the repository that imports a database driver; the schema guard fails the build on a second one, `.npmrc` isolation makes the driver unresolvable from a surface, and no surface package depends on `packages/schema`.

Every mutation goes through `createUnitOfWork(ctx, tx)`, which refuses to open unless the surface is enabled for the current phase, serves the principal's namespace, and (for internal surfaces) admits one of the principal's roles — all three are data in `SURFACES`. Then, per mutation, in order: the entity must be on the surface's write allowlist (S4's is empty; nobody has to remember it); the row's `org_id`/`region_id` must be inside the principal's tenancy (our people write into customer orgs within their region; external principals write only into their own org and region); the topic must be in the event catalogue. On commit, one `audit_log` row and one `outbox` row per mutation are written **inside the same transaction**, sharing one `event_id`, before `COMMIT`. A rollback leaves none of the three.

The interface is `apply`, `commit`, `rollback`, `pending`, `tx`. There is no `skipAudit`, no `force`, no write without a declared entity, no emit without a topic.

Refusals surface as distinct HTTP statuses: 401 for token faults (each with its own code), 403 for scope, role, tenancy and allowlist, 404 for a phase-disabled surface, 422 for admission and resolution refusals — with the human-readable reason, because a dispatcher or contract administrator reads it under time pressure.

*Enforced by:* `apps/gateway/src/unit-of-work.ts` (10 tests with a fake `Tx`), integration test "authoring a legal override writes the row, an audit row and an outbox row with one event_id — and none of them if the tx rolls back", the HTTP smoke run recorded in the commit message.

## 6. The compliance gate

Assignment has one door: `POST /s3/assign`, handled by `assignCrew()`. `buildAssignment()` requires a `ComplianceClearance` positionally, and a `ComplianceClearance` carries a symbol `domain/compliance/clearance.ts` never exports; only `evaluate()` can mint one, and the lint rule `ac/no-clearance-forgery` fails the build on any other import of `mintClearance`. `evaluate()` checks the **whole service window** against verified credentials: a certificate valid today that expires on the 20th does not clear a job on the 22nd. Subcontracted crews require insurance; employed crews are covered by ours; that difference lives in `REQUIRED` and never reaches the field layer (`employment_type` is barred from S5 by lint and guard).

A refusal is returned in plain words and recorded as a `crew.compliance_refused` event — the quality signal C9 feeds on — and nothing is written to `assignments`.

Layer two: `ac_assignment_requires_clearance()` re-verifies, for any INSERT from anywhere, that the clearance belongs to the crew and its window contains the job's; `ac_clearance_is_earned()` refuses a clearance row whose cited credentials do not belong to the crew, are unverified, or do not cover its window. Layer three: the clearance row itself, citing the exact credential ids, for the subrogation conversation afterwards.

`assignments` is server-authoritative under sync (§7), so an offline device cannot route around the gate.

*Enforced by:* `domain/compliance/` (6 tests), `migrations/0002` (gate section), integration tests "THE ONE THAT MATTERS", "the same crew clears a job on the 16th", "an unverified certificate is not a certificate", "layer 2", "layer 2b".

## 7. Offline sync

**The device is the source of intent. The server is the source of truth.** A device accumulates an ordered log of mutations while offline, each with a client-generated `mutation_id` and the device's own sequence number. On reconnect it replays the log; the gateway applies each entry under the policy declared for its table and returns an outcome the device adopts without argument. The device never merges.

Policy is data, one table (`CONFLICT_POLICIES` in `packages/domain/src/sync`), and an undeclared table is **rejected** — an undeclared policy is an undiscussed business decision:

| Policy | Tables | Rule |
|---|---|---|
| `append_only` | `job_media`, `time_entries`, `parts_used` | Two sources adding rows is not a conflict. Idempotent by `(job_id, mutation_id)` UNIQUE |
| `device_authoritative` | `checklist_items` | The technician was standing in front of the equipment; the office was not |
| `server_authoritative` | `assignments`, `contract_term_overrides`, `rate_cards`, `crew_credentials`, `compliance_clearances` | The device may not write. An intent to do so is recorded and rejected, named as a gate bypass |
| `state_machine` | `jobs` | Transitions replay in device order against the server's current state; only device-drivable transitions (`en_route`…`complete`, `aborted`) are accepted, and only if legal from there. `cancelled`/`invoiced`/`reassigned` on the server with a completing device → `queued_for_human` |
| `manual_queue` | `warranty_cases`, `signatures` | Legal weight; no automatic resolution |

Every intent lands in `sync_mutations` with its outcome, UNIQUE per `(device_id, mutation_id)`, so a replay after a twelve-hour outage is a set of duplicates and not a second set of rows. Human-resolution cases land in `sync_conflicts` and emit `sync.conflict_queued`. Applied mutations are unit-of-work mutations: audit row, outbox row.

*Enforced by:* `domain/sync/index.ts` (10 tests), `apps/gateway/src/handlers/sync.ts`, integration tests "sync: a device log replays in device order; a duplicate replay is a no-op; an assignment intent is rejected and recorded", "sync: the office cancelled it, the crew completed it".

## 8. The event stream

Topics are the constant `TOPICS` in `packages/contracts/src/events.ts`. The unit of work and the worker refuse to emit a topic that is not in it. Every event carries `eventId` (shared with its audit row), `topic`, `entity`, `entityId`, `payload`, `regionId`, `orgId`, `actorId`, `surfaceId`, `occurredAt`.

Delivery is a transactional outbox: rows are written with the state change, and `apps/worker` relays them in `occurred_at` order with `FOR UPDATE SKIP LOCKED` (two relays never fight; a crashed relay leaves nothing stuck), publishes, and marks `published_at`. Phase 1 publication is Postgres `NOTIFY` on `ac_events` and on a per-region channel; the gateway `LISTEN`s and pushes server-sent events to connected surfaces, filtered to the subscriber's region (org-scoped internal principals receive all). Delivery is at-least-once; subscribers dedupe on `eventId`. `SUBSCRIBERS` in the same file declares which topics each block consumes.

The worker also owns two sweeps: `credential.expiring`/`credential.expired` (30-day horizon, with the count of already-assigned jobs whose windows outlast the credential — the ones the gate cleared when it was true), and the SLA cascade (per-minute; `shadow_mode` is a field on the timer, so the cascade runs for real and records what it would have done until a region has earned paging).

*Enforced by:* `apps/worker/src/{relay,sweeps}.ts`, integration tests "relay: unpublished outbox rows are published in order…", "credential expiry sweep…", the SSE smoke run.

## 9. Audit

`audit_log` is append-only at three layers: no update/delete on the `AuditWriter` interface, `INSERT`+`SELECT` only for every runtime role, and a trigger that raises on UPDATE or DELETE regardless of role — including the superuser. Rows carry `event_id`, actor, surface, session, request id, action, entity, entity id, before, after, and tenancy. The same trigger protects `job_state_events`. No runtime role holds DELETE on any table; rows are ended, not removed.

*Enforced by:* `migrations/0002`, integration tests "audit_log refuses UPDATE and DELETE even from the superuser", "no runtime role can DELETE anything".

## 10. Storage

A `StorageKey` is a branded string `region/org/kind/id` carrying no bucket, host or vendor. `storage_objects` records key, content type, size and sha256. Nothing outside `packages/storage` touches the filesystem or a vendor host; the lint rule and guard fail the build otherwise.

## 11. Layering and running it

Dependencies point one way: surfaces → shell → sdk → contracts → gateway → {domain, events, audit, storage, schema}. `packages/domain` has no I/O and imports nothing from `node:` or from any layer above it; the guard refuses `Date.now()`, `new Date()`, `Math.random()` and upward imports there. Intra-repo imports are relative `.ts` paths, so every guard and every unit test runs with **no install**.

```
node tools/ci/schema-guard.ts          # zero install. All structural invariants.
npm run guard:test                     # zero install. 82 unit tests.
DATABASE_URL=… node tools/ci/migrate.ts && node tools/ci/migrate.ts --assert
DATABASE_URL=… npm run test:integration   # 29 tests against a live database
pnpm install && pnpm typecheck && pnpm guard:lint   # the toolchain layer
DATABASE_URL=… npm run gateway          # :8080
DATABASE_URL=… npm run worker
```

## 12. What this contract does not decide

Pricing architecture (OQ1) shapes invoice path internals, not the four paths or the register. Diagnostic data rights (OQ5) is a `NOT NULL` boolean on both the contract and the firm; the position must be stated, and the register carries it as a parent-only term with no default. S8's Phase 1 scope (D12) is S8's write allowlist. Supply-before-signature (D14) is `regions.min_crew_density`, zero until set. Working capital (D13) is `working_capital_positions`, measured from day one. None of these can change the shape above; each is a data change or a handler behind an existing door.

What *would* break this contract: a nullable `region_id`; a second database driver import; a tier added to `TIERS` after rows exist; a term's policy changed after override rows exist; an `assignments` write path other than `assignCrew`; a `force` argument anywhere. The guards refuse the first two mechanically. The other four are reviewed diffs on named files, which is the most a frame can make them.
