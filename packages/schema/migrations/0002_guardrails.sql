-- GUARDRAILS THAT TYPES CANNOT REACH: scripts, migrations, psql sessions, and
-- every service that does not exist yet. Each block names the non-negotiable it
-- holds and the failure it prevents.

-- ===========================================================================
-- Roles. The surfaces hold none of them. (non-negotiable #3)
-- ===========================================================================
DO $$ BEGIN
  CREATE ROLE ac_migrator NOLOGIN;   -- DDL, term_registry, seeds
  CREATE ROLE ac_gateway  NOLOGIN;   -- the sole application role
  CREATE ROLE ac_worker   NOLOGIN;   -- outbox relay, sweeps, cascade
  CREATE ROLE ac_readonly NOLOGIN;   -- warehouse extract, S4's ancestor
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO ac_gateway, ac_worker, ac_readonly;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ac_gateway;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ac_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ac_readonly;
-- Nothing in this schema is ever DELETEd by a runtime role. Rows are ended, not removed.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM ac_gateway, ac_worker, ac_readonly;

-- The term register is code. Its mirror is written by migrations only.
REVOKE INSERT, UPDATE, DELETE ON term_registry FROM ac_gateway, ac_worker, ac_readonly;

-- ===========================================================================
-- Non-negotiable #4: the audit log is append-only, at the privilege layer AND
-- at the trigger layer (which holds even for a superuser in a hurry).
-- ===========================================================================
REVOKE ALL ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM ac_gateway, ac_worker;
GRANT INSERT, SELECT ON audit_log TO ac_gateway, ac_worker;

CREATE OR REPLACE FUNCTION ac_audit_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP
    USING HINT = 'Corrections are new rows that reference the old one. Nothing is rewritten.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION ac_audit_is_immutable();

-- Same for the other append-only records: transitions and sync intents.
DROP TRIGGER IF EXISTS job_state_events_immutable ON job_state_events;
CREATE TRIGGER job_state_events_immutable
  BEFORE UPDATE OR DELETE ON job_state_events
  FOR EACH ROW EXECUTE FUNCTION ac_audit_is_immutable();

-- ===========================================================================
-- Non-negotiable #2, part three (finding 5): region_id DERIVES FROM THE PARENT
-- EDGE. A location cannot be created under a region node with a different
-- region_id; a site cannot differ from its location. Moving a node to a new
-- parent moves its region_id with it, and the trigger cascades the change
-- down. Only WE redraw a region, by moving the region node — an infrastructure
-- event, not a customer preference.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ac_accounts_derive_region() RETURNS trigger AS $$
DECLARE
  p RECORD;
  expected_parent_tier TEXT;
BEGIN
  IF NEW.tier = 'region' THEN
    -- The meeting point of a customer org and one of our regions. region_id is
    -- the node's own binding; the parent is the organization.
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'accounts: a region node has no parent row — its parent is the organization %', NEW.org_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = NEW.region_id AND r.active) THEN
      RAISE EXCEPTION 'accounts: region node % binds to inactive or unknown region %', NEW.name, NEW.region_id;
    END IF;
    NEW.path := ARRAY[NEW.id];
    RETURN NEW;
  END IF;

  SELECT id, tier, org_id, region_id, path INTO p FROM accounts WHERE id = NEW.parent_id;
  IF p IS NULL THEN
    RAISE EXCEPTION 'accounts: % node % has no parent', NEW.tier, NEW.name;
  END IF;
  expected_parent_tier := CASE NEW.tier WHEN 'location' THEN 'region' WHEN 'site' THEN 'location' END;
  IF p.tier <> expected_parent_tier THEN
    RAISE EXCEPTION 'accounts: a % must hang off a %, not a %', NEW.tier, expected_parent_tier, p.tier;
  END IF;
  IF p.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'accounts: node % belongs to org % but its parent belongs to org %', NEW.name, NEW.org_id, p.org_id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    -- The node is being moved. region_id FOLLOWS the new edge; it is not an input.
    NEW.region_id := p.region_id;
  ELSIF NEW.region_id <> p.region_id THEN
    RAISE EXCEPTION
      'accounts: % "%" declares region_id % but its parent edge is in region %. region_id derives from the parent edge and nothing else (D2 part 3). To move the node, change parent_id; region_id follows.',
      NEW.tier, NEW.name, NEW.region_id, p.region_id;
  END IF;
  NEW.path := p.path || NEW.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- The trigger runs as the table owner's definer so that it can read the parent
-- row regardless of the caller's RLS scope: a customer principal creating a site
-- under its own location is inside scope; the function must still see the parent.
ALTER FUNCTION ac_accounts_derive_region() SECURITY DEFINER;

