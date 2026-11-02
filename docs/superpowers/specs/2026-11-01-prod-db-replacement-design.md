# Replace the production database (and fix photo storage) — design

Date: 2026-11-01. Status: draft for approval.

## Intent

Production (acservice.systems, gateway at api.acservice.systems) runs on a PlanetScale Postgres
database whose table owner is the login `pscale_api_k2649aloq7cw`. Nobody holds that login's
password any more, PlanetScale cannot reset it (2BP01: it granted roles to other logins), and the
GitHub `production` `DATABASE_URL` was switched to a non-owner login (`pscale_api_ztm0hlheijup`).
Every deploy now fails at "Migrate the production database" with
`must be owner of table schema_migrations`.

Ethan wants to **start totally fresh**: a brand-new, empty production database whose owner login
he controls, built purely by the repo's migrations. In the same cutover, fix photo storage, which
has failed `/readyz` since 2026-10-31 (R2 bucket `ac-media`, `AC_STORAGE_*` Worker secrets).

Nobody uses production yet, so downtime is acceptable and nothing has to run in parallel.

## Goals

- A new PlanetScale Postgres database, migrated 0001 → 0037 (+ repeatables) by `guard.yml`'s
  `deploy-gateway` job, with the migrating login as owner of every object and creator of every
  `ac_*` role.
- The owner's connection string is stored somewhere durable **before** it is pasted anywhere else.
- A green deploy: migrate + `--assert` pass, `/healthz` and `/readyz` 200 with database **and**
  storage OK.
- Staff can sign in again: a real region plus the staff test logins, and the AC Logins app works
  against the new database.
- The old PlanetScale database is deleted once the new one is proven.

## Non-goals

- No data carried over. Ethan: "start empty, nothing to keep." No dump, no copy, no backfill.
  The same goes for photos: the `ac-media` bucket is emptied, not kept.
- No change of provider (staying on PlanetScale Postgres; see "Calls I made").
- No change to the single-login model (migrator = gateway login) — see Constraints.
- No new backup/restore tooling. Restore drills stay as documented in `docs/CLOUDFLARE_PAGES.md`.
- Not the residential/commercial customer split or any other pending feature.

## Anti-goals

- Repeating the lockout: an owner string that exists only in GitHub/Worker secrets (write-only)
  and in nobody's password manager.
- Creating the new database **inside the old PlanetScale database/cluster** where the `ac_*`
  roles already exist under `k2649` (see Constraints, roles).
- Bypassing guard: no hand-run migrations against prod, no `--assert` skipped, no secret pasted
  into commits, PRs, logs or chat.

## Constraints (from the repo as of `1231e30`, post-restructure #195)

Paths below are the new layout: gateway in `services/gateway/src/{auth,db,http,handlers}`,
AC Logins in `external/logins-app/`, scripts in `tools/ci` and `tools/ops`.

**Roles are cluster-wide and tied to their creator.**
`packages/schema/migrations/0002_guardrails.sql:8-13` creates `ac_migrator`, `ac_gateway`,
`ac_worker`, `ac_readonly` NOLOGIN and swallows `duplicate_object`; `0021_tenancy_fail_closed.sql:116-125`
creates `ac_logins` the same way. `0012_login_role_set.sql:22-24` then runs
`GRANT ac_gateway, ac_worker TO current_user WITH SET TRUE`, which needs ADMIN OPTION — i.e. the
migrating login must be the roles' creator. If the roles pre-exist under another creator, 0002
silently skips and 0012 fails. Hence: a **new PlanetScale database** (its own cluster/branch), not
a new schema or DB name next to the old one. The new login also needs `CREATEROLE`; nothing in the
repo confirms PlanetScale's default login has it, so it is verified first (step 3).

**Single login.** The gateway and worker connect as the `DATABASE_URL` login and do
`SET LOCAL ROLE ac_gateway` / `ac_worker` per transaction (`services/gateway/src/db/pg-tx.ts:45-58`,
`services/worker/src/main.ts:20`); `guard.yml:270-274` and `docs/CLOUDFLARE_PAGES.md:137-148`
assume the same login migrates. Splitting owner and runtime logins is out of scope.

