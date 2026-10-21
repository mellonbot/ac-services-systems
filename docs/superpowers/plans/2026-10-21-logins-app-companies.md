# AC Logins — Companies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Companies section to AC Logins (add / remove / reactivate our own and contractor companies, creating the contractor firm with it), let technicians be placed under any active company with "AC Services DFW" as the default, and say "Company (HVAC license)" instead of "Crew" in AC Logins.

**Architecture:** Pure row-building and display rules go in a new `tools/logins-app/src/companies.ts` (unit-tested, zero-install safe). Database reads/writes for companies go in `db.ts` next to the login ones, written **bound as an internal org-wide principal** (RLS on `crews`/`subcontractor_firms` refuses unbound). The renderer gains a Companies sidebar entry and updated technician forms, wired through the existing IPC pattern.

**Tech Stack:** as before — TypeScript on Node 24, `pg` via `apps/gateway/src/pg-tx.ts`, Electron 38, esbuild, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-21-logins-app-companies-design.md` (extends `docs/superpowers/specs/2026-10-20-logins-app-design.md`)

## Global Constraints

- Wording only inside `tools/logins-app`: "Company (HVAC license)" replaces "Crew"/"Crew (employed)" in the Technician column and forms. No change to schema, contracts, gateway or other surfaces.
- Company and firm writes: one transaction, `beginTx(pool, "ac_gateway")` + `setLocal(INTERNAL_READ_BINDING)`, committed. Login writes stay unbound (unchanged).
- Exception (plan's call): **technician** add / company-move / reactivate run in the office-bound transaction so the company-row lock and the users write share one transaction. Verified admissible: `users` (0007) and `sessions_close` (0008) admit `ac_internal()`; `crews`/`device_grants` are readable internal parent-tier. All other login writes stay unbound.
- Rows must equal what the gateway's `createFirm` / `createCrew` (`apps/gateway/src/handlers/network.ts`) write, minus audit/outbox: employed crew → `org_id = INTERNAL_ORG_ID`, `firm_id NULL`; contractor crew → `firm_id` = firm, `org_id` = firm's org; `region_id = home_region_id`; new firm → `organizations(kind='subcontractor', id = firm id, name = legal name)` + `subcontractor_firms(org_id = id, status 'onboarding', settlement_terms_days, msa_signed_at::date, diagnostic_data_rights_reserved)`.
- Payment terms: integer ≥ 0, form prefilled **30**. Diagnostic data rights reserved: **must be chosen Yes/No, no default**. MSA date optional.
- Terminated firms: not offered, refused on add-company and on reactivate-company. Suspended firms: offered, labelled "suspended".
- Duplicate names refused, trimmed + case-insensitive: an **active** company with the same label → "A company named <name> already exists"; any firm with the same legal name → "A firm named <name> already exists".
- Remove company = `crews.active = false`; never DELETE. Refused when active users have this `crew_id` → "Move its N technician(s) to another company first", or live assignments (`assignments.released_at IS NULL`) → "It has N job(s) assigned — release them in Dispatch first". Production asks `Remove <company>?`; Local does not.
- A technician may only be added to, moved to, or reactivated under an **active** company → "<company> has been removed — choose another company". Lock the crew row (`FOR SHARE` in technician writes, `FOR UPDATE` in remove) so the race cannot leave an active technician under a removed company.
- Technician rows keep today's shape for both company types (`namespace 'internal'`, role `technician`, `crew_id`, region = company's home region).
- Default company for a new technician: the active **employed** company labelled exactly "AC Services DFW" (case-insensitive) if present; else no preselection.
- Documents column = `summarizeDocuments(employmentType, credentials, today)` from `apps/gateway/src/handlers/network.ts`; "Ready" when `satisfied.length === required.length`, else e.g. "Missing: insurance · Unverified: license · Expired: background check" (omit empty parts).
- Styling: Arc Foundry tokens only, as before.

## Review Focus

1. **Two companies with nearly the same name** ("AC Services DFW" vs "ac services dfw ") — expect the second refused, so the technician default is unambiguous. → Task 2 `addCompany refuses a duplicate name`.
2. **Removing a company while its technician is mid-shift / has work** — expect a refusal naming the reason, nothing changed. → Task 2 `removeCompany refuses live assignments`.
3. **A technician form opened before the company was removed** — expect save refused with the removed-company message, not a technician under a removed company. → Task 2 `technician cannot be placed under a removed company`.
4. **Contractor firm form submitted without choosing data rights** — expect a form error, no rows written. → Task 1 `buildFirmRows requires data rights`, Task 3 form `required`.
5. **A contractor technician actually working** — expect a device shift can be granted and the technician signs in on S5 like ours. → Task 2 `contractor technician signs in on S5`.

## File Structure

```
tools/logins-app/src/companies.ts        NewCompany, row builders, name normalising, documentsLabel (pure)
tools/logins-app/src/companies.test.ts
tools/logins-app/src/db.ts               + company reads/writes, technician company guards
tools/logins-app/src/main.ts, preload.ts + IPC for the company calls
tools/logins-app/src/renderer/app.ts     + Companies entry, forms; technician wording/picker
tools/logins-app/src/renderer/app.css    layout only, tokens
tools/logins-app/smoke-write.cjs         + company → technician → remove-refused flow
test/integration/logins-app.test.ts      + company tests
```

---

### Task 1: Company rows and display rules (pure)

**Files:** Create `tools/logins-app/src/companies.ts`, `tools/logins-app/src/companies.test.ts`

**Interfaces:**
- Consumes: `INTERNAL_ORG_ID` (`packages/schema/src/tenancy.ts`); `LoginInputError` (`./rows.ts`); `CrewDocumentSummary` type (`packages/contracts/src/operations.ts`).
- Produces:
  ```ts
  export type NewCompany =
    | { readonly type: "ours"; readonly name: string; readonly regionId: string }
    | { readonly type: "contractor"; readonly name: string; readonly firm:
          | { readonly existing: string }                                   // firm id
          | { readonly legalName: string; readonly regionId: string; readonly paymentTermsDays: number;
              readonly dataRightsReserved: boolean; readonly msaSignedAt: string | null } };
  export const DEFAULT_PAYMENT_TERMS_DAYS = 30;
  export const DEFAULT_COMPANY_NAME = "AC Services DFW";
  export const normaliseName: (s: string) => string;                        // trim, collapse inner spaces
  export const sameName: (a: string, b: string) => boolean;                  // normalised, case-insensitive
  export type FirmRows = { organization: { id: string; name: string }; firm: { id: string; region_id: string; legal_name: string; settlement_terms_days: number; msa_signed_at: string | null; diagnostic_data_rights_reserved: boolean } };
  export const buildFirmRows: (id: string, f: Extract<NewCompany, { type: "contractor" }>["firm"] & { legalName: string }) => FirmRows;  // throws LoginInputError
  export type CrewRow = { org_id: string; region_id: string; home_region_id: string; label: string; employment_type: "employed" | "subcontracted"; firm_id: string | null };
  export const buildCrewRow: (name: string, placement: { type: "ours"; regionId: string } | { type: "contractor"; firmId: string; firmOrgId: string; firmRegionId: string }) => CrewRow; // throws LoginInputError
  export const documentsLabel: (s: CrewDocumentSummary) => string;
  ```

- [ ] **Step 1: Failing tests** in `companies.test.ts`:
  - `buildCrewRow ours` → `{ org_id: INTERNAL_ORG_ID, region_id: R, home_region_id: R, employment_type: "employed", firm_id: null, label: "AC Services DFW" }` from `"  AC  Services DFW "` (normalised).
  - `buildCrewRow contractor` → `org_id = firmOrgId`, `firm_id = firmId`, `region_id = home_region_id = firmRegionId`, `employment_type "subcontracted"`.
  - `buildFirmRows` → organization `{ id, name: legalName }`; firm `{ id, region_id, legal_name, settlement_terms_days: 30, msa_signed_at: null, diagnostic_data_rights_reserved: false }`.
  - `buildFirmRows requires data rights` — `dataRightsReserved` not a boolean (e.g. `undefined as never`) → throws `/data rights/`; `paymentTermsDays` `-1` or `1.5` → throws `/payment terms/`; empty legal name → throws `/name/`; `msaSignedAt "2026-13-40"` → throws `/date/`.
  - `buildCrewRow` empty name → throws `/name/`.
  - `sameName("AC Services DFW", " ac  services dfw")` true; `("A","B")` false.
  - `documentsLabel` — all satisfied → `"Ready"`; `{missing:["insurance"], unverified:["license"], expired:["background_check"]}` → `"Missing: insurance · Unverified: license · Expired: background check"`.
- [ ] **Step 2:** `node --test tools/logins-app/src/companies.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement.** Underscores in kinds become spaces in `documentsLabel`.
- [ ] **Step 4:** Re-run → PASS; `npm run guard:test` all pass (this file must not import `pg`).
- [ ] **Step 5: Commit** `"Logins app: company and firm rows, the way the gateway writes them"`

