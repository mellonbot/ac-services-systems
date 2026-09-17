-- ===========================================================================
-- 0005 — THE NETWORK REGISTRY (C4). Two mechanisms, both for a sentence the
-- design has said since 05 Rev D and nothing has enforced until now:
--
--   "Only S2 verifies a credential — the sole path that sets verified_at.
--    An unverified certificate is not a certificate."
--
-- The write allowlist cannot hold that sentence on its own. `crew_credential`
-- is an entity label the unit of work checks; the TABLE is reachable by any
-- role with INSERT/UPDATE on it, and S8's `compliance_doc` intake — when it
-- lands — writes the same table. So the rule lives where every path meets:
--
--   1. ac_credential_verification_is_earned
--        INSERT: verified_at and verified_by are NULL. A document ARRIVES
--                unverified, whoever records it.                     (AC422)
--        UPDATE: NULL → set is permitted only to an internal principal acting
--                AS S2, and verified_by must be that principal.       (AC403)
--                Once set, the document is immutable — kind, identifier,
--                window, storage key, crew, verification. A correction is a
--                new document; the gate cited the old one by id.      (AC403)
--
--   2. Firm isolation for the SUBCONTRACTOR namespace on the three tables a
--      firm reads about itself. 0002 bound crews and crew_credentials by
--      region only, which is right for a dispatcher and wrong for a firm: a
--      firm principal in South could list every South crew, including the
--      other firms'. subcontractor_firms had no policy at all.
--
-- Nothing here changes a table. tools/ci/schema-guard.ts §3d holds the ERRCODE
-- on every RAISE below, and §1 still finds region_id total.
-- ===========================================================================

CREATE OR REPLACE FUNCTION ac_credential_verification_is_earned() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL THEN
      RAISE EXCEPTION 'a credential is recorded unverified — verification is a separate act (credentials.verify), not a field on the document'
        USING ERRCODE = 'AC422', HINT = 'Record the document, then verify it.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE.
  IF OLD.verified_at IS NOT NULL THEN
    IF NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.identifier IS DISTINCT FROM OLD.identifier
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
       OR NEW.valid_to IS DISTINCT FROM OLD.valid_to
       OR NEW.document_key IS DISTINCT FROM OLD.document_key
       OR NEW.crew_id IS DISTINCT FROM OLD.crew_id THEN
      RAISE EXCEPTION 'credential % was verified at % and is immutable — a clearance may already cite it by id. Record a new document.', OLD.id, OLD.verified_at
        USING ERRCODE = 'AC403';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL THEN
    IF ac_setting('ac.namespace') IS DISTINCT FROM 'internal' OR ac_setting('ac.surface_id') IS DISTINCT FROM 'S2' THEN
      RAISE EXCEPTION 'only the Service Manager (S2) verifies a credential; this write came from % as %',
        COALESCE(ac_setting('ac.surface_id'), 'no surface'), COALESCE(ac_setting('ac.namespace'), 'no principal')
        USING ERRCODE = 'AC403';
    END IF;
    IF NEW.verified_at IS NULL OR NEW.verified_by IS NULL OR NEW.verified_by::text IS DISTINCT FROM ac_setting('ac.actor_id') THEN
      RAISE EXCEPTION 'verification names the principal who did it: verified_by must be the acting principal (%), and verified_at must be set with it',
        COALESCE(ac_setting('ac.actor_id'), 'unknown')
        USING ERRCODE = 'AC422';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ac_credential_verification_is_earned ON crew_credentials;
CREATE TRIGGER ac_credential_verification_is_earned
  BEFORE INSERT OR UPDATE ON crew_credentials
  FOR EACH ROW EXECUTE FUNCTION ac_credential_verification_is_earned();

-- ---------------------------------------------------------------------------
-- Firm isolation. Internal principals see across firms (S2 is the registry);
-- a subcontractor principal sees its own firm, its own crews, its own
-- documents; every other namespace sees nothing on these tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_firm_visible(row_firm UUID) RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal'
      OR (ac_setting('ac.namespace') = 'subcontractor' AND row_firm::text = ac_setting('ac.firm_id'))
$$ LANGUAGE sql STABLE;

ALTER TABLE subcontractor_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_firms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subcontractor_firms_firm_isolation ON subcontractor_firms;
CREATE POLICY subcontractor_firms_firm_isolation ON subcontractor_firms
  USING (ac_firm_visible(id));

-- crews: a dispatcher's region view stays; a firm additionally needs the crew to be its own.
DROP POLICY IF EXISTS crews_region_isolation ON crews;
CREATE POLICY crews_region_isolation ON crews
  USING (ac_region_visible(region_id)
         AND (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor' OR firm_id::text = ac_setting('ac.firm_id')));

-- crew_credentials: the document belongs to the crew's firm.
DROP POLICY IF EXISTS crew_credentials_region_isolation ON crew_credentials;
CREATE POLICY crew_credentials_region_isolation ON crew_credentials
  USING (ac_region_visible(region_id)
         AND (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor'
              OR EXISTS (SELECT 1 FROM crews c WHERE c.id = crew_credentials.crew_id AND c.firm_id::text = ac_setting('ac.firm_id'))));
