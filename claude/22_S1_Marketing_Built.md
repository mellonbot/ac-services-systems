# 22 — Item 8: S1 Marketing / Lead-Gen, built

**Date:** 2026-09-18
**Build order:** `00_MASTER_SYSTEM_PLAN.md` §2.8 item 8 — *"S1 Marketing — off the critical path, ships whenever a hand is free"*
**Registry:** `05_Web_Surface_Architecture.md` Rev M §S1
**Status:** built and proven — 11 handler tests, 16 render tests, 15 wire tests, 12 checks in a real browser.

---

## 1. What made this item different from 6 and 7

Items 6 and 7 each took a principal the system already minted and asked what
it could see. This one has no principal. Everything below follows from that,
and the three things that are genuinely new are new because of it.

**S0 had two boot paths and needed a third.** `connectShell` is login →
`session.me` → shell, and S1 can do neither half: `session.me` is a bearer read
the catalogue serves only to the authenticated surfaces, and there is no
credential to present. The generated first-cut `app.ts` S1 had been shipping
was not merely thin — it was *wrong*. It resumed a browser session and offered
to sign in, on the one surface with no session and no sign-in.

**The registry's degraded line rules out a round trip at boot.**

> *Statically generated; forms queue to a durable buffer and replay. Site stays
> up when the gateway does not. Coverage map is read from the hierarchy — never
> hard-coded (D14: supply before signature).*

"Site stays up when the gateway does not" is not a property of the deployment.
It is `apps/s1-marketing/src/app.ts` having **no `await` before its first
render**. Anything that resolves the principal at the gateway breaks it.

So `openAnonymousShell` constructs the shell from a constant and a live
transport. The constant — `ANONYMOUS_PRINCIPAL` in
`packages/contracts/src/scope.ts` — is the one principal a surface is allowed
to name, and it is allowed because *neither side invents it*: the shell boots
with it and the gateway binds transactions with it, from the same row of data.
The ids are spelled twice (contracts cannot import the schema package;
dependencies point one way and the guard enforces it) and
`apps/gateway/src/auth.test.ts` holds the two spellings together.

**The session is minted lazily, at the first write.** A session row per page
view is a database write per page view, and a token minted at boot has expired
by the time someone finishes typing. `ensureSession()` is idempotent and every
write path calls it.

---

## 2. Migration 0008 is the item's substance

The same method as 0006 and 0007: bind a transaction as the new namespace and
count rows on every table. Run against a database with a day's traffic in it,
the anonymous binding read:

| Table | What it answered |
|---|---|
| `leads` | **no policy** — every lead ever captured: the name, email, phone number and free-text note a member of the public typed into a form |
| `call_records` | **no policy** — every call, and which lead it belonged to |
| `regions` | **no policy** — our shard boundary, and `min_crew_density`: D14's supply rule, the one number this surface exists in order not to publish |
| `sessions` | **no policy** — who is signed in, on which surface, in which org and region |
| `devices`, `device_grants` | **no policy** — every field tablet's hardware id and public key; which crew is on which device, in which window |
| `checklist_items`, `time_entries` | **no policy** — the work a technician recorded, and the hours |

None of it through a screen. All of it reachable by **every** external
namespace — a customer on S6 and a firm on S8 could read every lead too. This
is the third consecutive item whose finding is the same sentence, and it is
worth naming as a pattern rather than three coincidences: *a table with no
policy is not protected by the absence of an operation, because an operation is
one row in a catalogue away.*

The rule now: **an anonymous principal writes twice and reads nothing.** Not
even its own submissions — a form that can read what it wrote is an enumeration
endpoint with a friendly name.

Three mechanisms carry it:

- **`ac_lead_is_anonymous_intake`** — what may be *in* the row: a contact we
  can actually answer (an email or a phone number, or it is not a lead), a
  source from the list, a `submission_id`, and no `converted_account_id`,
  because turning a lead into a customer is S2's on the day someone signs.
- **`ac_lead_is_not_the_strangers_to_change`** — a lead is ours once made.
- **`ac_public_coverage()`** — SECURITY DEFINER, two columns, active rows. The
  coverage claim has exactly one definition, so widening what the marketing
  site may say is a reviewed diff on a migration rather than a `SELECT` someone
  extends. `min_crew_density` is deliberately not in it: a supply figure on a
  public page is a promise.

One shape needed care. `sessions` was closed as read-ours/append-anything,
because `auth.deviceLogin` inserts its session *after* `resolveDeviceLogin` has
bound the grant's own tenancy — it has to, `crews` is behind RLS — so that
INSERT arrives on a device-bound transaction. An internal-only WITH CHECK
refused every technician a token, and `auth.login` (which binds *after* its
insert) would never have shown it. Found by making the strict version first and
running `test/integration/s3-s5.test.ts`.

