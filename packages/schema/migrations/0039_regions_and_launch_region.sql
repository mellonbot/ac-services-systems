-- ===========================================================================
-- 0039 — OUR REGIONS ARE KEPT IN S2, AND THE LAUNCH REGION EXISTS.
--
-- Until now the only region a fresh database held was 0001's "Unassigned
-- (pre-account)", the structural home of anonymous principals and leads, and
-- every S2 create form offered it because it was the only one. A region could
-- be opened only in SQL.
--
--   1. DFW, "Dallas–Fort Worth", is seeded here: the owner's launch region
--      (2026-10-31). Keyed on its code, so a database where someone already
--      opened a DFW by hand keeps that row — its id, name and standing — and
--      a second run changes nothing.
--   2. regions.create / regions.update / regions.setActive are gateway
--      operations, written by a principal only (S2 writeRoles region:
--      [principal]). `regions` already admits an internal writer (0008's
--      regions_write) and ac_gateway already holds INSERT and UPDATE on it
--      (0002), so no policy or grant changes.
--   3. Unassigned is neither renamed, deactivated nor offered: regions.list
--      marks it `assignable: false`, and every gateway door that takes a
--      region refuses it by name. It is not deleted and not moved — the
--      anonymous principal and the PROSPECT rows still live in it.
-- ===========================================================================
INSERT INTO regions (code, name, timezone, min_crew_density, active)
VALUES ('DFW', 'Dallas–Fort Worth', 'America/Chicago', 0, true)
ON CONFLICT (code) DO NOTHING;
