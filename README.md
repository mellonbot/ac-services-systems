# ac-platform

The AC Services platform monorepo. Eight web surfaces, one gateway, one
hierarchy, one backbone.

**State (2026-09-14): Step 0 (the frame) and Step 1 (the backbone) are built
and verified.** `docs/BACKBONE_CONTRACT.md` is the B2 deliverable — the
interface every block codes against — and every statement in it names the
mechanism that enforces it and the test that proved it against PostgreSQL 16.

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
npm run guard:test                  # 82 unit tests: resolver, admission, gate, sync, SLA, money, uow, auth
npm run guard:all                   # both

# A database.
export DATABASE_URL=postgres://user:pass@host/db
node tools/ci/migrate.ts            # versioned migrations + the repeatable term-register mirror
node tools/ci/migrate.ts --assert   # region_id is total in the LIVE schema
npm run test:integration            # 29 tests: the whole contract, end to end, with RLS on

# The toolchain layer.
pnpm install
pnpm typecheck && pnpm guard:lint   # tsc strict; eslint with the seven ac/ rules (verified: they fire)

# Run it.
npm run gateway                     # :8080 — login, /s2/terms/override, /terms/resolved, /s3/assign, /s5/sync, /events (SSE)
npm run worker                      # outbox relay (1s), SLA cascade (60s), credential expiry (1h)
```

## What is here

```
apps/gateway/         the sole access path
  src/auth.ts           Ed25519 tokens, claims validation, scrypt passwords    (node:crypto, no library)
  src/context.ts        hierarchy context at login; the scope binding RLS reads
  src/unit-of-work.ts   allowlist · role · tenancy · topic → audit + outbox in one tx
  src/pg-tx.ts          THE ONLY FILE THAT IMPORTS A DATABASE DRIVER
  src/handlers/         terms (admission + resolution), assignment (the gate), sync (device replay)
  src/main.ts           node:http + SSE
apps/worker/          outbox relay (SKIP LOCKED), credential-expiry sweep, SLA cascade
packages/contracts/   TIERS · TERMS (the policy register, two axes) · TOPICS · SURFACES · Claims/Principal
packages/schema/      operationalTable() and 43 tables; migrations 0001 (generated), 0002 (guardrails), 0003 (assert), repeatable/
packages/domain/      no I/O: inheritance/{resolve,admit} · compliance · sync · sla · money · billing
test/integration/     the backbone contract against a live Postgres
docs/BACKBONE_CONTRACT.md   B2
```

## Where each non-negotiable is held

| # | Commitment | Mechanism | Proven by |
|---|---|---|---|
| 1 | Four-tier hierarchy, per-level override, **term policy register** | `TIERS`; `TERMS` as authoring-tier × combine-rule; resolver with trace; admission at insert (trigger + EXCLUDE + ratchet); the register mirrored into `term_registry`, SELECT-only | 19 resolver/admission tests on the Amped fixture; 5 integration tests |
| 2 | `region_id` on every operational row — **our service region, never the customer's grouping** | `operationalTable()`; `ac_assert_region_id_everywhere()`; trigger derives `region_id` from the parent edge and cascades; `customer_group` is an attribute | guard §1–2; migrate `--assert`; 5 integration tests |
| 3 | Gateway as sole access path | one driver import (guard-enforced); `.npmrc` isolation; four roles, surfaces hold none; RLS with `FORCE`; `SET LOCAL ROLE` + scope binding per tx | guard; 4 RLS integration tests |
| 4 | Immutable audit log | same-transaction write by the unit of work; no update/delete on the interface; INSERT+SELECT grant; trigger raises for any role | uow tests; "refuses UPDATE and DELETE even from the superuser" |
| 5 | Object storage behind our interface | branded `StorageKey`; lint + guard | guard |
| 6 | Offline-first sync | device = intent, server = truth; policy is data; `(device, mutation_id)` UNIQUE; `assignments` server-authoritative; state machine; human queue | 10 sync tests; 2 integration tests |
| 7 | Consolidated parent invoicing, per-location lines | `allocate()` exact by construction; `invoice_lines.location_id` NOT NULL; `payment_terms_days` and `billing_rollup_tier` are parent-only terms | money tests; finding 1 tests |
| 8 | Compliance gate, no override by any path | a type with an unexported symbol; whole-window evaluation; trigger re-verifies; clearance row cites credentials; `ac/no-clearance-forgery` | 6 gate tests; 5 integration tests including the raw-INSERT bypass |
| 9 | One field experience regardless of employment | `employment_type` read only by the gate; lint + guard bar it from S5 | guard |
| 10–13 | Infrastructure as code, restore tests, monitoring, named owner + response obligation | Operational. Owner: Ethan M. (D7). D7a open. **No code mechanism can defend these.** | — |

## Conventions

Erasable TypeScript syntax only — no enums, no parameter properties, no
namespaces — so guards and tests run under Node's type stripping with zero
build step. Intra-repo imports are relative `.ts` paths for the same reason.
Money is integer minor units as `bigint`, enforced by lint; across jsonb it is a
**string**. Quantities are integer thousandths. `packages/domain` reads no clock,
no RNG, no `node:` module; every function takes the instant it evaluates at.

## Consolidation note

Three divergent copies of this repository existed on 2026-09-14 (a git bundle,
a "frame" tarball, a "step0" tarball). This is the union: the bundle's history,
schema emitter, migration runner and CI; step0's zero-install discipline;
the frame tarball's sync state machine and SLA cascade; and the D2 findings
(`claude/07_D2_Hierarchy_Findings.md`) as code. The other two copies are
superseded and should be deleted, not kept as reference.
