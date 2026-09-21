# The eight surfaces

> GENERATED from `packages/contracts/src/surfaces.ts`.

Every screen in the platform is one of eight websites. None owns data. Each is a
scoped view onto the same multi-tenant hierarchy, reached only through the API
gateway.

| ID | Surface | Block | Phase | Density | Auth scope | Writes |
|----|---------|-------|-------|---------|-----------|--------|
| S1 | Marketing / lead-gen | OFC | 1 | `comfort` | none (anonymous) | `lead`, `call_record` |
| S2 | Service Manager | OFC | 1 | `console` | role-based, org-wide | `account`, `contract`, `invoice`, `warranty_case`, `part`, `purchase_order`, `subcontractor_firm`, `crew`, `crew_credential`, `rate_card`, `brand_theme`, `job`, `device`, `device_grant`, `equipment`, `account_contact` |
| S3 | Dispatch Console | OFC | 1 | `console` | region-scoped | `assignment`, `job_state`, `crew_release`, `escalation` |
| S4 | HQ Ops Dashboard | OFC | 2 | `console` | org-wide READ only | — |
| S5 | Technician web fallback | FLD | 1 | `field` | tech credential + shift device grant | `job_state`, `checklist`, `photo`, `part_used`, `time_entry`, `signature` |
| S6 | Customer Portal | INV | 1 | `comfort` | customer IdP + tier claim | `service_request`, `payment`, `contact_update` |
| S7 | Vendor Portal | INV | 4 | `comfort` | separate vendor namespace | `po_ack`, `ship_date`, `vendor_invoice`, `catalog_price`, `rma` |
| S8 | Subcontractor Portal | INV | 1 | `comfort` | subcontractor firm namespace | `compliance_doc`, `crew_roster`, `settlement_ack`, `dispute` |

## Build order

1. Backbone contract — schema with `region_id` everywhere, gateway, auth with tier claims, event stream, audit log
2. **S0** — the shared shell: operation catalogue → generated client → shell transport (login, hierarchy context, SSE, refusal mapping, degraded flag). Every surface below boots through it
3. **S2** — hierarchy, contracts and the subcontractor registry must exist before anything dispatches against them
4. **S3 + S5 together** — the fallback is what lets the tablet ship without being a single point of failure
5. Yocto tablet — the long pole, de-risked because S5 already carries the field
6. **S6** — required for Amped end-to-end in Phase 1; tier scoping is the acceptance test
7. **S8** — D12 minimum cut: compliance intake + settlement visibility
8. **S1** — off the critical path, ship whenever a hand is free
9. **S4** (Phase 2), **S7** (Phase 4)

## Runtime (09)

Each surface is a build-rendered `frame.html` (from this registry) plus one
esbuild bundle of `src/main.ts`, served as static files. Preact/htm/signals
live in `packages/ui` alone; a surface imports `@ac/ui`. Screens are a
registry (`src/screens.ts`) checked against the operation catalogue.
