# S1 → S5 with no network: offline shift entry

**Date:** 2026-11-02 · **Status:** proposed, awaiting OK · **Branch:** `s1-offline-shift-entry`

## Problem

A technician opens the tablet with no signal. They should reach their S5 job list
and keep working (S5 already queues every write, `apps/s5-technician/src/offline.ts`).
Today they cannot, for three separate reasons:

| # | Where | What depends on the network |
|---|-------|-----------------------------|
| 1 | The site itself | Nothing caches the pages. There is no service worker anywhere in the repo; `_headers` sets `bundle.js`/`ui.css` to `no-cache`, so a reload with no network gets the browser's own offline error before any of our code runs — for S1 *and* S5. |
| 2 | S1 (`apps/s1-front-door/src/app.ts`) | S1 renders with no gateway call (registry `degraded`), but the only way out of it is `auth.signIn`. S1 cannot see the session cookie (httpOnly), so it cannot know this device already holds a shift. |
| 3 | S5 boot (`app.ts` `resume()`) | `connectShell({ session: "cookie" })` → `session.me`. Offline that throws, and `resume()` falls through to S5's own login form. Even once in, `jobs.mine` and `punches.mine` live only in the in-memory resource store, so nothing is on screen and the shift clock gate reads "unknown". |

## Rules this keeps

- **Never a new sign-in offline.** The only way to an offline S5 is a session the gateway
  already confirmed (`session.me` answered `namespace: "device"` with a `deviceCrew`) on this device.
- **Layering.** No `fetch` in a surface. The cached-context shell is built in `packages/shell`;
  the service worker is a build artefact emitted by `tools/ci`, not surface code, and it never
  touches the gateway origin.
- **S1 writes nothing** (`writes: []`). S1 only *reads* the held-shift record; S5 writes and clears it.
- **Server holds truth.** Offline S5 shows the last answer it had, stamped with its age (the existing
  freshness line); every tap is a queued mutation the gateway judges on replay.
- **Don't widen the shift-session persistence decision** (see "Interaction" below).

## Design

### A. The held shift — `packages/shell/src/held-shift.ts`

One localStorage record, `ac.shift.held`, written by S5 only:

```ts
type HeldShift = {
  principal: Principal;            // from session.me
  context: HierarchyContext;       // from session.me (includes deviceCrew)
  endsAt: string;                  // the session's own expiry — same instant the cookie expires
};
heldShift(store, now): HeldShift | null   // null if absent, malformed, not a device principal, or endsAt <= now
holdShift(store, connected): void         // S5, after an ONLINE session.me with a device principal + crew
forgetShift(store): void                  // S5: logout, a token refusal, or an expired record
resumeHeldShift(cfg, held): ConnectedShell // S5: a shell built from the held context with the live cookie
                                          // transport — degraded until the gateway answers; no session.me
```

`endsAt` needs the gateway: `session.me` gains `deviceShiftEndsAt` (ISO string) for a device
principal only, read from `sessions.expires_at` for the caller's session — the instant the cookie
dies. Optional field on `HierarchyContext` beside `deviceCrew`; no new operation, no new admission.
SDK regenerated if its emitted types change.

### B. S5 boot (`apps/s5-technician/src/app.ts`)

`resume()` becomes:

1. Try `connect({ session: "cookie" })` as today. On a device session with a crew → `holdShift`, enter.
2. Got an answer that is **not** a transport failure (no cookie, staff cookie, expired, revoked) →
   `forgetShift`, show S5's login as today.
3. **Transport failure** (gateway unreachable) → `heldShift(store, now)`. If present → enter with
   `resumeHeldShift`, the degraded notice showing; otherwise S5's login with a clear refusal:
   *"No signal, and this device holds no shift to open offline. Sign in when you are back in signal."*
   The form stays, but a submit with no network is the existing transport refusal — nothing new.

`logout()` and the existing token-refusal path in `tick()` call `forgetShift`. Queued work is untouched
(still keyed by device + technician, as today).

**Cached reads.** `createResourceStore` gains an optional `held` seed (key → last value) and an
`onAnswer(key, value)` hook; S5 persists the answers for `jobs.mine` and `punches.mine` under
`ac.s5.reads.<deviceId>.<subjectId>` and seeds the store from it. The store already keeps the held
value on screen when a refetch hits a transport failure, so job list, job detail, wrap-up and the
clock gate all work from it. S1/S2/S3/S6 pass nothing and behave exactly as now.

