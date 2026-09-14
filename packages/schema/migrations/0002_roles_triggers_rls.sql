-- Guardrails that types cannot reach: scripts, migrations, psql sessions, and
-- every service that does not exist yet.

-- ---------------------------------------------------------------------------
-- Four roles. The surfaces hold none of them.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE ROLE ac_migrator;   -- DDL only, used by migrations
  CREATE ROLE ac_gateway;    -- the sole application role
  CREATE ROLE ac_worker;     -- outbox relay, sweeps, rollups
  CREATE ROLE ac_readonly;   -- warehouse extract, S4's ancestor
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Non-negotiable #4: the audit log is append-only at the privilege layer.
REVOKE ALL ON audit_log FROM PUBLIC;
GRANT INSERT, SELECT ON audit_log TO ac_gateway, ac_worker;
-- Deliberately no UPDATE, no DELETE, for any role including the gateway.

-- ...and at the trigger layer, which holds even for a superuser.
CREATE OR REPLACE FUNCTION ac_audit_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION ac_audit_is_immutable();

-- ---------------------------------------------------------------------------
-- Non-negotiable #8 — the compliance gate, third layer.
-- The type system covers application code. This covers everything else.
-- The check is the whole service window, never the instant of assignment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_assignment_requires_clearance() RETURNS trigger AS $$
DECLARE
  j RECORD;
  c RECORD;
BEGIN
  SELECT window_start, window_end INTO j FROM jobs WHERE id = NEW.job_id;
  SELECT crew_id, window_start, window_end INTO c FROM compliance_clearances WHERE id = NEW.clearance_id;

  IF c IS NULL THEN
    RAISE EXCEPTION 'assignment % has no compliance clearance', NEW.id;
  END IF;
  IF c.crew_id <> NEW.crew_id THEN
    RAISE EXCEPTION 'clearance % was issued for a different crew', NEW.clearance_id;
  END IF;
  IF c.window_start > j.window_start OR c.window_end < j.window_end THEN
    RAISE EXCEPTION
      'clearance % covers [%, %] but job window is [%, %] — a certificate that expires mid-window does not clear the job',
      NEW.clearance_id, c.window_start, c.window_end, j.window_start, j.window_end;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assignment_gate ON assignments;
CREATE TRIGGER assignment_gate
  BEFORE INSERT OR UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION ac_assignment_requires_clearance();

-- ---------------------------------------------------------------------------
-- Rate confidentiality between subcontractor firms.
-- The gateway scope check is the first line. This is the one that means a
-- forgotten WHERE returns zero rows instead of every firm's pricing.
-- ---------------------------------------------------------------------------
ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_cards FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rate_cards_firm_isolation ON rate_cards;
CREATE POLICY rate_cards_firm_isolation ON rate_cards
  USING (
    current_setting('ac.namespace', true) = 'internal'
    OR firm_id::text = current_setting('ac.firm_id', true)
  );

-- Same shape, region boundary. Cheap now; it is what Tier 3 routing leans on.
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assignments_region_isolation ON assignments;
CREATE POLICY assignments_region_isolation ON assignments
  USING (region_id::text = current_setting('ac.region_id', true)
         OR current_setting('ac.scope', true) = 'org');
