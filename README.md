# AC Platform

**The Rankine Operating Company monorepo.**

Eight web surfaces. One gateway. One hierarchy. One backbone.

> Rankine is the network and the contracting entity. Operating firms keep their local names and equity (AC Services DFW is Works No. 1). Structure and marks are generated from `packages/tokens`.

## TL;DR

| What | Status | Principal |
|------|--------|-----------|
| Shared shell (S0) | ✅ Built | All |
| Marketing / Lead-gen (S1) | ✅ Built | Anonymous |
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
        S1["S1 Marketing<br/>Anonymous · Lead-gen"]
        S2["S2 Service Manager<br/>Office · Hierarchy, Contracts, Network"]
        S3["S3 Dispatch<br/>Board + offline queue"]
        S4["S4 HQ Dashboard<br/>36 metrics, 15-min rollup"]
        S5["S5 Tech Fallback<br/>Device login"]
        S6["S6 Customer Portal<br/>Sites, work, site card"]
        S7["S7 Vendor Portal<br/>Procurement (phase-gated)"]
        S8["S8 Subcontractor<br/>Crews, docs, settlements"]
    end

    S0["S0 Shared Shell<br/>Login · Context · Events · Refusals"]
    GW["Gateway<br/>Operation catalogue → routes + client<br/>Unit of work · RLS binding"]
    DB[("PostgreSQL 16<br/>Row-Level Security<br/>Triggers · Migrations")]

    Surfaces --> S0
    S0 --> GW
    GW --> DB

    classDef surface fill:#e8f4f8,stroke:#0066cc
    classDef core fill:#fff3e0,stroke:#e65100
    classDef data fill:#e8f5e9,stroke:#2e7d32
    class S1,S2,S3,S4,S5,S6,S7,S8 surface
    class S0,GW core
    class DB data
```

![Architecture diagram](docs/architecture-diagram.svg)

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
| **S1** | Marketing / Lead-gen | Anonymous | Durable lead buffer, coverage map, zero-copy ceiling | ✅ |
| **S2** | Service Manager | Office | Hierarchy, agreements (OQ5), network (firms/crews/docs/rates), purchasing | ✅ |
| **S3** | Dispatch Console | Dispatcher | Board, dispatch, offline-first mutation queue | ✅ |
| **S4** | HQ Ops Dashboard | Leadership | 36 figures across service, revenue, network, growth (15-min rollup) | ✅ |
| **S5** | Technician Web Fallback | Technician | Device-shaped login, offline replay | ✅ |
| **S6** | Customer Portal | Customer | Sites, work, agreements, **site card** (units, contacts, imagery, ledger) | ✅ |
| **S7** | Vendor Portal | Vendor | Catalogue, POs, shipments, 3-way match, returns | 🟡 Phase 4 |
| **S8** | Subcontractor Portal | Firm | Roster, documents, work, settlements (ack/dispute) | ✅ |

![Surface status chart](docs/surface-status.svg)

## Current build state (as of late Sept 2026)

- **Foundation** (Steps 0–2): Frame, backbone, S0 shell — complete.
- **Surface runtime + S2** (Step 3): Hierarchy, contracts, network — complete.
- **Items 4–11**: S3/S5, S6 (+ site card), S8, S1, S4, S7 (disabled) — complete.
- **Rev A**: Field-ops reference layout across all surfaces.
- Next: S7 enablement pending partners’ D9 call.

All flows are proven in real browsers against the real gateway. See `claude/` for per-item build notes.

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
  gateway/          sole access path (auth, uow, handlers, SSE)
  s1-marketing/ … s8-*/   surfaces
packages/
  contracts/        operation catalogue (source of truth)
  sdk/              generated client
  shell/            S0
  ui/               Preact + htm + signals
  domain/           pure logic (SLA, money, compliance, D14, …)
  schema/           tables + migrations
  tokens/           brand + design tokens
tools/ci/           guards, emitters, migrate, build-surface, drives
docs/               BRAND.md, BACKBONE_CONTRACT.md, architecture frame, diagrams
claude/             per-item build records
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
- **Brand layer** — house red is fenced the same way; state-bearing surfaces render neutral by default.

## Further reading

- `docs/BACKBONE_CONTRACT.md` — the interface every block codes against
- `06_Software_Architecture_Frame.md` — the frame
- `docs/BRAND.md` — generated brand guide
- `claude/` — detailed build notes for each item

---

*Built so that the difference between “Tier 3 is a routing change” and “Tier 3 is a rewrite” is visible in the diff.*