### C. S1 (`apps/s1-front-door/src/app.ts`)

S1 reads `heldShift(localStorage, now)` and `navigator.onLine` at boot and on `online`/`offline` events:

| Network | Held shift | S1 does |
|---------|-----------|---------|
| offline | yes | `go("/technician/")` — S5 opens it from cache |
| offline | no | the form is replaced by a refusal: *"No signal. Signing in needs a connection, and this device holds no shift to open offline."* No spinner, no submit. Comes back when `online` fires. |
| online | either | unchanged — the form. If a sign-in then fails with a transport refusal (signal bars but no route, a dead zone) and a shift is held, the refusal adds one link: *"Open the shift saved on this device"* → `/technician/`. |

Online behaviour with a held shift is deliberately unchanged: S1 does not auto-forward a connected
device into the previous holder's shift (that would widen the open decision below).

### D. The service worker — emitted by `tools/ci/build-pages.ts` as `/sw.js`

- Precaches the built files of **S1 and S5 only** (`index.html`, `bundle.js`, `ui.css`, `chunks/*`,
  fonts, icons, S1's `public/` — all small, ~450 KB) under a cache named by a hash of the file list +
  contents, so every deploy is a new cache and the old one is deleted on `activate`.
- Navigations and the no-cache files: **network first**, cache on failure — a deploy still rolls out
  immediately when online. `chunks/*` and fonts: cache first (content-hashed / immutable).
- Same-origin GETs under `/` and `/technician/` only. Never the gateway origin, never a non-GET,
  never another surface's path — S2/S3/S4/S6/S8 stay network-only.
- Registered from both S1 and S5 through one `registerOfflineShell(window)` in `packages/ui`
  (the browser-API boundary that already owns favicon/degraded-slot code). A failed or unsupported
  registration is silent: the site works exactly as today.
- `_headers`: `/sw.js` gets `Cache-Control: no-cache`.

The `tools/drive` site server and `build-surface` dev builds get the same file so the drive tests what ships.

## Interaction with the open shift-session persistence decision

`ac.shift.held` lives exactly as long as the cookie it mirrors — same `endsAt`, cleared on the same
sign-out and on the same token refusal — so it does not extend the shift session in time. Two things
it does change, for the PR to state plainly:

1. **Revocation is not seen offline.** If the office revokes the grant while the tablet is offline,
   the tablet still opens the shift from cache until `endsAt`. Nothing it does lands: replay meets a
   `token` refusal, S5 returns to sign-in, the queue stays on the device for that technician.
2. **On a shared browser, offline, S1 forwards whoever holds the tablet into the held shift.** Online,
   the same person could already open `/technician/` and resume by cookie, so exposure is the same
   session over a new path, not a longer one. If the decision lands on "a shift ends when the tab
   closes", `forgetShift` on `pagehide` is the one-line change that follows it here too.

## Tests

- `packages/shell/src/held-shift.test.ts` — hold/read/forget; expired, malformed, staff-principal,
  and blocked-storage records read as null; `resumeHeldShift` builds a degraded device shell with the held crew.
- `packages/ui/src/resource-store.test.ts` — seed shows on first read; `onAnswer` fires on answers only.
- `apps/s5-technician/src/app.test.ts` — transport failure + held shift → ready with cached jobs;
  transport failure + none → login with the offline refusal; a non-transport answer forgets the shift;
  logout and token refusal forget it.
- `apps/s1-front-door/src/app.test.ts` — the four rows of the table in C.
- `tools/ci/build-pages.test.ts` — `sw.js` lists S1 + S5 files only, no gateway origin, `_headers` row.
- `services/gateway` — `session.me` answers `deviceShiftEndsAt` for a device session, absent for staff
  (`test/integration/s1.test.ts`).
- **Drive** (`tools/drive/drive-s1.ts`, new steps): build S1 + S5 + `sw.js` into one site; tech signs in
  at S1 with a hardware ID → S5 job list; then cut the network (CDP offline emulation **and** stop
  both the site server and the gateway); reload `/` → lands on `/technician/` with the job on screen
  and the degraded notice; queue a move offline. Fresh browser profile, network cut → `/` shows the
  offline refusal, no spinner, no form submit.

## Out of scope

- S5's own bearer-session login (hardware ID typed into S5) is not held: it is bearer-in-memory by
  design and remains the online fallback.
- No offline for any other surface.
