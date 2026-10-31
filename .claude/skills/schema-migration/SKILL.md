---
name: schema-migration
description: Changing the Postgres schema in this repository — a new table, column, policy, grant, trigger or refusal. Covers the two sources of truth (packages/schema/src/tables and packages/schema/migrations), frozen migrations, region_id totality, row security, narrow grants, regenerating 0001_bootstrap, and proving it against a fresh database. Use before writing or editing any .sql file under packages/schema, or any table definition.
---

# Changing the schema

The database is where this repo's invariants are *held*, not described: tenancy is RLS,
"S2 authors truth" is a policy, a refused write is a trigger with a stable code. A schema
change is therefore a change to the rules, and it is reviewed as one.

## The two sources, and how they agree

| Source | Role | Who checks it |
|---|---|---|
| `packages/schema/src/tables/*.ts` (`operationalTable(...)`, listed in `tables/index.ts`) | The **definition** of every table. Emits `0001_bootstrap.sql`. | `schema-guard` §1 (region_id total), §3 (bootstrap not drifted) |
| `packages/schema/migrations/NNNN_*.sql` | What an **existing** database runs to reach the definition. | `migrate.ts` (checksums), `migrate.ts --assert` (live schema) |
| `packages/schema/migrations/repeatable/R_*.sql` | Reference data re-applied on every run (`R_service_codes`, `R_term_registry`). | re-run each migrate |

A new table goes in **both**: the TS definition (so a fresh database gets it from the
bootstrap) and a numbered migration with `CREATE TABLE IF NOT EXISTS` (so production gets
it). `0035_staff_messages.sql` + `tables/identity.ts` is the reference pair.

## Rules that fail CI if broken

1. **Applied migrations are frozen.** `migrate.ts` stores a sha256 per file and refuses an
   edited one (`applied migration(s) edited since they ran`). Only `0001_bootstrap` is
   regenerated. To change a function or policy, `CREATE OR REPLACE` / `DROP POLICY IF EXISTS`
   + `CREATE POLICY` in a **new** file (see `0037_customer_own_contacts.sql`).
2. **Next number.** Take `max + 1` from `ls packages/schema/migrations`. Two files already
   share 0027 and 0030 — files apply in lexical order, so a collision is legal but makes order
   depend on the slug. Don't add another.
3. **region_id is total.** Every `operational` table has a non-null `region_id`. Exceptions
   live in two allowlists that must match: `TENANCY_ROOT_TABLES` / `GLOBAL_REFERENCE_TABLES`
   in `packages/schema/src/tenancy.ts` and the **latest** `ac_assert_region_id_everywhere()`
   definition in SQL. Changing one means a new migration redefining the other.
4. **Every table behind row security, FORCEd, with at least one policy.** `ENABLE` and
   `FORCE ROW LEVEL SECURITY`, then policies. `--assert` checks the live schema.
5. **Narrow grants.** `0002` grants broadly on a fresh database; a new table then gets
   `REVOKE ALL ... FROM ac_gateway, ac_worker, ac_readonly` and back only what the handler
   needs — column-level `UPDATE (col)` where only one column ever changes.
6. **Refusals carry a code.** A trigger raising `AC422`/`AC403`, or a named constraint, is
   what `apps/gateway/src/refusals.ts` turns into a 422/403 with a stable `code`. Name
   constraints deliberately — the name is the wire code. Write messages for a dispatcher.
7. **Header comment.** Open the file with the boxed `-- 00NN — WHAT CHANGES.` block: the
   decision, who can now do what, and what was *not* widened. Close any `OPEN-*` it settles
   in `docs/OPEN_DECISIONS.md` in the same change.

## Steps

```bash
# 1. definition (if a table/column), then regenerate the bootstrap
node tools/ci/emit-schema.ts
# 2. write packages/schema/migrations/00NN_<what_it_does>.sql
# 3. zero-install guard
node tools/ci/schema-guard.ts
```

Then prove it on a **fresh** database *and* on one migrated from `main` (the production path):
start Postgres per the *Local Postgres* block in the **babysit** skill, then

```bash
pnpm db:migrate && pnpm db:assert && npm run test:integration
```

For the upgrade path: `git stash`, migrate a new database on `main`'s files, `git stash pop`,
migrate again. Both must end identical — a migration that only works from empty fails on deploy
(`deploy-gateway` migrates production before it ships).

Write the integration test for the new rule — the refusal as well as the allowed write —
under a **free** UUID prefix (check with the grep in the babysit skill).

## Done means

`schema-guard` green, migrate + assert clean from empty and from `main`, integration suite
green, `pnpm emit` leaves no diff, and the PR body states the rule in one sentence.