---

### Task 2: Companies in the database layer

**Files:** Modify `tools/logins-app/src/db.ts`; Test `test/integration/logins-app.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `summarizeDocuments` (`apps/gateway/src/handlers/network.ts`); existing `read`/`write` helpers, `INTERNAL_READ_BINDING`, `LoginInputError`, `GONE`.
- Produces (added to `LoginsDb`; `Crew` and `Firm` types replaced):
  ```ts
  export type Crew = { id: string; label: string; homeRegionId: string; employmentType: "employed" | "subcontracted"; firmName: string | null };
  export type Firm = { id: string; legalName: string; regionId: string; status: "onboarding" | "active" | "suspended" | "terminated" };
  export type Company = Crew & { regionCode: string; active: boolean; firmId: string | null; firmStatus: Firm["status"] | null; technicians: number; documents: string };
  listCrews(): Promise<readonly Crew[]>;                 // ACTIVE companies of BOTH types now, ordered type then label
  listFirms(): Promise<readonly Firm[]>;                 // now includes status; terminated excluded
  listCompanies(opts: { includeInactive: boolean }): Promise<readonly Company[]>;
  addCompany(n: NewCompany): Promise<{ id: string; firmId: string | null }>;
  removeCompany(id: string): Promise<void>;
  reactivateCompany(id: string): Promise<void>;
  ```
  `listFirms` callers (Subcontractor login Add) keep working: same fields plus `status`.

- [ ] **Step 1: Failing integration tests** (existing file, same fixture style; `today` for documents from `new Date().toISOString().slice(0,10)`):
  - `addCompany ours, then a technician under it` — `addCompany({type:"ours", name:`Ours ${RUN}`, regionId: SOUTH})`; row equals Task 1's employed shape; `listCrews()` includes it with `employmentType "employed"`; `addLogin` technician with that `crewId` succeeds.
  - `addCompany contractor with a new firm` — rows in `organizations` (kind subcontractor), `subcontractor_firms` (status onboarding, terms 30, rights false), `crews` (subcontracted, firm_id, org_id = firm id); `listCompanies` shows `firmName`, `firmStatus "onboarding"`, `technicians 0`, `documents` starting `"Missing:"`.
  - `addCompany under an existing firm` — second company under the same firm id; refused when that firm is set `terminated` (admin SQL) with `/terminated/`.
  - `addCompany refuses a duplicate name` — `"AC Services DFW ${RUN}"` then `" ac  services dfw ${RUN} "` → `LoginInputError` "A company named … already exists"; duplicate firm legal name → "A firm named … already exists"; nothing written by the refused calls.
  - `removeCompany refuses active technicians` → message `/Move its 1 technician/`; after `deactivate` of that technician, `removeCompany` succeeds; `listCompanies({includeInactive:false})` omits it, `true` shows `active:false`.
  - `removeCompany refuses live assignments` — admin-insert an unreleased `assignments` row for the crew (copy the column set from `test/integration/s3-s5.test.ts`) → `/release them in Dispatch/`.
  - `technician cannot be placed under a removed company` — remove company C; `addLogin` technician on C → `/has been removed/`; `editLogin` moving an existing technician to C → same; a technician deactivated while on C, then `reactivate` → same; `editLogin` with displayName only on a technician still pointing at C succeeds.
  - `reactivateCompany` — works; refused when its firm is terminated → `/terminated/`.
  - `contractor technician signs in on S5` — technician under the contractor company; grant a device shift and sign in through the gateway exactly as `test/integration/s3-s5.test.ts` does for an employed crew; assert the device login succeeds. If the gateway refuses, STOP and report the refusal (do not change gateway code).
- [ ] **Step 2:** Run `DATABASE_URL=postgres://postgres:postgres@localhost:5433/ac_dev node --test --test-concurrency=1 test/integration/logins-app.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement.** Company writes: one helper `writeAsOffice` = `beginTx(pool,"ac_gateway")` + `setLocal(INTERNAL_READ_BINDING)` + commit/rollback. Duplicate checks and firm-status checks inside the same transaction. `removeCompany`: `SELECT … FROM crews WHERE id=$1 FOR UPDATE`, then the two counts, then update. Technician guards in `addLogin` (kind technician), `editLogin` (when `crew` given) and `reactivate` (when the user has a `crew_id`): bound read of the crew `FOR SHARE` in a transaction that also performs the unbound users write is not possible (one binding per tx) — so do the guard read **bound** with `FOR SHARE` inside the **office** transaction and the users write in that same transaction (users admits internal too: `ac_unbound() OR ac_internal()`). Missing id → `GONE`.
- [ ] **Step 4:** Re-run → all pass; also `node --test tools/logins-app/src/*.test.ts`, `npm run guard:test`, repo tsc grep for `tools/logins-app` empty.
- [ ] **Step 5: Commit** `"Logins app: companies in the database — office-bound writes, remove guards, technicians only under active companies"`

