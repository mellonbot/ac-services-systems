-- ===========================================================================
-- 0020 — THE TECHNICIAN ROSTER.
--
-- (Scope 2026-10-21: the Technician Network shows, per firm and for our own
-- AC Services DFW crews, every technician's name, home address, phone and
-- specialty. Partner answers: the office keeps it in S2; specialty is a fixed
-- multi-pick list; home addresses are for account owners only.)
--
--   1. technicians — one row per person who works our jobs, independent of
--      whether they hold a login. firm_id null is ours.
--   2. RLS: internal principals only, region-bound like crews. No firm, no
--      customer, no device reads this table — S8 is not given the roster.
--      Who inside the office sees the address is the gateway's (account_owner).
--   3. A technician's crew belongs to the same employer: a firm's tech on a
--      firm's crew of that firm, one of ours on one of our employed crews.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS technicians (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  firm_id uuid REFERENCES subcontractor_firms(id),
  crew_id uuid REFERENCES crews(id),
  name text NOT NULL,
  phone text,
  home_address jsonb,
  specialties jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(specialties) = 'array' AND specialties <@ '["residential_hvac","light_commercial","commercial_rtu","refrigeration","chillers_boilers","controls_bas","install","ductwork"]'::jsonb),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS technicians_region_id_idx ON technicians (region_id);
CREATE INDEX IF NOT EXISTS technicians_firm_id_idx ON technicians (firm_id);
CREATE INDEX IF NOT EXISTS technicians_crew_id_idx ON technicians (crew_id);

GRANT SELECT, INSERT, UPDATE ON technicians TO ac_gateway, ac_worker;
GRANT SELECT ON technicians TO ac_readonly;

ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS technicians_internal_only ON technicians;
CREATE POLICY technicians_internal_only ON technicians
  USING (ac_setting('ac.namespace') = 'internal' AND ac_region_visible(region_id));

CREATE OR REPLACE FUNCTION ac_technician_crew_is_the_employers() RETURNS TRIGGER AS $$
DECLARE crew_firm uuid;
BEGIN
  IF NEW.crew_id IS NULL THEN RETURN NEW; END IF;
  SELECT firm_id INTO crew_firm FROM crews WHERE id = NEW.crew_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no crew % visible for technician %', NEW.crew_id, NEW.name USING ERRCODE = 'AC422';
  END IF;
  IF crew_firm IS DISTINCT FROM NEW.firm_id THEN
    RAISE EXCEPTION 'technician % and crew % have different employers — a technician is put on a crew of the firm (or of ours) they work for', NEW.name, NEW.crew_id
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_technician_crew_is_the_employers ON technicians;
CREATE TRIGGER ac_technician_crew_is_the_employers BEFORE INSERT OR UPDATE OF crew_id, firm_id ON technicians
  FOR EACH ROW EXECUTE FUNCTION ac_technician_crew_is_the_employers();
