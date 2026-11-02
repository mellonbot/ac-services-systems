# 31 — Disabled-control contrast (F-3) and the accent-layer wording

Date: 2026-11-02. Follows `30_S1_Front_Door.md`.

## Done

- **F-3.** `.ac-action[aria-disabled="true"]` faded the whole control to 55% opacity, which
  dragged its label under 4.5:1. It is now drawn in roles the token tests already measure:
  `--color-text-muted` on `--color-surface-sunken`, ruled by `--color-border-control`, and it
  holds that look through hover and press. `styles.test.ts` bans a fractional opacity in the sheet.
- **Layer wording.** `BRAND.md`'s accent-layer table showed the same red twice and left out
  that brand roles resolve to Ink Black wherever a state ramp renders. Reworded in the emitter
  (`tools/ci/emit-surfaces.ts`) to match the arc-foundry skill, then regenerated.
- The stale local `apps/s1-marketing/` (untracked, only `node_modules` links) was removed.

## Verified

schema-guard, guard:test, test:ui, typecheck, sdk:check, surfaces:check green. guard:lint is
clean for the repository; its only errors are in local `.claude/worktrees/` checkouts.

## Left

- Republish the walkthrough and the standards sheet (outside the repo).
- Create the real logins (AC Services DFW and staff) in AC Logins.
- Decide the S5 shift-session question and the offline-technician question.
- Revoke the old R2 token and delete the old PlanetScale database.
