-- ===========================================================================
-- 0033 — A TECHNICIAN CLOCKS IN AND OUT OF A SHIFT.
--
-- time_entries costs a job: every row names one, so a crew could not clock in
-- before its first job, and the drive between jobs counted for nobody. A
-- shift punch pays a person. It is written by the device through sync.replay
-- (append-only: the tablet was offline, the tap still happened), one row per
-- clock-in or clock-out, and the timesheet pairs each in with the next out.
--
--   1. A punch names its shift grant, and the grant is the only one the
--      writing device holds: device, crew and technician come with it, so a
--      tablet cannot punch someone else in, and a revoked grant punches
--      nobody.
--   2. A device reads its own technician's punches — every shift, every
--      device — and no one else's. The office reads its regions'.
--   3. A punch is never edited and never deleted. A wrong one is the
--      office's to answer, beside it; the record of what was tapped stays.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS shift_punches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  grant_id uuid NOT NULL REFERENCES device_grants(id),
  technician_id uuid NOT NULL REFERENCES users(id),
  crew_id uuid NOT NULL REFERENCES crews(id),
  kind text NOT NULL CHECK (kind IN ('in','out')),
  punched_at timestamptz NOT NULL,
  mutation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (grant_id, mutation_id)
);
CREATE INDEX IF NOT EXISTS shift_punches_region_id_idx ON shift_punches (region_id);
CREATE INDEX IF NOT EXISTS shift_punches_technician_id_punched_at_idx ON shift_punches (technician_id, punched_at);
CREATE INDEX IF NOT EXISTS shift_punches_grant_id_idx ON shift_punches (grant_id);

-- 3. Read and add, never change. On a fresh database 0002's GRANT ON ALL
-- TABLES reached this table first (0001 creates it), so what it gave is
-- taken back here rather than assumed absent (as 0010 does for its rollup).
REVOKE UPDATE, DELETE, TRUNCATE ON shift_punches FROM ac_gateway, ac_worker, ac_readonly;
REVOKE INSERT ON shift_punches FROM ac_worker, ac_readonly;
GRANT SELECT, INSERT ON shift_punches TO ac_gateway;
GRANT SELECT ON shift_punches TO ac_worker, ac_readonly;

ALTER TABLE shift_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_punches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shift_punches_read ON shift_punches;
DROP POLICY IF EXISTS shift_punches_punch ON shift_punches;

-- 2.
CREATE POLICY shift_punches_read ON shift_punches FOR SELECT USING (
  ac_unbound()
  OR (ac_internal() AND ac_region_visible(region_id))
  OR (ac_setting('ac.namespace') = 'device' AND technician_id::text = ac_setting('ac.actor_id')));

-- 1.
CREATE POLICY shift_punches_punch ON shift_punches FOR INSERT WITH CHECK (
  ac_setting('ac.namespace') = 'device'
  AND EXISTS (
    SELECT 1 FROM device_grants g
     WHERE g.id = shift_punches.grant_id AND g.revoked_at IS NULL
       AND g.device_id::text = ac_setting('ac.device_id')
       AND g.technician_id = shift_punches.technician_id AND g.technician_id::text = ac_setting('ac.actor_id')
       AND g.crew_id = shift_punches.crew_id
       AND g.org_id = shift_punches.org_id AND g.region_id = shift_punches.region_id));
