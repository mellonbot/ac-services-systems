-- ===========================================================================
-- 0015 — JOB NOTES AND THE RETURN-TRIP FLAG.
--
-- The dispatch dashboard flags jobs that owe a second visit and shows what
-- the office last wrote about each. Neither had a home: a note lived in
-- somebody's head or the old system, and "return trip" was read out of that
-- text by eye. Two places for them now:
--
--   jobs.return_trip   a flag, set by hand (jobs.setReturnTrip, S3). Not
--                      derived from note text — a keyword match is a guess,
--                      and a guess on a dispatcher's board is a wrong truck.
--   job_notes          append-only, one row per note (jobs.addNote, S3).
--                      The board shows the latest; the rows are who said
--                      what, when, and are never edited — a correction is a
--                      newer note.
--
-- Read as each namespace reads, before any screen names the table:
--   internal     its region's notes, or every region's at parent scope —
--                the same rule as the job itself (ac_region_visible)
--   customer     none. A dispatcher's note ("customer wants a call before
--                we roll a truck") is written about the customer, not to
--                them; S6 reads null where S3 reads the note.
--   subcontractor, vendor, anonymous   none
--   unbound      every row — the worker and the warehouse role read whole
--                tables, as 0008's call_records does.
--
-- Tenancy is inherited from the job (0002's rule): a note's org and region
-- are its job's, checked here rather than trusted from the writer.
-- ===========================================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS return_trip boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN jobs.return_trip IS '0015: a second visit is owed on this job. The office''s flag, set by hand — not read out of the notes.';

CREATE TABLE IF NOT EXISTS job_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS job_notes_region_id_idx ON job_notes (region_id);
CREATE INDEX IF NOT EXISTS job_notes_job_id_created_at_idx ON job_notes (job_id, created_at);

-- A table created after 0002 gets its grants here or not at all. INSERT and
-- SELECT only: a note is never updated or deleted, and the trigger below
-- says so to anyone who holds more.
GRANT SELECT, INSERT ON job_notes TO ac_gateway, ac_worker;
GRANT SELECT ON job_notes TO ac_readonly;

DROP TRIGGER IF EXISTS job_notes_immutable ON job_notes;
CREATE TRIGGER job_notes_immutable
  BEFORE UPDATE OR DELETE ON job_notes
  FOR EACH ROW EXECUTE FUNCTION ac_audit_is_immutable();

CREATE OR REPLACE FUNCTION ac_job_notes_match_job() RETURNS TRIGGER AS $$
DECLARE
  j RECORD;
BEGIN
  SELECT org_id, region_id INTO j FROM jobs WHERE id = NEW.job_id;
  IF j IS NULL THEN
    RAISE EXCEPTION 'job_notes: job % is not visible in this scope', NEW.job_id USING ERRCODE = 'AC422';
  END IF;
  IF NEW.org_id <> j.org_id OR NEW.region_id <> j.region_id THEN
    RAISE EXCEPTION 'job_notes: tenancy (org %, region %) does not match its job (org %, region %). Tenancy is inherited, not typed.',
      NEW.org_id, NEW.region_id, j.org_id, j.region_id USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS job_notes_match_job ON job_notes;
CREATE TRIGGER job_notes_match_job BEFORE INSERT ON job_notes
  FOR EACH ROW EXECUTE FUNCTION ac_job_notes_match_job();

ALTER TABLE job_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_notes_read ON job_notes;
DROP POLICY IF EXISTS job_notes_insert ON job_notes;
CREATE POLICY job_notes_read ON job_notes FOR SELECT
  USING (ac_unbound() OR (ac_internal() AND ac_region_visible(region_id)));
CREATE POLICY job_notes_insert ON job_notes FOR INSERT
  WITH CHECK (ac_internal() AND ac_region_visible(region_id));
