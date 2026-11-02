# AC Logins — a desktop app for the `users` table

**2026-10-20 · Design · Owner: Ethan M.**

## Why

Logins today are made by SQL in tests or by `tools/ci/seed-test-logins.ts`.
There is no operation for provisioning a principal yet (OPEN_DECISIONS, the
item-6 note), so seeing who can sign in where, adding someone, resetting a
password or switching a login off means a psql session against production.
Ethan wants a window instead: pick a kind of login, see the active ones, act on
them, and have the change live the moment it is made — no deploy.

## Who and where

- One user: Ethan, on his own Linux desktop. No sharing, no multi-user, no
  hosted version.
- It works against the **live production database** (PlanetScale Postgres),
  and the local `ac_dev` (docker `ac-pg`, :5433). A switch in the header picks
  which one is shown.

## What it looks like (chosen: layout A, sidebar)

- Header: app name, and the database switch (Production / Local). When
  Production is selected the header says so unmistakably (colour + label).
- Left sidebar: one entry per **kind of login**, each with a count of active
  logins. Clicking one fills the right pane.
- Right pane: a table of that kind's active logins — email, display name, and
  the columns that matter for the kind (below) — with **+ Add login** above it
  and **Reset password / Edit / Remove** on each row. A **Show inactive**
  toggle lists switched-off logins with a **Reactivate** button.

### The kinds (sidebar entries)

Derived from `SURFACES` in `packages/contracts/src/surfaces.ts` — not a second
hand-written list — so a new surface or role appears without editing the app.
Only surfaces that sign people in from the `users` table appear:

