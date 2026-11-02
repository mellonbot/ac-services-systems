# 28 — S1 becomes the front door

**Date:** 2026-11-01 · **PR:** #194 · **Branch:** `s1-front-door`

## What was done

S1 was "Marketing / lead-gen" (item 8, `22_S1_Marketing_Built.md`). The partners
said it was never meant to be that: S1 is the page everyone starts at, and it sorts
each person into the surface they belong to. So:

- `auth.signIn` (`POST /auth/sign-in`, S1 only): one credential check, then the
  gateway answers `signed_in` (the one live surface the login opens; that surface's
  session is set as the cookie) or `choose` (several; no session until the pick), or
  routes to S5 when a `hardwareId` is given. It shares `checkedUser` / `refusalFor` /
  `mintUserSession` / `mintDeviceSession` with `auth.login` and `auth.deviceLogin`
  (`services/gateway/src/auth/auth-routes.ts`), so it can never offer a surface the
  door behind it would refuse. The cookie is set only after the commit.
- S1 writes nothing (`writes: []`). Removed: `leads.submit`, `callRecords.record`,
  `coverage.list`, `auth.anonymousSession`, S1's lead buffer. `leads`, its rows and
  S2's Follow-ups stay. `apps/s1-marketing` → `apps/s1-front-door`.
- S5 resumes a device session S1 minted, by cookie; `session.me` answers `deviceCrew`.

## Verified

Unit, guard, UI, lint, SDK and surface checks green; `test/integration/s1.test.ts`
(9), `rollout.test.ts`, `gateway-hardening.test.ts`; `tools/drive/drive-s1.ts` 8/8 in
Chromium. An independent review of the auth change found three issues, all fixed.

## Left

- **Edge limit:** `POST /auth/sign-in`, 30/min per IP — `SIGN_IN_LIMIT` in `infra/cloudflare/wrangler.jsonc`, applied in `worker.mjs` (was a zone WAF rule; moved into the repo 2026-11-02, `docs/CLOUDFLARE_PAGES.md`).
  The old `/auth/anonymous` and `/s1/leads` WAF rules guard routes that no longer exist.
- **Decision:** S5 now keeps a front-door shift session across a reload until the
  shift ends. On a shared browser, closing the tab without signing out leaves the
  next person in it.
- Portals keep their own sign-in pages for bookmarks; redirecting them to `/` is open.

## Trap

`manager.test.ts` "on site → finished: 1.0417 ≠ 1" failed on 2026-11-01 on unchanged
`main` too — date-dependent (the day DST ended), not this change.
