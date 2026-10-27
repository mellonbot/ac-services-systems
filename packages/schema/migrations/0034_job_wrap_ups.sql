-- ===========================================================================
-- 0034 — A TECHNICIAN WRAPS UP A VISIT.
--
-- (Partner answers 2026-10-27.) Completing a job from the field now says how
-- it was closed: Complete, or Quote needed. Either way the visit completes;
-- the wrap-up records the notes, the customer's signature or why there is
-- none, and for Quote needed the RTU measurements the office prices from.
-- Photos and the signature are job_media rows the device uploaded first
-- (jobs.attachMedia); jobs.wrapUp counts them before it writes anything.
--
--   1. One wrap-up per job, written once, by the device whose crew holds the
--      job. A replay of the same submit (wrap_up_id) finds it, not a second.
--   2. "Quote needed" opens a QUOTE job at the site. A device cannot open a
--      job — the SLA comes from the site's terms, which only the office reads
--      — so the worker does it (sweepQuoteJobs) and writes back quote_job_id,
--      or why it could not yet (quote_error). Those two columns are the only
--      thing that ever changes here, and only the worker can change them.
--   3. The office reads its regions' wrap-ups; a device, its crew's.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS job_wrap_ups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  wrap_up_id text NOT NULL,
  crew_id uuid NOT NULL REFERENCES crews(id),
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('complete','quote_needed')),
  notes text CHECK (notes IS NULL OR length(btrim(notes)) BETWEEN 1 AND 4000),
  measurements jsonb,
  signature_media_id uuid REFERENCES job_media(id),
  customer_absent_reason text,
  quote_job_id uuid REFERENCES jobs(id),
  quote_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (job_id),
  UNIQUE (wrap_up_id),
  CONSTRAINT job_wrap_ups_measured_quote CHECK ((outcome = 'quote_needed') = (measurements IS NOT NULL)),
  CONSTRAINT job_wrap_ups_signed_or_absent CHECK ((signature_media_id IS NULL) <> (customer_absent_reason IS NULL)),
  CONSTRAINT job_wrap_ups_absent_says_why CHECK (customer_absent_reason IS NULL OR length(btrim(customer_absent_reason)) BETWEEN 3 AND 500),
  CONSTRAINT job_wrap_ups_quote_only_from_quote CHECK (quote_job_id IS NULL OR outcome = 'quote_needed')
);
CREATE INDEX IF NOT EXISTS job_wrap_ups_region_id_idx ON job_wrap_ups (region_id);
CREATE INDEX IF NOT EXISTS job_wrap_ups_quote_job_id_idx ON job_wrap_ups (quote_job_id);
CREATE INDEX IF NOT EXISTS job_wrap_ups_region_id_idx ON job_wrap_ups (region_id);
CREATE INDEX IF NOT EXISTS job_wrap_ups_quote_job_id_idx ON job_wrap_ups (quote_job_id);

-- On a fresh database 0002's GRANT ON ALL TABLES reached this table first
-- (0001 creates it); end in the same place either way.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON job_wrap_ups FROM ac_gateway, ac_worker, ac_readonly;
GRANT SELECT, INSERT ON job_wrap_ups TO ac_gateway;
GRANT SELECT ON job_wrap_ups TO ac_worker, ac_readonly;
GRANT UPDATE (quote_job_id, quote_error) ON job_wrap_ups TO ac_worker;

ALTER TABLE job_wrap_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_wrap_ups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_wrap_ups_read ON job_wrap_ups;
DROP POLICY IF EXISTS job_wrap_ups_submit ON job_wrap_ups;
DROP POLICY IF EXISTS job_wrap_ups_quote ON job_wrap_ups;

-- 3.
CREATE POLICY job_wrap_ups_read ON job_wrap_ups FOR SELECT USING (
  ac_unbound()
  OR (ac_internal() AND ac_region_visible(region_id))
  OR (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id') AND ac_device_crew_job(job_id)));

-- 1.
CREATE POLICY job_wrap_ups_submit ON job_wrap_ups FOR INSERT WITH CHECK (
  ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id') AND ac_device_crew_job(job_id)
  AND submitted_by::text = ac_setting('ac.actor_id'));

-- 2.
CREATE POLICY job_wrap_ups_quote ON job_wrap_ups FOR UPDATE
  USING (ac_internal() AND ac_region_visible(region_id))
  WITH CHECK (ac_internal() AND ac_region_visible(region_id));

-- A wrap-up's photos and signature are stored objects like a request's
-- photos (0017), uploaded by the device through jobs.attachMedia: a device
-- writes one as itself, in its own region, and reads the objects behind the
-- job_media rows it can see.
DROP POLICY IF EXISTS storage_objects_read ON storage_objects;
DROP POLICY IF EXISTS storage_objects_insert ON storage_objects;
CREATE POLICY storage_objects_read ON storage_objects FOR SELECT
  USING (ac_unbound()
         OR (ac_internal() AND ac_region_visible(region_id))
         OR EXISTS (SELECT 1 FROM service_request_media m WHERE m.storage_object_id = storage_objects.id)
         OR (ac_setting('ac.namespace') = 'device' AND EXISTS (SELECT 1 FROM job_media jm WHERE jm.storage_key = storage_objects.storage_key)));
CREATE POLICY storage_objects_insert ON storage_objects FOR INSERT
  WITH CHECK (uploaded_by::text = ac_setting('ac.actor_id')
              AND ((ac_setting('ac.namespace') = 'customer' AND org_id::text = ac_setting('ac.org_id'))
                   OR (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id'))));