| Entry | Surface | Who is listed | Extra columns |
|---|---|---|---|
| Service Manager | S2 | `namespace='internal'` whose roles meet S2's `roles` | roles, org-wide/region |
| Dispatch | S3 | internal, roles meet S3's | roles, region |
| HQ Dashboard | S4 | internal, roles meet S4's | roles |
| Technician | S5 | any user with a `crew_id` (the tech credential half of `auth.deviceLogin`, which checks only `crew_id`, `active` and the password) | crew, employed/subcontracted |
| Customer Portal | S6 | `namespace='customer'` | customer org, what they see (whole company / region / location / site — the scope node's name) |
| Subcontractor | S8 | `namespace='subcontractor'` | firm |
| Vendor Portal | S7 | `namespace='vendor'` | — (S7 is `enabled: false`; **list only**, labelled "not live yet": no Add, since the gateway has never accepted a vendor row shape) |
| Other | — | active users that fall under none of the above (e.g. internal with no matching role and no crew) | namespace, roles |

S1 (anonymous) has no logins and does not appear. A login admitted to several
surfaces (superadmin-test: S2, S3, S4) appears under each. Membership for
S2/S3/S4/S6/S7/S8 is `admits()` / `surfacesAdmitting()` from the registry, the
same functions the gateway uses. S5 is the exception: its namespace is
`device`, so `admits()` never matches a person; Technician membership is the
`crew_id` rule above, mirroring `deviceLogin`. "Other" exists so that a login
Edit has moved out of every kind can still be found and fixed.

## What each button does

All writes go straight to the database in one transaction, as `ac_gateway`
unbound — exactly as `seed-test-logins.ts` and the gateway's own login do
(`users` and `sessions` admit an unbound writer; checked against 0007/0008).
The gateway reads `users` at sign-in, so a change is live on the next sign-in
with nothing deployed.

**Picker reads** (crews, subcontractor firms, a customer's account tree) are
done as `ac_gateway` in a read-only transaction bound as an internal org-wide
principal (`ac.namespace=internal`, `ac.scope_tier=parent`,
`ac.org_id=ac.scope_id=INTERNAL_ORG_ID`) — the view S2 has. Unbound, RLS
returns no rows on `crews` (0006), `subcontractor_firms` (0005) and `accounts`
(0007). `organizations`, `regions` and `users` are read unbound.

**Revoking a login's sessions** means both kinds: `sessions` where
`principal_kind='user' AND principal_id = <user id>`, and, for technicians,
`principal_kind='device_grant' AND principal_id IN (SELECT id FROM
device_grants WHERE technician_id = <user id>)` — `deviceLogin` keys the
session on the grant, not the user. Device grants themselves are not touched.

- **+ Add login** — a form for that kind: email, display name, password, and
  what the kind needs:
  - internal (S2/S3/S4): roles (checkboxes from `ROLES`), and org-wide or one
    region (region picker). Org-wide → `org_id = scope_id = INTERNAL_ORG_ID`,
    `scope_tier='parent'`; region → `scope_tier='region'`, `scope_id` = the
    region. Same shape as `testLoginRow`. Every internal login also gets a
    **home region** (`users.region_id`, the token's region claim) from a region
    picker, preselected when there is only one active region; for a
    region-scoped login it is that region.
  - Technician: as internal with role `technician`, plus a crew picker
    (`crew_id`) offering **employed crews only** in v1; home region = the
    crew's home region. Subcontracted technicians already in the table are
    listed and can be reset/removed, but not added here (their row shape —
    subcontractor namespace + firm — has no test yet).
  - Customer: a customer org picker, then how much they see — whole company
    (`parent`, `scope_id` = org) or a node in its account tree (region /
    location / site node → that tier and that node's id). `region_id` = the
    node's region; for whole-company, a picker over the regions the org has a
    region node in, preselected when there is one.
  - Subcontractor: a firm picker → `org_id = scope_id = firm_id` = the firm's
    org, `scope_tier='parent'`, as in `test/integration/s8.test.ts`.
  - Password: hashed with `hashPassword` from `apps/gateway/src/auth.ts`;
    minimum length `MIN_TEST_LOGIN_PASSWORD` (12).
  - An email that already exists is refused with a plain message, not upserted.
- **Reset password** — enter a new one (twice); the hash is replaced and the
  login's open sessions are revoked (`sessions.revoked_at = now()`), so the old
  password stops working everywhere at once.
- **Edit** — display name, roles (internal), region/scope, crew (technician).
  Email is shown but not editable (it is the sign-in key; changing it is
  remove + add). If anything other than the display name changes, the login's
  sessions are revoked too: a token carries roles, scope and region for up to
  `TOKEN_TTL` (8h) and the gateway checks only `revoked_at` per request, so
  without the revoke a removed role would keep working until sign-out.
- **Remove** — sets `active = false` and revokes the login's open sessions.
  Never a `DELETE`: audit rows and history point at the user id. On
  Production, Remove asks "Are you sure?" naming the email; nothing else asks.
- **Reactivate** — `active = true`.

Why revoke sessions: the gateway checks `users.active` only at sign-in
(`apps/gateway/src/main.ts`); a signed-in session is checked against
`sessions.revoked_at` on every request. Without the revoke, a removed login
stays in until its token expires.

## How it is made (Claude's calls)

- **Electron + TypeScript**, in `tools/logins-app/` with its own
  `package.json`, so the product's dependency tree is untouched. Launched from
  the desktop via a `.desktop` file in `~/.local/share/applications/`.
- The main process imports the repo's own modules — `SURFACES`/`admits`,
  `ROLES`, `hashPassword`, `createPool`/`beginTx` — so the app cannot drift from
  what the gateway accepts. The window talks to the main process over IPC; the
  window never holds a database connection or the connection strings.
- UI: plain HTML/CSS/TS in the renderer, no framework required. Builder's call.
  Every colour, type, radius and spacing value comes from `packages/tokens/`
  (Arc Foundry — read the `arc-foundry` skill first; repo `CLAUDE.md`), using
  the semantic roles, not `PRIMITIVES`. Console density: this is an office tool.
- Connections: stored once in `~/.config/ac-logins/connections.json`, mode
  `0600`, entered in a small settings dialog (Local prefilled with the
  `ac-pg` URL). Production is the PlanetScale string as shown for psql
  (`createPool` already handles `sslrootcert=system`), using the **same login
  the Worker uses** — migration 0012 grants it `SET ROLE ac_gateway`.
- No audit_log rows in v1: `audit_log.actor_id` must be a user and the app has
  no principal of its own (the seed script writes none either).

## Goals

- See every active login, grouped by where it signs in, on the live database.
- Add, edit, reset, remove, reactivate — live immediately, no deploy.

## Non-goals

- No hosting, no other users, no sign-in to the app itself.
- No editing of orgs, regions, account trees, firms or crews — only pickers
  over what exists.
- No device grants / shifts (S5's other half), no anonymous principals.
- No bulk import.

## Anti-goals (would be a failure even if it worked)

- A password stored or shown in plain text anywhere, or a connection string
  reaching the renderer.
- A write that bypasses what the gateway would accept — rows it can't sign in
  with, or a namespace/role combination `admits()` would refuse.
- Hard `DELETE` of a user.
- Being unsure which database you're changing.

## Left to the builder

- Exact styling, icons, packaging details.
- Tests: unit tests for the row-building (one per kind, like
  `tools/ci/test-logins.test.ts`) and one integration test against `ac_dev`
  for add → sign-in-works → remove → sign-in-refused through the real gateway,
  plus: an Edit that drops a role ends the open session; Remove on a
  technician ends their S5 session.
