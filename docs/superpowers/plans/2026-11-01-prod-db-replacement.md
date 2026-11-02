# Replace the Production Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move production onto a brand-new, empty PlanetScale Postgres database whose owner string Ethan holds, and get photo storage (`ac-media`) passing `/readyz` again.

**Architecture:** Repo changes first (one PR): region creation moves out of a bare psql INSERT into a TS tool that binds as `ac_gateway` + system, plus docs. Then an operator cutover driven through `gh`/`wrangler`, with Ethan doing the dashboard and password-manager steps. Nothing is copied from the old database or bucket.

**Tech Stack:** Node 24 (TS erasable syntax, relative `.ts` imports), `pg` via `services/gateway/src/db/pg-tx.ts`, node:test, GitHub Actions, wrangler 4, Cloudflare R2, PlanetScale Postgres 16.

**Spec:** `docs/superpowers/specs/2026-11-01-prod-db-replacement-design.md`

## Global Constraints

- Paths are the post-#195 layout: gateway `services/gateway/src/{auth,db,http,handlers}`, AC Logins `external/logins-app/`, scripts in `tools/ci` / `tools/ops`.
- No database driver outside `services/gateway/src/db/pg-tx.ts`; tools use `createPool` / `beginTx` / `bindSystem` from it.
- Never edit a frozen migration; this plan adds none.
- Production workflows run only from `main`; no hand-run migrations against prod.
- Never paste a secret value into a commit, PR, log line or chat. Ethan pastes secrets into `gh secret set` / `wrangler secret put` prompts himself.
- The owner connection string goes into Ethan's password manager **before** anywhere else, exactly as PlanetScale shows it (ending `sslmode=verify-full&sslrootcert=system`). Do not append `?sslmode=require`.
- New database = a new PlanetScale database (own cluster), same region as now (gcp-us-central1), owner = PlanetScale's default role.
- Irreversible steps (empty `ac-media`, delete old database, revoke old R2 token) each need a fresh "yes" from Ethan in chat at the moment they run.
- Before hand-back run and report: `node tools/ci/schema-guard.ts`, `npm run guard:test`, `npm run test:ui`, `pnpm typecheck`, `pnpm guard:lint`, `npm run sdk:check`, `npm run surfaces:check`.

## Review Focus