DROP TRIGGER IF EXISTS accounts_derive_region ON accounts;
CREATE TRIGGER accounts_derive_region
  BEFORE INSERT OR UPDATE OF parent_id, region_id, tier, org_id, path ON accounts
  FOR EACH ROW EXECUTE FUNCTION ac_accounts_derive_region();

-- When a node moves or a region node is rebound (we redraw a region), the
-- children are re-derived, which re-fires this on THEIR children. region_id
-- and path both follow the parent edge, all the way down.
CREATE OR REPLACE FUNCTION ac_accounts_cascade() RETURNS trigger AS $$
BEGIN
  IF NEW.region_id <> OLD.region_id OR NEW.path <> OLD.path THEN
    UPDATE accounts SET region_id = NEW.region_id, path = NEW.path || id WHERE parent_id = NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS accounts_cascade_region ON accounts;
DROP TRIGGER IF EXISTS accounts_cascade ON accounts;
CREATE TRIGGER accounts_cascade
  AFTER UPDATE OF parent_id, region_id, path ON accounts
  FOR EACH ROW EXECUTE FUNCTION ac_accounts_cascade();

-- Rows that hang off a site inherit the site's tenancy. Declared once here so a
-- script inserting a job with the wrong region_id is refused, not accepted.
CREATE OR REPLACE FUNCTION ac_inherit_tenancy_from_account() RETURNS trigger AS $$
DECLARE
  a RECORD;
  col TEXT := TG_ARGV[0];
  ref UUID;
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO ref USING NEW;
  SELECT org_id, region_id INTO a FROM accounts WHERE id = ref;
  IF a IS NULL THEN
    RAISE EXCEPTION '%: % % does not exist in accounts', TG_TABLE_NAME, col, ref;
  END IF;
  IF NEW.org_id <> a.org_id OR NEW.region_id <> a.region_id THEN
    RAISE EXCEPTION '%: tenancy (org %, region %) does not match its account (org %, region %). Tenancy is inherited, not typed.',
      TG_TABLE_NAME, NEW.org_id, NEW.region_id, a.org_id, a.region_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS jobs_inherit_tenancy ON jobs;
CREATE TRIGGER jobs_inherit_tenancy BEFORE INSERT OR UPDATE OF site_id, org_id, region_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION ac_inherit_tenancy_from_account('site_id');
DROP TRIGGER IF EXISTS equipment_inherit_tenancy ON equipment;
CREATE TRIGGER equipment_inherit_tenancy BEFORE INSERT OR UPDATE OF site_id, org_id, region_id ON equipment
  FOR EACH ROW EXECUTE FUNCTION ac_inherit_tenancy_from_account('site_id');
DROP TRIGGER IF EXISTS service_requests_inherit_tenancy ON service_requests;
CREATE TRIGGER service_requests_inherit_tenancy BEFORE INSERT OR UPDATE OF site_id, org_id, region_id ON service_requests
  FOR EACH ROW EXECUTE FUNCTION ac_inherit_tenancy_from_account('site_id');

