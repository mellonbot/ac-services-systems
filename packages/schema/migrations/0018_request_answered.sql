-- ===========================================================================
-- 0018 — A REQUEST IS ANSWERED ONCE, BY THE OFFICE, WITH A JOB AT ITS SITE.
--
-- S3's Intake opens a job against a customer's request (serviceRequests.openJob)
-- and sets service_requests.job_id. Two rules hold that link on every path,
-- not only through the handler:
--
--   1. The link is final, and it names a job at the request's own site and
--      tenancy. A request is not re-pointed, and an answer at another site is
--      not an answer. (SECURITY DEFINER for 0002's reason: the check reads the
--      job past the caller's own scope.)
--   2. Only the office updates a request. 0006's policy has USING alone, which
--      for UPDATE also let a customer rewrite its own row — its description, or
--      the job_id that 0017's photo policy reads. A restrictive policy narrows
--      UPDATE to ours; reading and the customer's own INSERT are unchanged.
--
-- Also: 0017's tenancy trigger raised P0001, which the gateway cannot tell from
-- a bug (0004) — a 500 that flips a surface degraded. Redefined here with AC422,
-- body unchanged, because 0017 has already run where it matters.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ac_media_matches_its_request() RETURNS TRIGGER AS $$
DECLARE r_org UUID; r_region UUID; o_org UUID; o_region UUID;
BEGIN
  SELECT org_id, region_id INTO r_org, r_region FROM service_requests WHERE id = NEW.request_id;
  SELECT org_id, region_id INTO o_org, o_region FROM storage_objects WHERE id = NEW.storage_object_id;
  IF r_org IS DISTINCT FROM NEW.org_id OR r_region IS DISTINCT FROM NEW.region_id
     OR o_org IS DISTINCT FROM NEW.org_id OR o_region IS DISTINCT FROM NEW.region_id THEN
    RAISE EXCEPTION 'service_request_media % does not match the tenancy of its request and its object', NEW.id
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION ac_request_answer_is_final() RETURNS TRIGGER AS $$
DECLARE j_site UUID; j_org UUID; j_region UUID;
BEGIN
  IF OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN
    RAISE EXCEPTION 'service request % is already answered by job %; the link is final', OLD.id, OLD.job_id
      USING ERRCODE = 'AC422';
  END IF;
  IF NEW.job_id IS NOT NULL AND OLD.job_id IS NULL THEN
    SELECT site_id, org_id, region_id INTO j_site, j_org, j_region FROM jobs WHERE id = NEW.job_id;
    IF j_site IS DISTINCT FROM NEW.site_id OR j_org IS DISTINCT FROM NEW.org_id OR j_region IS DISTINCT FROM NEW.region_id THEN
      RAISE EXCEPTION 'job % is not at the site of service request %', NEW.job_id, NEW.id
        USING ERRCODE = 'AC422';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
DROP TRIGGER IF EXISTS service_requests_answer_is_final ON service_requests;
CREATE TRIGGER service_requests_answer_is_final BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION ac_request_answer_is_final();

DROP POLICY IF EXISTS service_requests_office_updates ON service_requests;
CREATE POLICY service_requests_office_updates ON service_requests AS RESTRICTIVE FOR UPDATE
  USING (ac_unbound() OR ac_internal())
  WITH CHECK (ac_unbound() OR ac_internal());
