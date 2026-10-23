-- ===========================================================================
-- 0024 — AN INSTALL CREW IS NOT A TECHNICIAN.
--
-- (Partner answers 2026-10-23.) Nothing told the two apart: a crew was a
-- label and an employer, a technician's "install" was a specialty beside
-- "chillers_boilers", and a job's service_code was free text. Dispatch could
-- send a changeout to one tech or a no-cool call to a four-man install crew.
--
--   1. crews.kind — 'service' or 'install'. A technician is never on a crew
--      (partner: "they will never be considered on the crew"); credentials,
--      the shift grant and the gate all hang off a crew row, so a technician's
--      dispatch unit is a 'service' crew of ONE technician. An 'install' crew
--      is installers only — a lead, installers, helpers. A technician may work
--      the same site as an install crew, on a job of their own.
--   2. technicians.role — 'technician', or an installer role. A technician
--      goes on a service unit; an installer on an install crew. Never across.
--   3. jobs.work_class — 'service', 'install' or 'commissioning'. Install
--      work goes to an install crew; service AND commissioning go to a
--      technician (partner: "a tech always, for now").
--   4. An install job sits under the person who sold it: the job names a
--      project, and the project names its foreman. A foreman cannot be taken
--      off a project that still has install work under it.
--   5. An install is never an emergency. An emergency is a technician's call.
--
-- Existing rows: every crew is 'service', every technician 'technician',
-- every job 'service' — exactly what dispatch already treated them as. The
-- triggers read only the row being written, so a crew that already holds two
-- technicians is not refused until someone next moves one of them.
-- ===========================================================================
ALTER TABLE crews ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'service' CHECK (kind IN ('service','install'));
COMMENT ON COLUMN crews.kind IS '0024: service — one technician''s dispatch unit; install — an install crew. A technician is never on an install crew.';

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'technician' CHECK (role IN ('technician','lead_installer','installer','helper'));
COMMENT ON COLUMN technicians.role IS '0024: a technician works alone on a service unit; the installer roles work on an install crew.';

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS work_class text NOT NULL DEFAULT 'service' CHECK (work_class IN ('service','install','commissioning'));
COMMENT ON COLUMN jobs.work_class IS '0024: install goes to an install crew; service and commissioning go to a technician.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_install_sits_under_a_project') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_install_sits_under_a_project CHECK (work_class <> 'install' OR project_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_install_is_never_an_emergency') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_install_is_never_an_emergency CHECK (work_class <> 'install' OR priority <> 'emergency');
  END IF;
END $$;

-- 1 + 2: who may sit on which kind of crew.
CREATE OR REPLACE FUNCTION ac_technician_fits_the_crew() RETURNS TRIGGER AS $$
DECLARE crew_kind text;
BEGIN
  IF NEW.crew_id IS NULL THEN RETURN NEW; END IF;
  SELECT kind INTO crew_kind FROM crews WHERE id = NEW.crew_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no crew % visible for technician %', NEW.crew_id, NEW.name USING ERRCODE = 'AC422';
  END IF;
  IF NEW.role = 'technician' AND crew_kind = 'install' THEN
    RAISE EXCEPTION 'technician % is never on an install crew — a technician is dispatched on their own service unit, and may work the same site as the crew on a job of their own', NEW.name
      USING ERRCODE = 'AC422';
  END IF;
  IF NEW.role <> 'technician' AND crew_kind = 'service' THEN
    RAISE EXCEPTION '% is an installer (%) — an installer goes on an install crew, not a technician''s service unit', NEW.name, NEW.role
      USING ERRCODE = 'AC422';
  END IF;
  IF crew_kind = 'service' AND NEW.active AND EXISTS (
       SELECT 1 FROM technicians t WHERE t.crew_id = NEW.crew_id AND t.active AND t.id <> NEW.id) THEN
    RAISE EXCEPTION 'a service unit is one technician — crew % already has one; give % a unit of their own', NEW.crew_id, NEW.name
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_technician_fits_the_crew ON technicians;
CREATE TRIGGER ac_technician_fits_the_crew BEFORE INSERT OR UPDATE OF crew_id, role, active ON technicians
  FOR EACH ROW EXECUTE FUNCTION ac_technician_fits_the_crew();

-- The same sentence from the crew's side: a crew does not change kind under its people.
CREATE OR REPLACE FUNCTION ac_crew_kind_fits_its_people() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind AND EXISTS (
       SELECT 1 FROM technicians t WHERE t.crew_id = NEW.id
          AND ((NEW.kind = 'install' AND t.role = 'technician') OR (NEW.kind = 'service' AND t.role <> 'technician'))) THEN
    RAISE EXCEPTION 'crew % cannot become % — the people on it do not belong on that kind of crew; move them first', NEW.label, NEW.kind
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_crew_kind_fits_its_people ON crews;
CREATE TRIGGER ac_crew_kind_fits_its_people BEFORE UPDATE OF kind ON crews
  FOR EACH ROW EXECUTE FUNCTION ac_crew_kind_fits_its_people();

-- 4: an install job sits under the person who sold it.
CREATE OR REPLACE FUNCTION ac_install_job_has_its_seller() RETURNS TRIGGER AS $$
DECLARE seller uuid;
BEGIN
  IF NEW.work_class <> 'install' THEN RETURN NEW; END IF;
  SELECT foreman_id INTO seller FROM projects WHERE id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'install job % names no project visible here — an install sits under the project of the person who sold it', NEW.id
      USING ERRCODE = 'AC422';
  END IF;
  IF seller IS NULL THEN
    RAISE EXCEPTION 'project % names no foreman — an install sits under the person who sold it; name them on the project first', NEW.project_id
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_install_job_has_its_seller ON jobs;
CREATE TRIGGER ac_install_job_has_its_seller BEFORE INSERT OR UPDATE OF work_class, project_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION ac_install_job_has_its_seller();

CREATE OR REPLACE FUNCTION ac_project_keeps_its_seller() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.foreman_id IS NULL AND OLD.foreman_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM jobs j WHERE j.project_id = NEW.id AND j.work_class = 'install') THEN
    RAISE EXCEPTION 'project % has install work under it — its foreman is who sold it and cannot be cleared; name another instead', NEW.name
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_project_keeps_its_seller ON projects;
CREATE TRIGGER ac_project_keeps_its_seller BEFORE UPDATE OF foreman_id ON projects
  FOR EACH ROW EXECUTE FUNCTION ac_project_keeps_its_seller();

-- 3: the crew fits the work. dispatch.assign refuses by name first
-- (handlers/assignment.ts); this is the same rule where no handler can skip it.
CREATE OR REPLACE FUNCTION ac_assignment_crew_fits_the_work() RETURNS TRIGGER AS $$
DECLARE crew_kind text; work text;
BEGIN
  SELECT kind INTO crew_kind FROM crews WHERE id = NEW.crew_id;
  SELECT work_class INTO work FROM jobs WHERE id = NEW.job_id;
  IF crew_kind IS DISTINCT FROM (CASE WHEN work = 'install' THEN 'install' ELSE 'service' END) THEN
    RAISE EXCEPTION 'job % is % work and crew % is a % crew — install work goes to an install crew; service and commissioning go to a technician', NEW.job_id, work, NEW.crew_id, crew_kind
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_assignment_crew_fits_the_work ON assignments;
CREATE TRIGGER ac_assignment_crew_fits_the_work BEFORE INSERT ON assignments
  FOR EACH ROW EXECUTE FUNCTION ac_assignment_crew_fits_the_work();
