# AC Platform

**The Rankine Operating Company monorepo.**

Eight web surfaces. One gateway. One hierarchy. One backbone.

> Rankine is the network and the contracting entity. Operating firms keep their local names and equity (AC Services DFW is Works No. 1). Structure and marks are generated from `packages/tokens`.

## TL;DR

| What | Status | Principal |
|------|--------|-----------|
| Shared shell (S0) | ✅ Built | All |
| Front door (S1) | ✅ Built | Everyone, before sign-in |
| Service Manager (S2) | ✅ Built | Office |
| Dispatch Console (S3) | ✅ Built | Dispatcher |
| HQ Ops Dashboard (S4) | ✅ Built | Leadership (read-only) |
| Technician Web Fallback (S5) | ✅ Built | Technician |
| Customer Portal (S6) | ✅ Built + Site Card | Customer |
| Vendor Portal (S7) | 🟡 Built, disabled (Phase 4) | Vendor |
| Subcontractor Portal (S8) | ✅ Built | Firm |

**Core idea:** Expensive failures are *erosions*, not bugs. Every structural invariant is enforced by a reviewed diff on a named file (or a database trigger/policy), not by convention.

## Architecture

```mermaid
flowchart TB
    subgraph Surfaces["Surfaces (S1–S8)"]
        S1["S1 Front door<br/>Everyone · One sign-in, routed"]
        S2["S2 Service Manager<br/>Office · Hierarchy, Contracts, Network"]
        S3["S3 Dispatch<br/>Board + offline queue"]
        S4["S4 HQ Dashboard<br/>36 metrics, 15-min rollup"]
        S5["S5 Technician<br/>Four job states · offline replay"]
        S6["S6 Customer Portal<br/>Sites, work, site card"]
        S7["S7 Vendor Portal<br/>Procurement (phase-gated)"]
        S8["S8 Subcontractor<br/>Crews, docs, settlements"]
    end

    S0["S0 Shared Shell<br/>Login · Context · Events · Refusals"]
    GW["Gateway<br/>Operation catalogue → routes + client<br/>Unit of work · RLS binding"]
    DB[("PostgreSQL 18<br/>Row-Level Security<br/>Triggers · Migrations")]

    Surfaces --> S0
    S0 --> GW
    GW --> DB

    classDef surface fill:#F3F6F9,stroke:#8695A2,color:#0E1418
    classDef core fill:#F3F6F9,stroke:#0E1418,stroke-width:2px,color:#0E1418
    classDef data fill:#D4DCE4,stroke:#0E1418,stroke-width:2px,color:#0E1418
    class S1,S2,S3,S4,S5,S6,S7,S8 surface
    class S0,GW core
    class DB data
```

![Architecture diagram](docs/assets/architecture-diagram.svg)

### Key flows

```mermaid
sequenceDiagram
    participant U as User / Surface
    participant S0 as S0 Shell
    participant GW as Gateway
    participant DB as Postgres (RLS)

    U->>S0: Login / action
    S0->>GW: Operation (from catalogue)
    GW->>GW: Unit of work<br/>(allowlist · role · tenancy · audit + outbox)
    GW->>DB: Scoped transaction
    DB-->>GW: Result or refusal (SQLSTATE → typed)
    GW-->>S0: Response / SSE event
    S0-->>U: Screen update
```

## Surfaces at a glance

| ID | Name | Who | Key capability | Status |
|----|------|-----|----------------|--------|
| **S0** | Shared shell | All | Login, hierarchy context, event subscription, typed refusals | ✅ |
| **S1** | Front door | Everyone | One sign-in; the gateway routes each login to its surface (or a choice); zero-copy ceiling | ✅ |
| **S2** | Service Manager | Office | Hierarchy, agreements (OQ5), network (firms/crews/docs/rates), purchasing | ✅ |
| **S3** | Dispatch Console | Dispatcher | Board, dispatch, offline-first mutation queue | ✅ |
| **S4** | HQ Ops Dashboard | Leadership | 36 figures across service, money, network, growth and platform (15-min rollup) | ✅ |
| **S5** | Technician Web Fallback | Technician | Job walks assigned → en route → in progress → completed; offline replay | ✅ |
| **S6** | Customer Portal | Customer | Sites, work, agreements, **site card** (units, contacts, imagery, ledger) | ✅ |
| **S7** | Vendor Portal | Vendor | Catalogue, POs, shipments, 3-way match, returns | 🟡 Phase 4 |
| **S8** | Subcontractor Portal | Firm | Roster, documents, work, settlements (ack/dispute) | ✅ |

![Surface status chart](docs/assets/surface-status.svg)

## Current build state (as of 2 November 2026)