---

### Task 3: Companies in the window

**Files:** Modify `tools/logins-app/src/main.ts`, `preload.ts`, `renderer/app.ts`, `renderer/app.css`, `smoke-write.cjs`

**Interfaces:**
- Consumes: Task 2's `LoginsDb` additions, Task 1's `NewCompany`, `DEFAULT_PAYMENT_TERMS_DAYS`, `DEFAULT_COMPANY_NAME`, `sameName`.
- Produces: `Api` gains `listCompanies(db, includeInactive)`, `addCompany(db, n)`, `removeCompany(db, id)`, `reactivateCompany(db, id)` — same `use()` DbName guard as the rest.

- [ ] **Step 1: IPC.** Add the four methods to `Api`, `METHODS`, handlers, preload (pattern of existing methods).
- [ ] **Step 2: Sidebar + table.** A **Companies** entry after the login kinds, visually separated (it is not a login kind; no count badge semantics change for the others — its badge is the active company count). Columns: Company, Type (Ours / Contractor), Firm, Region, Technicians, Documents, Firm status (contractor only). **Show inactive** toggle → Reactivate on inactive rows. Row action **Remove** (Production: `confirm("Remove <company>?")`).
- [ ] **Step 3: Add company form.** Type radio Ours / Contractor. Ours: Name, Region (preselect when one). Contractor: Firm = New / Existing; Existing → firm picker (terminated never listed; suspended labelled "(suspended)"); New → Legal name, Region, Payment terms (days) prefilled `DEFAULT_PAYMENT_TERMS_DAYS`, Diagnostic data rights reserved — two radios Yes / No, **neither checked**, required — MSA signed date (optional, `type=date`); Company name (defaults to the legal name until edited). Errors inline.
- [ ] **Step 4: Technician wording and picker.** Column "Crew" → "Company (HVAC license)"; "Employment" → "Type" showing Ours / Contractor. Add/Edit field label "Company (HVAC license)"; picker = `listCrews` grouped with `<optgroup>` "Ours" / "Contractors" (contractor options show `label — firmName`). Add preselects the company where `employmentType === "employed" && sameName(label, DEFAULT_COMPANY_NAME)`. Edit of a technician whose company is not in the active list shows `"<crewLabel> (removed)"` selected (existing `keepOption`).
- [ ] **Step 5: Smoke.** Extend `smoke-write.cjs` (LOCAL only, unchanged refusal on production): Add company Ours `Smoke Co <ts>` → Add Technician under it (verify `crew_id` in SQL) → Remove company → expect the inline/banner refusal text containing "Move its 1 technician" → deactivate the technician via Remove → Remove company succeeds (`crews.active = f`). Keep the existing customer flow.
- [ ] **Step 6: Verify.** `npm run build`; `npx tsc -p tools/logins-app`; repo tsc grep empty; `npx eslint tools/logins-app` clean; `npm run guard:test`; CSS audit grep; run both smokes on local and paste output.
- [ ] **Step 7: Commit** `"Logins app: Companies section and company wording for technicians"`

---

## After the plan (controller, with Ethan's standing go-ahead)

Once merged and verified: on **Production**, create "AC Services DFW" (Ours, region DFW) through the app's database layer (`addCompany`), then confirm it lists with `technicians 0` and documents "Missing: license · …".
