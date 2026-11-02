# 26 — S7 Vendor Portal and S2 Purchasing, built (item 11)

2026-09-27. Branch `item-11-s7-vendor-portal`.

## The brief

S7 is the vendor's side of buying parts. Nothing supported it: no vendor,
catalogue, purchase order, shipment, vendor invoice or return table existed.
The partners chose: **S2 creates the orders**; **a vendor proposes a price and
the office accepts it**; **a vendor invoice is matched three ways** (price
against the order, quantity against the receipt) with paying out of scope; and
S7 is **switched on in the clickable demo only** — it stays `enabled: false`
(Phase 4) in the product, to be turned off in the demo in a few days.

## What was built

| Layer | Where | What |
|---|---|---|
| Tables | `packages/schema/src/tables/procurement.ts` | `vendors` (tenant root: id = its organization), `receiving_points`, `vendor_catalog_items`, `vendor_catalog_prices` (proposed/accepted/rejected/withdrawn; EXCLUDE on overlapping accepted prices), `purchase_orders` + lines, `shipments` + lines, `po_receipts`, `vendor_invoices` + lines, `rmas`. |
| Migration | `0011_procurement.sql` | Tenancy inherited by trigger (a vendor's rows are its org; a PO lives in its receiving point's region; children take the PO's). Quantity triggers: nothing ships or is received beyond the order, nothing returns beyond the receipt. Column triggers: a vendor may acknowledge an issued PO, withdraw its own proposal, answer a requested return — and change nothing else. RLS: we see everything; a vendor its own rows, a PO only once issued. **Restrictive "no vendor" policies on 33 existing tables.** |
| Domain | `packages/domain/src/procurement/match.ts` | The three-way match: exact price, cumulative quantity within the receipt, one note per disagreement. |
| Operations | `packages/contracts/src/operations.ts` | 22: vendors, receiving points, catalogue, prices (propose/withdraw/decide), POs (list/detail/create/issue/cancel/acknowledge), shipments, receipts, vendor invoices (submit/list), returns (request/respond/list). |
| Gateway | `apps/gateway/src/handlers/procurement.ts` | One file for both sides. Vendors are org-scoped in the unit of work (`isOrgScoped`), because a vendor ships to receiving points in any region. |
| Surfaces | `apps/s2-service-manager/src/screens/purchasing.ts`, `apps/s7-vendor-portal/src/` | S2: Purchasing, a vendor's catalogue, an order. S7: orders, an order (acknowledge, ship, invoice, returns), catalogue, invoices, returns. |

## What the audit found

Bound as a vendor in South before 0011, the database returned every South job
(8), assignment (5), crew (10), crew document (21), clearance (5), job event
(8), SLA timer (8), service request and job-equipment row. The region rule
admits any namespace bound to the region; 0006 and 0007 carved out the customer
and the firm, not the vendor. A restrictive policy per table closes it without
touching any other namespace's rule. After 0011 a vendor reads only the global
reference tables and its own procurement rows.

## Decisions worth knowing

- **A held invoice does not use up the receipt.** Only matched invoices count
  as invoiced, so a vendor can correct a held invoice with a new one. Found in
  the demo, fixed in the handler, pinned in the integration test.
- **A purchase order names a receiving point by code**, never a customer; a
  location stock room is coded (MTN-LS-02), not named after the customer's gym.
- **An open order keeps its price.** Accepting a later price closes the old one
  at the new first day; order lines carry the price they were raised at.
- **No global parts table.** Each vendor's catalogue is its own; the exception
  list of region-less tables stays four long.

## Proof

- `test/integration/s7.test.ts` — 11 tests against Postgres 16: the whole loop
  (propose → accept → raise → issue → acknowledge → ship → receive twice →
  invoice matched → invoice held → corrected invoice matched → return
  authorized → later price closes the old one), vendor isolation, zero rows on
  every job and customer table, and the table refusing a vendor's off-limits
  writes. The office side runs over the wire; the vendor side runs its real
  handlers bound as a vendor, because S7's phase gate refuses the wire.
- `packages/domain/src/procurement/match.test.ts` (6), S2 purchasing render
  tests (4), S7 render tests (7), `isOrgScoped` (unit-of-work test).
- The full CI `migrate` job reproduced locally on a fresh Postgres 16:
  migrations, idempotency, 153/153 integration tests, the four browser drives.

## Not built

- Paying vendors (OPEN-PAYMENTS).
- A browser drive for S2 Purchasing or S7.
- Row security on four remaining tables (OPEN-RLS-REMAINDER).
