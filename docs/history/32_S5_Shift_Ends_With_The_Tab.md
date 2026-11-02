# 32 — S5: a front-door shift ends when its tab closes

Date: 2026-11-02. Settles the decision left open in `30_S1_Front_Door.md`.

## Decision

A shift S1 signed in lasts across a reload and ends when its tab closes. Before this, the shift
cookie lived until the shift ended, so on a shared browser the next person to open S5 walked
into the last technician's shift.

## How

The cookie cannot see tabs; a tab's sessionStorage can, and S1 and S5 share an origin.

- `packages/shell`: `SHIFT_TAB_KEY` and `TabMark`.
- S1 marks the tab (`sessionStorage[SHIFT_TAB_KEY]`) as it sends a sign-in to S5.
- S5 `resume()` resumes a device cookie only in a marked tab. In an unmarked tab it calls
  `logout()`, which revokes the left-behind session on the gateway, and shows the login.
  S5's own sign-out clears the mark.
- S5's own sign-in is bearer, held in memory, and already ended with a reload; unchanged.

## Verified

New unit tests in `apps/s1-front-door/src/app.test.ts` and `apps/s5-technician/src/app.test.ts`.
schema-guard, guard:test, test:ui, typecheck, sdk:check, surfaces:check green; guard:lint clean
for the repository. No browser drive covers S1 → S5 in one tab; none was run.

## Trap

A browser that restores tabs on restart also restores their sessionStorage, so a restored tab
keeps its shift until the cookie expires. Duplicating a tab copies the mark too.

Offline entry (a separate session) must work inside this rule: a fresh tab has no mark.