**Deploy copies only `DATABASE_URL`.** `guard.yml` `deploy-gateway` (215-349) copies
`DATABASE_URL` from the GitHub `production` env onto the Worker each run, checks the Worker has
`AC_SIGNING_KEY_PEM`, `DATABASE_URL` and — because S5 writes photos — all four `AC_STORAGE_*`
(280-304), migrates + asserts (307-313), deploys, then waits for `/healthz` and `/readyz`. No
Hyperdrive, no R2 binding (`infra/cloudflare/wrangler.jsonc`). No real host or login name is
hard-coded in the repo.

**RLS is GUC-keyed and FORCE'd.** Policies key on `ac.namespace` / `ac.scope_tier` /
`ac.region_id` / `ac.firm_id`; tables are FORCE RLS, so the owning login is filtered too unless it
is superuser/BYPASSRLS. `regions_write` (`0008`, tightened by 0021) only admits writes when
`ac.namespace = 'system'` or internal.

**Fresh-DB contents.** Migrations create orgs PROSPECT and AC Services (internal), region
UNASSIGNED, USD, the service catalogue and term registry. No real region, crew, customer or user.

**Photo storage.** `packages/storage/src/env.ts:5-28` needs all four of `AC_STORAGE_ENDPOINT`
(`https://<account-id>.r2.cloudflarestorage.com`), `AC_STORAGE_BUCKET` (`ac-media`),
`AC_STORAGE_KEY_ID`, `AC_STORAGE_SECRET` — a partial set throws at start. `/readyz`
(`services/gateway/src/http/routes.ts:417-456`) probes with a signed GET of `readyz-probe`:
200/404 NoSuchKey pass; 403 = wrong key or token not scoped to the bucket; 404 NoSuchBucket =
wrong bucket; timeout = wrong endpoint. Token setup is in `docs/CLOUDFLARE_PAGES.md:88-128`.
A Worker secret only reaches the container on its next start (next deploy).

## What gets done

### Repo changes (one branch, one PR, merged before the cutover)

1. **Fix `seed-logins.yml` "the region exists" step for a fresh database.** Today it runs a bare
   `INSERT INTO regions` via psql with no role or namespace, which `regions_write` should refuse
   on a non-superuser login. Make it run in a transaction as `ac_gateway` with `ac.namespace`
   set to `system` (mirror how `tools/ops/seed-test-logins.ts:18-20,30-47` binds). CI runs as a
   superuser and would not have caught this; add an integration test that inserts a region as a
   non-superuser login through the same binding if the existing harness allows it cheaply —
   otherwise note why not in the PR.
