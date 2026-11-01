---
name: contract-terms
description: Contract terms in this repository — the term policy register (packages/contracts/src/terms.ts), override rows, admission (admitOverride, the DB trigger, the EXCLUDE constraint), resolution (resolveTerm and its trace), the three refusal axes S2 must render, and the MSA activation gate. Use before adding or changing a term, touching packages/domain/src/inheritance, the terms handler, rate or SLA lookups, or anything that reads a customer's payment terms, SLA, PM visits, labour rate or warranty.
---

# Contract terms

Primary source: `docs/BACKBONE_CONTRACT.md` §3. This skill is the working map.

**Root idea:** "terms flow downward and may be overridden at any level" is five rules in one
coat. A term carries a **policy**, not just a value, and every violation **raises** — there
is no configurable on-violation behaviour, because that is an override flag in disguise.

## The register — `packages/contracts/src/terms.ts`

Each `TermPolicy` has two orthogonal axes:

- **authoring** — which tiers (`parent`, `region`, `location`, `site`) may hold an override row.
- **combine** — `nearest` (most specific wins), `ratchet` with `stricter: "lower" | "higher"`
  (an override may only tighten), or `attach` (binds to one node, never walks).

Plus `valueKind` (`int`, `money`, `text`, `enum`, `bool`), `values` for enums (**index 0 is
lowest** — ratchet uses that ordinal), `label` (dispatcher's words), `rationale` (the failure
it prevents — S2 shows it in refusals), and `fallback` (`undefined` = resolution raises).

| Term | Authoring | Combine | Fallback |
|---|---|---|---|
| `payment_terms_days` | parent | nearest | 30 |
| `billing_rollup_tier` | parent | nearest | parent |
| `invoice_delivery` | parent, region | nearest | portal |
| `sla_response` | all | ratchet lower | 4_hour |
| `sla_credit_pct` | parent, region, location | ratchet lower | 10 |
| `pm_visits_per_year` | all | ratchet higher | 2 |
| `after_hours_multiplier_milli` | all | nearest | 1500 |
| `labor_rate_minor` | all | nearest | "12500" |
| `vendor_warranty` | site | attach | — |
| `equipment_service_window` | site | attach | — |
| `diagnostic_data_rights_reserved` | parent | nearest | true |

Re-read `terms.ts` before relying on this table; the file wins.

**Money is a string of integer minor units.** A JSON number is an IEEE754 double and is refused.

## Where each rule is held

| Rule | Held by | Code |
|---|---|---|
| Unknown term / illegal tier | `admitOverride()` + DB trigger `ac_admit_term_override()` reading `term_registry` | `unknown_term`, `illegal_tier` |
| Value shape | `checkTermValue` in `admitOverride()` | `bad_value` |
| Two amendments in effect at once | `admitOverride()` + `EXCLUDE USING gist (scope_tier, scope_id, term_key, effective &&)` | `overlap` |
| Ratchet loosened (child relaxes) | `admitOverride()`, called by `services/gateway/src/handlers/terms.ts` | `ratchet_loosened` |
| Parent tightens over a looser child | `admitOverride()` | `would_orphan_descendants` |
| No value and no fallback | `resolveTerm()` | `no_value` |

`resolveTerm(overrides, path, key, asOf)` **re-applies all three checks**, so a row that
arrived by restore or bypass is still refused. It returns value, winning tier, policy and a
trace naming every rung, including empty ones. **The domain has no clock**: the caller
passes `asOf` — a disputed February job reprices against February rows.

`term_registry` is a mirror regenerated from `terms.ts` on every migrate
(`repeatable/R_term_registry.sql` via `emit-schema.ts`). No runtime role may write it.
Never edit the mirror.

## Refusals reach S2 as decisions

`AdmissionRefused` / `ResolutionError` → 422 with `code` (`services/gateway/src/main.ts`).
`packages/contracts/src/refusals.ts` `ADMISSION_AXIS` classifies each code:

- **structural** — the row can never be right (`unknown_term`, `illegal_tier`, `bad_value`,
  `overlap`, `ambiguous`). Nothing to escalate.
- **commercial** — someone must agree and price it (`ratchet_loosened`,
  `would_orphan_descendants`).
- **incomplete** — the account is missing a term (`no_value`). Goes through once authored.

A new code needs an axis entry, or S2 renders a generic error — which 05 Rev D forbids.

## Changing things

- **Add a term** — cheap. Edit `terms.ts` (label, rationale, fallback decided on purpose),
  run `node tools/ci/emit-schema.ts`, migrate, add resolve/admit tests against the Amped
  fixture (`packages/domain/src/inheritance/fixtures/amped.ts`). A term with **no fallback**,
  not `attach`, and authorable at `parent` joins `REQUIRED_AT_ACTIVATION` (derived in
  `terms.ts`) automatically: from then on no MSA activates without it
  (`handlers/contracts.ts`), and every already-active MSA lacking it shows red in
  `msa-terms-audit` — dispatchers on those accounts get `no_value`. Today the list is empty
  because every such term has a fallback; giving a new term none is a commercial decision,
  so raise it with the user.
- **Change a term's policy** — a migration project, not an edit. Every existing override
  must be re-admitted under the new policy; the rows that fail are terms a customer
  currently believes they have. Write the re-admission check first, run it against
  production read-only, and bring the list to the user before changing anything.
- **Read a term in a handler** — resolve it with an explicit `asOf`; never read
  `contract_term_overrides` directly and pick a row.

## Verify

```bash
node --test packages/domain/src/inheritance/resolve.test.ts
node tools/ci/schema-guard.ts
npm run test:integration   # "finding 1/2/4 at the table", "register mirror cannot be edited"
```
