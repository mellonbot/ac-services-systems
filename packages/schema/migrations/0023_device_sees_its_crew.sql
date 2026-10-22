-- ===========================================================================
-- 0023 — A DEVICE SEES ITS CREW'S WORK, NOT ITS REGION.
--
-- (Whole-repo review, 2026-10-22.) A shift grant read every customer's site
-- tree in its region (`accounts`), every crew's hours (`time_entries`) and
-- every job's checklist (`checklist_items`). A tablet left in a truck was a
-- region's customer list and roster. Now a device reads a site, an hour or
-- a checklist answer only for a job its crew has been sent to — the same
-- line sync.replay holds a write to (handlers/sync.ts), drawn the same way a
-- firm's view is drawn in 0007.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ac_device_crew_job(row_job UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignments a JOIN device_grants g ON g.crew_id = a.crew_id
     WHERE a.job_id = row_job AND g.device_id::text = ac_setting('ac.device_id') AND g.revoked_at IS NULL)
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION ac_account_visible(row_id uuid, row_org uuid, row_region uuid, row_path uuid[]) RETURNS boolean AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'internal'      THEN true
    WHEN 'device'        THEN row_region::text = ac_setting('ac.region_id')
                              AND EXISTS (SELECT 1 FROM jobs j WHERE j.site_id = row_id AND ac_device_crew_job(j.id))
    WHEN 'subcontractor' THEN EXISTS (SELECT 1 FROM jobs j WHERE j.site_id = row_id)
    WHEN 'customer'      THEN row_org::text = ac_setting('ac.org_id')
                              AND (ac_setting('ac.scope_tier') = 'parent'
                                   OR ac_setting('ac.scope_id')::uuid = ANY(row_path)   -- the subtree
                                   OR row_id = ANY(ac_scope_ancestors()))               -- the breadcrumb
    ELSE false END
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_entries','checklist_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_visibility', t);
    EXECUTE format($p$CREATE POLICY %I ON %I
      USING (ac_unbound() OR ac_internal() OR (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id') AND ac_device_crew_job(job_id)))
      WITH CHECK (ac_unbound() OR ac_internal() OR (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id') AND ac_device_crew_job(job_id)))$p$,
      t || '_visibility', t);
  END LOOP;
END $$;
