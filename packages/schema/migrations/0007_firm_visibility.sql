-- ===========================================================================
-- 0007 — FIRM VISIBILITY (item 7, S8 Subcontractor Portal). Read as a firm.
--
-- 0005 made "a firm sees its own firm, its own crews, its own documents, its
-- own price" true on the four network tables. Everything else a firm could
-- read was still bound by REGION, which is a dispatcher's rule, and a firm is
-- not a dispatcher. Bound as a subcontractor principal in South, before this
-- migration, the tables answered:
--
--   jobs, sla_timers, job_state_events   every South job of every customer,
--                                        whether or not the firm was ever on it
--   assignments, compliance_clearances   every South crew's, including other firms'
--   service_requests                     every customer's intake in the region
--   accounts                             every customer's tree in the region
--   settlement_lines                     NO POLICY — every firm's lines: job,
--                                        rate card, quantity, amount, which is
--                                        the other firm's price by division
--   working_capital_positions            NO POLICY — our float, by region
--   organizations, users, audit_log,     NO POLICY — every customer's name; every
--   outbox                               principal's row with its password hash;
--                                        every audited change with before/after
--
-- None of it was reachable through an S8 screen, because the catalogue served
-- the firm four reads. That is the same sentence 0006 answered for the
-- customer: "not reachable through a screen" is not a mechanism. The
-- catalogue now serves S8 the reads it needs (jobs.list, settlements.*), and
-- the tables say what the firm may see.
--
-- THE RULE. A firm sees WORK ITS OWN CREWS HAVE BEEN ASSIGNED — the job, its
-- timer, its state history, the site it happened at, the assignment and the
-- clearance that admitted it — and its own STATEMENTS once issued, with their
-- lines. It sees no customer's intake, no customer's tree beyond the site it
-- was sent to, no other firm's anything, and none of our money.
--
-- THE WRITES (D12, the minimum cut as the registry states it: compliance_doc,
-- crew_roster, settlement_ack, dispute). The allowlist is an entity label the
-- unit of work checks; the table has to say the same thing, which 0005 learned
-- for crew_credentials and 0006 for contracts:
--   - crews: a firm enrolls a crew under ITSELF, subcontracted, and thereafter
--     changes its label and whether it is active — never its firm, its type,
--     or its home region.                    (ac_crew_roster_is_the_firms)
--   - crew_credentials: a firm's document arrives unverified and stays the
--     firm's to correct until we verify it — 0005 already holds both halves.
--   - settlements: a firm changes its POSITION on a statement we issued —
--     acknowledged, or disputed with a reason — and nothing else on the row.
--     A draft is ours until issued and a firm does not see it.
--                                            (ac_settlement_position_is_the_firms)
--
-- Two things this migration does that the earlier ones did not: it ALTERs a
-- table (three nullable columns on settlements, also in the regenerated 0001
-- so a fresh database and a migrated one agree), and it admits an UNBOUND
-- transaction on the tables it newly protects. The gateway's login path and
-- the worker's sweeps run with no principal — they are the gateway acting as
-- itself — and a policy that returned false for them would make login refuse
-- everyone. `ac_unbound()` names that case so it is read as a decision.
--
-- Nothing here changes an existing policy for the internal, device or customer
-- namespace except where noted; the customer's rows in 0006 are untouched.
-- tools/ci/schema-guard.ts §3d holds the ERRCODE on every RAISE below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The statement's position: the columns the firm's two writes set.
-- ---------------------------------------------------------------------------
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS dispute_reason text;

-- ---------------------------------------------------------------------------
-- No principal bound: the gateway before login, the worker between requests.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_unbound() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') IS NULL
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION ac_internal() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal'
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- Work the firm has been on. An assignment of one of the firm's crews — live
-- or released — is what puts a job in the firm's view; the firm's settlement
-- lines cite jobs it has finished, so a released assignment still counts.
-- The EXISTS runs under `assignments`' and `crews`' own policies, which for
-- the firm are "my crew" — so "my work" is decided in one place, below.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_firm_work_visible(row_job UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignments a JOIN crews c ON c.id = a.crew_id
     WHERE a.job_id = row_job AND c.firm_id::text = ac_setting('ac.firm_id'))
$$ LANGUAGE sql STABLE;

-- jobs: the customer's rule from 0006, the firm's rule here, the region rule for us.
DROP POLICY IF EXISTS jobs_region_isolation ON jobs;
CREATE POLICY jobs_region_isolation ON jobs
  USING (CASE ac_setting('ac.namespace')
           WHEN 'subcontractor' THEN ac_firm_work_visible(id)
           ELSE ac_work_visible(region_id, site_id) END);

