# AC Logins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user Electron desktop app that lists the `users` table by the surface each login signs in to, and adds, edits, resets, removes and reactivates logins directly in the local or production database.

**Architecture:** The logic lives in plain TypeScript modules under `tools/logins-app/src/` (kinds, row building, database access, connection storage) that run under Node 24 and are tested by `npm run guard:test` and `npm run test:integration` like the rest of the repo. An Electron main process imports those modules and exposes them to a sandboxed renderer over IPC; esbuild bundles main, preload and renderer (it already resolves the repo's `.ts` imports). The renderer is plain HTML/TS styled only from `packages/tokens` (Arc Foundry, console density).

**Tech Stack:** TypeScript, Node ≥22.18 (use `nvm use 24`), `pg` via `apps/gateway/src/pg-tx.ts`, Electron 38, esbuild 0.28.2 (already a repo devDependency), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-20-logins-app-design.md`

## Global Constraints

- Works against production (PlanetScale Postgres, the Worker's login — migration 0012 grants it `SET ROLE ac_gateway`) and local `ac_dev` (`postgres://postgres:postgres@localhost:5433/ac_dev`).
- Every write: one transaction, `beginTx(pool, "ac_gateway")`, **unbound** (no `setLocal`). Every read: `beginTx(pool, "ac_gateway")` + `setLocal(INTERNAL_READ_BINDING)` (Task 3), then rollback. *(Plan's call: the spec reads `organizations`/`regions`/`users` unbound and only the pickers bound; reading everything bound as internal is equivalent — internal sees all of those — and lets `listUsers` join crew, firm, org and scope-node names in one query.)*
- Never `DELETE FROM users`. Remove = `active = false` + revoke sessions.
- Revoke sessions = `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND ((principal_kind = 'user' AND principal_id = $1) OR (principal_kind = 'device_grant' AND principal_id IN (SELECT id FROM device_grants WHERE technician_id = $1)))`.
- Passwords: `hashPassword` from `apps/gateway/src/auth.ts`; minimum `MIN_TEST_LOGIN_PASSWORD` (12) from `tools/ci/test-logins.ts`. Never logged, never returned to the renderer, never stored in plain text.
- Connection strings live only in `~/.config/ac-logins/connections.json`, file mode `0600`, and only in the main process. The renderer never receives one.
- Kinds and role lists come from `SURFACES`, `admits`, `ROLES` (`packages/contracts/src/`) — no hand-written copy, except Technician (the `crew_id` rule) and Other.
- Styling: only `tokenCss("console")` from `packages/tokens/src/css.ts` and semantic roles (`var(--color-…)`); no literal colour, font, radius or spacing values; never import `PRIMITIVES`. Read `.claude/skills/arc-foundry/SKILL.md` before Task 5.
- On Production: a persistent header label "PRODUCTION" in the fault/danger semantic role; Remove asks "Remove <email>? They will be signed out everywhere." Nothing else asks.
- No audit_log rows. No vendor Add. Technician Add offers employed crews only.

## Review Focus

1. **Duplicate email on Add** — a person expects "A login with that email already exists", not a crash or a silent upsert. → Task 3, `addLogin refuses an existing email`.
2. **Production connection drops / wrong string** (PlanetScale idle timeout, typo, login lacking `SET ROLE`) — expect the error shown in the window and the app still usable, not a white screen. → Task 3 `openDb surfaces a bad connection as LoginsDbError`; Task 5 renders `LoginsDbError.message`.
3. **Edit that only changes the display name** — expect the person *not* signed out; any access change — expect them signed out. → Task 3 `editLogin revokes only on an access change`.
4. **Removing a login that is already signed in** — expect the next request with their session to be refused. → Task 3 integration `remove ends an open session over the wire`.
5. **Switching database with a form half-filled** — expect the form closed and lists reloaded from the new database, never a write to the database you switched away from. → Task 5: every IPC call carries the `DbName` the window is showing; main rejects a call whose `DbName` is not the current one.

## File Structure

```
tools/logins-app/
  package.json            electron + scripts (start, build)
  build.mjs               esbuild: main.cjs, preload.cjs, renderer.js; writes tokens.css
  ac-logins.desktop       launcher template
  install-desktop.sh      copies the launcher into ~/.local/share/applications
  src/kinds.ts            KINDS, kindsOf()                         (pure)
  src/kinds.test.ts
  src/rows.ts             NewLogin, buildUserRow(), accessChanged() (pure)
  src/rows.test.ts
  src/db.ts               every query and write                    (pg)
  src/connections.ts      load/save connections.json 0600          (fs)
  src/connections.test.ts
  src/main.ts             Electron main: window, IPC
  src/preload.ts          contextBridge → window.logins
  src/renderer/index.html
  src/renderer/app.ts     layout A
  src/renderer/app.css    layout only, var(--…) tokens
test/integration/logins-app.test.ts
```

---

### Task 1: Kinds — which sidebar entries a login appears under

**Files:**
- Create: `tools/logins-app/src/kinds.ts`
- Test: `tools/logins-app/src/kinds.test.ts`

**Interfaces:**
- Consumes: `SURFACES`, `admits`, `SurfaceId` from `packages/contracts/src/surfaces.ts`; `Namespace`, `Role` from `packages/contracts/src/scope.ts`; `Tier` from `packages/contracts/src/tiers.ts`.
- Produces:
  ```ts
  export type KindId = "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "other";
  export type Kind = { readonly id: KindId; readonly name: string; readonly canAdd: boolean; readonly note?: string };
  export const KINDS: readonly Kind[];            // order: S2,S3,S4,S5,S6,S8,S7,other
  export type UserRecord = {
    readonly id: string; readonly email: string; readonly displayName: string;
    readonly namespace: Namespace; readonly roles: readonly string[];
    readonly orgId: string; readonly orgName: string; readonly regionId: string; readonly regionCode: string;
    readonly scopeTier: Tier; readonly scopeId: string; readonly scopeName: string | null;
    readonly firmId: string | null; readonly firmName: string | null;
    readonly crewId: string | null; readonly crewLabel: string | null; readonly crewEmployment: "employed" | "subcontracted" | null;
    readonly active: boolean;
  };
  export const kindsOf: (u: Pick<UserRecord, "namespace" | "roles" | "crewId">) => readonly KindId[];
  ```

- [ ] **Step 1: Write the failing tests** in `kinds.test.ts`:
  - `KINDS names come from SURFACES` — for each of S2,S3,S4,S6,S7,S8, `KINDS.find(k => k.id === id)!.name === SURFACES[id].name`; S5's name is `"Technician"`; `other` is `"Other"`.
  - `canAdd` — false for `S7` (note `"not live yet"`) and `other`; true for the rest.
  - `superadmin-test opens S2, S3, S4` — `kindsOf({namespace:"internal", roles:["principal"], crewId:null})` deep-equals `["S2","S3","S4"]`.
  - `dispatcher → S3` ; `office_manager → S2` ; `customer, roles [] → S6` ; `subcontractor → S8` ; `vendor → S7`.
  - `a crew makes a technician, whatever the namespace` — `{internal, ["technician"], crewId:"c"}` → `["S5"]`; `{subcontractor, [], crewId:"c"}` → `["S8","S5"]`.
  - `nothing matches → other` — `{internal, ["technician"], crewId:null}` → `["other"]`; `{internal, [], crewId:null}` → `["other"]`.
- [ ] **Step 2:** Run `node --test tools/logins-app/src/kinds.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `kinds.ts`. Registry kinds use `admits(id, {namespace, roles})`; S5 is `crewId !== null`; `other` only when the list is otherwise empty.
- [ ] **Step 4:** Re-run — expect PASS.
- [ ] **Step 5: Commit** `git add tools/logins-app/src/kinds*.ts && git commit -m "Logins app: login kinds from the surface registry"`

---

### Task 2: Row building — what a new or edited login writes

**Files:**
- Create: `tools/logins-app/src/rows.ts`
- Test: `tools/logins-app/src/rows.test.ts`

**Interfaces:**
- Consumes: `hashPassword` (`apps/gateway/src/auth.ts`), `verifyPassword` (tests only), `INTERNAL_ORG_ID` (`packages/schema/src/tenancy.ts`), `MIN_TEST_LOGIN_PASSWORD` (`tools/ci/test-logins.ts`), `Role`, `Tier`, `UserRecord` (Task 1).
- Produces:
  ```ts
  type Base = { readonly email: string; readonly displayName: string; readonly password: string };
  export type NewLogin =
    | Base & { readonly kind: "internal"; readonly roles: readonly Role[]; readonly scope: "org" | "region"; readonly regionId: string }
    | Base & { readonly kind: "technician"; readonly crewId: string; readonly crewHomeRegionId: string }
    | Base & { readonly kind: "customer"; readonly orgId: string; readonly tier: Tier; readonly nodeId: string; readonly regionId: string }
    | Base & { readonly kind: "subcontractor"; readonly firmId: string; readonly regionId: string };
  export type UsersRow = {
    readonly org_id: string; readonly region_id: string; readonly namespace: "internal" | "customer" | "subcontractor";
    readonly email: string; readonly display_name: string; readonly roles: readonly string[];
    readonly scope_tier: Tier; readonly scope_id: string; readonly firm_id: string | null; readonly crew_id: string | null;
    readonly password_hash: string;
  };
  export class LoginInputError extends Error {}
  export const checkPassword: (password: string) => void;         // throws LoginInputError
  export const buildUserRow: (n: NewLogin) => UsersRow;            // throws LoginInputError
  export type Access = Pick<UserRecord, "roles" | "regionId" | "scopeTier" | "scopeId" | "orgId" | "crewId">;
  export const accessChanged: (before: Access, after: Access) => boolean;
  ```

- [ ] **Step 1: Write the failing tests** (`R = "a0000000-0000-0000-0000-0000000000aa"`, `ORG`, `NODE`, `FIRM`, `CREW` similar UUIDs):
  - `internal org-wide` → `[namespace, org_id, region_id, scope_tier, scope_id, firm_id, crew_id] = ["internal", INTERNAL_ORG_ID, R, "parent", INTERNAL_ORG_ID, null, null]`, and `verifyPassword(pw, row.password_hash) === true`.
  - `internal region` → `scope_tier "region"`, `scope_id R`.
  - `technician` → `["internal", INTERNAL_ORG_ID, CREW_HOME, "region", CREW_HOME, null, CREW]`, `roles ["technician"]`.
  - `customer whole company` (`tier "parent", nodeId ORG`) → `["customer", ORG, R, "parent", ORG]`, `roles []`; `customer site` (`tier "site", nodeId NODE`) → `scope_id NODE`.
  - `subcontractor` → `["subcontractor", FIRM, R, "parent", FIRM, FIRM, null]`.
  - `refusals` — password of 11 chars → throws `/at least 12/`; email `"nope"` → throws `/email/`; internal with `roles: []` → throws `/role/`; email is trimmed and lower-cased.
  - `accessChanged` — same values → false; any one of roles (order-insensitive), regionId, scopeTier, scopeId, orgId, crewId differing → true.
- [ ] **Step 2:** Run `node --test tools/logins-app/src/rows.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `rows.ts`. Email check: one `@` with text either side, after trim + lower-case.
- [ ] **Step 4:** Re-run — expect PASS.
- [ ] **Step 5: Commit** `"Logins app: users rows for each kind of login"`

---

### Task 3: Database access — reads, writes, session revocation

**Files:**
- Create: `tools/logins-app/src/db.ts`
- Test: `test/integration/logins-app.test.ts`

**Interfaces:**
- Consumes: `createPool`, `beginTx`, `Pool` (`apps/gateway/src/pg-tx.ts`); `INTERNAL_ORG_ID`, `UNASSIGNED_REGION_ID`; Task 1 `UserRecord`; Task 2 `NewLogin`, `buildUserRow`, `checkPassword`, `accessChanged`, `LoginInputError`.
- Produces:
  ```ts
  export const INTERNAL_READ_BINDING: Readonly<Record<string, string>>;
  // { "ac.namespace":"internal", "ac.org_id":INTERNAL_ORG_ID, "ac.scope_tier":"parent", "ac.scope_id":INTERNAL_ORG_ID,
  //   "ac.region_id":"", "ac.firm_id":"", "ac.device_id":"", "ac.actor_id":"", "ac.surface_id":"logins-app" }
  export class LoginsDbError extends Error {}       // any pg/connection failure, message fit to show
  export type Region = { id: string; code: string; name: string };
  export type Crew = { id: string; label: string; homeRegionId: string };              // employed only
  export type Firm = { id: string; legalName: string; regionId: string };
  export type CustomerOrg = { id: string; name: string };
  export type AccountNode = { id: string; tier: "region" | "location" | "site"; name: string; parentId: string | null; regionId: string };
  export type LoginEdit = {
    readonly displayName: string;
    readonly roles?: readonly Role[];
    readonly scope?: { readonly tier: Tier; readonly scopeId: string; readonly regionId: string };
    readonly crew?: { readonly id: string; readonly homeRegionId: string };
  };
  export type LoginsDb = {
    ping(): Promise<void>;
    listUsers(opts: { includeInactive: boolean }): Promise<readonly UserRecord[]>;
    listRegions(): Promise<readonly Region[]>;
    listCrews(): Promise<readonly Crew[]>;
    listFirms(): Promise<readonly Firm[]>;
    listCustomerOrgs(): Promise<readonly CustomerOrg[]>;
    listAccountTree(orgId: string): Promise<readonly AccountNode[]>;
    addLogin(n: NewLogin): Promise<{ id: string }>;
    resetPassword(userId: string, password: string): Promise<{ revokedSessions: number }>;
    editLogin(userId: string, edit: LoginEdit): Promise<{ revokedSessions: number }>;
    deactivate(userId: string): Promise<{ revokedSessions: number }>;
    reactivate(userId: string): Promise<void>;
    close(): Promise<void>;
  };
  export const openDb: (connectionString: string) => Promise<LoginsDb>;   // pings; throws LoginsDbError
  ```

- [ ] **Step 1: Write the failing integration test** `test/integration/logins-app.test.ts`, structured like `test/integration/test-logins.test.ts` (skip without `DATABASE_URL`; spawn the gateway on a random port with `AC_SITE: "ac.test"`; seed regions WEST/SOUTH; a run tag `RUN`). Fixture via admin SQL: one employed crew in SOUTH; one customer org with a SOUTH region node and a location under it; one subcontractor firm (insert into `organizations` kind `subcontractor` + `subcontractor_firms` with the same id). Tests:
  - `openDb surfaces a bad connection as LoginsDbError` — `openDb("postgres://nobody:x@127.0.0.1:1/none")` rejects with `LoginsDbError`.
  - `the pickers see what the unbound role cannot` — `listCrews()` includes the crew; `listFirms()` includes the firm; `listAccountTree(org)` includes both nodes; `listRegions()` excludes `UNASSIGNED_REGION_ID`.
  - `add one of each kind, and each signs in where kindsOf says` — `addLogin` an internal dispatcher (region SOUTH), a customer (location tier), a subcontractor; `connectShell` (from `packages/shell/src/index.ts`) succeeds on S3, S6, S8 respectively; `listUsers` returns them with `kindsOf` = `["S3"]`, `["S6"]`, `["S8"]` and `scopeName`/`firmName`/`orgName` filled.
  - `addLogin refuses an existing email` — second `addLogin` with the same email rejects `LoginInputError` with message `"A login with that email already exists"`; the row count for that email stays 1.
  - `editLogin revokes only on an access change` — sign the dispatcher in; `editLogin(id, {displayName:"New"})` → `revokedSessions 0` and the session still works; `editLogin(id, {displayName:"New", roles:["dispatcher","foreman"]})` → `revokedSessions ≥ 1` and the next call on the old session is refused (`GatewayRefusal`, 401).
  - `remove ends an open session over the wire` — sign the customer in on S6; `deactivate` → `revokedSessions 1`; old session refused; a fresh sign-in refused; `listUsers({includeInactive:false})` omits it, `{includeInactive:true}` shows `active:false`; `reactivate` → sign-in works again.
  - `reset password` — `resetPassword(id, "short")` rejects `/at least 12/`; a good one revokes the open session, old password refused, new accepted.
  - `remove ends a technician's device session` — `addLogin` a technician on the crew; insert a `devices` row, a `device_grants` row for that technician, and a `sessions` row with `principal_kind='device_grant'`, `principal_id` = the grant; `deactivate` → that session has `revoked_at` set.
- [ ] **Step 2:** Run `DATABASE_URL=postgres://postgres:postgres@localhost:5433/ac_dev node --test test/integration/logins-app.test.ts` (after `docker start ac-pg`, `nvm use 24`, `node tools/ci/migrate.ts`) — expect FAIL (module not found).
- [ ] **Step 3: Implement** `db.ts`. Reads: one helper that opens `beginTx(pool, "ac_gateway")`, `setLocal(INTERNAL_READ_BINDING)`, queries, rolls back. `listUsers` joins `organizations`, `regions`, `crews`, `subcontractor_firms` and `accounts` (for `scopeName` when `scope_tier <> 'parent'`), ordered by email. Writes: unbound tx; `addLogin` inserts `buildUserRow(n)` (`roles` as `::jsonb`), mapping SQLSTATE `23505` on the email key to the `LoginInputError` above; `editLogin` reads the current row, builds the new access, updates, and revokes (Global Constraints SQL) iff `accessChanged`. Every pg error that is not a `LoginInputError` is rethrown as `LoginsDbError(<pg message>)`. Pool via `createPool(url, "ac-logins-app")`.
- [ ] **Step 4:** Re-run — expect PASS. Also `npx tsc -p tsconfig.json 2>&1 | grep tools/logins-app` — expect no output.
- [ ] **Step 5: Commit** `"Logins app: database access — pickers bound internal, writes unbound, sessions revoked"`

---

### Task 4: Connection storage

**Files:**
- Create: `tools/logins-app/src/connections.ts`
- Test: `tools/logins-app/src/connections.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DbName = "production" | "local";
  export type Connections = { readonly production?: string; readonly local: string };
  export const LOCAL_DEFAULT = "postgres://postgres:postgres@localhost:5433/ac_dev";
  export const loadConnections: (dir: string) => Connections;            // missing file → { local: LOCAL_DEFAULT }
  export const saveConnections: (dir: string, c: Connections) => void;   // mkdir -p, write, chmod 0600
  ```
  `main.ts` calls these with `path.join(os.homedir(), ".config", "ac-logins")`.

- [ ] **Step 1: Write the failing tests** (each in a fresh `fs.mkdtempSync` dir): missing file → `{ local: LOCAL_DEFAULT }`; save then load round-trips; after save `(fs.statSync(file).mode & 0o777) === 0o600`; saving over an existing `0644` file leaves it `0600`.
- [ ] **Step 2:** Run `node --test tools/logins-app/src/connections.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Write with `{ mode: 0o600 }` then `chmodSync(file, 0o600)`.
- [ ] **Step 4:** Re-run — expect PASS.
- [ ] **Step 5: Commit** `"Logins app: connection strings stored 0600"`

---

### Task 5: The Electron app — window, IPC, layout A

**Files:**
- Create: `tools/logins-app/package.json`, `tools/logins-app/build.mjs`, `src/main.ts`, `src/preload.ts`, `src/renderer/index.html`, `src/renderer/app.ts`, `src/renderer/app.css`
- Modify: `.gitignore` (add `tools/logins-app/dist/`, `tools/logins-app/node_modules/`)
- Modify: `tsconfig.json` — add `"exclude": ["tools/logins-app/src/main.ts", "tools/logins-app/src/preload.ts", "tools/logins-app/src/renderer/**"]`: `electron` is installed only under `tools/logins-app/`, so the repo typecheck (CI) must not see those files. Create `tools/logins-app/tsconfig.json` extending `../../tsconfig.base.json` with `"lib": ["ES2023", "DOM"]` covering `src/**`, and check with `npx tsc -p tools/logins-app` after `npm install` there.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (preload → `window.logins`; every call takes the `db` the window is showing):
  ```ts
  type Api = {
    connections(): Promise<{ production: boolean; local: boolean }>;      // which are configured — never the strings
    setConnection(db: DbName, url: string): Promise<void>;                // saves, then openDb ping; rejects with the error text
    select(db: DbName): Promise<void>;                                    // closes the old pool, opens the new
    listUsers(db: DbName, includeInactive: boolean): Promise<readonly UserRecord[]>;
    listRegions(db: DbName): Promise<readonly Region[]>;  listCrews(db: DbName): Promise<readonly Crew[]>;
    listFirms(db: DbName): Promise<readonly Firm[]>;      listCustomerOrgs(db: DbName): Promise<readonly CustomerOrg[]>;
    listAccountTree(db: DbName, orgId: string): Promise<readonly AccountNode[]>;
    addLogin(db: DbName, n: NewLogin): Promise<{ id: string }>;
    resetPassword(db: DbName, userId: string, password: string): Promise<{ revokedSessions: number }>;
    editLogin(db: DbName, userId: string, e: LoginEdit): Promise<{ revokedSessions: number }>;
    deactivate(db: DbName, userId: string): Promise<{ revokedSessions: number }>;
    reactivate(db: DbName, userId: string): Promise<void>;
  };
  ```
  Main rejects any call whose `db` ≠ the selected one with `"The window is showing a different database — reload."`.

- [ ] **Step 1: Scaffold.** `package.json`: `"private": true`, `"main": "dist/main.cjs"`, devDependency `electron@^38`, scripts `"build": "node build.mjs"`, `"start": "node build.mjs && electron ."`. `build.mjs`: esbuild (the repo's) — `src/main.ts` → `dist/main.cjs` (platform node, format cjs, external `electron`, `pg-native`); `src/preload.ts` → `dist/preload.cjs` (same); `src/renderer/app.ts` → `dist/renderer.js` (platform browser, esm); copy `index.html`, `app.css`; write `dist/tokens.css` = `` `:root{${tokenCss("console")}}` `` — check `tokenCss`'s return shape and wrap only if it is not already a `:root` block. Run `cd tools/logins-app && npm install && npm run build` — expect `dist/` with five files.
- [ ] **Step 2: Main + preload.** `BrowserWindow` 1200×800, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, title `"AC Logins"`. Opens `local` on start; `ipcMain.handle` per Api method, errors rethrown as `Error(message)` so the renderer gets text (`LoginInputError`/`LoginsDbError` messages verbatim). Content-Security-Policy meta in `index.html`: `default-src 'self'`.
- [ ] **Step 3: Renderer, layout A** (spec "What it looks like" and the approved mockup):
  - Header: "AC Logins"; database switch Local / Production; on Production a persistent `PRODUCTION` label in the fault role; a ⚙ that opens the connection dialog (two fields; Production empty until set; Local prefilled). If Production is not configured, choosing it opens the dialog.
  - Sidebar: `KINDS`, each with the count of active `listUsers` rows whose `kindsOf` includes it; the selected entry highlighted.
  - Main pane: title `"<Kind name> logins"`, **+ Add login** (hidden when `!canAdd`, S7 shows its note), **Show inactive** toggle; table: Email, Name, then per kind — S2/S3/S4: Roles, Scope (`org-wide` or region code); S5: Crew, Employment; S6: Customer, Sees (`Whole company` for parent, else `scopeName`); S8: Firm; S7: —; Other: Namespace, Roles. Row buttons: Reset password, Edit, Remove (inactive rows: Reactivate only).
  - Forms (modal): Add per kind, fields from Task 2's `NewLogin` variant, pickers from the list calls (customer: org, then tree as indented options + "Whole company"; whole company also picks a region from that org's region nodes; region pickers preselect when there is one); password entered twice and compared client-side. Edit shows email read-only. After a call returning `revokedSessions > 0`, show "Signed out of N session(s)."
  - Remove on Production: `confirm("Remove <email>? They will be signed out everywhere.")`; on Local no confirm.
  - Errors: shown inline in the form or as a banner, text from the rejected call; the window stays usable.
  - Switching database: closes any open form, then `select(db)` and reloads every list.
  - `app.css`: layout only; every colour/font/radius/space a `var(--…)` from `tokens.css`. Read `.claude/skills/arc-foundry/SKILL.md` first and follow its audit.
- [ ] **Step 4: Verify by hand** against local (`docker start ac-pg`, `npm start` in `tools/logins-app`): the sidebar counts match `SELECT count(*) … WHERE active` per kind; add a customer login, then sign in at the local S6 surface; Remove it, confirm the sign-in is refused; switch to Production with the dialog empty — the dialog opens and nothing is written. Then the style audit: `grep -nE "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(|[0-9]+px" tools/logins-app/src/renderer/app.css` — expect no matches outside `var(--…)` fallbacks (none should exist).
- [ ] **Step 5: Commit** `"Logins app: Electron window, layout A, IPC to the database layer"`

---

### Task 6: Launcher and docs

**Files:**
- Create: `tools/logins-app/ac-logins.desktop`, `tools/logins-app/install-desktop.sh`
- Modify: `README.md` (a short "AC Logins" block next to `db:seed-test-logins`)

- [ ] **Step 1:** `ac-logins.desktop`: `Name=AC Logins`, `Exec=bash -lc 'cd "<APP_DIR>" && source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm start'`, `Terminal=false`, `Type=Application`, `Categories=Development;`. `install-desktop.sh` replaces `<APP_DIR>` with the absolute path of `tools/logins-app` and writes `~/.local/share/applications/ac-logins.desktop`.
- [ ] **Step 2:** Run `bash tools/logins-app/install-desktop.sh` then `desktop-file-validate ~/.local/share/applications/ac-logins.desktop` (if installed) — expect no errors; launch "AC Logins" from the app launcher — the window opens on Local.
- [ ] **Step 3:** README block: what it is, `cd tools/logins-app && npm install && npm start`, the launcher script, where connections are stored (`~/.config/ac-logins/connections.json`, 0600), and that Production needs the Worker's login.
- [ ] **Step 4:** Full check: `npm run guard:test` (all pass), `DATABASE_URL=… npm run test:integration` (all pass), `npx tsc -p tsconfig.json 2>&1 | grep tools/logins-app` (empty).
- [ ] **Step 5: Commit** `"Logins app: desktop launcher and README"`
