---
name: deploy
description: Production for this repository — the gateway container on Cloudflare (api.acservice.systems), the Pages site (acservice.systems), the production database, secrets, the ROLLOUT list, the manual ops workflows (db-check, seed-logins, grant-logins-role, msa-terms-audit, backfill-home-agreements) and the dashboard-only WAF rules. Use when a deploy job is red or skipped, when publishing a surface, rotating a secret, or diagnosing the live site or gateway.
---

# Production

Reference: `docs/CLOUDFLARE_PAGES.md` (authoritative steps), `infra/cloudflare/`,
`.github/workflows/guard.yml` jobs `latest` → `deploy-gateway` → `deploy`. The **babysit**
skill covers getting a PR merged; this covers what happens after, and everything run by hand.

## The shape

```
main push ─ guard (zero-install-guard, full, migrate, drive)
          └ latest            stops if main has moved on (no rollback by re-run)
            └ deploy-gateway  migrate prod DB → wrangler deploy container → /healthz → /readyz
              └ deploy        build:pages with AC_GATEWAY stamped in → Pages publish
```

| Piece | Where it runs | Config |
|---|---|---|
| Gateway + worker | One container (`Dockerfile`, PID 1 `infra/cloudflare/entrypoint.mjs`) behind `infra/cloudflare/worker.mjs` | `infra/cloudflare/wrangler.jsonc` — `AC_SITE`, `AC_ROLLOUT=1`, one `basic` instance |
| Site | Cloudflare Pages, one project, every published surface under its path | GitHub `production` env: `CLOUDFLARE_PAGES_PROJECT`, optional `AC_GATEWAY` |
| Database | PlanetScale Postgres (via Cloudflare) or any PG16 over TLS; string pasted exactly as the provider shows it, owner string kept in a password manager | `DATABASE_URL` in **two** places: Worker secret and GitHub `production` env |

Order matters: the site build stamps the gateway origin into every frame, so the gateway
deploys first. Migrations run against production **before** the new image ships — a
migration must be safe under the old gateway for the minutes between.

## Secrets

| Name | Lives on | Effect when missing |
|---|---|---|
| `DATABASE_URL` | GitHub `production` env | `deploy-gateway` **skips with a notice**; site publishes alone; staff sign-in broken |
| `DATABASE_URL` | Worker | Job copies it from GitHub each deploy; fails by name if it can't |
| `AC_SIGNING_KEY_PEM` | Worker | Job fails by name before building. Rotation = new secret + `AC_SIGNING_KID` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub `production` env | `deploy` errors by name |
| `AC_MAPTILER_KEY` (optional) | Worker | S2 home map says no provider configured |
| `AC_STORAGE_ENDPOINT`, `AC_STORAGE_BUCKET`, `AC_STORAGE_KEY_ID`, `AC_STORAGE_SECRET` | Worker | Missing while a photo-taking surface (S5) is in ROLLOUT: job fails by name. Wrong: `/readyz` 503 "cannot reach its photo storage" (triage below). All four or none — a partial set throws at start |

A Worker secret reaches the container on its next start — i.e. the next deploy.
Never paste a secret value into a commit, PR, log line or chat.

## Diagnosing a red or skipped deploy

| Symptom | Cause | Next step |
|---|---|---|
| `deploy-gateway` skipped, notice about `DATABASE_URL` | GitHub `production` env has no `DATABASE_URL` | Tell the user — a skip is **not** success |
| `/healthz` never answers (5 min) | Container won't start | `npx wrangler@4.148.0 tail -c infra/cloudflare/wrangler.jsonc` |
| `/healthz` ok, `/readyz` 503 "cannot reach its database" | Gateway can't reach Postgres as `ac_gateway` (TLS, wrong login, role grants) | `tail` shows a `readyz:` line; run **Actions → db-check** (uses `pg` exactly as the gateway does — psql turns TLS on by itself, `pg` doesn't) |
| `/healthz` ok, `/readyz` 503 "cannot reach its photo storage" | `AC_STORAGE_*` held but wrong: 403 = key/secret or token not scoped to the bucket; 404 NoSuchBucket = bucket name; timeout = endpoint | `tail` shows a `readyz: storage:` line; re-put the secret per docs/CLOUDFLARE_PAGES.md 'Photo storage' |
| Migrate step fails | Migration not safe on a populated DB | Reproduce the upgrade path (**schema-migration** skill) |
| `latest` stopped | `main` moved on | Correct; the newer run deploys |

Pin wrangler to the version the workflow uses (`4.148.0`) when reproducing.

## Publishing a surface

`ROLLOUT` in `packages/contracts/src/surfaces.ts` (today `S1, S2, S3, S5`) is the whole
switch: it publishes the frame on Pages, lets the production gateway mint sessions for it,
and takes the tape off its plate on S1. Outside `ROLLOUT` a surface is built, tested and
driven but answers `SurfaceNotLive` (404) in production.

Before adding one, confirm in the PR:
- its sign-in path works for real principals (S6/S7/S8 have no production principals —
  `OPEN-S6-IDP`; `seed-logins` only seeds staff);
- **S1:** the two WAF rate-limit rules (`/auth/anonymous`, `/s1/leads`) exist on the zone.
  They are dashboard objects, not files — no diff can prove them. Ask the user.

## Manual workflows (Actions → Run workflow, all against production)

| Workflow | Writes? | Use |
|---|---|---|
| `db-check` | no | Prints what `pg` sees: host, sslmode. First stop for `/readyz` failures |
| `msa-terms-audit` | no | Active MSAs missing a gated term; customers with sites and no MSA. Red = dispatchers will get `no_value` |
| `seed-logins` | yes, idempotent | Fresh DB: a real region + staff test logins (`superadmin` only if ticked) |
| `grant-logins-role` | yes | Lets another PlanetScale login act as `ac_logins` for the desktop app |
| `backfill-home-agreements` | only with `apply` | One-off; dry run lists homes first. Check after with `msa-terms-audit` |

These change production. Run one only when the user asks; dry-run first where it exists,
and report the run's conclusion.

## Restore

Non-negotiable #11: point-in-time restore is exercised on a calendar by a named person,
into a scratch database the integration suite then runs against. Not automated here.