-- Timers and state events hang off the job; visible exactly when it is, for
-- the customer (0006) and now for the firm.
DROP POLICY IF EXISTS sla_timers_region_isolation ON sla_timers;
CREATE POLICY sla_timers_region_isolation ON sla_timers
  USING (CASE ac_setting('ac.namespace')
           WHEN 'customer'      THEN EXISTS (SELECT 1 FROM jobs j WHERE j.id = sla_timers.job_id)
           WHEN 'subcontractor' THEN EXISTS (SELECT 1 FROM jobs j WHERE j.id = sla_timers.job_id)
           ELSE ac_region_visible(region_id) END);

DROP POLICY IF EXISTS job_state_events_region_isolation ON job_state_events;
CREATE POLICY job_state_events_region_isolation ON job_state_events
  USING (CASE ac_setting('ac.namespace')
           WHEN 'customer'      THEN EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_state_events.job_id)
           WHEN 'subcontractor' THEN EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_state_events.job_id)
           ELSE ac_region_visible(region_id) END);

-- A customer's intake is between the customer and us. The firm sees the job
-- once we have opened one and sent its crew; never the request.
DROP POLICY IF EXISTS service_requests_visibility ON service_requests;
CREATE POLICY service_requests_visibility ON service_requests
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor' AND ac_work_visible(region_id, site_id));

-- assignments and clearances: the firm's own crews'. 0006 closed the customer.
DROP POLICY IF EXISTS assignments_region_isolation ON assignments;
CREATE POLICY assignments_region_isolation ON assignments
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'customer'
         AND ac_region_visible(region_id)
         AND (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor'
              OR EXISTS (SELECT 1 FROM crews c WHERE c.id = assignments.crew_id)));

DROP POLICY IF EXISTS compliance_clearances_region_isolation ON compliance_clearances;
CREATE POLICY compliance_clearances_region_isolation ON compliance_clearances
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'customer'
         AND ac_region_visible(region_id)
         AND (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor'
              OR EXISTS (SELECT 1 FROM crews c WHERE c.id = compliance_clearances.crew_id)));

-- accounts: the firm sees the SITE it was sent to — the row a job it may see
-- names — and nothing above or beside it. 0002 wrote "narrows to assigned
-- sites with S8 Phase 2" in a comment; this is that sentence as a policy.
-- No cycle: the firm's jobs rule reads assignments and crews, never accounts.
DROP POLICY IF EXISTS accounts_visibility ON accounts;
CREATE OR REPLACE FUNCTION ac_account_visible(row_id UUID, row_org UUID, row_region UUID, row_path UUID[]) RETURNS BOOLEAN AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'internal'      THEN true
    WHEN 'device'        THEN row_region::text = ac_setting('ac.region_id')
    WHEN 'subcontractor' THEN EXISTS (SELECT 1 FROM jobs j WHERE j.site_id = row_id)
    WHEN 'customer'      THEN row_org::text = ac_setting('ac.org_id')
                              AND (ac_setting('ac.scope_tier') = 'parent'
                                   OR ac_setting('ac.scope_id')::uuid = ANY(row_path)   -- the subtree
                                   OR row_id = ANY(ac_scope_ancestors()))               -- the breadcrumb
    ELSE false END
$$ LANGUAGE sql STABLE;
CREATE POLICY accounts_visibility ON accounts
  USING (ac_account_visible(id, org_id, region_id, path));

-- ---------------------------------------------------------------------------
-- Money. A statement is the firm's to read once we have issued it, and its
-- position is the firm's to state. Everything else about money is ours.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS settlements_firm_isolation ON settlements;
DROP POLICY IF EXISTS settlements_read ON settlements;
DROP POLICY IF EXISTS settlements_insert ON settlements;
DROP POLICY IF EXISTS settlements_update ON settlements;
CREATE POLICY settlements_read ON settlements FOR SELECT
  USING (ac_unbound() OR ac_internal()
         OR (ac_setting('ac.namespace') = 'subcontractor' AND firm_id::text = ac_setting('ac.firm_id') AND state <> 'draft'));
CREATE POLICY settlements_insert ON settlements FOR INSERT
  WITH CHECK (ac_unbound() OR ac_internal());
CREATE POLICY settlements_update ON settlements FOR UPDATE
  USING (ac_unbound() OR ac_internal()
         OR (ac_setting('ac.namespace') = 'subcontractor' AND firm_id::text = ac_setting('ac.firm_id') AND state <> 'draft'))
  WITH CHECK (ac_unbound() OR ac_internal()
         OR (ac_setting('ac.namespace') = 'subcontractor' AND firm_id::text = ac_setting('ac.firm_id')));

