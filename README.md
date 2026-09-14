# ac-platform

The AC Services platform monorepo. Eight web surfaces, one gateway, one
hierarchy.

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

Nothing here is enforced by documentation, convention, or code review alone —
those are the three mechanisms that fail at T-4 when someone is tired.

## Running it

```bash
pnpm install
pnpm guard:all          # schema guard + typecheck + lint + the full test suite
pnpm guard:schema       # dependency-free; runs with NO install at all
pnpm db:migrate && pnpm db:assert   # DATABASE_URL, psql, no node_modules
```

The last line belongs in CI after every migration. It is the assertion that the
shard key is still total.

## Layering

Dependencies point one way. There is no exception and no framework that earns one.

```
   apps/s1 … s8          surfaces — render and collect, own no logic
        │
        ▼
   packages/shell        S0: the one way a surface talks to the gateway
        │
        ▼
   packages/sdk          generated from contracts — never hand-written
        │
        ▼
   packages/contracts    scope claims, surface registry, API shapes
        │
        ▼
   apps/gateway          the sole access path; the unit of work
        │
        ├──▶ packages/domain    pure logic: inheritance, compliance, billing, sync, money
        ├──▶ packages/events    outbox / publisher interface
        ├──▶ packages/audit     append-only writer + reader
        ├──▶ packages/storage   opaque keys over object storage
        └──▶ packages/schema    the frozen backbone contract
```

Two properties fall out and are worth naming:

**`packages/domain` has no I/O.** No database, no clock, no network, no config.
Every function takes its inputs and the instant it is evaluating at. That is what
makes "does a certificate expiring Tuesday clear a job on Thursday" a 40ms unit
test instead of a staging exercise nobody runs twice.

**A surface cannot reach past the shell.** Not by policy: `.npmrc` sets
`node-linker=isolated`, so `import { Pool } from "pg"` inside a surface fails to
resolve before any lint rule runs.

## Where each non-negotiable is held

| # | Commitment | Mechanism |
|---|---|---|
| 1 | Four-tier hierarchy with inheritance and per-level override | Sparse override rows; pure resolver with an inspectable trace; **ambiguity throws** rather than tie-breaking — `packages/domain/src/inheritance/` |
| 2 | `region_id` on every operational row | `operationalTable()` appends it; a caller cannot omit it or make it nullable. Two short allowlists. Re-asserted against the live schema post-migrate — `packages/schema/src/tenancy.ts`, `migrations/0003` |
| 3 | Gateway as sole access path | Package isolation, lint rule, CI guard, four Postgres roles none of which the surfaces hold |
| 4 | Immutable audit log | Written **inside** the transaction, by the only object that can write; no update/delete on the interface; INSERT+SELECT grant; trigger regardless of role |
| 5 | Object storage behind our own interface | Branded `StorageKey` encoding `region/org/kind/id`, carrying no location |
| 6 | Offline-first sync | Device = intent, server = truth. Conflict policy is **data**. `assignments` is server-authoritative so an offline device cannot route around the gate |
| 7 | Consolidated parent invoicing, per-location itemization | `allocate()` — largest-remainder with a total tiebreak, exact sum by construction |
| 8 | Compliance gate at assignment, no override by any path | **A type, not a check.** See below |
| 9 | One field experience regardless of employment | `employment_type` barred from the field layer by lint rule and CI guard |
| 10 | Infrastructure as code from the first server | `infra/` is a build target |

## The three that carry the most weight

**Tenancy has three table kinds, not one rule with exceptions.** A rule with no
designed home for its awkward cases dies the first time someone meets one. Leads
arrive before a customer exists — so they are operational rows owned by a real
`PROSPECT` org in an `UNASSIGNED` region. The invariant stays total; the shard
key never needs a fallback.

**The compliance gate is a type, not a check.** `if (!isCompliant(crew)) throw`
is an override waiting for a deadline, because the call site can be edited by
whoever needs it to pass. So there is no check to edit: `buildAssignment` takes a
`ComplianceClearance`, a type carrying a symbol its module never exports. No flag
to set, no value to fake. And the gate evaluates the **whole service window**, not
the instant of assignment — a certificate valid today that expires Tuesday does
not clear a job scheduled Thursday. Three layers, because types do not see every
path: the type covers application code, a database trigger covers scripts and
migrations and services that do not exist yet, and the recorded clearance covers
the subrogation conversation afterwards.

**Four invoicing paths stay four.** Someone needs 80% of the enterprise path for
a project invoice, imports it, adds `if (isProject)`, and eighteen months later
residential pricing cannot change without regression-testing all four. Held by an
interface each path implements independently, a directory per path, and a lint
rule plus CI guard that fails on a cross-path import — including the
`../enterprise_sla/` spelling an IDE refactor produces on its own. Shared
behaviour has one admission test: **if it needs a flag to serve two paths, it is
not shared behaviour.**

## Conventions

Erasable TypeScript syntax only — no enums, no parameter properties, no
namespaces — so tools and tests run under Node's type stripping with zero build
step. That is what makes `pnpm guard:schema` runnable on a laptop with nothing
installed, on the day someone is in a hurry.

Money is integer minor units as `bigint`, end to end, enforced by lint.
Quantities are integer thousandths. There is no float in the money path and no
`Date.now()` in `packages/domain`. Money crossing the jsonb boundary is a
**string** — a JSON number is an IEEE754 double.
