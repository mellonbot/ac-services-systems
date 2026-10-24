-- ===========================================================================
-- 0030 — A JOB HAS A NUMBER A PERSON CAN READ ALOUD.
--
-- (Partner answers 2026-10-24.) A job was only its uuid. Dispatch, the
-- technician, the invoice and the customer's AP now share one number:
--
--     SOUTH-2610-1417-3
--     │     │    │    └ check digit (Damm) over YYMM and the sequence
--     │     │    └───── sequence in the region for the month
--     │     └────────── YYMM of opened_at, in the region's timezone
--     └──────────────── regions.code
--
--   1. Only what never changes goes in it. Region is the shard boundary and
--      the month is when the job was opened; priority, work class, service
--      code and customer are all re-decided at triage, and a number that
--      carried them would be wrong afterwards or would have to be re-issued
--      under every invoice and PO that cites it.
--   2. One counter per region per month, so regions never wait on each other.
--      The counter row is the lock: two jobs opened at once in one region
--      queue on it, and neither can take the other's number.
--   3. Each month starts at a random 1000–4999 (partner: a number should not
--      tell a customer how many jobs we ran this month). The sequence is
--      therefore four digits from the first job, and has at least 5000 of
--      headroom before it grows to five.
--   4. The check digit is a Damm digit: it catches every single wrong digit
--      and every swap of two adjacent digits — the two mistakes made reading
--      a number over the phone. ac_job_no_valid() is what a lookup calls
--      before it searches.
--   5. Assigned at insert, by the table, whatever the caller sent; refused on
--      update. Jobs are not opened offline (partner), so there is no
--      provisional number to reconcile.
--
-- Existing rows are numbered here in the order they were opened, under the
-- same rules. A renamed region keeps its old code in the numbers it already
-- issued: the number is a record of where the job was opened, not a pointer.
-- ===========================================================================

-- 2 + 3. --------------------------------------------------------------------
-- The table exists already on a fresh database (0001); this is the same DDL
-- for one that ran 0001 before it was declared.
CREATE TABLE IF NOT EXISTS job_number_counters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}$'),
  last_seq integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (region_id, month)
);
CREATE INDEX IF NOT EXISTS job_number_counters_region_id_idx ON job_number_counters (region_id);

-- Nobody reads or writes it but ac_take_job_seq(), which runs as its owner.
-- The privilege is the gate; the policy is there because every table is
-- behind forced row security with one (migrate.ts --assert).
REVOKE ALL ON job_number_counters FROM PUBLIC, ac_gateway, ac_worker, ac_readonly;
ALTER TABLE job_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_number_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_number_counters_owner ON job_number_counters;
CREATE POLICY job_number_counters_owner ON job_number_counters USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION ac_take_job_seq(region UUID, yymm TEXT) RETURNS INTEGER AS $$
  INSERT INTO job_number_counters (org_id, region_id, month, last_seq)
  VALUES ('00000000-0000-0000-0000-000000000003', region, yymm, 1000 + floor(random() * 4000)::int)
  ON CONFLICT (region_id, month) DO UPDATE SET last_seq = job_number_counters.last_seq + 1
  RETURNING last_seq
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION ac_take_job_seq(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ac_take_job_seq(UUID, TEXT) TO ac_gateway, ac_worker;

-- 4. ------------------------------------------------------------------------
-- The Damm digit of a string of digits. Appending it makes the string's own
-- Damm digit 0, which is the whole of the validation below.
CREATE OR REPLACE FUNCTION ac_damm(digits TEXT) RETURNS INTEGER AS $$
DECLARE
  q CONSTANT TEXT := '0317598642' || '7092154863' || '4206871359' || '1750983426' || '6123045978'
                  || '3674209581' || '5869720134' || '8945362017' || '9438617205' || '2581436790';
  i INTEGER := 0;
  d TEXT;
BEGIN
  FOREACH d IN ARRAY regexp_split_to_array(digits, '') LOOP
    i := substr(q, i * 10 + d::int + 1, 1)::int;
  END LOOP;
  RETURN i;
END $$ LANGUAGE plpgsql IMMUTABLE STRICT;

-- True when the text is a job number whose check digit holds. It does not
-- say the job exists, or that the caller may see it.
CREATE OR REPLACE FUNCTION ac_job_no_valid(job_no TEXT) RETURNS BOOLEAN AS $$
  SELECT m IS NOT NULL AND ac_damm(m[1] || m[2] || m[3]) = 0
    FROM (SELECT regexp_match(job_no, '^[A-Z0-9_]+-([0-9]{4})-([0-9]{4,})-([0-9])$') AS m) x
$$ LANGUAGE sql IMMUTABLE STRICT;

-- 1. ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_next_job_no(region UUID, opened TIMESTAMPTZ) RETURNS TEXT AS $$
DECLARE r RECORD; yymm TEXT; seq TEXT;
BEGIN
  SELECT code, timezone INTO r FROM regions WHERE id = region;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'region %, which this caller cannot see, cannot number a job', region USING ERRCODE = 'AC422';
  END IF;
  yymm := to_char(opened AT TIME ZONE r.timezone, 'YYMM');
  seq := ac_take_job_seq(region, yymm)::text;
  RETURN r.code || '-' || yymm || '-' || seq || '-' || ac_damm(yymm || seq);
END $$ LANGUAGE plpgsql;

-- 5. ------------------------------------------------------------------------
-- Named to fire after jobs_inherit_tenancy (BEFORE triggers run in name
-- order), so a job whose region disagrees with its site is refused before it
-- spends a number.
CREATE OR REPLACE FUNCTION ac_job_number() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.job_no IS DISTINCT FROM OLD.job_no THEN
      RAISE EXCEPTION 'job % is % for good — a job number is never changed', OLD.id, OLD.job_no USING ERRCODE = 'AC422';
    END IF;
    RETURN NEW;
  END IF;
  NEW.job_no := ac_next_job_no(NEW.region_id, NEW.opened_at);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Existing rows, in the order they were opened.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_no text;
COMMENT ON COLUMN jobs.job_no IS '0030: what people read — REGION-YYMM-SEQ-CHECK. Assigned at insert, never changed. The id is still what everything references.';
DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN SELECT id, region_id, opened_at FROM jobs WHERE job_no IS NULL ORDER BY opened_at, id LOOP
    UPDATE jobs SET job_no = ac_next_job_no(j.region_id, j.opened_at) WHERE id = j.id;
  END LOOP;
END $$;
ALTER TABLE jobs ALTER COLUMN job_no SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_job_no_key') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_job_no_key UNIQUE (job_no);
  END IF;
END $$;

DROP TRIGGER IF EXISTS jobs_number ON jobs;
CREATE TRIGGER jobs_number BEFORE INSERT OR UPDATE OF job_no ON jobs
  FOR EACH ROW EXECUTE FUNCTION ac_job_number();
