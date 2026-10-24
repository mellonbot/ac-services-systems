-- ===========================================================================
-- 0029 — A CHECK THAT READS ANOTHER ROW HOLDS IT, AND IS RE-RUN WHEN IT MOVES.
--
-- (Whole-repo review, 2026-10-24.) Each check below read a sum or an EXISTS
-- with no lock, so two concurrent writers both passed it; or ran on INSERT
-- only, so an UPDATE walked straight past it.
--
--   1. quantities: shipment_lines, po_receipts and rmas are summed under a
--      lock on their PO line, and re-checked when a quantity or line changes.
--   2. the crew fits the work from the job's side too: 0024 checked it when
--      an assignment was written, and a job's work_class could then change
--      under a live crew of the wrong kind.
--   3. a service unit is one technician: the check holds the crew row, so
--      two technicians put on one unit at once cannot both pass.
--   4. a clearance's window is read in the region's days, and its upper bound
--      is exclusive, as the range says.
-- ===========================================================================

-- 1. ------------------------------------------------------------------------
-- The lock only. A vendor records shipment lines but may not UPDATE the PO
-- line, and FOR UPDATE reads through UPDATE policies — so taking the lock as
-- the caller would hide the line from a vendor. This reads nothing back; the
-- check below still reads the ordered quantity through the caller's row
-- security, and refuses a line it cannot see.
CREATE OR REPLACE FUNCTION ac_lock_po_line(line UUID) RETURNS VOID AS $$
  SELECT NULL::void FROM (SELECT 1 FROM purchase_order_lines WHERE id = line FOR UPDATE) l
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION ac_quantity_within_order() RETURNS TRIGGER AS $$
DECLARE ordered BIGINT; already BIGINT; limit_qty BIGINT; what TEXT;
BEGIN
  IF NEW.quantity_milli <= 0 THEN
    RAISE EXCEPTION '%: a quantity is more than zero', TG_TABLE_NAME USING ERRCODE = 'AC422';
  END IF;
  -- Concurrent writers to one line queue here; each sum below is read after
  -- the one before it committed.
  PERFORM ac_lock_po_line(NEW.po_line_id);
  SELECT quantity_milli INTO ordered FROM purchase_order_lines WHERE id = NEW.po_line_id;
  IF ordered IS NULL THEN
    RAISE EXCEPTION '%: line % is not visible in this scope', TG_TABLE_NAME, NEW.po_line_id USING ERRCODE = 'AC422';
  END IF;
  -- id <> NEW.id: on UPDATE the row's old quantity is not "already".
  IF TG_TABLE_NAME = 'shipment_lines' THEN
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM shipment_lines WHERE po_line_id = NEW.po_line_id AND id <> NEW.id;
    limit_qty := ordered; what := 'ordered';
  ELSIF TG_TABLE_NAME = 'po_receipts' THEN
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM po_receipts WHERE po_line_id = NEW.po_line_id AND id <> NEW.id;
    limit_qty := ordered; what := 'ordered';
  ELSE
    SELECT COALESCE(sum(quantity_milli), 0) INTO limit_qty FROM po_receipts WHERE po_line_id = NEW.po_line_id;
    SELECT COALESCE(sum(quantity_milli), 0) INTO already FROM rmas WHERE po_line_id = NEW.po_line_id AND state <> 'rejected' AND id <> NEW.id;
    what := 'received';
  END IF;
  IF already + NEW.quantity_milli > limit_qty THEN
    RAISE EXCEPTION '%: % thousandths on top of % already would exceed the % % on line %',
      TG_TABLE_NAME, NEW.quantity_milli, already, limit_qty, what, NEW.po_line_id USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipment_lines','po_receipts','rmas'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_within_order', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF quantity_milli, po_line_id ON %I FOR EACH ROW EXECUTE FUNCTION ac_quantity_within_order()', t || '_within_order', t);
  END LOOP;
END $$;

