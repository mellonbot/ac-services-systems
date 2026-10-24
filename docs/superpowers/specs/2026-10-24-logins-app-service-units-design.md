# AC Logins — a technician's own service unit (0024)

**2026-10-24 · Design** · Amends `2026-10-21-logins-app-companies-design.md`.

## Why

The 10-21 design called a crew a **"Company (HVAC license)"**: a technician worked
under one company's license, the license hung off the crew row, so the crew was
the company, and every employed technician stood under one "AC Services DFW" crew.

Migration 0024 (partner answers, 2026-10-23) made that wrong. A technician is never
on a crew: their dispatch unit is a `service` crew of **one**, and an `install`
crew is installers only. Credentials, the shift grant and the compliance gate still
hang off the crew row — so the row is the technician's own unit, not an employer.
The employer is us (the internal org) or a contractor firm.

## What changes — AC Logins only

- **Add Technician login** asks who employs them — **Ours** (and a region) or a
  **Contractor** firm — and makes their service unit, labelled with their name,
  in the same transaction as the login. There is no crew picker.
- **Remove** a technician retires their unit with them, unless it still holds
  unreleased assignments (Dispatch releases those). **Reactivate** brings it back,
  refused under a terminated firm. A service unit is never reactivated on its own:
  it would be an empty row on the dispatch board.
- **Edit** shows the employer read-only. A login still on a shared crew or an
  install crew (made before 0024) offers **Move to their own service unit**: a new
  unit under the same employer, and the login's sessions end.
- **Companies** becomes **Crews & units**: every service unit and install crew,
  with Kind and Employer columns. **Add** makes install crews only. Install-crew
  names stay unique; two technicians may share a name, so units do not.
- The Technician list shows **Employer** and **Service unit** ("Own unit", or
  "Shared — …" / "Install crew — …" for a login that should be moved).

The rest of the platform keeps "crew". No schema, contract or gateway change.

## Not done

0024's one-technician-per-service-crew rule is held by a trigger on `technicians`,
not `users`. AC Logins never places two logins on a unit; logins already sharing a
crew are listed as such and moved one at a time.
