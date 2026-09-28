# 25 — S4 HQ Ops Dashboard, built (item 10)

2026-09-27. Branch `item-10-s4-hq-dashboard`.

## The brief

S4 is the view for Rankine's leadership: every top-level, company-wide number,
across every region and every surface. The partners' instruction was **see
everything, change nothing**, figures from **worker-built rollups**, and S4
**enabled now** — ahead of the Phase 2 gate in 00 §5.5 ("ships only once regions
demonstrably run without it"). The enablement is recorded under OPEN-S4 in
`docs/OPEN_DECISIONS.md`.

## What was built

| Layer | Where | What |
|---|---|---|
| Register | `packages/contracts/src/hq.ts` | 34 figures in four areas (service & SLA, revenue & money, network & compliance, growth & web), each with its unit, window and one sentence of meaning. Every figure is additive across regions. |
| Table | `packages/schema/src/tables/hq.ts`, 0001 regenerated | `hq_metrics`: one row per (UTC day, region, metric), `as_of` the refresh that wrote it. |
| Migration | `0010_hq_rollup.sql` | RLS: the internal namespace reads every row, everyone else none; INSERT/UPDATE only when bound as the worker; the gateway and read-only roles hold SELECT and nothing else. |
| Worker | `apps/worker/src/rollup.ts`, `main.ts` | One SQL expression per figure, evaluated for every region in one upsert per figure, every 15 minutes, from the unregioned worker. The gate's required document kinds come from `domain/compliance`. |
| Gateway | `apps/gateway/src/handlers/hq.ts` | `hq.metrics` (latest day or a given day, with `asOf`) and `hq.history` (one figure's daily closes, 1–90 days). Reads `hq_metrics` and region names only. |
| Surface | `apps/s4-hq-dashboard/src/` | Company (four area panels, summary first, then a region grid with the D14 density state), Area (every figure by region, a company row, 30-day small multiples, what each figure means), Region (every figure for one region). The rollup's age is on every screen. No event stream: the page re-reads every minute. |

## Decisions worth knowing

- **Rates are divided on the screen, never stored.** "Answered in time" is
  `sla_met_30d / sla_closed_30d`; the company rate is the sum over the sum, not
  the mean of regional rates. Nothing closed shows "—", not 0%.
- **Leads have no region** until the office works them, so they roll up under
  UNASSIGNED and appear only in the Growth area as "Not yet placed".
- **Payments are not recorded yet**, so "Past due date" is an upper bound on
  what is owed and says so. Receivable and payable come from the latest
  `working_capital_positions` row.
- **Money is summed across currencies as minor units** and shown as USD. Every
  row today is USD; a second currency needs a currency dimension on the register.

## Proof

- `apps/s4-hq-dashboard/src/app.test.ts` — 13 render tests through the real
  shell and client (sums, rates, pills only where a number is a state,
  freshness, no writes, re-read on its own clock).
- `apps/gateway/src/handlers/hq.test.ts` (4) and `apps/worker/src/rollup.test.ts` (4).
- `test/integration/s4.test.ts` — 6 tests on a scratch database: every figure
  equals the seeded rows; a second refresh overwrites; 0010's read and write
  rules by namespace and role; S4 over the wire; a dispatcher refused at the door.
- Before CI: migrations 0001–0010 and the suite's own seed and figure
  assertions were replayed in PGlite (Postgres compiled to WebAssembly), which
  passed. The wire tests run in CI only, because no Postgres with `psql` was
  available on the build machine.

## Not built

- A browser drive (`tools/ci/drive-s4.ts`) like S1/S6/S8's.
- Annotation or acknowledgement from S4 — OPEN-S4.
- S4 in the clickable demo (`tools/demo/`, a separate PR); adding it is a
  gateway mock for the two reads once that PR is merged.
