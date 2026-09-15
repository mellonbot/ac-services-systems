-- ===========================================================================
-- 0004 — REFUSAL CODES. A trigger refusal is a refusal, not an outage.
--
-- Every RAISE in 0002 carried a message written for a human and no ERRCODE,
-- so it arrived at the gateway as SQLSTATE P0001 (raise_exception), which the
-- gateway could not tell from a bug and answered with 500 "internal error".
-- The shell classifies 500 as a transport failure and flips the surface into
-- its degraded mode. Net effect: a location created under the wrong parent
-- tier would have put the Service Manager into read-only with an outage
-- banner. Found by design (09_Surface_Runtime_and_S2_Design.md §3.7).
--
-- Two custom SQLSTATE classes, both in the user-defined 'AC' class:
--   AC422  refused by an invariant of the data — the row can never be right
--          (tier ladder, tenancy inheritance, term register, clearance).
--          The gateway answers 422 with the trigger's message verbatim.
--   AC403  refused by policy — the caller may not do this at all
--          (audit_log / job_state_events immutability). The gateway answers 403.
--
-- The function bodies below are 0002's, unchanged except for the USING clause
-- on each RAISE. tools/ci/schema-guard.ts §3d fails the build if any trigger
-- function's latest definition raises without an ERRCODE, so a 0005 that
-- redefines one of these cannot quietly drop the code again.
-- ===========================================================================

CREATE OR REPLACE FUNCTION ac_audit_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP
    USING ERRCODE = 'AC403', HINT = 'Corrections are new rows that reference the old one. Nothing is rewritten.';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_accounts_derive_region() RETURNS trigger AS $$
DECLARE
  p RECORD;
  expected_parent_tier TEXT;
BEGIN
  IF NEW.tier = 'region' THEN
    -- The meeting point of a customer org and one of our regions. region_id is
    -- the node's own binding; the parent is the organization.
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'accounts: a region node has no parent row — its parent is the organization %', NEW.org_id
    USING ERRCODE = 'AC422';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM regions r WHERE r.id = NEW.region_id AND r.active) THEN
      RAISE EXCEPTION 'accounts: region node % binds to inactive or unknown region %', NEW.name, NEW.region_id
    USING ERRCODE = 'AC422';
    END IF;
    NEW.path := ARRAY[NEW.id];
    RETURN NEW;
  END IF;

  SELECT id, tier, org_id, region_id, path INTO p FROM accounts WHERE id = NEW.parent_id;
  IF p IS NULL THEN
    RAISE EXCEPTION 'accounts: % node % has no parent', NEW.tier, NEW.name
    USING ERRCODE = 'AC422';
  END IF;
  expected_parent_tier := CASE NEW.tier WHEN 'location' THEN 'region' WHEN 'site' THEN 'location' END;
  IF p.tier <> expected_parent_tier THEN
    RAISE EXCEPTION 'accounts: a % must hang off a %, not a %', NEW.tier, expected_parent_tier, p.tier
    USING ERRCODE = 'AC422';
  END IF;
  IF p.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'accounts: node % belongs to org % but its parent belongs to org %', NEW.name, NEW.org_id, p.org_id
    USING ERRCODE = 'AC422';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    -- The node is being moved. region_id FOLLOWS the new edge; it is not an input.
    NEW.region_id := p.region_id;
  ELSIF NEW.region_id <> p.region_id THEN
    RAISE EXCEPTION
      'accounts: % "%" declares region_id % but its parent edge is in region %. region_id derives from the parent edge and nothing else (D2 part 3). To move the node, change parent_id; region_id follows.',
      NEW.tier, NEW.name, NEW.region_id, p.region_id
    USING ERRCODE = 'AC422';
  END IF;
  NEW.path := p.path || NEW.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_inherit_tenancy_from_account() RETURNS trigger AS $$
DECLARE
  a RECORD;
  col TEXT := TG_ARGV[0];
  ref UUID;
BEGIN
  EXECUTE format('SELECT ($1).%I', col) INTO ref USING NEW;
  SELECT org_id, region_id INTO a FROM accounts WHERE id = ref;
  IF a IS NULL THEN
    RAISE EXCEPTION '%: % % does not exist in accounts', TG_TABLE_NAME, col, ref
    USING ERRCODE = 'AC422';
  END IF;
  IF NEW.org_id <> a.org_id OR NEW.region_id <> a.region_id THEN
    RAISE EXCEPTION '%: tenancy (org %, region %) does not match its account (org %, region %). Tenancy is inherited, not typed.',
      TG_TABLE_NAME, NEW.org_id, NEW.region_id, a.org_id, a.region_id
    USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_admit_term_override() RETURNS trigger AS $$
DECLARE
  reg RECORD;
  exists_ok BOOLEAN;
