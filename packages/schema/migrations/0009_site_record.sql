-- ===========================================================================
-- 0009 — THE SITE RECORD (item 9, S6 site card). Read as a customer, again.
--
-- The customer portal's home is a tree of sites. Each site's line said what
-- was happening there (open work, waiting requests) and nothing about what
-- the site IS: where it is, what runs on its roof, who lets a crew in, what
-- it has been billed for. The site card answers that from four tables. The
-- method is 0006's: bind a transaction as a customer principal and read
-- those tables as it reads, BEFORE any screen names them.
--
-- Bound as a facility manager at one Austin site, before this migration:
--
--   equipment          NO POLICY — every unit at every site of every
--                      customer, with its serial number. Not "the region's":
--                      RLS was never enabled on the table.
--   invoices           0002's rule is `org_id = ac.org_id`, so a manager
--                      scoped to ONE location reads the parent's every
--                      invoice nationwide. Tier scoping, the acceptance test
--                      S6 passed on `accounts` and `jobs`, did not hold here.
--   invoice_lines      NO POLICY — every line of every invoice of every
--                      customer: the description, the quantity, the price.
--   job_media          NO POLICY — every photo and signature key.
--   parts_used         NO POLICY — every part on every job.
--   warranty_cases     NO POLICY — every claim, the amount, the decision.
--
-- None of it through a screen. Before 0006 that sentence covered jobs; before
-- 0007, settlements; before 0008, leads. It is not a mechanism, and this is
-- the fourth migration to say so. Every table above now carries the rule its
-- shape implies, in the one place the question is already answered:
--
--   a row that hangs off a JOB is visible exactly when the job is
--     (`jobs`' own policy decides — 0006's ac_work_visible for a customer,
--      0007's firm rule for a firm, the region rule for us);
--   a row that hangs off a SITE or NODE is visible exactly when the node is
--     (`accounts`' own policy decides);
--   an INVOICE is visible to a customer when one of its lines is, and a
--     LINE when the job it bills is visible — or, for a line with no job,
--     when the location it itemises is. A firm sees none of it: a firm's
--     money is `settlements`, and a customer's invoice is not its business.
--
-- Two tables are new. `job_equipment` says which units a job was about, so
-- "last serviced" is a fact about the work rather than a date somebody
-- remembers to update. `account_contacts` gives the customer's on-site
-- manager a row — S6's `contact_update` write, in the registry since 05, now
-- has a table to land in; the write itself stays S2's until the customer's
-- own edit is decided (OPEN-S6-CONTACTS).
--
-- Writing: the internal namespace alone, on every table here that a customer
-- reads. 0006 learned it on `contracts` and this migration does not relearn
-- it: a USING-only policy is also the INSERT check, and a customer's own org
-- passes it. tools/ci/schema-guard.ts §3d holds the ERRCODE on every RAISE.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- New columns and tables, for a database that already ran 0001 without them.
-- On a fresh database 0001 (regenerated) created all of this and every
-- statement below is a no-op. The definitions are the source of truth:
-- packages/schema/src/tables/hierarchy.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'other';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS label text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_kind_check') THEN
    ALTER TABLE equipment ADD CONSTRAINT equipment_kind_check
      CHECK (kind IN ('rtu','split','package','ahu','chiller','boiler','heat_pump','mini_split','vrf','exhaust','mau','controls','other'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS account_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  role text NOT NULL DEFAULT 'site_manager' CHECK (role IN ('site_manager','facilities','accounts_payable','security','other')),
  name text NOT NULL,
  phone text,
  email text,
  note text,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS account_contacts_region_id_idx ON account_contacts (region_id);
CREATE INDEX IF NOT EXISTS account_contacts_account_id_idx ON account_contacts (account_id);

CREATE TABLE IF NOT EXISTS job_equipment (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  equipment_id uuid NOT NULL REFERENCES equipment(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (job_id, equipment_id)
);
CREATE INDEX IF NOT EXISTS job_equipment_region_id_idx ON job_equipment (region_id);
CREATE INDEX IF NOT EXISTS job_equipment_equipment_id_idx ON job_equipment (equipment_id);

-- 0002 granted on ALL TABLES as they stood; a table created afterwards gets
-- its grants here or not at all. The gateway and the worker read and write;
-- the warehouse role reads.
GRANT SELECT, INSERT, UPDATE ON account_contacts, job_equipment TO ac_gateway, ac_worker;
GRANT SELECT ON account_contacts, job_equipment TO ac_readonly;

-- ---------------------------------------------------------------------------
-- Tenancy is inherited, not typed (0002's rule, extended to the two new
-- tables). A contact takes its org and region from its node; a job_equipment
-- row takes them from its job — and the unit it names must be at that job's
-- site, or the row is a lie about where the work happened.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS account_contacts_inherit_tenancy ON account_contacts;
CREATE TRIGGER account_contacts_inherit_tenancy BEFORE INSERT OR UPDATE OF account_id, org_id, region_id ON account_contacts
  FOR EACH ROW EXECUTE FUNCTION ac_inherit_tenancy_from_account('account_id');

CREATE OR REPLACE FUNCTION ac_job_equipment_is_at_the_jobs_site() RETURNS TRIGGER AS $$
DECLARE
  j RECORD;
  e RECORD;
BEGIN
  SELECT org_id, region_id, site_id INTO j FROM jobs WHERE id = NEW.job_id;
  IF j IS NULL THEN
    RAISE EXCEPTION 'job_equipment: job % is not visible in this scope', NEW.job_id USING ERRCODE = 'AC422';
  END IF;
  SELECT site_id, active INTO e FROM equipment WHERE id = NEW.equipment_id;
  IF e IS NULL THEN
    RAISE EXCEPTION 'job_equipment: equipment % is not visible in this scope', NEW.equipment_id USING ERRCODE = 'AC422';
  END IF;
  IF e.site_id <> j.site_id THEN
    RAISE EXCEPTION 'job_equipment: equipment % is not at the job''s site — a job names the units at the site it was opened for', NEW.equipment_id USING ERRCODE = 'AC422';
  END IF;
  IF NEW.org_id <> j.org_id OR NEW.region_id <> j.region_id THEN
    RAISE EXCEPTION 'job_equipment: tenancy (org %, region %) does not match its job (org %, region %). Tenancy is inherited, not typed.',
      NEW.org_id, NEW.region_id, j.org_id, j.region_id USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS job_equipment_is_at_the_jobs_site ON job_equipment;
CREATE TRIGGER job_equipment_is_at_the_jobs_site BEFORE INSERT OR UPDATE ON job_equipment
  FOR EACH ROW EXECUTE FUNCTION ac_job_equipment_is_at_the_jobs_site();

-- ---------------------------------------------------------------------------
-- Writing is ours. One predicate, used as the INSERT/UPDATE check on every
-- table below that a customer reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_site_record_writable() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal'
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Rows that hang off a NODE: visible exactly when the node is. `accounts`'
-- policy already answers "may this principal see this node" for every
-- namespace — the subtree, the breadcrumb, the region, everything — so the
-- EXISTS asks it rather than restating it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_node_row_visible(row_account UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM accounts a WHERE a.id = row_account)
$$ LANGUAGE sql STABLE;

ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS equipment_read ON equipment;
DROP POLICY IF EXISTS equipment_insert ON equipment;
DROP POLICY IF EXISTS equipment_update ON equipment;
CREATE POLICY equipment_read   ON equipment FOR SELECT USING (ac_node_row_visible(site_id));
CREATE POLICY equipment_insert ON equipment FOR INSERT WITH CHECK (ac_site_record_writable() AND ac_node_row_visible(site_id));
CREATE POLICY equipment_update ON equipment FOR UPDATE USING (ac_site_record_writable() AND ac_node_row_visible(site_id)) WITH CHECK (ac_site_record_writable());

ALTER TABLE account_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_contacts_read ON account_contacts;
DROP POLICY IF EXISTS account_contacts_insert ON account_contacts;
DROP POLICY IF EXISTS account_contacts_update ON account_contacts;
CREATE POLICY account_contacts_read   ON account_contacts FOR SELECT USING (ac_node_row_visible(account_id));
CREATE POLICY account_contacts_insert ON account_contacts FOR INSERT WITH CHECK (ac_site_record_writable() AND ac_node_row_visible(account_id));
CREATE POLICY account_contacts_update ON account_contacts FOR UPDATE USING (ac_site_record_writable() AND ac_node_row_visible(account_id)) WITH CHECK (ac_site_record_writable());

-- ---------------------------------------------------------------------------
-- Rows that hang off a JOB: visible exactly when the job is. `jobs`' policy
-- is 0006's for a customer and 0007's for a firm; whichever it is, it is the
-- one answer, and these five tables stop having their own.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_job_row_visible(row_job UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM jobs j WHERE j.id = row_job)
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_equipment','job_media','parts_used','warranty_cases'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_job_visibility', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (ac_job_row_visible(job_id))', t || '_job_visibility', t);
  END LOOP;
END $$;

-- A customer reads its units' service history and writes none of it. The
-- field layer (device namespace) and the office write job_media, parts_used
-- and warranty_cases through their own allowlists; job_equipment is the
-- office's, and — when S5 grows the stamp — the device's.
DROP POLICY IF EXISTS job_equipment_job_visibility ON job_equipment;
DROP POLICY IF EXISTS job_equipment_read ON job_equipment;
DROP POLICY IF EXISTS job_equipment_insert ON job_equipment;
CREATE POLICY job_equipment_read   ON job_equipment FOR SELECT USING (ac_job_row_visible(job_id));
CREATE POLICY job_equipment_insert ON job_equipment FOR INSERT
  WITH CHECK (ac_setting('ac.namespace') IN ('internal', 'device') AND ac_job_row_visible(job_id));

-- ---------------------------------------------------------------------------
-- MONEY. An invoice line bills a job at a site, or itemises a location. A
-- customer sees the line when it may see that job — or, for a line with no
-- job, that location. It sees the invoice when it may see one of its lines,
-- so a manager scoped to one location reads the consolidated parent invoice
-- and, on it, its own location's lines and nothing beside. We see
-- everything; a firm sees nothing here (its money is `settlements`).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_invoice_line_visible(row_org UUID, row_job UUID, row_location UUID) RETURNS BOOLEAN AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'internal' THEN true
    WHEN 'customer' THEN row_org::text = ac_setting('ac.org_id')
                         AND CASE WHEN row_job IS NOT NULL THEN ac_job_row_visible(row_job)
                                  ELSE ac_node_row_visible(row_location) END
    ELSE false END
$$ LANGUAGE sql STABLE;

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_lines_read ON invoice_lines;
DROP POLICY IF EXISTS invoice_lines_insert ON invoice_lines;
DROP POLICY IF EXISTS invoice_lines_update ON invoice_lines;
CREATE POLICY invoice_lines_read   ON invoice_lines FOR SELECT USING (ac_invoice_line_visible(org_id, job_id, location_id));
CREATE POLICY invoice_lines_insert ON invoice_lines FOR INSERT WITH CHECK (ac_site_record_writable());
CREATE POLICY invoice_lines_update ON invoice_lines FOR UPDATE USING (ac_site_record_writable()) WITH CHECK (ac_site_record_writable());

CREATE OR REPLACE FUNCTION ac_invoice_visible(row_id UUID, row_org UUID) RETURNS BOOLEAN AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'internal' THEN true
    WHEN 'customer' THEN row_org::text = ac_setting('ac.org_id')
                         AND EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = row_id)
    ELSE false END
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS invoices_org_isolation ON invoices;
DROP POLICY IF EXISTS invoices_read ON invoices;
DROP POLICY IF EXISTS invoices_insert ON invoices;
DROP POLICY IF EXISTS invoices_update ON invoices;
CREATE POLICY invoices_read   ON invoices FOR SELECT USING (ac_invoice_visible(id, org_id));
CREATE POLICY invoices_insert ON invoices FOR INSERT WITH CHECK (ac_site_record_writable());
CREATE POLICY invoices_update ON invoices FOR UPDATE USING (ac_site_record_writable()) WITH CHECK (ac_site_record_writable());
