-- ===========================================================================
-- 0028 — WRITES ARE HELD AT THE TABLE, NOT ONLY AT THE GATEWAY.
--
-- (Whole-repo review, 2026-10-24.) Read isolation held; writes did not. A
-- `FOR ALL ... USING` policy with no WITH CHECK admits every row a principal
-- can SEE as a row it can WRITE, and an invoker trigger that reads through the
-- caller's row security sees NULL where a row is hidden and skips its check.
-- The gateway's write allowlist stopped all of this over HTTP; the table did
-- not, and the table is the boundary this repository says it relies on.
-- Probed against a live cluster before this migration:
--
--   a customer      deactivated its own region node (accounts), forged a
--                   created→complete transition (job_state_events), and
--                   pushed its SLA due date out ten years (sla_timers);
--   a firm          activated itself and skipped its MSA
--                   (subcontractor_firms), priced its own work (rate_cards),
--                   released its own assignment, and — through the gate
--                   trigger reading a job it could not see — assigned itself
--                   another customer's job and so gained sight of it;
--   a device        read and wrote every job, crew and credential in its
--                   region (0023 narrowed three tables of fourteen);
--   anyone, anonymous included, appended outbox and audit rows under any
--                   actor, org and region.
--
-- Now:
--   1. the office's tables are written by the office (internal) and the
--      system binding only — RESTRICTIVE, so no permissive policy widens it;
--      job_state_events also by a device, for a job its crew was sent to;
--   2. an audit or outbox row names the actor its transaction is bound as;
--   3. a device reads and writes its crew's work, not its region's;
--   4. the clearance gate refuses an assignment whose job it cannot read,
--      or whose org is not the job's.
--
-- Left as it is: 0004 re-created ac_accounts_derive_region without 0002's
-- SECURITY DEFINER. That fails closed — a parent the caller cannot see is
-- refused as "no parent" — and widening a trigger to read past the caller's
-- row security is the shape of defect 4 fixes. It stays invoker, on purpose.
-- ===========================================================================

-- 1. -------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','sla_timers','assignments','compliance_clearances','rate_cards','subcontractor_firms'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_writers_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_writers_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_writers_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT
      WITH CHECK (ac_unbound() OR ac_internal())$p$, t || '_writers_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE
      USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal())$p$, t || '_writers_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE
      USING (ac_unbound() OR ac_internal())$p$, t || '_writers_delete', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS job_state_events_writers_insert ON job_state_events;
DROP POLICY IF EXISTS job_state_events_writers_update ON job_state_events;
DROP POLICY IF EXISTS job_state_events_writers_delete ON job_state_events;
CREATE POLICY job_state_events_writers_insert ON job_state_events AS RESTRICTIVE FOR INSERT
  WITH CHECK (ac_unbound() OR ac_internal() OR (ac_setting('ac.namespace') = 'device' AND ac_device_crew_job(job_id)));
-- A transition that happened is history: nobody but the system rewrites it.
CREATE POLICY job_state_events_writers_update ON job_state_events AS RESTRICTIVE FOR UPDATE
  USING (ac_unbound()) WITH CHECK (ac_unbound());
CREATE POLICY job_state_events_writers_delete ON job_state_events AS RESTRICTIVE FOR DELETE
  USING (ac_unbound());

-- 2. -------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_log_authored ON audit_log;
DROP POLICY IF EXISTS outbox_authored ON outbox;
CREATE POLICY audit_log_authored ON audit_log AS RESTRICTIVE FOR INSERT
  WITH CHECK (ac_unbound() OR actor_id::text = ac_setting('ac.actor_id'));
CREATE POLICY outbox_authored ON outbox AS RESTRICTIVE FOR INSERT
  WITH CHECK (ac_unbound() OR actor_id::text = ac_setting('ac.actor_id'));

-- 3. -------------------------------------------------------------------------
-- The crews a device's live grants are for. Reads device_grants only, whose
-- device rule names the device and nothing else, so no policy below recurses.
CREATE OR REPLACE FUNCTION ac_device_crews() RETURNS uuid[] AS $$
  SELECT COALESCE(array_agg(g.crew_id), '{}')
    FROM device_grants g
   WHERE g.device_id::text = ac_setting('ac.device_id') AND g.revoked_at IS NULL
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  rule RECORD;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
      ('jobs',                  'ac_device_crew_job(id)'),
      ('job_state_events',      'ac_device_crew_job(job_id)'),
      ('sla_timers',            'ac_device_crew_job(job_id)'),
      ('assignments',           'crew_id = ANY (ac_device_crews())'),
      ('compliance_clearances', 'crew_id = ANY (ac_device_crews())'),
      ('crews',                 'id = ANY (ac_device_crews())'),
      ('crew_credentials',      'crew_id = ANY (ac_device_crews())'),
      ('projects',              'EXISTS (SELECT 1 FROM jobs j WHERE j.project_id = projects.id)')
    ) AS v(tbl, pred)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', rule.tbl || '_device_crew', rule.tbl);
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE
      USING (ac_setting('ac.namespace') IS DISTINCT FROM 'device' OR (%s))
      WITH CHECK (ac_setting('ac.namespace') IS DISTINCT FROM 'device' OR (%s))$p$,
      rule.tbl || '_device_crew', rule.tbl, rule.pred, rule.pred);
  END LOOP;
END $$;

-- 4. -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_assignment_requires_clearance() RETURNS trigger AS $$
DECLARE
  j RECORD;
  c RECORD;
BEGIN
  SELECT service_window, region_id, org_id INTO j FROM jobs WHERE id = NEW.job_id;
  -- Hidden and absent read the same here, and both are a refusal: every check
  -- below compares against j, and a comparison with NULL is never false.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment names job %, which this caller cannot see', NEW.job_id
    USING ERRCODE = 'AC422';
  END IF;
  SELECT crew_id, service_window INTO c FROM compliance_clearances WHERE id = NEW.clearance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment has no compliance clearance'
    USING ERRCODE = 'AC422';
  END IF;
  IF c.crew_id <> NEW.crew_id THEN
    RAISE EXCEPTION 'clearance % was issued for a different crew', NEW.clearance_id
    USING ERRCODE = 'AC422';
  END IF;
  IF NOT (c.service_window @> j.service_window) THEN
    RAISE EXCEPTION
      'clearance % covers % but the job window is % — a certificate that expires mid-window does not clear the job',
      NEW.clearance_id, c.service_window, j.service_window
    USING ERRCODE = 'AC422';
  END IF;
  IF NEW.region_id <> j.region_id THEN
    RAISE EXCEPTION 'assignment region % does not match job region %', NEW.region_id, j.region_id
    USING ERRCODE = 'AC422';
  END IF;
  IF NEW.org_id <> j.org_id THEN
    RAISE EXCEPTION 'assignment org % does not match job org %', NEW.org_id, j.org_id
    USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