---

## 3. The durable buffer, and what makes one honest

`leads.submit` needed idempotency before a queue was safe to build, so
`leads.submission_id` (nullable, UNIQUE, also in the regenerated 0001) is the
replay key: `(device, mutation_id)` from the sync design, cut down to the one
field a page needs. The browser mints it once, when the visitor presses the
button, and replays it unchanged. A replay that already landed loses to the
index and comes back as `leads_submission_id_key`, which
`apps/s1-marketing/src/buffer.ts` reads as **done**.

Without it, "we'll retry when you're back online" means "we'll phone you once
per reconnection."

Three properties the buffer holds, each of which is a line that could
plausibly have been left out:

1. **It survives the tab.** S5's queue is in memory, because a technician's
   device is awake for a shift. A stranger on one bar in a mechanical room
   closes the tab. So this one is storage-backed, and `localStorage` is probed
   rather than assumed — it *throws* rather than returning null when site data
   is blocked, and the buffer degrades to memory instead of taking the form
   down with it.
2. **It replays one id.**
3. **It tells the truth on screen.** A queued form says queued, in those words.
   The failure this exists to prevent is a visitor who believes we have their
   number and waits; a page saying "thanks, we'll be in touch" over a request
   still sitting in their own browser has converted an outage into a lost
   customer, silently.

Refusals are classified by *kind*, not by status: `transport` waits, `token`
re-mints once and retries the same lead, anything else stops and is shown to
the visitor in the gateway's own words. And S1's submit button is the one in
this repository that does **not** disable itself when the gateway is
unreachable — S6's and S8's must, because a write shown as accepted and never
received is a crew that cannot be sent; here, a stranger who came for help and
found a dead button calls someone else.

---

## 4. The copy ceiling is zero, and that is a mechanism

05 §S1 says availability and response-time language on this surface is bounded
by **OQ6** and **D7a**, and adds the sentence that made this part of the item:
*"neither of which is visible to whoever writes the copy."* F9 is where the
ceiling gets written down. It has not been.

So the ceiling is zero, held by a list of patterns — a response window, 24/7,
same-day, a guarantee, an uptime figure, the word SLA — run against the
rendered page in `app.test.ts` and against the **painted** page in
`drive-s1.ts`, so a claim arriving through a stylesheet fails too. A sentence
promising a time fails in the commit that adds it.

**When F9 lands, those two lists are what changes.** They are the ceiling,
written in the only place that enforces it. See `docs/OPEN_DECISIONS.md`,
OPEN-S1-CEILING.

The related half is already closed: the coverage map is `regions`, so a map
claiming a metro with no crews behind it is not expressible (D14).

---

## 5. Found and fixed on the way: the worker's calendar

`sweepCredentialExpiry` keyed its own idempotency on
`today.toISOString().slice(0, 10)` — a **UTC** date — against
`occurred_at::date`, which Postgres casts in the **session's** timezone. On any
cluster west of UTC the two disagree from local evening until midnight: the
`NOT EXISTS` guard never matches, and the sweep re-warns about the same
credential on every run, all night.

It was invisible because CI runs UTC. It surfaced the first time the suite was
run against a cluster on `America/Chicago`.

Fixed by comparing both sides in UTC. The regression test **pins the session
timezone** rather than trusting the machine's, so it fails on the old SQL
everywhere — including in CI — and passes on the new SQL everywhere. Proven to
fire by planting the old SQL back.

---

## 6. What is not here

- **No rate limit.** `leads.submit` is the first mutation a stranger can reach.
  It is bounded every way the frame already provides — a revocable session per
  visit, a two-entity allowlist, a constant tenancy, field lengths, an
  idempotent retry — and none of that is a rate limit; the gateway has none.
  The blast radius is bounded (rows in PROSPECT/UNASSIGNED and a noisy intake
  queue; no customer data is reachable, and the wire suite holds that), but the
  choice belongs at the edge and should be taken deliberately.
  **`docs/OPEN_DECISIONS.md`, OPEN-S1-ABUSE. S1 should not be on a public
  domain until it is made.**
- **No customer login.** The portal's sign-in lives on the portal's domain
  (05 §S1). A credential field on the one page with no session behind it is not
  a convenience.
- **No read of a lead, anywhere.** Not an operation, not a screen. The shortest
  distance between `handlers/leads.ts` and an enumeration endpoint is one
  well-meaning row in the catalogue.
