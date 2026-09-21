# 23 — Item 8 re-run on a second machine; two CI jobs were red and nobody knew

**Date:** 2026-09-21
**Reads as:** the execution half of `claude/22_S1_Marketing_Built.md`, which
recorded item 8 as built and proven. This doc records the first time anything
in it ran anywhere but the sandbox that wrote it.

---

## 1. Item 8 was not in git

`claude/22` closes by listing what was shipped. None of it was tracked. Read
from `.git/index` on the build machine: **293 entries**, and the only
`apps/s1-marketing` files among them are the five generated placeholders. Not
tracked: `0008_anonymous_intake.sql`, `tools/ci/drive-s1.ts`,
`test/integration/s1.test.ts`, `claude/22`, the seven hand-written app sources
and the three screens, and the modifications to `0001_bootstrap.sql`,
`package.json`, `emit-surfaces.ts`, `contracts/src/scope.ts` and the rest.

The cause is visible in the reflog: `157b0bb`, *"Tokens: measure the published
figures, and gate the ramp in greyscale"*, was committed with a selective
`git add`. It took `packages/tokens/src/figures.ts` and
`figures.test.ts` and left item 8 in the working tree. `apply-item-8.sh`, which
does `git add -A` and would have caught all of it, was written the same evening
and never run — there is no `item-8-s1-marketing` branch. Local `main` is also
one commit ahead of `origin/main` and unpushed.

This is the **merge-gap finding from `17` a second time**, one turn worse: C4
sat on an unmerged branch; item 8 sat on no branch at all, one `git clean -fd`
from gone.

## 2. Re-run from a clean checkout, on a different machine

The tree was staged file-by-file off the build machine into a sandbox with
PostgreSQL 16 and Chromium, `pnpm install --frozen-lockfile`, fresh cluster,
fresh database. Everything below is what that run printed.

| Gate | Result |
|---|---|
| `guard:schema` | **red** — see §3 |
| `guard:test` (zero-install) | 288 pass |
| `typecheck` | clean |
| `guard:lint` | **red** — see §3 |
| `test:ui` (rendered) | 121 pass |
| `build-surface --all --minify` | 6 surfaces; S1 96.7 KB (33.5 KB gzip), 49 modules |
| `emit-sdk --check`, `emit-surfaces --check` | current |
| `migrate` 0001→0008, `--assert`, second run | applied, region_id total, *nothing to do* |
| `test:integration` | **129 pass** |
| `drive-s1` | **12/12** |
| `drive-s2-c4` / `drive-s6` / `drive-s8` | 13/13, 12/12, 11/11 against 0008 |

**Item 8's own claims reproduce exactly.** The wire suite and the browser drive
pass on a machine that did not build them, which is the only version of that
sentence worth writing down. The timezone regression from `22` §5 passes on a
cluster that is not UTC, as designed.

## 3. Two jobs would have failed CI, and both are in the committed work

Neither is item 8's. Both are in `157b0bb`, which is why nobody saw them: it was
never pushed, so CI never ran on it.

**`guard:schema` — the generator and its artifact disagreed.** `docs/BRAND.md`
is generated from `renderBrandDoc()` in `emit-surfaces.ts`. The figure
correction updated the *artifact* — 0.55° and 34.78° — by hand, and left two
literals in the *generator* saying 1.2° and 34.8°. `figures.test.ts` could not
see it: it reads `docs/BRAND.md` and asserts the corrected values are quoted,
which they were. The emitter now cites `FIGURES.redFromFault.measured` and
`FIGURES.faultToWarning.measured` directly, so the two files cannot part
company again. This is `22`'s own thesis applied one layer out: *a figure that
is not in the table is a figure nobody is checking* — including a figure inside
the thing that writes the table's readers.

**`guard:lint` — `figures.test.ts` imports `node:fs`.** `ac/no-storage-bypass`
bars it outside `packages/storage` and `tools/`. The test reads `docs/BRAND.md`
and `brand.ts` to prove the prose quotes the measurement, which is the same
category as build tooling reading the repo. Exempted in `eslint.config.js`,
scoped to `packages/tokens/**/*.test.ts` rather than to tests in general —
a surface test reaching for `node:fs` is exactly what the rule exists to catch.

## 4. `drive:s1` in CI — the one edit that has to be made by hand

`.github/workflows/guard.yml` is a protected path: a workflow file cannot be
written to this machine by a remote tool, which is the right restriction and
is why `apply-item-8.sh` always said to do this one by hand. The step, after
`drive:s8`:

```yaml
      - name: S1 through a real browser
        run: npm run drive:s1
```
 Two of item 8's mechanisms cannot be checked anywhere else:
the durable buffer surviving a reload, and the copy ceiling measured against
the **painted** page, so a promise arriving through a stylesheet fails too.

## 5. Consequences

- **Item 8 is built, executed on a second machine, and still uncommitted.**
  The remaining step is `apply-item-8.sh`, which now also carries §3's two
  fixes and the CI step. Its branch's parent is the unpushed `157b0bb`, so the
  pull request will show two commits and should be reviewed as two changes.
- **The risk-register row grows a fifth instance, with a new shape.** The first
  four were *a mechanism recorded as built that had never run* — `createShell`,
  `deviceLogin`, 0006's insert check, the worker's sweeps. This one is
  *a mechanism that runs, proven, and is not in the repository.* The wire suite
  as the definition of done does not catch it. **The definition of done needs a
  second clause: on a branch, pushed.**
- **Nothing in the plan moves.** S1 was off the critical path and remains so.
  `OPEN-S1-ABUSE` still gates putting S1 on a public domain.