- **Foundation** (Steps 0–2): Frame, backbone, S0 shell — complete.
- **Surface runtime + S2** (Step 3): Hierarchy, contracts, network — complete.
- **Items 4–11**: S3/S5, S6 (+ site card), S8, S1, S4, S7 (disabled) — complete.
- **Arc Foundry Revs A–D**: reference layout across all surfaces (A), 4px/6px corners (B), red as the instrument accent with a garnet fault (C), S5 moved onto the light stock (D).
- **Production database replaced** — PostgreSQL 18; CI tests against the same version (`docs/history/28`).
- **Importer, regions and shift controls** — CSV load through the gateway, principal-only regions, S2 Shifts panel (`docs/history/29`).
- **S1 front door** — one sign-in; the gateway sends each login to its surface (`docs/history/30`).
- **S5 four job states** — assigned, en route, in progress, completed (`docs/history/31`).
- **Residential households** can hold more than one home.
- **Live in production** (`ROLLOUT`): S1, S2, S3, S5. S4, S6 and S8 are built and enabled but not yet rolled out.
- Next: S7 enablement pending partners’ D9 call.

All flows are proven in real browsers against the real gateway. See `docs/history/` for per-item build notes.

## Quick start

```bash
# Zero-install checks (Node 22.18+)
node tools/ci/schema-guard.ts
npm run guard:test          # ~300 unit tests
npm run guard:all

# With a database
export DATABASE_URL=postgres://user:pass@host/db
node tools/ci/migrate.ts
node tools/ci/migrate.ts --assert

# Seed test logins (idempotent)
AC_TEST_LOGIN_PASSWORD=… npm run db:seed-test-logins

# Integration + browser drives
npm run test:integration
npm run drive:s2-c4
npm run drive:s6
# … see package.json for full list

# Build & run a surface
node tools/ci/build-surface.ts S2
npm run gateway                 # :8080
npm run worker                  # outbox, SLA, expiry
```

**Production posture:** set `AC_SITE=ac.example` for Secure cookies and correct CORS.

## Repository map

```
apps/
  s1-front-door/ … s8-*/   surfaces
services/
  gateway/          sole access path (src/auth, src/db, src/http, src/handlers)
  worker/           outbox, SLA, expiry
packages/
  contracts/        operation catalogue (source of truth)
  sdk/              generated client
  shell/            S0
  ui/               Preact + htm + signals
  domain/           pure logic (SLA, money, compliance, D14, …)
  schema/           tables + migrations
  tokens/           brand + design tokens
tools/
  ci/               guards, emitters, migrate, build-surface
  drive/            browser end-to-end drives (Chrome over CDP)
  ops/              production scripts, test-login seeding
external/           apps outside the workspace (Electron logins app)
test/               integration tests (see test/README.md)
infra/              Cloudflare deployment
docs/               BACKBONE_CONTRACT.md, OPEN_DECISIONS.md, …
  generated/        BRAND.md, SURFACES.md (emitted — do not edit)
  assets/           diagrams
  history/          per-item build records
```

## Governing principle

> The expensive failures in this system are not bugs — they are **erosions**: a nullable `region_id` added under deadline, a `force` flag on the compliance gate, a helpful import between two invoicing paths, one handler that queries the database directly. Each is individually reasonable. Each is individually invisible. Together they are the difference between Tier 3 being a routing change and Tier 3 being a rewrite.
>
> **Make each erosion cost a reviewed diff on a named file, instead of costing nothing.**

This is enforced by:
- Operation catalogue as single source of truth (routes + client generated from it)
- Unit-of-work allowlist
- Database RLS + triggers (the real security boundary)
- Schema guards and zero-install CI checks
- Accent gate and brand layer (state colors never collide with tenant brand)

## Brand

Generated from tokens. Two mechanisms worth knowing:

- **Accent gate** — tenant colors cannot sit within 30° of state inks.
- **Brand layer** — the brand roles are fenced the same way: they render only where a surface declares `stateRamp: false`. Since Rev C the fault ink is garnet, so house red clears the gate and is also the instrument accent on every surface.

The design system is **Arc Foundry** (Identity Standards Bulletin No. 2). `packages/tokens/` holds the values; the rules are in `.claude/skills/arc-foundry/SKILL.md`.

## Further reading

- `docs/BACKBONE_CONTRACT.md` — the interface every block codes against
- `docs/generated/BRAND.md` — generated brand guide
- `docs/OPEN_DECISIONS.md` — the partner decisions the code is waiting on
- `docs/CLOUDFLARE_PAGES.md`, `infra/README.md` — production
- `docs/history/` — detailed build notes for each item

---

*Built so that the difference between “Tier 3 is a routing change” and “Tier 3 is a rewrite” is visible in the diff.*
