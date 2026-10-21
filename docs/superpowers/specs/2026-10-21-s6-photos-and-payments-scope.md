# S6 — request photos and invoice payment

**2026-10-21 · Scope · Owner: unassigned**

The Work orders home (commit `3df7c17`) left out two things the partners'
reference draws: **photos on a request** and **view & pay invoice**. Both were
left out for the same reason: nothing on the server accepts the data. This
document scopes what it takes to make each one real, what the partners
have to decide first, and what each one depends on.

They are independent. Photos can ship without payments, and payments can ship without photos.

---

## 1. Photos on a service request

### What exists

| Piece | State | Where |
|---|---|---|
| Key scheme `region/org/kind/id`, no vendor in the key | Built | `packages/storage/src/index.ts` |
| `ObjectStore` interface (`put`, `get`, `presign`) | Interface only — **no implementation** | same |
| Object storage bucket | **Not bound.** "R2 is the obvious fit and is not yet bound" | `infra/README.md` |
| `storage_objects` (key, content type, size, sha256, uploader) | Table exists, **row security off** (OPEN-RLS-REMAINDER) | `migrations/0001`, `OPEN_DECISIONS.md` |
| `job_media` (photo / signature / capture) | Exists, but `job_id NOT NULL` — a customer's photo arrives **before** any job does | `migrations/0001` |
| A binary-body operation | **None.** Every operation in the catalogue is JSON | `packages/contracts/src/operations.ts` |

So the root blocker is not a missing form field. It is that **object storage has
never been wired**. S5's crew photos (`job_media`, the `awaiting_pictures`
state) need exactly the same wiring. Building it for S6 builds it for S5.

### Shape

1. **Bind storage.** An R2 bucket per environment. The gateway runs in a
   container behind the Worker (`infra/cloudflare/worker.mjs`), and a container
   has no R2 binding of its own, so the gateway reaches R2 over its
   S3-compatible API. Credentials go in as Worker secrets on the `PASSTHROUGH`
   list (`AC_STORAGE_ENDPOINT`, `AC_STORAGE_KEY_ID`, `AC_STORAGE_SECRET`,
   `AC_STORAGE_BUCKET`). The `ObjectStore` implementation signs SigV4 with
   `node:crypto`, the same no-library line the token signer holds.
2. **Upload through the gateway, not to R2.** The browser never gets a
   bucket URL: the storage package's own rule is "a surface never receives a
   vendor URL", and `schema-guard` already fails a surface that reaches a third-party
   host. The gateway takes the bytes, checks them, writes the object, and
   records a `storage_objects` row in the same transaction as the link.
3. **Attach after create.** `serviceRequests.create` stays as it is. A new
   `serviceRequests.attachPhoto` takes `{ requestId }` plus the image body, once per
   photo. That way a failed photo never loses the request it belongs to. The
   form submits the request, then the photos, and shows each one's outcome.
4. **One new table, `service_request_media`** (`request_id`, `storage_object_id`,
   `org_id`, `region_id`, `uploaded_by`, `created_at`). Don't relax `job_media.job_id`:
   that table is the field layer's append-only log, with `mutation_id` dedupe,
   and a customer upload isn't a field mutation. Once a job is opened against
   the request, its photos are read through `service_requests.job_id`.
5. **Reads.** `serviceRequests.list` gains a `photos: { id, contentType, bytes }[]`
   field, and a new `media.get { id }` streams the bytes **through the gateway**
   under the same RLS. S6 draws the thumbnails on the work order card. S2/S3 draw
   them on the request, and S5 sees them on the job.

### Rules the gateway enforces

- `image/jpeg`, `image/png`, `image/heic`/`heif` only, decided by the **file's
  first bytes**, not the header the browser sends.
- 10 MB per photo, 6 per request (both registry constants, not magic numbers).
- Refused while degraded, the same as the request itself. There is no queue.
- RLS: a photo is visible wherever its request is visible (`ac_work_visible` /
  the 0006 rules). Insert only by the request's own requester, and only while no
  job is open against it. After that, photos are the office's to add.
