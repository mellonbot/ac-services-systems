---
name: browser-drive
description: Running, debugging or writing a scripted end-to-end browser drive in this repository (tools/ci/drive-*.ts) — a real gateway, a real built surface, Chrome over CDP and a scratch Postgres database. Use when a drive job is red in CI, when a change touches a flow a drive covers, or when a surface claim can only be proven in a browser (offline queue, form replay, degraded mode).
---

# Browser drives

A drive proves the claims no unit or integration test can: that the **built** surface,
served statically, talks to a **real** gateway over a **real** database, through a **real**
browser. `drive-s1.ts`'s header is the canonical statement — read it before writing one.

## What exists

| npm script | File | Proves |
|---|---|---|
| `drive:s1` | `tools/ci/drive-s1.ts` | Site up before the gateway; queued lead survives reload; replay lands one row |
| `drive:s2-c4` | `drive-s2-c4.ts` | S2 contract/rate flow (C4) |
| `drive:s3` / `drive:s5` | `drive-s3.ts` / `drive-s5.ts` | Dispatch board, technician fallback |
| `drive:s6` / `drive:s8` | `drive-s6.ts` / `drive-s8.ts` | Customer portal, subcontractor portal |
| `drive:c3-amped` | `drive-c3-amped.ts` | C3 acceptance: Amped's fixture authored through the UI |

CI runs each as its own `drive (<name>)` job in `.github/workflows/guard.yml`
(`matrix.surface`). Adding a drive = new file + `package.json` script + matrix entry.

## Run one locally

Start Postgres as in the **babysit** skill (*Local Postgres*), then:

```bash
DATABASE_URL=postgres://postgres@localhost:55432/postgres npm run drive:s3
```

Chromium is preinstalled in cloud sessions; `tools/ci/cdp.ts` `findChrome()` locates it.
Each drive picks random ports, `CREATE`s `ac_driveN_<run>`, runs `pnpm db:migrate` against
it, drives, and `DROP ... WITH (FORCE)`s it in `finally`. Set `AC_DRIVE_DB` to keep a fixed
name while debugging; drop it yourself afterwards.

## Discipline every drive keeps

- **Scratch database, always.** Never point a drive at a shared database; it seeds and drops.
- **Count rows, not messages.** The claim is in the database — assert with SQL, not by
  reading a toast.
- **Order is the test.** S1 starts the site *before* the gateway on purpose. Don't "fix"
  a drive by reordering startup.
- **Numbered checks.** `check(n, what)` / `must(cond, msg)` — the log is the evidence a
  reviewer reads; each line states a claim in plain words.
- **The 09 §3.11 check.** Any form that calls `form.reset()` must assert `value` versus
  `defaultValue` after a submit — that defect cost C4 a silent second rate.
- **Built output.** Each drive runs `build-surface.ts <S>` itself with `AC_GATEWAY` pointed
  at its own gateway, then serves that `dist/`. A build failure surfaces as the drive's
  first `must`, not a separate job.

## Reading a red drive

Find the last `✓` line — the next numbered check is the one that failed, and its `must`
message says why. A timeout on a selector is usually a renamed element or a surface that
flipped degraded (gateway refused with a 500 → check the gateway log the drive prints).
Reproduce locally once; a second identical failure is real, not a flake.
