-- ===========================================================================
-- 0016 — JOB DETAIL: STANDING NOTES, CUSTOMER UPDATES, THE CUSTOMER THREAD.
--
-- S3's job detail separates what the office says to itself from what the
-- customer is told. Three things, each with one home:
--
--   job_notes.kind     'standing' marks the note every tech should read
--                      before rolling; the newest standing note is the job's.
--                      Still append-only and internal (0015) — a new
--                      standing note replaces the old one by being newer.
--   job_updates        what the customer is told, written by dispatch —
--                      usually from an internal note — as a DRAFT no customer
--                      can read, then PUBLISHED. A published update is never
--                      edited (trigger); a correction is a new update.
--   job_messages       the customer ↔ dispatch thread. Append-only. Who
--                      wrote a row is the writer's namespace, checked here:
--                      a customer cannot post as the office.
--
-- Read as each namespace reads:
--   internal       every row, in its region (ac_region_visible) — drafts too
--   customer       PUBLISHED updates and the thread, on a job it may see
--                  (0006's rule, through jobs' own policy); never a draft,
--                  never a note
--   subcontractor, vendor, anonymous, device   none
--   unbound        every row (worker, warehouse role)
-- Tenancy is inherited from the job, checked by trigger (0002's rule).
-- ===========================================================================
ALTER TABLE job_notes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_notes_kind_check') THEN
    ALTER TABLE job_notes ADD CONSTRAINT job_notes_kind_check CHECK (kind IN ('note','standing'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS job_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  source_note_id uuid REFERENCES job_notes(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published')),
  author_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT job_updates_published_is_stamped CHECK ((state = 'published') = (published_at IS NOT NULL AND published_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS job_updates_region_id_idx ON job_updates (region_id);
CREATE INDEX IF NOT EXISTS job_updates_job_id_created_at_idx ON job_updates (job_id, created_at);

CREATE TABLE IF NOT EXISTS job_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  author_kind text NOT NULL CHECK (author_kind IN ('customer','office')),
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS job_messages_region_id_idx ON job_messages (region_id);
CREATE INDEX IF NOT EXISTS job_messages_job_id_created_at_idx ON job_messages (job_id, created_at);

GRANT SELECT, INSERT, UPDATE ON job_updates TO ac_gateway, ac_worker;
GRANT SELECT, INSERT ON job_messages TO ac_gateway, ac_worker;
GRANT SELECT ON job_updates, job_messages TO ac_readonly;

-- Tenancy is the job's, whoever writes.
CREATE OR REPLACE FUNCTION ac_row_matches_its_job() RETURNS TRIGGER AS $$
DECLARE
  j RECORD;
BEGIN
  SELECT org_id, region_id INTO j FROM jobs WHERE id = NEW.job_id;
  IF j IS NULL THEN
    RAISE EXCEPTION '%: job % is not visible in this scope', TG_TABLE_NAME, NEW.job_id USING ERRCODE = 'AC422';
  END IF;
  IF NEW.org_id <> j.org_id OR NEW.region_id <> j.region_id THEN
    RAISE EXCEPTION '%: tenancy (org %, region %) does not match its job (org %, region %). Tenancy is inherited, not typed.',
      TG_TABLE_NAME, NEW.org_id, NEW.region_id, j.org_id, j.region_id USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS job_updates_match_job ON job_updates;
CREATE TRIGGER job_updates_match_job BEFORE INSERT OR UPDATE OF job_id, org_id, region_id ON job_updates
  FOR EACH ROW EXECUTE FUNCTION ac_row_matches_its_job();
DROP TRIGGER IF EXISTS job_messages_match_job ON job_messages;
CREATE TRIGGER job_messages_match_job BEFORE INSERT ON job_messages
  FOR EACH ROW EXECUTE FUNCTION ac_row_matches_its_job();

-- The thread is append-only; an update is editable only while it is a draft.
DROP TRIGGER IF EXISTS job_messages_immutable ON job_messages;
CREATE TRIGGER job_messages_immutable BEFORE UPDATE OR DELETE ON job_messages
  FOR EACH ROW EXECUTE FUNCTION ac_audit_is_immutable();

CREATE OR REPLACE FUNCTION ac_job_update_published_is_final() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'job_updates: an update is never deleted — a draft that should not go out stays a draft' USING ERRCODE = 'AC403';
  END IF;
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'job_updates: update % was published to the customer at % and is final — a correction is a new update', OLD.id, OLD.published_at USING ERRCODE = 'AC403';
  END IF;
  IF NEW.job_id <> OLD.job_id OR NEW.source_note_id IS DISTINCT FROM OLD.source_note_id OR NEW.author_id <> OLD.author_id THEN
    RAISE EXCEPTION 'job_updates: a draft keeps its job, its source note and its author; only the words and the publish change' USING ERRCODE = 'AC403';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS job_updates_published_is_final ON job_updates;
CREATE TRIGGER job_updates_published_is_final BEFORE UPDATE OR DELETE ON job_updates
  FOR EACH ROW EXECUTE FUNCTION ac_job_update_published_is_final();

-- A customer's job, by jobs' own policy (0006 for a customer). Namespace-gated
-- first: ac_job_row_visible alone would also admit a firm (0007).
CREATE OR REPLACE FUNCTION ac_customer_job_visible(row_job UUID) RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'customer' AND ac_job_row_visible(row_job)
$$ LANGUAGE sql STABLE;

ALTER TABLE job_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_updates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_updates_read ON job_updates;
DROP POLICY IF EXISTS job_updates_insert ON job_updates;
DROP POLICY IF EXISTS job_updates_update ON job_updates;
CREATE POLICY job_updates_read ON job_updates FOR SELECT
  USING (ac_unbound()
         OR (ac_internal() AND ac_region_visible(region_id))
         OR (state = 'published' AND ac_customer_job_visible(job_id)));
CREATE POLICY job_updates_insert ON job_updates FOR INSERT
  WITH CHECK (ac_internal() AND ac_region_visible(region_id) AND state = 'draft');
CREATE POLICY job_updates_update ON job_updates FOR UPDATE
  USING (ac_internal() AND ac_region_visible(region_id))
  WITH CHECK (ac_internal() AND ac_region_visible(region_id));

ALTER TABLE job_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_messages_read ON job_messages;
DROP POLICY IF EXISTS job_messages_insert ON job_messages;
CREATE POLICY job_messages_read ON job_messages FOR SELECT
  USING (ac_unbound()
         OR (ac_internal() AND ac_region_visible(region_id))
         OR ac_customer_job_visible(job_id));
CREATE POLICY job_messages_insert ON job_messages FOR INSERT
  WITH CHECK ((author_kind = 'office' AND ac_internal() AND ac_region_visible(region_id))
              OR (author_kind = 'customer' AND ac_customer_job_visible(job_id)
                  AND author_id::text = ac_setting('ac.actor_id')));
