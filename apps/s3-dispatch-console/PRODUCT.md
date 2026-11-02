# Product

<!-- impeccable:product-schema 1 -->

Scope: S3 Dispatch Console only. The other seven surfaces (S1–S8) share the company, the gateway and the Arc Foundry design system but have their own users.

Facts marked *(inferred)* come from the repo and an accepted default, not from a stated answer; confirm or correct them.

## Platform

web

## Users

An office dispatcher, scoped to one region. All day they assign jobs to crews, watch SLA clocks, release or escalate work, and handle unscheduled requests. They work on a desktop browser with a mouse and keyboard, scanning many rows at once. *(inferred)* Their first question on the board is which jobs have breached or are about to, with unassigned work and free crews second.

## Product Purpose

The dispatch board shows every job the dispatcher's region lets them see: its stage, SLA state, crew, and which technicians are idle, in one glance. Success is a dispatcher who never acts on stale or wrong state.

## Positioning

The board is the same data as S2's org-wide `jobs.list`, so a board and a report can never disagree about a job's state. The compliance gate is enforced at assignment, with no override path.

## Operating Context

- Realtime is a hard requirement.
- Degraded mode: the board freezes with a visible staleness clock and stops accepting assignments. A dispatcher acting on a stale board is worse than one who knows it is stale.
- Region-scoped. Scoping is enforced at the gateway, never client-side.
- No offline writes.

## Capabilities and Constraints

- Writes allowed: assignment, job_state, crew_release, escalation, job_note, job_flag, job_update, job_message, job, service_request. Anything else is `SurfaceWriteDenied`.
- The surface owns no data and holds no database credential. It imports `@ac/ui`, never the renderer.
- Board model: a 7 AM–5 PM day, hour columns, one row per crew or technician, service technicians above install crews, steppable ±3 days from today.
- Jobs with no crew, and a crew's work outside 7 AM–5 PM, are listed under the grid so no job loses its place.
- SLA state is derived, not displayed verbatim: `slaStatus` yields ok, at risk or breached.

## Brand Commitments

Rankine Operating Company, Arc Foundry (Identity Standards Bulletin No. 2). White-label: no — Rankine's plate, always. Console density: 36px controls, 14px body, hover allowed. Arc Foundry's tokens in `packages/tokens/` are the only visual authority; Impeccable supplies method and never colour, type, radius or spacing values.

## Evidence on Hand

- Reference layout: `Work/AC Services/artifacts/dispatch board visualuizer.html`, which the partners adopted for page structure (Rev A).
- Incumbent implementation: `apps/s3-dispatch-console/src/screens/board.ts` and `src/styles.ts`.
- No user research, usage data or testimonials are on hand; none should be invented.

## Product Principles

1. A board that cannot be trusted refuses to act: stale state is shown and assignments stop.
2. State is carried by form, word and mark first, hue second.
3. No job is ever lost off the grid: everything unassigned or outside the day's window stays listed.
4. One job, one truth across surfaces: S3 reads the same operations as S2.

## Accessibility & Inclusion

State never rests on colour alone: every state carries a word, and the marks ● ▲ ■ ✕ come from the shipped face. WCAG contrast is measured against `--color-surface-sunken`, per Arc Foundry's audit.
