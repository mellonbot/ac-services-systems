-- ===========================================================================
-- 0025 — WHAT A JOB IS FOR, AND WHAT A PERSON IS QUALIFIED ON.
--
-- Two cleanups 0024 left behind.
--
--   1. A specialty is equipment, never work. "install" and "ductwork" sat on
--      the specialty list beside "chillers_boilers"; since 0024 the kind of
--      work a person does is their role (technicians.role). Both leave the
--      list, and the rows that carried them drop them. Nothing is inferred
--      from them: a "technician" tagged install stays a technician until the
--      office says otherwise, because moving them onto an install crew is a
--      decision about their crew, not a data repair.
--
--   2. The service catalogue. jobs.service_code was free text — seventeen
--      spellings for about five kinds of work — and nothing tied a code to
--      the work class 0024 dispatches on. Now:
--        service_codes   the catalogue, mirrored from SERVICE_CATALOG in
--                        packages/contracts (repeatable R_service_codes.sql)
--        jobs.service_code REFERENCES it — NOT VALID, so a job opened before
--                        this migration under a code we cannot map is still
--                        readable, and every write from now on is checked
--        a trigger       holds a job's work class to its code's
--      The known spellings of SERVICE work are mapped to their code. Install
--      spellings (CONDENSER-INSTALL, rtu_changeout) are NOT: those jobs were
--      opened with no sale on record, and turning them into install work
--      would put them under a project nobody sold. They keep their text for
--      the office to settle.
-- ===========================================================================

-- 1. Specialties.
UPDATE technicians SET specialties = specialties - 'install' - 'ductwork'
 WHERE specialties ?| ARRAY['install', 'ductwork'];
ALTER TABLE technicians DROP CONSTRAINT IF EXISTS technicians_specialties_check;
ALTER TABLE technicians ADD CONSTRAINT technicians_specialties_check
  CHECK (jsonb_typeof(specialties) = 'array' AND specialties <@ '["residential_hvac","light_commercial","commercial_rtu","refrigeration","chillers_boilers","controls_bas"]'::jsonb);

-- 2. The catalogue. The rows here are the catalogue as it stood when this
-- migration was written, so the mapping below has codes to point at; the
-- repeatable mirror keeps it in step with the code from here on.
CREATE TABLE IF NOT EXISTS service_codes (
  code text NOT NULL,
  label text NOT NULL,
  work_class text NOT NULL CHECK (work_class IN ('service','install','commissioning')),
  PRIMARY KEY (code)
);
GRANT SELECT ON service_codes TO ac_gateway, ac_worker, ac_readonly;
REVOKE INSERT, UPDATE, DELETE ON service_codes FROM ac_gateway, ac_worker, ac_readonly;

INSERT INTO service_codes (code, label, work_class) VALUES
  ('DIAGNOSTIC', 'Diagnostic', 'service'),
  ('HVAC-REPAIR', 'Repair', 'service'),
  ('PM-VISIT', 'Preventive maintenance', 'service'),
  ('WARRANTY-CALLBACK', 'Warranty callback', 'service'),
  ('EQUIPMENT-CHANGEOUT', 'Equipment changeout', 'install'),
  ('NEW-INSTALL', 'New installation', 'install'),
  ('DUCTWORK', 'Ductwork', 'install'),
  ('STARTUP-COMMISSIONING', 'Startup & commissioning', 'commissioning')
ON CONFLICT (code) DO NOTHING;

-- The service spellings found in the system, normalised (upper case, runs of
-- '_' or ' ' read as '-') and mapped to their code.
UPDATE jobs j SET service_code = m.code
  FROM (VALUES
    ('HVAC-REPAIR', 'HVAC-REPAIR'), ('REPAIR-HVAC', 'HVAC-REPAIR'), ('REPAIRS', 'HVAC-REPAIR'), ('REPAIR', 'HVAC-REPAIR'),
    ('EMERG-CALL', 'HVAC-REPAIR'), ('COMPRESSOR-REPLACEMENT', 'HVAC-REPAIR'),
    ('PM-VISIT', 'PM-VISIT'), ('PM-RTU', 'PM-VISIT'), ('PM-Q2', 'PM-VISIT'), ('PM-QTR', 'PM-VISIT'),
    ('PM-SPRING', 'PM-VISIT'), ('SPRING-TUNE-UP', 'PM-VISIT'), ('PM-ROUTE', 'PM-VISIT'),
    ('DIAGNOSTIC', 'DIAGNOSTIC'), ('WARRANTY-CALLBACK', 'WARRANTY-CALLBACK')
  ) AS m(spelling, code)
 WHERE upper(regexp_replace(btrim(j.service_code), '[_ ]+', '-', 'g')) = m.spelling
   AND j.service_code IS DISTINCT FROM m.code;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_service_code_fkey') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_service_code_fkey FOREIGN KEY (service_code) REFERENCES service_codes (code) NOT VALID;
  END IF;
END $$;

-- A job's work class is its code's. Checked on every write that names either;
-- a job under a code the catalogue does not hold (opened before 0025) is not
-- reached by this, and is refused by the FK the moment its code is touched.
CREATE OR REPLACE FUNCTION ac_job_work_is_its_services() RETURNS TRIGGER AS $$
DECLARE s RECORD;
BEGIN
  SELECT label, work_class INTO s FROM service_codes WHERE code = NEW.service_code;
  IF FOUND AND s.work_class <> NEW.work_class THEN
    RAISE EXCEPTION '% is % work, and this job says %. A job''s work is its service''s — pick the service that is the work', s.label, s.work_class, NEW.work_class
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_job_work_is_its_services ON jobs;
CREATE TRIGGER ac_job_work_is_its_services BEFORE INSERT OR UPDATE OF service_code, work_class ON jobs
  FOR EACH ROW EXECUTE FUNCTION ac_job_work_is_its_services();

-- service_codes is global reference data (tenancy.ts GLOBAL_REFERENCE_TABLES):
-- the assertion that region_id is total names it as an exception. 0003 is
-- frozen, so the function is redefined here; schema-guard reads the latest.
CREATE OR REPLACE FUNCTION ac_assert_region_id_everywhere() RETURNS void AS $$
DECLARE
  offender TEXT;
  -- The two allowlists, mirrored from packages/schema/src/tenancy.ts.
  -- They are short on purpose and they are the whole exception surface.
  tenancy_roots TEXT[] := ARRAY['organizations','regions'];
  global_refs   TEXT[] := ARRAY['currencies','part_manufacturers','schema_migrations','service_codes','term_registry'];
BEGIN
  SELECT string_agg(t.table_name, ', ') INTO offender
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND NOT (t.table_name = ANY(tenancy_roots))
    AND NOT (t.table_name = ANY(global_refs))
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t.table_name
        AND c.column_name = 'region_id' AND c.is_nullable = 'NO'
    );

  IF offender IS NOT NULL THEN
    RAISE EXCEPTION
      'region_id is not total. Offending tables: %. Either the table is operational (add it via operationalTable()) or it is an exception (name it in a reviewed diff in tenancy.ts AND here).',
      offender;
  END IF;
END $$ LANGUAGE plpgsql;
