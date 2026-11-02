# 31 — A technician's job has four states; "wrap up" is gone

**Date:** 2026-11-02 · **Branch:** `claude/vigilant-planck-dxqw8n`

## What was done

The field walked five steps: assigned → en route → on site → in progress → wrap up.
It is now four: **assigned → en route → in progress → completed**.

- `packages/domain/src/sync` (and its S5 mirror `apps/s5-technician/src/offline.ts`):
  `en_route → in_progress` directly; `on_site` removed from `DEVICE_TRANSITIONS`. A
  device can no longer move a job on site. `on_site` stays in `JOB_STATES` and in
  `JOB_TRANSITIONS` as a legacy state so jobs already there still move forward, and
  the office's close-out from it is unchanged.
- S5: the card's forward move from en route is "Start work"; "Wrap up" is
  "Complete job" everywhere, the route is `/jobs/:jobId/complete`, the refusal pill
  reads "completion refused", the waiting notice "Completed — waiting to be sent".
- S3: the job-detail panel is "Completion"; the manager waits read "Scheduled to in
  progress" / "In progress to finished".
- Gateway: the manager wait's arrival is the first `on_site` **or** `in_progress`
  event (new jobs never emit `on_site`). The refusal for a job not in progress says
  "only a job in progress can be completed"; the sync rejection of a bare
  `complete` names the completion report.

## Not renamed, deliberately

`jobs.wrapUp`, `/s5/jobs/wrap-up`, `job_wrap_ups`, the `WrapUp*` wire types and
the device's `ac.s5.wrapups.*` storage key. They are not user-facing; renaming them
is a migration plus an API break that would strand completions already queued
offline on devices. DOM ids (`submit-wrap-up`, …) are unchanged for the same
test/drive stability reason.

## Verified

schema-guard, guard:test (520), test:ui (335), typecheck, guard:lint, sdk:check,
surfaces:check all green. Integration tests (`backbone`, `s3-s5`) and
`tools/drive/drive-s5.ts` were updated for the four-state walk but **not run** here —
no `DATABASE_URL` in this session.

## Trap

A device still holding a queued `on_site` move from before this deploy gets it
rejected (shown as an attention item); the tech taps "Start work" instead.
