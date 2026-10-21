-- ===========================================================================
-- 0017 — PHOTOS ON A SERVICE REQUEST.
--
-- The customer attaches photos to its own request in S6. The bytes are in
-- object storage, behind packages/storage's key scheme; the database holds
-- the key (storage_objects) and whose request the photo belongs to
-- (service_request_media). Not job_media: that is the field layer's
-- append-only log keyed by a device's mutation id, and a customer's photo
-- arrives before any job exists.
--
-- Read as each namespace reads:
--   service_request_media   wherever its request is visible — service_requests'
--                           own policy decides (0006/0007): the customer at a
--                           visible site, the office by region, never a firm
--   storage_objects         an object a visible request's photo points at, or
--                           ours by region; unbound, everything
-- Written:
--   by the customer who made the request, only while no job is open against
--   it, as itself. Nobody updates or deletes a row: there is no policy for it.
--
-- storage_objects had row security OFF (OPEN-RLS-REMAINDER). It is written
-- for the first time here, so it gets its rule now, with its readers known.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS service_request_media (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  request_id uuid NOT NULL REFERENCES service_requests(id),
  storage_object_id uuid NOT NULL REFERENCES storage_objects(id),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (storage_object_id)
);
CREATE INDEX IF NOT EXISTS service_request_media_region_id_idx ON service_request_media (region_id);
CREATE INDEX IF NOT EXISTS service_request_media_request_id_created_at_idx ON service_request_media (request_id, created_at);

GRANT SELECT, INSERT ON service_request_media TO ac_gateway, ac_worker;
GRANT SELECT ON service_request_media TO ac_readonly;

-- Tenancy is inherited from the request, and the object must be the same
-- tenancy's (0002's rule): a photo row cannot carry another org's object.
-- SECURITY DEFINER for 0002's reason: the check must see the object the
-- caller has just written, which the caller's own read policy does not admit
-- until this very row exists.
CREATE OR REPLACE FUNCTION ac_media_matches_its_request() RETURNS TRIGGER AS $$
DECLARE r_org UUID; r_region UUID; o_org UUID; o_region UUID;
BEGIN
  SELECT org_id, region_id INTO r_org, r_region FROM service_requests WHERE id = NEW.request_id;
  SELECT org_id, region_id INTO o_org, o_region FROM storage_objects WHERE id = NEW.storage_object_id;
  IF r_org IS DISTINCT FROM NEW.org_id OR r_region IS DISTINCT FROM NEW.region_id
     OR o_org IS DISTINCT FROM NEW.org_id OR o_region IS DISTINCT FROM NEW.region_id THEN
    RAISE EXCEPTION 'service_request_media % does not match the tenancy of its request and its object', NEW.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS service_request_media_match_request ON service_request_media;
CREATE TRIGGER service_request_media_match_request BEFORE INSERT ON service_request_media
  FOR EACH ROW EXECUTE FUNCTION ac_media_matches_its_request();

ALTER TABLE service_request_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_request_media FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_request_media_read ON service_request_media;
DROP POLICY IF EXISTS service_request_media_insert ON service_request_media;
CREATE POLICY service_request_media_read ON service_request_media FOR SELECT
  USING (ac_unbound() OR EXISTS (SELECT 1 FROM service_requests r WHERE r.id = service_request_media.request_id));
CREATE POLICY service_request_media_insert ON service_request_media FOR INSERT
  WITH CHECK (ac_setting('ac.namespace') = 'customer'
              AND uploaded_by::text = ac_setting('ac.actor_id')
              AND EXISTS (SELECT 1 FROM service_requests r
                           WHERE r.id = service_request_media.request_id
                             AND r.requested_by::text = ac_setting('ac.actor_id')
                             AND r.job_id IS NULL));

ALTER TABLE storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_objects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_objects_read ON storage_objects;
DROP POLICY IF EXISTS storage_objects_insert ON storage_objects;
CREATE POLICY storage_objects_read ON storage_objects FOR SELECT
  USING (ac_unbound()
         OR (ac_internal() AND ac_region_visible(region_id))
         OR EXISTS (SELECT 1 FROM service_request_media m WHERE m.storage_object_id = storage_objects.id));
CREATE POLICY storage_objects_insert ON storage_objects FOR INSERT
  WITH CHECK (ac_setting('ac.namespace') = 'customer'
              AND uploaded_by::text = ac_setting('ac.actor_id')
              AND org_id::text = ac_setting('ac.org_id'));
