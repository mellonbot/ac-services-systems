# The eight surfaces

> GENERATED from `packages/contracts/src/surfaces.ts`.

Every screen in the platform is one of eight websites. None owns data. Each is a
scoped view onto the same multi-tenant hierarchy, reached only through the API
gateway.

| ID | Surface | Block | Phase | Density | Auth scope | Writes |
|----|---------|-------|-------|---------|-----------|--------|
| S1 | Marketing / lead-gen | OFC | 1 | `comfort` | none (anonymous) | `lead`, `call_record` |
| S2 | Service Manager | OFC | 1 | `console` | role-based, org-wide | `account`, `contract`, `invoice`, `warranty_case`, `part`, `purchase_order`, `subcontractor_firm`, `crew_credential`, `rate_card` |
| S3 | Dispatch Console | OFC | 1 | `console` | region-scoped | `assignment`, `job_state`, `crew_release`, `escalation` |
| S4 | HQ Ops Dashboard | OFC | 2 | `console` | org-wide READ only | — |
| S5 | Technician web fallback | FLD | 1 | `field` | tech credential + shift device grant | `job_state`, `checklist`, `photo`, `part_used`, `time_entry`, `signature` |
| S6 | Customer Portal | INV | 1 | `comfort` | customer IdP + tier claim | `service_request`, `payment`, `contact_update` |
| S7 | Vendor Portal | INV | 4 | `comfort` | separate vendor namespace | `po_ack`, `ship_date`, `vendor_invoice`, `catalog_price`, `rma` |
| S8 | Subcontractor Portal | INV | 1 | `comfort` | subcontractor firm namespace | `compliance_doc`, `crew_roster`, `settlement_ack`, `dispute` |

## Build order

1. Backbone contract — schema with `region_id` everywhere, gateway, auth with tier claims, event stream, audit log
2. **S2** — hierarchy, contracts and the subcontractor registry must exist before anything dispatches against them
3. **S3 + S5 together** — the fallback is what lets the tablet ship without being a single point of failure
4. Yocto tablet — the long pole, de-risked because S5 already carries the field
5. **S6** — required for Amped end-to-end in Phase 1; tier scoping is the acceptance test
6. **S8** — D12 minimum cut: compliance intake + settlement visibility
7. **S1** — off the critical path, ship whenever a hand is free
8. **S4** (Phase 2), **S7** (Phase 4)
