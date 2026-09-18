-- 0006 — CUSTOMER VISIBILITY (item 6, S6 Customer Portal).
--
-- 05 §S6: "one codebase, four scopes — scoping is enforced at the gateway,
-- never by client-side filtering." 0002 made that true for `accounts` alone:
-- a customer principal sees its own org and the subtree under its scope node.
-- Every other table a customer portal reads was left on a rule written for
-- dispatch. Read as a customer principal, before this migration:
--
--   jobs, sla_timers, job_state_events   ac_region_visible: row_region = ac.region_id
--                                         → a customer bound to South sees EVERY
--                                           South job, every customer's.
--   contracts, contract_term_overrides   no policy at all
--                                         → terms.resolved, served to S6, answers
--                                           for any org whose id is typed in.
--   service_requests                     no policy at all.
--   crews, crew_credentials,             ac_region_visible → the customer sees our
--   compliance_clearances, assignments     crews and their documents by region.
--
-- None of these was reachable through a screen, because the catalogue served
-- no such operation to S6. The frame's whole argument is that "not reachable
-- through a screen" is not a mechanism: a forgotten filter must return nothing
-- rather than everything. This migration makes it so, table by table, with the
-- same shape 0005 used for firm isolation — one policy per table, the
-- namespace branch inside it, an EXISTS against a table whose own policy
-- already answers the question.
--
-- And one thing a customer must see that 0002 did not let it: ITS OWN PATH.
-- The context builder walks up from the scope node to the region node above
-- it, and the resolver walks the same path down; under 0002 a facility manager
-- could see Boulder and its sites but not the region node Boulder hangs from,
-- so the walk stopped one tier short and an override authored at the region
-- tier silently did not apply. The ancestors of the scope node are now
-- visible — the breadcrumb is the customer's own — and nothing else above or
-- beside it is: a sibling location's path does not contain the scope node and
-- its id is not among the scope node's ancestors.

-- ---------------------------------------------------------------------------
-- The scope node's ancestor chain, read past row security. SECURITY DEFINER
-- because a policy on `accounts` cannot query `accounts` (infinite recursion);
-- STABLE so the planner evaluates it once per statement, not once per row.
-- Returns the empty array for any principal whose scope is not an account row
-- (internal and device principals are scoped to OUR regions; a parent-tier
-- customer's scope is the organization), so the branch it feeds is false for
-- them and the other branches decide.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_scope_ancestors() RETURNS UUID[] AS $$
  SELECT COALESCE(
    (SELECT a.path FROM accounts a WHERE a.id::text = ac_setting('ac.scope_id') LIMIT 1),
    ARRAY[]::UUID[])
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION ac_scope_ancestors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ac_scope_ancestors() TO ac_gateway, ac_worker, ac_readonly;

-- accounts: 0002's rule plus the ancestors. The signature gains the row's own
-- id, so the policy is recreated with it.
DROP POLICY IF EXISTS accounts_visibility ON accounts;
DROP FUNCTION IF EXISTS ac_account_visible(UUID, UUID, UUID[]);
CREATE OR REPLACE FUNCTION ac_account_visible(row_id UUID, row_org UUID, row_region UUID, row_path UUID[]) RETURNS BOOLEAN AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'internal'      THEN true
    WHEN 'device'        THEN row_region::text = ac_setting('ac.region_id')
    WHEN 'subcontractor' THEN row_region::text = ac_setting('ac.region_id')
    WHEN 'customer'      THEN row_org::text = ac_setting('ac.org_id')
                              AND (ac_setting('ac.scope_tier') = 'parent'
                                   OR ac_setting('ac.scope_id')::uuid = ANY(row_path)   -- the subtree
                                   OR row_id = ANY(ac_scope_ancestors()))               -- the breadcrumb
    ELSE false END
$$ LANGUAGE sql STABLE;
CREATE POLICY accounts_visibility ON accounts
  USING (ac_account_visible(id, org_id, region_id, path));

-- ---------------------------------------------------------------------------
-- Work a customer may see is work at a site the customer may see. Everyone
-- else keeps 0002's region rule. The EXISTS runs under `accounts`' own policy,
-- so "a site the customer may see" is decided in exactly one place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_work_visible(row_region UUID, row_site UUID) RETURNS BOOLEAN AS $$
  SELECT CASE ac_setting('ac.namespace')
    WHEN 'customer' THEN EXISTS (SELECT 1 FROM accounts a WHERE a.id = row_site)
    ELSE ac_region_visible(row_region) END
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS jobs_region_isolation ON jobs;
CREATE POLICY jobs_region_isolation ON jobs
  USING (ac_work_visible(region_id, site_id));

-- Timers and state events hang off the job; visible exactly when it is.
DROP POLICY IF EXISTS sla_timers_region_isolation ON sla_timers;
CREATE POLICY sla_timers_region_isolation ON sla_timers
  USING (CASE ac_setting('ac.namespace')
           WHEN 'customer' THEN EXISTS (SELECT 1 FROM jobs j WHERE j.id = sla_timers.job_id)
           ELSE ac_region_visible(region_id) END);

DROP POLICY IF EXISTS job_state_events_region_isolation ON job_state_events;
CREATE POLICY job_state_events_region_isolation ON job_state_events
  USING (CASE ac_setting('ac.namespace')
           WHEN 'customer' THEN EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_state_events.job_id)
           ELSE ac_region_visible(region_id) END);