1. Region code already present → `ensureRegion` returns the existing row unchanged (idempotent re-run of `seed-logins`); pinned in Task 1.
2. Lower-case / padded code input (`" dfw "`) → stored and returned as `DFW`, matching `resolveRegion`'s normalisation; pinned in Task 1.
3. Running as a non-superuser login that only holds `ac_gateway` WITH SET (production's shape) → region is created; pinned in Task 1.
4. New owner lacks CREATEROLE → cutover stops at Task 4 step 3 before any migration runs; checked by an explicit gate, not a test.
5. `/readyz` red after the first deploy → read `wrangler tail` `readyz:` lines and triage (403 key/scope, 404 NoSuchBucket, timeout endpoint) per `.claude/skills/deploy/SKILL.md:51`; a database reason is a stop, never a retry loop.

---

### Task 1: `ensureRegion` tool and test

**Files:**
- Create: `tools/ops/ensure-region.ts`
- Create: `test/integration/ensure-region.test.ts`

**Interfaces:**
- Consumes: `createPool(url, appName)`, `beginTx(pool, "ac_gateway")`, `bindSystem(tx)`, `tx.query`, `tx.commit()`, `tx.rollback()` from `services/gateway/src/db/pg-tx.ts`.
- Produces: `export const ensureRegion = (pool: Pool, code: string, name: string): Promise<{ id: string; code: string; name: string; active: boolean }>` and a CLI: `REGION_CODE=DFW REGION_NAME="Dallas–Fort Worth" DATABASE_URL=… node tools/ops/ensure-region.ts` that prints `code name active` and exits non-zero on error. Task 2 calls the CLI.

- [ ] **Step 1: Write the failing test** `test/integration/ensure-region.test.ts`, skip pattern copied from `readyz.test.ts` (skip when `DATABASE_URL` unset). Use a run-unique code `ER${Date.now().toString(36).toUpperCase()}`. In `before`, as the admin pool, create login `ac_ensure_region_login` (idempotent `DO $$` like `readyz.test.ts:48-53`) with `NOSUPERUSER NOBYPASSRLS`, then `GRANT ac_gateway TO ac_ensure_region_login WITH SET TRUE`. Tests:
  - `"a non-superuser holding ac_gateway creates the region"`: pool on the URL with that login's credentials; `ensureRegion(pool, code, "Ensure Region Test")` resolves with `code === code`, `active === true`; admin `SELECT count(*) FROM regions WHERE code = $1` (admin is superuser in CI) is `1`.
  - `"a second run returns the same row"`: second call with name `"Other Name"` returns the same `id` and the original name `"Ensure Region Test"`.
  - `"the code is trimmed and upper-cased"`: `ensureRegion(pool, \` ${code.toLowerCase()}2 \`, "x")` returns `code === \`${code}2\``.
  - `"a malformed code is refused before touching the database"`: `ensureRegion(pool, "dfw-1", "x")` rejects with `/region code/`.
  In `after`, delete the test regions as admin and `end()` both pools.

- [ ] **Step 2: Run it to verify it fails**

Run: `docker start ac-pg; source ~/.nvm/nvm.sh && nvm use 24 && DATABASE_URL=postgres://postgres:postgres@localhost:5433/ac_dev node --test test/integration/ensure-region.test.ts`
Expected: FAIL — cannot find module `tools/ops/ensure-region.ts`.

- [ ] **Step 3: Implement `ensureRegion` in `tools/ops/ensure-region.ts`**

Normalise `code.trim().toUpperCase()`, refuse anything not matching `/^[A-Z][A-Z0-9_]*$/` with `Error("region code must be upper-case letters/digits/underscore, got '<raw>'")`. In one `beginTx(pool, "ac_gateway")` + `bindSystem(tx)`: `INSERT INTO regions (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`, then `SELECT id, code, name, active FROM regions WHERE code = $1`, commit; rollback on error. CLI block guarded by the `isMain` pattern from `tools/ops/seed-test-logins.ts:103`, reading `DATABASE_URL`, `REGION_CODE`, `REGION_NAME`. Header comment says why: since 0021 `regions_write` admits only the system namespace, and a bare psql INSERT is refused for a non-superuser owner.

- [ ] **Step 4: Run the test to verify it passes**

Run: same command as Step 2.
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tools/ops/ensure-region.ts test/integration/ensure-region.test.ts
git commit -m "Ops: ensure-region creates a region as ac_gateway under the system binding"
```

### Task 2: `seed-logins.yml` uses the tool; docs

**Files:**
- Modify: `.github/workflows/seed-logins.yml` (step "the region exists", ~lines 65-79)
- Modify: `.claude/skills/deploy/SKILL.md` (Secrets table, ~lines 31-39)
- Modify: `docs/CLOUDFLARE_PAGES.md` ("The database", ~lines 42-53)

**Interfaces:**
- Consumes: the `ensure-region.ts` CLI from Task 1 (`REGION_CODE`, `REGION_NAME`, `DATABASE_URL`).
- Produces: nothing code-level; the runbook section "Replacing the production database" that Task 4 follows.

- [ ] **Step 1: Replace the psql heredoc** in "the region exists" with `node tools/ops/ensure-region.ts`, env `DATABASE_URL`, `REGION_CODE: ${{ inputs.region_code }}`, `REGION_NAME: ${{ inputs.region_name }}`. Drop the shell `case` check (the tool validates). Update the header comment only if it mentions psql.

- [ ] **Step 2: Deploy skill secrets table** — add rows for `AC_STORAGE_ENDPOINT`, `AC_STORAGE_BUCKET`, `AC_STORAGE_KEY_ID`, `AC_STORAGE_SECRET` (lives on: Worker; effect when missing: deploy fails by name while S5 is in ROLLOUT; when wrong: `/readyz` 503, see triage at :51; all four or none — a partial set throws at start).

- [ ] **Step 3: `docs/CLOUDFLARE_PAGES.md`** — in "The database" add: save the owner string in a password manager before setting it anywhere; once `grant-logins-role` has run PlanetScale cannot reset that login (2BP01), so that entry is the only copy. Add a section "Replacing the production database" listing the cutover in Task 4 as short numbered steps (new PlanetScale database, not a new DB in the old cluster, because 0002/0012 must create and own the `ac_*` roles; CREATEROLE check via `db-check`; guard; R2; seed; AC Logins; delete old last).

- [ ] **Step 4: Verify**

Run: `node tools/ci/schema-guard.ts && npm run guard:test && pnpm guard:lint && pnpm typecheck && npm run test:ui && npm run sdk:check && npm run surfaces:check`, plus `DATABASE_URL=postgres://postgres:postgres@localhost:5433/ac_dev npm run test:integration`.
Expected: all green; report any that cannot run.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add .github/workflows/seed-logins.yml .claude/skills/deploy/SKILL.md docs/CLOUDFLARE_PAGES.md
git commit -m "Seed: seed-logins creates its region through ensure-region; docs for replacing the prod database"
git push
gh pr create --title "Seed: fresh-database region creation and prod database replacement runbook" --body "<what/why/how verified; link the spec and plan>"
```
Expected: CI green. Ethan merges (agent never merges). Task 4 waits for the merge.

### Task 3: AC Logins launchers (local machine, not in the repo)

**Files:**
- Modify: `~/Desktop/ac-logins.desktop`, `~/.local/share/applications/ac-logins.desktop` (`Exec=` line)
- Delete: `~/ac-services-systems/tools/logins-app/` (untracked: `dist/`, `node_modules/` only — confirm with `git -C ~/ac-services-systems ls-files tools/logins-app` printing nothing before deleting)

- [ ] **Step 1:** Change `tools/logins-app` → `external/logins-app` in both `Exec=` lines.
- [ ] **Step 2:** `cd ~/ac-services-systems/external/logins-app && source ~/.nvm/nvm.sh && nvm use 24 && npm install` (if `node_modules` absent).
- [ ] **Step 3:** Delete the leftover `tools/logins-app/`.
- [ ] **Step 4: Verify:** launch from the app menu entry; the AC Logins window opens against the local `ac_dev` connection. No commit (outside the repo).

### Task 4: Cutover (after the Task 2 PR is merged)

No code. Each step: run it, report the result in chat, stop on anything unexpected. **[Ethan]** marks steps he performs.

- [ ] **Step 1 [Ethan]:** Create a new PlanetScale Postgres 16 database in gcp-us-central1 (via the Cloudflare dashboard as today, or PlanetScale). Save the default role's connection string in the password manager exactly as shown.
- [ ] **Step 2 [Ethan]:** `gh secret set DATABASE_URL --env production -R mellonbot/ac-services-systems` and paste it.
- [ ] **Step 3: Gate.** `gh workflow run db-check.yml --ref main`, then `gh run watch`. Expected: `current_user` = the new role; it is superuser or has CREATEROLE (if `db-check` doesn't print it, Ethan runs `SELECT rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user` in the PlanetScale console). Record `rolbypassrls`. **If no CREATEROLE: stop and decide with Ethan.**
- [ ] **Step 4 [Ethan]:** New R2 API token: Object Read & Write, scoped to `ac-media` only. Then from the repo: `wrangler secret put AC_STORAGE_ENDPOINT -c infra/cloudflare/wrangler.jsonc` (value `https://<account-id>.r2.cloudflarestorage.com`), `AC_STORAGE_BUCKET` (`ac-media`), `AC_STORAGE_KEY_ID`, `AC_STORAGE_SECRET` — Ethan pastes the key and secret.
- [ ] **Step 5: Empty `ac-media`.** List objects and report the count (`wrangler r2 object` / S3 `ListObjectsV2` with the new token); on Ethan's "yes", delete every object, keep the bucket. Re-list: count `0`.
- [ ] **Step 6: Deploy.** `gh workflow run guard.yml --ref main`; watch `deploy-gateway`. Expected: migrate applies 0001 → 0037 + repeatables, `--assert` passes, `/healthz` and `/readyz` 200. If `/readyz` fails, `wrangler tail` and triage per Review Focus 5.
- [ ] **Step 7:** Re-run `db-check`. Expected: membership of `ac_gateway`/`ac_worker`, regions count `1` (only UNASSIGNED until Step 9).
- [ ] **Step 8 [Ethan]:** Revoke the old R2 token in the dashboard (on his "yes").
- [ ] **Step 9: Seed.** `gh workflow run seed-logins.yml --ref main -f region_code=DFW -f region_name="Dallas–Fort Worth" -f superadmin=<Ethan's choice>`. Expected: green; `DFW` created; sign in as `dispatcher-test@ac.test` on acservice.systems succeeds.
- [ ] **Step 10 [Ethan]:** Create a PlanetScale login for AC Logins on the new database; `gh workflow run grant-logins-role.yml --ref main -f login=<name>`; replace the prod connection in AC Logins. Recreate company "AC Services DFW" (Ours, DFW) and real staff logins in the app.
- [ ] **Step 11: Delete the old PlanetScale database** — only after steps 6–10 are green and Ethan says "yes, delete it" in chat.
- [ ] **Step 12: Handoff.** Branch from `origin/main`, write `docs/history/28_Prod_Database_Replaced.md` (what was done, what was verified, `rolbypassrls` result, traps: owner unresettable, roles cluster-wide), open a docs PR. Update the `ac-logins-app` memory: the k2649/ztm0 lockout is resolved, new owner is the default role, password-manager is the only copy.