BEGIN
  SELECT * INTO reg FROM term_registry WHERE key = NEW.term_key;
  IF reg IS NULL THEN
    RAISE EXCEPTION 'term "%" is not in the policy register. A term with no entry raises rather than defaulting to cascade.', NEW.term_key
    USING ERRCODE = 'AC422';
  END IF;
  IF NOT (reg.authoring_tiers ? NEW.scope_tier) THEN
    RAISE EXCEPTION 'term "%" may not be set at tier "%". Authoring tiers: %. This is a data error, not a preference — see packages/contracts/src/terms.ts.',
      NEW.term_key, NEW.scope_tier, reg.authoring_tiers
    USING ERRCODE = 'AC422';
  END IF;
  IF reg.value_kind = 'enum' AND NOT (reg.enum_values ? (NEW.term_value #>> '{}')) THEN
    RAISE EXCEPTION 'term "%": % is not a legal value; legal: %', NEW.term_key, NEW.term_value, reg.enum_values
    USING ERRCODE = 'AC422';
  END IF;
  IF reg.value_kind = 'money' AND jsonb_typeof(NEW.term_value) <> 'string' THEN
    RAISE EXCEPTION 'term "%" is money and must be a STRING of minor units — a JSON number is an IEEE754 double', NEW.term_key
    USING ERRCODE = 'AC422';
  END IF;
  IF reg.value_kind = 'int' AND (jsonb_typeof(NEW.term_value) <> 'number' OR (NEW.term_value #>> '{}') !~ '^-?[0-9]+$') THEN
    RAISE EXCEPTION 'term "%" must be an integer', NEW.term_key
    USING ERRCODE = 'AC422';
  END IF;
  IF reg.value_kind = 'bool' AND jsonb_typeof(NEW.term_value) <> 'boolean' THEN
    RAISE EXCEPTION 'term "%" must be true or false', NEW.term_key
    USING ERRCODE = 'AC422';
  END IF;

  -- The scope must exist at the declared tier, in this org.
  IF NEW.scope_tier = 'parent' THEN
    SELECT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.scope_id AND id = NEW.org_id) INTO exists_ok;
  ELSE
    SELECT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.scope_id AND tier = NEW.scope_tier AND org_id = NEW.org_id) INTO exists_ok;
  END IF;
  IF NOT exists_ok THEN
    RAISE EXCEPTION 'term override scope %:% does not exist in org %', NEW.scope_tier, NEW.scope_id, NEW.org_id
    USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_contract_scope_exists() RETURNS trigger AS $$
DECLARE ok BOOLEAN;
BEGIN
  IF NEW.scope_tier = 'parent' THEN
    SELECT EXISTS (SELECT 1 FROM organizations WHERE id = NEW.scope_id AND id = NEW.org_id) INTO ok;
  ELSE
    SELECT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.scope_id AND tier = NEW.scope_tier AND org_id = NEW.org_id) INTO ok;
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'contract scope %:% does not exist in org %', NEW.scope_tier, NEW.scope_id, NEW.org_id
    USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_assignment_requires_clearance() RETURNS trigger AS $$
DECLARE
  j RECORD;
  c RECORD;
BEGIN
  SELECT service_window, region_id INTO j FROM jobs WHERE id = NEW.job_id;
  SELECT crew_id, service_window INTO c FROM compliance_clearances WHERE id = NEW.clearance_id;

  IF c IS NULL THEN
    RAISE EXCEPTION 'assignment has no compliance clearance'
    USING ERRCODE = 'AC422';
  END IF;
  IF c.crew_id <> NEW.crew_id THEN
    RAISE EXCEPTION 'clearance % was issued for a different crew', NEW.clearance_id
    USING ERRCODE = 'AC422';
  END IF;
  IF NOT (c.service_window @> j.service_window) THEN
    RAISE EXCEPTION
      'clearance % covers % but the job window is % — a certificate that expires mid-window does not clear the job',
      NEW.clearance_id, c.service_window, j.service_window
    USING ERRCODE = 'AC422';
  END IF;
  IF NEW.region_id <> j.region_id THEN
    RAISE EXCEPTION 'assignment region % does not match job region %', NEW.region_id, j.region_id
    USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ac_clearance_is_earned() RETURNS trigger AS $$
DECLARE
  cred RECORD;
  cid TEXT;
BEGIN
  IF jsonb_typeof(NEW.credential_ids) <> 'array' OR jsonb_array_length(NEW.credential_ids) = 0 THEN
    RAISE EXCEPTION 'a clearance names the credentials that earned it'
    USING ERRCODE = 'AC422';
  END IF;
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
    IF NOT (daterange(cred.valid_from, cred.valid_to, '[]') @> daterange(lower(NEW.service_window)::date, upper(NEW.service_window)::date, '[]')) THEN
      RAISE EXCEPTION 'credential % [% .. %] does not cover clearance window %', cid, cred.valid_from, cred.valid_to, NEW.service_window
    USING ERRCODE = 'AC422';
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
