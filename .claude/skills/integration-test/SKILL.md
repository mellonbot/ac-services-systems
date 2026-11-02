---
name: integration-test
description: Writing or fixing a test in test/integration/ in this repository — the spawned gateway, the shell client, the asBinding RLS probe, per-file UUID prefixes, idempotent seeding, the shared Amped seed, and running the suite against a local Postgres. Use when adding an integration test, when one passes alone but fails in the suite, or when a change needs proof through the gateway and the database's row security.
---

# Integration tests

`npm run test:integration` runs every `test/integration/*.test.ts` **serially**
(`--test-concurrency=1`) against one database (`DATABASE_URL`). Without it each file
registers a skipped test that says what was not verified — never a silent pass.
Local Postgres: the *Local Postgres* block in the **babysit** skill.

## Anatomy (copy from `s2-c4.test.ts`)

1. Header comment: the one sentence the suite holds, and its refusals and admissions.
2. `const U = (n) => \`<prefix>-0000-0000-0000-${String(n).padStart(12, "0")}\`` — every id
   this file creates.
3. `before`: seed with `admin(sql)` (superuser pool), hash passwords with
   `hashPassword`, then `spawn` `services/gateway/src/main.ts` on a random port with
   `AC_SITE: "ac.test"` and wait for it. `after`: kill it, end the pool.
4. Act through the **real client**: `connectShell(...)` from `packages/shell`, then
   `s2.gateway.<sdkMethod>(...)` — the same generated SDK a surface uses.
5. Prove the database line with `asBinding({ "ac.namespace": ..., "ac.org_id": ... }, sql)`:
   `SET LOCAL ROLE ac_gateway` plus the settings, so you see what RLS allows — "by RLS, not by
   a WHERE".
6. Use `RUN = \`<tag>-${Date.now().toString(36)}\`` in names that must be unique across runs.

Test both sides of every rule: the refusal (assert status/`code`, not message text) and the
admission.

## Prefixes — the failure this suite actually has

Each file owns an 8-hex-digit UUID prefix. Users are seeded with
`ON CONFLICT (id) DO UPDATE SET password_hash = ...` — which updates the password and **not the
email**. Two files writing the same user id under different emails pass alone and fail
together (`invalid credentials`), depending on run order.

Map prefixes to files before choosing one:

```bash
grep -oE '[`"][0-9a-f]{8}-0000-0000-0000-' test/integration/*.ts | tr -d '`"' | sort -u \
  | awk -F: '{a[$2]=a[$2]" "$1} END{for(k in a) print k a[k]}' | sort
```

Pick one **no file uses**. Three pairs already share one — `d4` (s3-s5, s4), `d6`
(manager, s6), `d7` (s6-photos, s7). They hold today only because their ids don't overlap
within a table, or are byte-identical rows (s6-photos and s7 both seed `owner.d7@ac.test`
at `d7…01`). Do not add a third file to any of them, and do not add ids to those files
without checking the partner.

`00000000-…` is the reserved tenancy rows (`INTERNAL_ORG_ID` etc.); reference them, never
create under it.

## Shared fixtures

- `test/integration/amped-seed.ts` `seedAmped(admin, authoredBy)` — Amped Fitness, three
  regions, its account tree, MSA, amendments and term overrides, via the real admission
  trigger. Idempotent (`ON CONFLICT DO NOTHING`), so any file may call it first or alone.
  Read it; never write rows under Amped's ids in your own file.
- Region ids come from `packages/domain/src/inheritance/fixtures/amped.ts`.

## Rules

- **Idempotent seeds.** CI's database is fresh, but locally you'll re-run on a dirty one.
  Every seed `ON CONFLICT`; every created name carries `RUN`.
- **No order dependence.** A file must pass alone (`node --test test/integration/<f>.test.ts`)
  and in the full suite on a **fresh** database — run both before pushing.
- **Production posture.** Leave `AC_ROLLOUT` unset so every enabled surface is reachable; a
  test that needs the production refusal sets it on its own gateway (`rollout.test.ts`).
- **Postgres log noise.** `ERROR:` lines in the server log are usually the suite's deliberate
  refusals. Find `not ok` in the test output.
- Never skip or weaken an assertion to get green; find which file wrote the row.