-- 2. ------------------------------------------------------------------------
-- The UPDATE holds the job's row; assignCrew takes the same lock before it
-- writes an assignment, so the two queue rather than cross.
CREATE OR REPLACE FUNCTION ac_job_work_fits_its_crew() RETURNS TRIGGER AS $$
DECLARE c RECORD;
BEGIN
  IF NEW.work_class IS NOT DISTINCT FROM OLD.work_class THEN RETURN NEW; END IF;
  SELECT cr.label, cr.kind INTO c
    FROM assignments a JOIN crews cr ON cr.id = a.crew_id
   WHERE a.job_id = NEW.id AND a.released_at IS NULL
     AND cr.kind IS DISTINCT FROM (CASE WHEN NEW.work_class = 'install' THEN 'install' ELSE 'service' END)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'job % cannot become % work while % (a % crew) is on it — install work goes to an install crew; service and commissioning go to a technician. Release the crew first', NEW.id, NEW.work_class, c.label, c.kind
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ac_job_work_fits_its_crew ON jobs;
CREATE TRIGGER ac_job_work_fits_its_crew BEFORE UPDATE OF work_class ON jobs
  FOR EACH ROW EXECUTE FUNCTION ac_job_work_fits_its_crew();

-- 3. ------------------------------------------------------------------------
-- 0024's function, the crew read now FOR UPDATE. Technicians are written by
-- the office only (0020), which may lock the crews it can see.
CREATE OR REPLACE FUNCTION ac_technician_fits_the_crew() RETURNS TRIGGER AS $$
DECLARE crew_kind text;
BEGIN
  IF NEW.crew_id IS NULL THEN RETURN NEW; END IF;
  -- Two technicians put on one unit at once: the second waits here, then
  -- sees the first in the EXISTS below.
  SELECT kind INTO crew_kind FROM crews WHERE id = NEW.crew_id FOR UPDATE;
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

-- 4. ------------------------------------------------------------------------
-- 0004's function, the window's days now read where the work is. It cast
-- lower/upper(service_window)::date in the session's TimeZone — the server's
-- clock, not the job's — and closed the [) window's exclusive upper bound,
-- so a window ending at local midnight demanded the next day too. The days
-- are now the region's (regions.timezone), and the last day is the one the
-- window's final instant falls on. The gateway's dry run reads the same days
-- (handlers/assignment.ts credentialsOf).
CREATE OR REPLACE FUNCTION ac_clearance_is_earned() RETURNS trigger AS $$
DECLARE
  cred RECORD;
  cid TEXT;
  tz TEXT;
  first_day DATE;
  last_day DATE;
BEGIN
  IF jsonb_typeof(NEW.credential_ids) <> 'array' OR jsonb_array_length(NEW.credential_ids) = 0 THEN
    RAISE EXCEPTION 'a clearance names the credentials that earned it'
    USING ERRCODE = 'AC422';
  END IF;
  SELECT timezone INTO tz FROM regions WHERE id = NEW.region_id;
  IF tz IS NULL THEN
    RAISE EXCEPTION 'clearance names region %, which this caller cannot see — its days cannot be read', NEW.region_id
    USING ERRCODE = 'AC422';
  END IF;
  first_day := (lower(NEW.service_window) AT TIME ZONE tz)::date;
  last_day := ((upper(NEW.service_window) - interval '1 microsecond') AT TIME ZONE tz)::date;
  FOR cid IN SELECT jsonb_array_elements_text(NEW.credential_ids) LOOP
    SELECT crew_id, valid_from, valid_to, verified_at INTO cred FROM crew_credentials WHERE id = cid::uuid;
    IF cred IS NULL OR cred.crew_id <> NEW.crew_id THEN
      RAISE EXCEPTION 'clearance cites credential % which does not belong to crew %', cid, NEW.crew_id
    USING ERRCODE = 'AC422';
    END IF;
    IF cred.verified_at IS NULL THEN
      RAISE EXCEPTION 'clearance cites unverified credential %', cid
    USING ERRCODE = 'AC422';
    END IF;
    IF NOT (daterange(cred.valid_from, cred.valid_to, '[]') @> daterange(first_day, last_day, '[]')) THEN
      RAISE EXCEPTION 'credential % [% .. %] does not cover clearance window % (% .. % in %)', cid, cred.valid_from, cred.valid_to, NEW.service_window, first_day, last_day, tz
    USING ERRCODE = 'AC422';
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
