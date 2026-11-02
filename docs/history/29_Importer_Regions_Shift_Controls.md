# 29 — Importer, Regions and shift controls (without People logins)

Ported from `claude/production-data` onto the post-#195 layout. Deliberately **not** ported: People screens,
staff-login creation, temp passwords, `must_change_password`. That migration conflicts with the S1 front door's
`auth.signIn` (a temp-password user would get a session without changing the password).

## Done
- `tools/import` — CSV importer, run through the gateway as a principal; makes no logins. Templates and `docs/IMPORT.md`.
  Service units (one-technician crews) are now listed in `crews.csv`; technicians point at them via `crew`.
- Regions — `regions.create/update/setActive`; principal-only; `UNASSIGNED` never assignable; migration
  `0038_regions_and_launch_region` opens DFW. S2 "Regions" tab (principals only) and region pickers offer assignable regions only.
- Shift controls — `devices.listGrants/extendShift/revokeShift`; S2 devices screen Shifts panel.

## Verified
schema-guard, guard:test, typecheck, guard:lint, sdk:check, surfaces:check, `npm run test:ui` (334), and against local
Postgres 16: migrate 0001→0038, `--assert`, `test/integration/production-data.test.ts` 10/10, full integration 298/300.

## Trap
`manager.test.ts` ("leadership at parent scope…") and `s7.test.ts` (vendor proposal) fail identically on `origin/main`
in this environment; not caused by this change.

## Left
Real staff logins and the "AC Services DFW" company in AC Logins; deciding the People/temp-password design against S1.
