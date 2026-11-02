# 33 — A technician gets from the front door to S5 with no network

**Date:** 2026-11-02 · **PR:** #210 · **Builds on:** #209 (`shift-session-ends-with-tab`)
**Spec:** `docs/superpowers/specs/2026-11-02-s1-offline-shift-entry-design.md`

## What was done

A technician who opened the tablet with no signal was stuck: nothing cached the pages, S1's only
way out was `auth.signIn`, and S5's boot needed `session.me`. Now:

- **`/sw.js`** (`tools/ci/offline-shell.ts`, written by `build-pages.ts`) keeps every built file of
  S1 and S5, and nothing else, in a cache named for their contents. Network first, the cache only when
  the network fails; same-origin GETs under `/` and `/technician/` only. Registered from both surfaces
  by `registerOfflineShell` (`packages/ui`). `_headers` gives it `no-cache`.
- **`session.me`** answers `deviceShiftEndsAt` for a device session (the token's `exp`, the cookie's end).
- **The held shift** (`packages/shell`: `heldShift`/`holdShift`/`forgetShift`/`resumeHeldShift`): when
  S5 resumes a front-door shift online, in a tab #209 marked, it keeps that `session.me` answer in the
  tab's sessionStorage. It is only ever written from a gateway answer — no sign-in is accepted offline.
- **S5**: `resume()` with no answer at all opens the held shift (cookie transport, no `session.me`), with
  the last `jobs.mine`/`punches.mine` answers kept in the same tab; a tab holding nothing gets
  "No signal, and this tab holds no shift to open offline". Any real answer, sign-out or token refusal
  forgets the held shift and its reads. The offline queue stays in localStorage, as before.
- **S1**: with `navigator.onLine` false it offers no form. A tab holding a shift goes on to `/technician/`;
  any other gets a plain refusal. Online is unchanged, except a sign-in that cannot get through in a
  tab holding a shift offers "Open the shift saved in this tab".
- `RefusalNotice` takes an optional `message` for when the surface has better words than the kind's.

## Verified

`schema-guard`, `guard:test` (526), `test:ui` (351), `typecheck`, `guard:lint`, `sdk:check`,
`surfaces:check` green. `test:integration` 300/300 against a local postgres:18 (s1.test.ts asserts
`deviceShiftEndsAt`). `drive-s1.ts` 11/11 in Chrome — new steps 9–11: sign in on a field device and reach
Today; cut the network (CDP offline **and** site and gateway stopped), reload `/` in the same tab → S5's job
list from cache, Clock in queued; a new tab offline → "No signal", no form, no spinner. `drive-s5.ts` 9/9.

## Left

- **Revocation is not seen offline.** A grant revoked while the tablet is offline still opens from the
  tab until `deviceShiftEndsAt` or the tab closes. Nothing done there lands: replay meets a `token`
  refusal, S5 returns to sign-in, the queue stays for that technician.
- Offline, the degraded line reads "Not connected yet this session": the held reads carry no
  `lastOkAt`. Stamping them with when they were answered would let it say how old the list is.
- Network-first means a network that hangs (rather than failing) holds the page until the browser
  gives up. No timeout was added.
- S5's own bearer login (hardware ID typed into S5) is not held; it stays the online fallback.

## Trap

`main.ts` in every app is generated — `resumeHeldShift` is called from `apps/s5-technician/src/app.ts`
directly for that reason. S5's router moves `/technician/` to `/technician/jobs` on entry, so a drive
waiting on the exact path never sees it.