2. **Docs:**
   - `.claude/skills/deploy/SKILL.md` secrets table: add the four `AC_STORAGE_*` Worker secrets
     and their effect when missing/wrong (the triage line already exists at :51).
   - `docs/CLOUDFLARE_PAGES.md` "The database": add the rule learned here — the owner string must
     be saved in a password manager before it is set anywhere, and a replacement database must be
     a new PlanetScale database so 0002/0012 create and own the roles. State plainly that once
     `grant-logins-role` has run, PlanetScale **cannot reset the owner's password** (2BP01, it has
     granted roles to another login): the password-manager entry is the only copy. Ethan accepted
     this on 2026-11-01 rather than redesigning how AC Logins gets its access.
   - A short runbook section "Replacing the production database" (in `docs/CLOUDFLARE_PAGES.md`
     or the deploy skill — builder's call) capturing the cutover steps below.
   - `docs/history/28_Prod_Database_Replaced.md` handoff record after the cutover (per AGENTS.md).

### Cutover (Ethan + agent, after the PR merges)

Steps marked **[Ethan]** need his dashboard/password-manager access; the agent drives the rest
via `gh` and `wrangler` and reports each result.

1. **[Ethan] Create the new database** — PlanetScale Postgres (from the Cloudflare dashboard or
   PlanetScale directly, same as today), PG16, same region as now (gcp-us-central1) to keep
   latency to the Worker unchanged.
2. **[Ethan] Save the owner connection string in his password manager first**, exactly as
   PlanetScale shows it (ending `sslmode=verify-full&sslrootcert=system`, which
   `services/gateway/src/db/pg-url.ts` handles — do not append `?sslmode=require`). The owner is
   the default role PlanetScale creates with the database (see "Calls I made"). Then `gh secret set DATABASE_URL --env production` (he pastes it;
   it is never echoed into chat or logs).
3. **Verify the login** — run the `db-check` workflow. Expect `current_user` = the new login.
   Before migrating, confirm it can create roles (`rolcreaterole` or superuser; a one-off read
   query via `db-check` output or the PlanetScale console). If it cannot, stop and decide with
   Ethan (PlanetScale role settings) — do not work around it. Also record `rolsuper` /
   `rolbypassrls`: if the owner bypasses RLS, the seed-workflow fix (repo change 1) is hardening
   rather than a cutover blocker, but it still ships.
4. **Deploy** — re-run `guard` on `main` (workflow dispatch). `deploy-gateway` copies the new
   `DATABASE_URL` onto the Worker, migrates 0001 → 0037 + repeatables, runs `--assert`, deploys.
   `/readyz` will still fail on storage until step 6, so this run is expected to go red at the
   final `/readyz` wait **only** for storage; any database error is a stop.
   (Alternatively do step 6 first so the first deploy is fully green — builder's call.)
5. **Re-run `db-check`** — now shows `ac_gateway`/`ac_worker` membership and a regions count.
6. **[Ethan] New R2 token** — Cloudflare dashboard → R2 → API token, Object Read & Write, scoped
   to `ac-media` only. Then set the four Worker secrets with
   `wrangler secret put AC_STORAGE_{ENDPOINT,BUCKET,KEY_ID,SECRET} -c infra/cloudflare/wrangler.jsonc`
   (Ethan pastes the key/secret). Revoke the old R2 token.
   **Empty `ac-media`** (Ethan: "empty the bucket"): its photos are keyed to rows of the old
   database. List and report the object count first, then delete every object (keep the bucket
   itself). Irreversible; do it before seeding so no new photo can be caught in the sweep.
7. **Deploy again** — re-run `guard`. Expect migrate "nothing to do", `/readyz` 200 with database
   and storage OK. Check `wrangler tail` for any `readyz:` lines if not.
8. **Seed** — run `seed-logins` (region `DFW` / Dallas–Fort Worth by default; superadmin box per
   Ethan). Confirm a staff test login can sign in on acservice.systems.
9. **AC Logins app** — Ethan creates a PlanetScale login for the app on the new database, runs
   `grant-logins-role` with it, and replaces the prod connection in the app on each machine. Then
   recreate the first company ("AC Services DFW", Ours, DFW) and real staff logins in the app.
10. **Delete the old PlanetScale database** — only after steps 7–9 are green **and** Ethan
    confirms in chat. Irreversible.
11. **Handoff** — write the `docs/history/` record, open/merge as a small docs PR.

### Local machine (not in the repo)

- Repoint both `ac-logins.desktop` launchers (`~/Desktop`, `~/.local/share/applications`) from
  `~/ac-services-systems/tools/logins-app` to `~/ac-services-systems/external/logins-app` (moved
  in #195), and delete the untracked leftover `tools/logins-app/` (`dist/`, `node_modules/` only).
  Run `npm install` in the new location if needed and check the app starts.

## Calls I made (Ethan to check)

- **Stay on PlanetScale.** Everything is wired for it, and the failure was a lost credential, not
  the provider. Ethan said "stay on planetscale i guess what do you think"; this is my recommendation.
- **Keep the single-login model** instead of the separate low-privilege runtime login I first
  suggested — the repo assumes one login, and the real fix is storing the owner string.
- **Same region (gcp-us-central1)** for the new database.
- **Owner = PlanetScale's default role** for the new database (not a hand-made `pscale_api_*`
  like `k2649`), verified at cutover step 3.
- **Connection string pasted exactly as PlanetScale shows it**, per `docs/CLOUDFLARE_PAGES.md`.
- **Fix the seed workflow in the repo** rather than hand-inserting the region with SQL.
- **Revoke the old R2 token** as part of the swap.
- **Delete the old database last, with explicit confirmation.**

## Left to the builder

- Exact shape of the seed-workflow fix and whether an integration test is cheap enough.
- Where the runbook section lives.
- Whether to set the R2 secrets before the first deploy (one green run) or after (two runs).
