-- ===========================================================================
-- 0036 — THE GATEWAY CAN TELL ONE OF OUR CREWS FROM A FIRM'S.
--
-- Messages (0035) decide "employee" with an EXISTS on crews: an active
-- internal login with no firm, and not sitting on a crew that belongs to a
-- firm. That statement runs as the gateway itself (ac.namespace = 'system').
--
-- crews_region_isolation does not admit that binding. ac_region_visible is
-- true for an internal parent, or for the bound region, and a system
-- transaction sets neither — so the EXISTS matches nothing. Every employed
-- technician, the people with a crew_id, dropped out of the directory and
-- out of an everyone-send. Office staff, who have no crew, still matched.
--
-- This admits the gateway itself to SELECT crews, and nothing else. A
-- transaction that bound nobody still sees zero crews: ac_unbound() is
-- 'system', not an unset namespace. INSERT and UPDATE stay on
-- crews_region_isolation. Device login still binds the shift's region
-- before it reads the crew, and that read is unchanged.
-- ===========================================================================
DROP POLICY IF EXISTS crews_system_read ON crews;
CREATE POLICY crews_system_read ON crews FOR SELECT
  USING (ac_unbound());