-- What a firm may change on a statement: its position, and only forward.
CREATE OR REPLACE FUNCTION ac_settlement_position_is_the_firms() RETURNS trigger AS $$
BEGIN
  IF ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor' THEN
    RETURN NEW;  -- ours to issue, correct and pay; WS-E's ladder, not this trigger's
  END IF;
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.region_id IS DISTINCT FROM OLD.region_id
     OR NEW.period IS DISTINCT FROM OLD.period OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'statement % is ours; a firm states its position on it (acknowledge, dispute) and changes nothing else', OLD.id
      USING ERRCODE = 'AC403';
  END IF;
  IF NEW.state = 'acknowledged' AND OLD.state = 'issued' THEN
    IF NEW.acknowledged_at IS NULL THEN
      RAISE EXCEPTION 'an acknowledgement is stamped: acknowledged_at is set with the state' USING ERRCODE = 'AC422';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state = 'disputed' AND OLD.state IN ('issued', 'acknowledged') THEN
    IF NEW.disputed_at IS NULL OR NEW.dispute_reason IS NULL OR btrim(NEW.dispute_reason) = '' THEN
      RAISE EXCEPTION 'a dispute says why: dispute_reason and disputed_at are set with the state' USING ERRCODE = 'AC422';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'statement % is %; a firm may acknowledge an issued statement or dispute an issued or acknowledged one, not make it %', OLD.id, OLD.state, NEW.state
      USING ERRCODE = 'AC422';
  END IF;
  RAISE EXCEPTION 'statement % is %; nothing on it is the firm''s to change but its position', OLD.id, OLD.state
    USING ERRCODE = 'AC403';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ac_settlement_position_is_the_firms ON settlements;
CREATE TRIGGER ac_settlement_position_is_the_firms
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION ac_settlement_position_is_the_firms();

-- Lines follow their statement. The EXISTS runs under settlements' read policy.
ALTER TABLE settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settlement_lines_read ON settlement_lines;
DROP POLICY IF EXISTS settlement_lines_write ON settlement_lines;
CREATE POLICY settlement_lines_read ON settlement_lines FOR SELECT
  USING (ac_unbound() OR ac_internal() OR EXISTS (SELECT 1 FROM settlements s WHERE s.id = settlement_lines.settlement_id));
CREATE POLICY settlement_lines_write ON settlement_lines FOR ALL
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

-- Our float is ours.
ALTER TABLE working_capital_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_capital_positions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS working_capital_positions_internal ON working_capital_positions;
CREATE POLICY working_capital_positions_internal ON working_capital_positions
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

-- ---------------------------------------------------------------------------
-- The roster. A firm's crew is subcontracted, under the firm, in the firm's
-- region; after that the firm changes its label and whether it is active.
-- The firm's INSERT is admitted by 0005's crews policy (own firm, own region);
-- this trigger holds what the row may say and what may change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_crew_roster_is_the_firms() RETURNS trigger AS $$
BEGIN
  IF ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.firm_id::text IS DISTINCT FROM ac_setting('ac.firm_id') OR NEW.employment_type IS DISTINCT FROM 'subcontracted' THEN
      RAISE EXCEPTION 'a firm enrolls its own crews, subcontracted — this row names firm % as %',
        COALESCE(NEW.firm_id::text, 'none'), NEW.employment_type
        USING ERRCODE = 'AC403';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id OR NEW.employment_type IS DISTINCT FROM OLD.employment_type
     OR NEW.home_region_id IS DISTINCT FROM OLD.home_region_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.region_id IS DISTINCT FROM OLD.region_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'crew % changes employer, type or region only as a new crew with a new document set; a firm changes its label and whether it is active', OLD.id
      USING ERRCODE = 'AC403';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ac_crew_roster_is_the_firms ON crews;
CREATE TRIGGER ac_crew_roster_is_the_firms
  BEFORE INSERT OR UPDATE ON crews
  FOR EACH ROW EXECUTE FUNCTION ac_crew_roster_is_the_firms();

-- ---------------------------------------------------------------------------
-- Tables no namespace had been told about. Each is read by the gateway acting
-- as itself (unbound) or by us; a bound external principal sees its own row
-- or nothing. The unit of work INSERTs audit and outbox rows inside every
-- bound transaction, so INSERT stays open to any principal — RETURNING is
-- never used on either, so the SELECT policy does not bite the write.
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_visibility ON organizations;
CREATE POLICY organizations_visibility ON organizations
  USING (ac_unbound() OR ac_internal() OR id::text = ac_setting('ac.org_id'))
  WITH CHECK (ac_unbound() OR ac_internal());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_visibility ON users;
CREATE POLICY users_visibility ON users
  USING (ac_unbound() OR ac_internal() OR id::text = ac_setting('ac.actor_id'))
  WITH CHECK (ac_unbound() OR ac_internal());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_read ON audit_log;
DROP POLICY IF EXISTS audit_log_append ON audit_log;
CREATE POLICY audit_log_read ON audit_log FOR SELECT USING (ac_unbound() OR ac_internal());
CREATE POLICY audit_log_append ON audit_log FOR INSERT WITH CHECK (true);

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_read ON outbox;
DROP POLICY IF EXISTS outbox_append ON outbox;
DROP POLICY IF EXISTS outbox_relay ON outbox;
CREATE POLICY outbox_read ON outbox FOR SELECT USING (ac_unbound() OR ac_internal());
CREATE POLICY outbox_append ON outbox FOR INSERT WITH CHECK (true);
CREATE POLICY outbox_relay ON outbox FOR UPDATE USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());