- `storage_objects` gets its own policy in the same migration. That closes one
  of the four OPEN-RLS-REMAINDER tables, with the readers now known.

### Decisions for the partners

| # | Question | Default if nobody decides |
|---|---|---|
| P1 | Strip EXIF (GPS, device) from customer photos? Doing it properly means re-encoding, which needs an image library in the container | Keep the original and don't show EXIF. Revisit before photos leave the office (reports, partner screenshots) |
| P2 | Retention: how long does a customer photo live after the job closes? | Same as `job_media`, which today means indefinitely. Needs a number before the first data-residency question arrives |
| P3 | Can a customer add photos after a job is open (e.g. "it's leaking again")? | No. That's `job_message`, S6's other unbuilt write, and it should carry attachments when it lands |

### Work

| Piece | Size |
|---|---|
| R2 bucket + secrets + `ObjectStore` (SigV4 put/get) with a local-disk store for tests | S |
| Binary carrier in the operation catalogue, SDK generator and shell (`carrier: "binary"`) | M — the one structural change; S5 reuses it |
| Migration 0017: `service_request_media`, policies on it and on `storage_objects` | S |
| Gateway handlers `serviceRequests.attachPhoto`, `media.get`, `photos` on the list | S |
| S6 form (picker, per-photo progress and refusal) + thumbnails on the card; S2/S3 request view | S |
| Integration tests: scope (a manager can't read another location's photo), type sniffing, size, degraded | S |

Roughly **1½ weeks** for one builder, most of it in the binary carrier.

---

## 2. Paying an invoice

### What exists

| Piece | State | Where |
|---|---|---|
| `invoices`, `invoice_lines`, money in integer minor units | Built, read-only | `migrations/0001`, `invoices.list` |
| Invoice **issuance** | **No operation.** "Issuance is WS-E's (D13) and has no operation yet". Invoices exist only because tests seed them | `apps/gateway/src/handlers/site-record.ts` |
| Invoice paid state | **None.** No state column, no payments table | OPEN-PAYMENTS |
| `payment` in S6's registered writes | Declared, no operation behind it | `packages/contracts/src/surfaces.ts` |
| A processor, an AR ledger, an accounting system | **None chosen** | — |

So payment is gated behind a question that comes before any code: **where do
invoices come from, and which system is the ledger of record for what a
customer owes?** If an accounting system (QuickBooks, NetSuite, Xero) issues
the invoices, it should also take the payment, and this platform mirrors the
status. If this platform issues them (WS-E), it takes the payment through a
processor and becomes the AR ledger. Building a pay button before that is settled
means building it twice.

### Shape — assuming this platform is the ledger (the WS-E path)

1. **Hosted checkout, never a card form of ours.** S6 asks the gateway for a
   checkout session and the browser **navigates** (a top-level redirect, not a
   `fetch`) to the processor's page, then comes back to S6. No card or bank
   number ever touches our servers, which keeps PCI at the lightest
   self-assessment (SAQ A). This is the one place a surface is sent to a vendor URL, and it's sent as a
   page to visit, not as data to load.
2. **ACH first, card second.** Commercial invoices in the hundreds to thousands
   of dollars are paid by bank transfer. Card fees run about 3%. ACH takes
   days to settle and can be returned, so a payment has a **pending** state that the
   customer sees ("Payment processing"). It's never shown as paid until it settles.
3. **The processor's webhook is the source of truth, not the redirect.** A new
   unauthenticated operation (`auth: "none"`, like `brand.theme` and
   `auth.login`; its proof is the signature, not a token) takes the
   processor's signed event, verifies the signature, and records it **idempotently**
   on the processor's event id. It writes an outbox event (`invoice.paid`,
   `payment.failed`) in the same transaction; S6 adds both to the topics it already subscribes to.