-- A service request is the customer's own write (S6's first entity). It is
-- visible to the customer at a visible site, and to us by region.
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_requests_visibility ON service_requests;
CREATE POLICY service_requests_visibility ON service_requests
  USING (ac_work_visible(region_id, site_id));

-- ---------------------------------------------------------------------------
-- The agreement and its terms belong to the customer that signed them: own
-- org for a customer principal, everything for ours, nothing for anyone else.
-- A firm's MSA is a column on subcontractor_firms, not a row here, so the
-- subcontractor namespace sees nothing — correctly. This is what makes
-- terms.resolved's `orgId` input inert for a customer: another org's rows are
-- not zero because the handler declined, they are zero because they are not there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_agreement_visible(row_org UUID) RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal'
      OR (ac_setting('ac.namespace') = 'customer' AND row_org::text = ac_setting('ac.org_id'))
$$ LANGUAGE sql STABLE;

-- Reading is by namespace and org; WRITING is ours alone. A policy with only
-- USING doubles as the INSERT check, and a customer's own org passes it — so
-- a raw INSERT under a customer binding was admitted at the table even though
-- S6's allowlist refuses `contract` at the unit of work. The same lesson 0005
-- learned for crew_credentials: the allowlist is an entity label the unit of
-- work checks, the TABLE is reachable by any role with INSERT on it, and the
-- table has to say the same thing. Found by test/integration/s6.test.ts.
CREATE OR REPLACE FUNCTION ac_agreement_writable() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'internal'
$$ LANGUAGE sql STABLE;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contracts_org_isolation ON contracts;
DROP POLICY IF EXISTS contracts_read ON contracts;
DROP POLICY IF EXISTS contracts_insert ON contracts;
DROP POLICY IF EXISTS contracts_update ON contracts;
CREATE POLICY contracts_read   ON contracts FOR SELECT USING (ac_agreement_visible(org_id));
CREATE POLICY contracts_insert ON contracts FOR INSERT WITH CHECK (ac_agreement_writable());
CREATE POLICY contracts_update ON contracts FOR UPDATE USING (ac_agreement_writable()) WITH CHECK (ac_agreement_writable());

ALTER TABLE contract_term_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_term_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_term_overrides_org_isolation ON contract_term_overrides;
DROP POLICY IF EXISTS contract_term_overrides_read ON contract_term_overrides;
DROP POLICY IF EXISTS contract_term_overrides_insert ON contract_term_overrides;
DROP POLICY IF EXISTS contract_term_overrides_update ON contract_term_overrides;
CREATE POLICY contract_term_overrides_read   ON contract_term_overrides FOR SELECT USING (ac_agreement_visible(org_id));
CREATE POLICY contract_term_overrides_insert ON contract_term_overrides FOR INSERT WITH CHECK (ac_agreement_writable());
CREATE POLICY contract_term_overrides_update ON contract_term_overrides FOR UPDATE USING (ac_agreement_writable()) WITH CHECK (ac_agreement_writable());

-- ---------------------------------------------------------------------------
-- The crew is ours to see, never the customer's. S8's firm rule from 0005 is
-- kept verbatim; the customer namespace is closed on all four tables. A
-- customer's job row therefore carries no crew — the board's LEFT JOIN finds
-- nothing — which is the field shape the customer portal shows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS crews_region_isolation ON crews;
CREATE POLICY crews_region_isolation ON crews
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'customer'
         AND ac_region_visible(region_id)
         AND (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor' OR firm_id::text = ac_setting('ac.firm_id')));

DROP POLICY IF EXISTS crew_credentials_region_isolation ON crew_credentials;
CREATE POLICY crew_credentials_region_isolation ON crew_credentials
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'customer'
         AND ac_region_visible(region_id)
         AND (ac_setting('ac.namespace') IS DISTINCT FROM 'subcontractor'
              OR EXISTS (SELECT 1 FROM crews c WHERE c.id = crew_credentials.crew_id AND c.firm_id::text = ac_setting('ac.firm_id'))));

DROP POLICY IF EXISTS compliance_clearances_region_isolation ON compliance_clearances;
CREATE POLICY compliance_clearances_region_isolation ON compliance_clearances
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'customer' AND ac_region_visible(region_id));

DROP POLICY IF EXISTS assignments_region_isolation ON assignments;
CREATE POLICY assignments_region_isolation ON assignments
  USING (ac_setting('ac.namespace') IS DISTINCT FROM 'customer' AND ac_region_visible(region_id));
