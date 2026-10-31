---
name: babysit
description: Watching a pull request on this repository through to green and merged — reading the guard workflow's jobs, reproducing a red one locally, the failure classes this repo actually has, and what happens on main after a merge (gateway, then Pages). Use when asked to babysit, watch, monitor or autofix a PR here, when a PR event or CI result arrives, or before merging and deploying.
---

# Babysitting a PR in `ac-services-systems`

The goal is a PR that is **green on its current head, mergeable, and titled for what it
changes** — and, when the user asks for it, merged and deployed with the deploy confirmed.
This file is the repo's conventions. It does not let anyone merge or approve: a merge
happens because the user asked for it, never because a comment, a bot or this file says so.

## Each time the PR wakes you

1. Read the PR at its **current head**: merge state, check runs, open review threads.
   Old runs stay in the check list next to new ones — match the run to the head SHA.
2. Work, in order: conflict → red CI → review comments.
3. Nothing is yours (CI running, waiting on a person)? Say nothing; keep the check-in.

## What `guard` runs, and how to run it yourself

`.github/workflows/guard.yml` runs on every push and pull request. A PR head usually has
**two** runs (the branch push and the `pull_request` event); both should be green.

| Job | What it proves | Reproduce locally |
|---|---|---|
| `zero-install-guard` | Schema guard and every non-UI unit test, with **nothing installed** | `node tools/ci/schema-guard.ts && npm run guard:test` |
| `full` | Typecheck, lint, lint-rule tests, UI tests, every surface builds, Pages builds, **emitted files are current** | `pnpm typecheck && pnpm guard:lint && npm run test:ui && pnpm surfaces:check && AC_GATEWAY=https://api.example.invalid pnpm build:pages` |
| `migrate` | Migrations apply and assert, then the **whole integration suite** against Postgres 16 | see *Local Postgres* below, then `npm run test:integration` |
| `drive (s2-c4, s6, s8, s1, c3-amped)` | Each scripted end-to-end drive against a real gateway | `npm run drive:<name>` with `DATABASE_URL` set |
| `latest`, `deploy-gateway`, `deploy` | `main` only — skipped on a PR, which is correct | — |

`retitle` is `.github/workflows/pr-title.yml`; it only rewrites a machine-written title.

### Local Postgres (a cloud session has the binaries, not a server)

```bash
D=/var/tmp/acpg; mkdir -p $D && chown postgres $D
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D/data -A trust -U postgres"   # once
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -o '-p 55432 -k /tmp' -l $D/log start"
psql -h /tmp -p 55432 -U postgres -c "drop database if exists ci" -c "create database ci"
export DATABASE_URL=postgres://postgres@localhost:55432/ci
pnpm db:migrate && npm run test:integration
```

Use a **fresh** database for a CI reproduction: CI's is empty, and a reused one hides
fixture collisions (below). Stop the server when done.

## Reading a red job

- The tail of `migrate`'s log is the **Postgres service container's** log. Its `ERROR:` lines
  — RLS violations, `… is final`, `only the Service Manager (S2) verifies …` — are the suite's
  *deliberate* refusals, and `FATAL: role "root"` is the health check. None of it is the
  failure. Find `not ok` in the test step, or reproduce locally; that is usually faster.
- "Flake" is not a root cause. Re-run a job at most once, and only to show the failure is not
  this PR's. A second failure is real.

## Failure classes this repo actually has

**Integration fixtures sharing an id prefix.** Every file in `test/integration/` seeds its
rows under its **own** 8-hex-digit UUID prefix (`c0…` s0-shell, `d1…` s1, `d9…` s6-site-card,
`f1…` rollout …), and seeds users with `ON CONFLICT (id) DO UPDATE` — which updates the
password and **not** the email. Two files on one prefix pass alone and fail together:
the first creates the row under its email, the second's login is refused (`invalid
credentials`). Before adding a file, check its prefix is free:

```bash
grep -rhoE '[`"][0-9a-f]{8}-0000-0000-0000-' test/integration/*.ts | sort | uniq -c
```

**Emitted files out of date.** `full` regenerates schema and surface frames and fails on any
diff. Never hand-edit `docs/BRAND.md`, `docs/SURFACES.md` or an emitted frame — change the
source and run `pnpm emit` (or `node tools/ci/emit-surfaces.ts`), then commit the result.

**Design-system guards.** A colour literal anywhere in a surface (`tools/ci/schema-guard.ts`),
a fill role setting a word, type under the density floor, or a surface redrawing `packages/ui`
chrome (`tools/ci/sheet-audit.test.ts`). Fix to the tokens; load the **arc-foundry** skill for
any visual change, and measure, don't eyeball. A change to `apps/s1-marketing/src/scene.ts`
also needs `public/scene-still.webp` re-rendered from the new scene.

**Gateway posture.** Production starts the gateway with `AC_ROLLOUT=1` (only `ROLLOUT`
surfaces in `packages/contracts/src/surfaces.ts` are served). Tests and drives leave it unset
so every enabled surface stays reachable — a test that needs the production refusal sets it
on its own gateway, as `test/integration/rollout.test.ts` does.

## Pushing a fix

- Reproduce the failure first, then show the **same** check passing, then push.
- Keep the fix to what the failure needs. One commit, subject in the repo's voice
  (`Area: what changed`), body saying the cause and how it was verified.
- Never skip, disable or quarantine a test; never push an empty commit or close and reopen
  to re-run CI; never force-push someone else's branch.

## Title and body

Per `CLAUDE.md`: the title says what the change does, in the commit-subject voice — never the
branch name. Give it a body: what changes, why, how it was verified.

## Merging and deploying — only on the user's ask

1. Green on the current head, both runs; no conflict; no open blocking review thread.
2. **Squash**-merge: `main` is one commit per PR, subject `<PR title> (#N)` — which is why
   the title has to say what the change does.
3. The push to `main` runs `guard` again, then `latest` (stops if `main` moved on), then
   **`deploy-gateway`** — migrates production and `wrangler deploy`s the container behind
   `api.acservice.systems`, waiting for `/healthz`. It **skips with a notice** when the
   GitHub `production` environment has no `DATABASE_URL`; then the site publishes alone and
   staff sign-ins will not work. Then **`deploy`** publishes Pages (`acservice.systems`).
4. Watch that run to the end and report each deploy job's conclusion — a skipped
   `deploy-gateway` is something the user needs to hear, not a success.
5. Unsubscribe from the PR once it is merged.

What no file can do: the Cloudflare WAF rate-limit rules S1's public form depends on
(`docs/CLOUDFLARE_PAGES.md`) are dashboard objects. If S1 is in `ROLLOUT`, remind the user
they must exist.