4. **One new table, `payments`** (`invoice_id`, `amount_minor`, `currency`,
   `method` ach/card, `processor_ref` unique, `state`
   pending/succeeded/failed/returned/refunded, timestamps). The invoice's paid
   status is **derived** (succeeded sum ≥ total), not a column someone can set
   by hand. `invoices.list` gains `paidMinor` and `paymentState`.
5. **S6.** The card's "see it on the site card" becomes **Pay invoice**, shown
   only to a principal allowed to pay it (below). Paid, processing and failed
   each get a word and a pill. The Invoices due tile then counts **unpaid**
   invoices, which fixes the over-count the home ships with today.
6. **What else turns true.** S4's "Past due date" stops being an upper bound,
   and D13's working-capital positions get real collections in them.

### Who may pay a consolidated invoice

An invoice bills to a tier (`bill_to_tier`: parent, region, location or site), and
`invoices.list` shows a location manager **only their lines** of a parent
invoice. Paying the whole invoice from a location would pay for other locations they can't
see. Paying just their lines makes partial payment the normal case.

**Proposed rule:** only a principal whose scope **covers the bill-to node**
can pay, and only the whole invoice. A location manager sees their lines and
"Billed to Shipman Co Facilities — paid by your accounts payable". This needs
the partners' sign-off (Y2 below).

### Decisions for the partners

| # | Question | Why it blocks |
|---|---|---|
| Y1 | **Ledger of record:** do we issue invoices and take payment (WS-E), or does an accounting system own AR and we mirror it? | Decides whether anything below gets built here |
| Y2 | Who may pay a consolidated invoice (proposal above), and is partial payment ever allowed? | Decides the permission rule and the `payments` ↔ `invoice_lines` shape |
| Y3 | Processor (Stripe is the default for hosted checkout + ACH debit; the accounting system's own processor if Y1 goes that way) | Contract, fees, payout account |
| Y4 | Card surcharge or fee absorption, and whether card is offered at all on enterprise SLA accounts | Pricing and legal; varies by state and card network rules — get advice, don't guess |
| Y5 | White-label: does a tenant's checkout page show the tenant's name or Rankine's? Who is merchant of record? | Decides one processor account vs. one per tenant — a large difference |

### Work (after Y1–Y3, and **after invoice issuance exists**)

| Piece | Size |
|---|---|
| Invoice issuance (WS-E) — **prerequisite, not part of this scope** | separate |
| Migration 0018: `payments`, RLS (read = `ac_invoice_visible`; insert/update = the webhook role only), derived paid status | S |
| Processor client (checkout session) + webhook verify, all `node:crypto`; secrets on the `PASSTHROUGH` list | M |
| Operations `payments.checkout` (S6), `payments.webhook` (none), `paidMinor`/`paymentState` on `invoices.list` | S |
| Outbox events `invoice.paid` / `payment.failed`; S6 + S4 subscribe | S |
| S6 Pay button, return page, pending/paid/failed states; S2 payment history on the invoice | S |
| Tests: double-delivered webhook, out-of-order events, ACH return after "succeeded", a location manager refused on a parent invoice | M |

Roughly **2–3 weeks** for one builder once the decisions are made and issuance exists.

---

## Recommended order

1. **Photos now.** Nothing blocks it but the storage binding, and it unblocks S5's crew
   photos and the `awaiting_pictures` path at the same time.
2. **Payments: take Y1 to the partners first.** The answer decides whether
   this is 2–3 weeks here or a mirror of someone else's ledger. Until then, the S6 card
   links to the invoice, and the Invoices due tile's caption should say it counts
   invoices not yet past due, paid or not.

## Non-goals

- A card or bank form of our own. Hosted checkout or nothing.
- Uploading straight from the browser to the bucket. The gateway is the only door.
- Video, PDFs or other documents on a request (P3's `job_message` is the place).
- Refunds initiated from S6. A refund is the office's action, from S2.