-- ===========================================================================
-- D2 part two: TERM ADMISSION. The authoring-tier axis of the policy register,
-- enforced against the mirror at insert. A location setting payment_terms_days
-- is refused here even from psql. (The overlap axis is the EXCLUDE constraint
-- on the table itself; the ratchet axis needs the resolver and lives in the
-- gateway's admission.) Scope existence is checked here too.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ac_admit_term_override() RETURNS trigger AS $$
DECLARE
  reg RECORD;
  exists_ok BOOLEAN;
BEGIN
  SELECT * INTO reg FROM term_registry WHERE key = NEW.term_key;
  IF reg IS NULL THEN
    RAISE EXCEPTION 'term "%" is not in the policy register. A term with no entry raises rather than defaulting to cascade.', NEW.term_key;
  END IF;
  IF NOT (reg.authoring_tiers ? NEW.scope_tier) THEN
    RAISE EXCEPTION 'term "%" may not be set at tier "%". Authoring tiers: %. This is a data error, not a preference — see packages/contracts/src/terms.ts.',
      NEW.term_key, NEW.scope_tier, reg.authoring_tiers;
  END IF;
  IF reg.value_kind = 'enum' AND NOT (reg.enum_values ? (NEW.term_value #>> '{}')) THEN
    RAISE EXCEPTION 'term "%": % is not a legal value; legal: %', NEW.term_key, NEW.term_value, reg.enum_values;
  END IF;
  IF reg.value_kind = 'money' AND jsonb_typeof(NEW.term_value) <> 'string' THEN
    RAISE EXCEPTION 'term "%" is money and must be a STRING of minor units — a JSON number is an IEEE754 double', NEW.term_key;
  END IF;
  IF reg.value_kind = 'int' AND (jsonb_typeof(NEW.term_value) <> 'number' OR (NEW.term_value #>> '{}') !~ '^-?[0-9]+$') THEN
    RAISE EXCEPTION 'term "%" must be an integer', NEW.term_key;
  END IF;
  IF reg.value_kind = 'bool' AND jsonb_typeof(NEW.term_value) <> 'boolean' THEN
    RAISE EXCEPTION 'term "%" must be true or false', NEW.term_key;
  END IF;

  -- The scope must exist at the declared tier, in this org.
  IF NEW.scope_tier = 'parent' THEN
    SELECT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.scope_id AND id = NEW.org_id) INTO exists_ok;
  ELSE
    SELECT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.scope_id AND tier = NEW.scope_tier AND org_id = NEW.org_id) INTO exists_ok;
  END IF;
  IF NOT exists_ok THEN
    RAISE EXCEPTION 'term override scope %:% does not exist in org %', NEW.scope_tier, NEW.scope_id, NEW.org_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS term_override_admission ON contract_term_overrides;
CREATE TRIGGER term_override_admission
  BEFORE INSERT OR UPDATE ON contract_term_overrides
  FOR EACH ROW EXECUTE FUNCTION ac_admit_term_override();

-- Same scope-existence rule for the contract row itself.
CREATE OR REPLACE FUNCTION ac_contract_scope_exists() RETURNS trigger AS $$
DECLARE ok BOOLEAN;
BEGIN
  IF NEW.scope_tier = 'parent' THEN
    SELECT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.scope_id AND id = NEW.org_id) INTO ok;
  ELSE
    SELECT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.scope_id AND tier = NEW.scope_tier AND org_id = NEW.org_id) INTO ok;
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'contract scope %:% does not exist in org %', NEW.scope_tier, NEW.scope_id, NEW.org_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contract_scope_exists ON contracts;
CREATE TRIGGER contract_scope_exists BEFORE INSERT OR UPDATE OF scope_tier, scope_id ON contracts
  FOR EACH ROW EXECUTE FUNCTION ac_contract_scope_exists();

-- ===========================================================================
-- Non-negotiable #8 — the compliance gate, third layer. The type system covers
-- application code. This covers everything else. The check is the WHOLE
-- service window, never the instant of assignment.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ac_assignment_requires_clearance() RETURNS trigger AS $$
DECLARE
  j RECORD;
  c RECORD;
BEGIN
  SELECT service_window, region_id INTO j FROM jobs WHERE id = NEW.job_id;
  SELECT crew_id, service_window INTO c FROM compliance_clearances WHERE id = NEW.clearance_id;

  IF c IS NULL THEN
    RAISE EXCEPTION 'assignment has no compliance clearance';
  END IF;
  IF c.crew_id <> NEW.crew_id THEN
    RAISE EXCEPTION 'clearance % was issued for a different crew', NEW.clearance_id;
  END IF;
  IF NOT (c.service_window @> j.service_window) THEN
    RAISE EXCEPTION
      'clearance % covers % but the job window is % — a certificate that expires mid-window does not clear the job',
      NEW.clearance_id, c.service_window, j.service_window;
  END IF;
  IF NEW.region_id <> j.region_id THEN
    RAISE EXCEPTION 'assignment region % does not match job region %', NEW.region_id, j.region_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assignment_gate ON assignments;
CREATE TRIGGER assignment_gate
  BEFORE INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION ac_assignment_requires_clearance();

-- A clearance is minted from verified credentials that cover its window. The
-- domain evaluator is the only thing that SHOULD insert one; this refuses a
-- forged row from anything else.
CREATE OR REPLACE FUNCTION ac_clearance_is_earned() RETURNS trigger AS $$
DECLARE
  cred RECORD;
  cid TEXT;
BEGIN
  IF jsonb_typeof(NEW.credential_ids) <> 'array' OR jsonb_array_length(NEW.credential_ids) = 0 THEN
    RAISE EXCEPTION 'a clearance names the credentials that earned it';
  END IF;
  FOR cid IN SELECT jsonb_array_elements_text(NEW.credential_ids) LOOP
    SELECT crew_id, valid_from, valid_to, verified_at INTO cred FROM crew_credentials WHERE id = cid::uuid;
    IF cred IS NULL OR cred.crew_id <> NEW.crew_id THEN
      RAISE EXCEPTION 'clearance cites credential % which does not belong to crew %', cid, NEW.crew_id;
    END IF;
    IF cred.verified_at IS NULL THEN
      RAISE EXCEPTION 'clearance cites unverified credential %', cid;
    END IF;
    IF NOT (daterange(cred.valid_from, cred.valid_to, '[]') @> daterange(lower(NEW.service_window)::date, upper(NEW.service_window)::date, '[]')) THEN
      RAISE EXCEPTION 'credential % [% .. %] does not cover clearance window %', cid, cred.valid_from, cred.valid_to, NEW.service_window;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clearance_is_earned ON compliance_clearances;
CREATE TRIGGER clearance_is_earned BEFORE INSERT OR UPDATE ON compliance_clearances
  FOR EACH ROW EXECUTE FUNCTION ac_clearance_is_earned();

-- ===========================================================================
-- Non-negotiable #4 meets #2: every outbox row and audit row must carry a
-- topic from the catalogue. The relay refuses unknown topics; so does the DB.
-- (Catalogue mirrored by emit into a CHECK would drift; a lookup function
-- reading a small table would be one more mirror. Keep the check in the
-- unit of work + relay, and hold the DB to the shape: event_id shared.)
-- ===========================================================================

-- ===========================================================================
-- ROW-LEVEL SECURITY. The gateway's scope binding SET LOCALs these settings
-- inside the transaction (apps/gateway/src/scope-binding.ts). A forgotten
-- WHERE returns zero rows, not every firm's pricing and not every region's
-- crews. FORCE so the table owner is bound too.
-- ===========================================================================
CREATE OR REPLACE FUNCTION ac_setting(name TEXT) RETURNS TEXT AS $$
  SELECT NULLIF(current_setting(name, true), '')
$$ LANGUAGE sql STABLE;

-- Rate confidentiality between subcontractor firms is a commercial requirement.
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_cards_firm_isolation ON rate_cards;
CREATE POLICY rate_cards_firm_isolation ON rate_cards
  USING (ac_setting('ac.namespace') = 'internal'
         OR firm_id::text = ac_setting('ac.firm_id'));

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlements_firm_isolation ON settlements;
CREATE POLICY settlements_firm_isolation ON settlements
  USING (ac_setting('ac.namespace') = 'internal'
         OR firm_id::text = ac_setting('ac.firm_id'));

-- Region isolation for the dispatch surface. A dispatcher in one region cannot
-- see or touch another region's crews or jobs. Org-scoped internal principals
-- (ops leadership, account owners) see across regions; everyone else is bound.
CREATE OR REPLACE FUNCTION ac_region_visible(row_region UUID) RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal' AND ac_setting('ac.scope_tier') = 'parent'
      OR row_region::text = ac_setting('ac.region_id')
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['jobs','assignments','crews','crew_credentials','compliance_clearances','job_state_events','projects','sla_timers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_region_isolation', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (ac_region_visible(region_id))', t || '_region_isolation', t);
  END LOOP;
END $$;

-- ACCOUNTS visibility, by namespace. No recursion: `path` is materialised by
-- the derive trigger, so "is my scope node an ancestor of this row" is an
-- array containment test.
--   internal       everything
--   device         the region the shift grant is for
--   subcontractor  the region the firm works in (Phase 1; narrows to assigned sites with S8 Phase 2)
--   customer       own org, and only the subtree under the scope node (S6's four scopes)
--   anonymous      nothing
CREATE OR REPLACE FUNCTION ac_account_visible(row_org UUID, row_region UUID, row_path UUID[]) RETURNS BOOLEAN AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'internal'      THEN true
    WHEN 'device'        THEN row_region::text = ac_setting('ac.region_id')
    WHEN 'subcontractor' THEN row_region::text = ac_setting('ac.region_id')
    WHEN 'customer'      THEN row_org::text = ac_setting('ac.org_id')
                              AND (ac_setting('ac.scope_tier') = 'parent'
                                   OR ac_setting('ac.scope_id')::uuid = ANY(row_path))
    ELSE false END
$$ LANGUAGE sql STABLE;

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_org_isolation ON accounts;
DROP POLICY IF EXISTS accounts_visibility ON accounts;
CREATE POLICY accounts_visibility ON accounts
  USING (ac_account_visible(org_id, region_id, path));

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_org_isolation ON invoices;
CREATE POLICY invoices_org_isolation ON invoices
  USING (ac_setting('ac.namespace') = 'internal' OR org_id::text = ac_setting('ac.org_id'));

-- Devices see their own intents and nothing else's.
ALTER TABLE sync_mutations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_mutations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sync_mutations_device_isolation ON sync_mutations;
CREATE POLICY sync_mutations_device_isolation ON sync_mutations
  USING (ac_setting('ac.namespace') = 'internal' OR device_id::text = ac_setting('ac.device_id'));
