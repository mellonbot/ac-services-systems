# 28 — Production database replaced, photo storage fixed

Date: 2026-11-02. PRs: #199 (prep). Spec: `docs/superpowers/specs/2026-11-01-prod-db-replacement-design.md`.
Plan: `docs/superpowers/plans/2026-11-01-prod-db-replacement.md`. Runbook: `docs/CLOUDFLARE_PAGES.md`
→ "Replacing the production database".

## Why

The old PlanetScale database's owner login (`pscale_api_k2649…`) was lost and PlanetScale could not
reset it (2BP01: it had granted roles to other logins). With a non-owner `DATABASE_URL`, every deploy
failed at "Migrate the production database" (`must be owner of table schema_migrations`). Nobody used
production yet, so the decision was a clean start: nothing copied. Photo storage had also failed
`/readyz` since 2026-10-31.

## What was done

- New PlanetScale database `acservice-prod-base`: GCP us-central1, **PostgreSQL 18.6**, PS-5,
  single node, x86-64. Owner = PlanetScale's default role `postgres` (not superuser; CREATEROLE and
  BYPASSRLS true). Its URL-form string is held in Ethan's password manager and as the GitHub
  `production` `DATABASE_URL`; guard copies it onto the Worker each deploy.
- Guard on `main` migrated 0001 → 0037 + repeatables, `--assert` passed, gateway deployed.
  `/readyz` → `{"ok":true,"database":"reachable","storage":"reachable"}`.
- `db-check`: `postgres` holds all five `ac_*` roles; `SET LOCAL ROLE ac_gateway` / `ac_worker` ok;
  `LISTEN` ok.
- Photo storage: new R2 token (Object Read & Write, `ac-media` only); four `AC_STORAGE_*` Worker
  secrets. `ac-media` was already empty (0 objects), so nothing was deleted.
- `seed-logins` (region `DFW` / Dallas–Fort Worth; superadmin left out): `dispatcher-test@ac.test`
  (DFW → S3) and `service_manager-test@ac.test` (org-wide → S2).
- AC Logins: own role `pscale_api_xbn47dxm9r2q` on the new database, granted `ac_logins` by
  `grant-logins-role`; app connected and working.

## Verified

PG 18 was not what CI tests (postgres:16), so before migrating prod the full migration set, `--assert`
and the integration suite (296/296) were run against a local `postgres:18` (18.6) container: all green.

## Traps

- **Connection string form.** The gateway, migrate and db-check need the URL form:
  `postgresql://ROLE.BRANCHID:PASSWORD@HOST:5432/postgres?sslmode=verify-full&sslrootcert=system`.
  PlanetScale's Connect screen shows a keyword form. Every mistake met on the way, in order:
  keyword form (`Invalid URL`), placeholder left in the user (`branch <branch-id> does not exist`),
  branch name or PlanetScale database name as the path (`database "…" does not exist` — the path is
  `/postgres`), password in the branch slot (`branch pscale_pw_… does not exist` — that error **prints
  the password**; reset the role if it is seen). Use port 5432 (6432 is PgBouncer, which breaks
  `SET LOCAL ROLE` and `LISTEN`), and leave out `sslnegotiation=direct`.
- **A malformed `AC_STORAGE_ENDPOINT` stops the gateway from starting.** `s3Store` parses it with
  `new URL()` at boot; the Worker then reports `the gateway did not become ready on :8080` and
  `/healthz` hangs — no `readyz:` line, and container stdout is not in `wrangler tail`. The first
  deploy after the cutover failed this way; re-putting the endpoint as exactly
  `https://<account-id>.r2.cloudflarestorage.com` (and the bucket as `ac-media`) fixed it.
- The `ac_*` roles are cluster-wide; a replacement must be a new PlanetScale database so 0002 creates
  them and 0012 can grant them.
- PlanetScale documents `pscale role reset-default <db> <branch>` for the default role, so the owner is
  probably resettable — unlike the old hand-made login. The password manager stays the record anyway.

## Left

- Revoke the old R2 token (dashboard).
- Delete the old PlanetScale database (old `pscale_api_k2649…` / `ztm0…` / `we7m…` logins go with it).
- Recreate company "AC Services DFW" (Ours, DFW) and real staff logins in AC Logins.
- Deferred review minors from #199: runbook step 5 could point at the `/readyz` triage table; comments
  say `regions_write` admits only `system` (it also admits internal); one ensure-region test title
  over-claims; `ensure-region` succeeds on an existing inactive region (the next step then fails clearly).
- Consider moving CI's postgres service to 18 to match production.
