-- ===========================================================================
-- 0008 — ANONYMOUS INTAKE (item 8, S1 Marketing / Lead-Gen). Read as a stranger.
--
-- S1 is the first surface whose principal is nobody. Everything below follows
-- from that one fact, and the method is the one 0006 and 0007 used: bind a
-- transaction as the new namespace and read the schema as it reads.
--
-- Bound as `anonymous` before this migration, the tables answered:
--
--   leads              NO POLICY — every lead ever captured: the name, the
--                      email, the phone number and the free-text note a
--                      stranger typed into a form, for every stranger.
--   call_records       NO POLICY — every call we have logged, and which lead
--                      it belonged to.
--   regions            NO POLICY — our shard boundary, and `min_crew_density`,
--                      which is D14: the supply rule that decides whether we
--                      may sign a location. The one number the marketing
--                      surface exists to NOT publish, readable from the
--                      marketing surface's own binding.
--   organizations      0007's rule admits `id = ac.org_id`, so an anonymous
--                      principal reads the PROSPECT root and nothing else.
--                      Named here because it is admitted on purpose.
--
-- The first three were reachable by every OTHER external namespace too — a
-- customer on S6 and a firm on S8 could read every lead and the density rule.
-- None of it through a screen, because no operation served those tables. That
-- is the third time this sentence has appeared in a migration header, and it
-- is not a mechanism: an operation is one row in a catalogue away.
--
-- THE RULE. An anonymous principal WRITES TWICE AND READS NOTHING. It may put
-- a lead and a call record into PROSPECT/UNASSIGNED, which is where a
-- pre-account row lives by construction (tenancy is total; `leads` needs no
-- nullable column). It may not read either one back — not its own, not
-- anyone's. A form that can read its own submissions is an enumeration
-- endpoint with a friendly name.
--
-- THE COVERAGE CLAIM. 05 §S1 requires the coverage map to be read from the
-- hierarchy rather than hard-coded, and the answer to "which metros" is in
-- `regions` — which this migration has just closed. `ac_public_coverage()` is
-- the door: SECURITY DEFINER, two columns, active rows. Widening what the
-- marketing site may claim is then a reviewed diff on a migration, which is
-- the right weight for it, because D7a and OQ6 have not yet set the ceiling
-- on what S1 may promise (action plan F9) and `min_crew_density` is on the
-- other side of that ceiling.
--
-- Nothing here changes a policy for the internal, device, customer or
-- subcontractor namespace except `regions`, which was open to all four and is
-- now ours plus a device's own row. tools/ci/schema-guard.ts §3d holds the
-- ERRCODE on every RAISE below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- THE REPLAY KEY. What makes "forms queue to a durable buffer and replay"
-- (SURFACES.S1.degraded) safe to actually do.
--
-- The browser mints `submission_id` once, when the visitor presses the button,
-- and keeps it with the queued form. Every replay carries the SAME id, so the
-- second one loses to the unique index and comes back as a named refusal
-- rather than as a second row — which is to say, a second phone call to the
-- same person. It is `(device, mutation_id)` from the sync design, cut down
-- to the one field a page needs.
--
-- Nullable, and also in the regenerated 0001, so a fresh database and a
-- migrated one agree (the shape 0007 used for the settlements columns). A
-- lead we author ourselves was never queued and has none.
-- ---------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS submission_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_submission_id_key') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_submission_id_key UNIQUE (submission_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The namespace, named once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_anonymous() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') = 'anonymous'
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- REGIONS. The shard boundary and the D14 rule. Ours, plus the one row a
-- device's own login has to resolve (apps/gateway/src/context.ts reads
-- `regions` for an internal or device principal scoped to a region; a customer
-- or a firm resolves its context from `accounts` and never touches this table,
-- which is why closing it does not cost them a login).
-- ---------------------------------------------------------------------------
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS regions_visibility ON regions;
DROP POLICY IF EXISTS regions_write ON regions;
CREATE POLICY regions_visibility ON regions FOR SELECT
  USING (ac_unbound() OR ac_internal()
         OR (ac_setting('ac.namespace') = 'device' AND id::text = ac_setting('ac.region_id')));
CREATE POLICY regions_write ON regions FOR ALL
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

-- Foreign keys into `regions` are unaffected: referential-integrity checks
-- bypass row security, so a lead may cite UNASSIGNED from a binding that
-- cannot read the row. That is the behaviour this design depends on, and
-- test/integration/s1.test.ts is what holds it.

-- ---------------------------------------------------------------------------
-- LEADS. Write-only for a stranger; ours to read and to work.
-- ---------------------------------------------------------------------------
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_read ON leads;
DROP POLICY IF EXISTS leads_insert ON leads;
DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_read ON leads FOR SELECT
  USING (ac_unbound() OR ac_internal());
CREATE POLICY leads_insert ON leads FOR INSERT
  WITH CHECK (ac_unbound() OR ac_internal()
              OR (ac_anonymous()
                  AND org_id = '00000000-0000-0000-0000-000000000001'::uuid
                  AND region_id = '00000000-0000-0000-0000-000000000002'::uuid));
CREATE POLICY leads_update ON leads FOR UPDATE
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

-- ---------------------------------------------------------------------------
-- CALL RECORDS. Same shape. A visitor records that THEY called US; an
-- outbound call is something we did, and we are not anonymous when we do it.
-- ---------------------------------------------------------------------------
ALTER TABLE call_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS call_records_read ON call_records;
DROP POLICY IF EXISTS call_records_insert ON call_records;
DROP POLICY IF EXISTS call_records_update ON call_records;
CREATE POLICY call_records_read ON call_records FOR SELECT
  USING (ac_unbound() OR ac_internal());
CREATE POLICY call_records_insert ON call_records FOR INSERT
  WITH CHECK (ac_unbound() OR ac_internal()
              OR (ac_anonymous()
                  AND direction = 'inbound'
                  AND org_id = '00000000-0000-0000-0000-000000000001'::uuid
                  AND region_id = '00000000-0000-0000-0000-000000000002'::uuid));
CREATE POLICY call_records_update ON call_records FOR UPDATE
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

-- ---------------------------------------------------------------------------
-- What an anonymous INSERT may say. The policy above decides WHERE the row
-- lands; this decides what is IN it, and it is a trigger rather than a check
-- constraint because the answer depends on who is writing.
--
-- `converted_account_id` is the column that turns a lead into a customer.
-- It is S2's, on the day someone signs. A stranger arriving with it already
-- set would be a stranger writing into a customer's tree through the one door
-- that has no password on it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_lead_is_anonymous_intake() RETURNS trigger AS $$
BEGIN
  IF NOT ac_anonymous() THEN
    RETURN NEW;  -- ours to capture, work and convert
  END IF;
  IF NEW.converted_account_id IS NOT NULL THEN
    RAISE EXCEPTION 'a lead arrives unconverted; conversion is S2''s, on the day someone signs'
      USING ERRCODE = 'AC403';
  END IF;
  IF NEW.contact IS NULL OR jsonb_typeof(NEW.contact) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'a lead carries a contact object' USING ERRCODE = 'AC422';
  END IF;
  IF btrim(coalesce(NEW.contact ->> 'name', '')) = '' THEN
    RAISE EXCEPTION 'a lead says who it is from' USING ERRCODE = 'AC422';
  END IF;
  IF btrim(coalesce(NEW.contact ->> 'email', '')) = ''
     AND btrim(coalesce(NEW.contact ->> 'phone', '')) = '' THEN
    RAISE EXCEPTION 'a lead we cannot answer is not a lead: an email or a phone number is required'
      USING ERRCODE = 'AC422';
  END IF;
  IF NEW.submission_id IS NULL THEN
    RAISE EXCEPTION 'a queued lead carries the submission id it will be replayed under' USING ERRCODE = 'AC422';
  END IF;
  IF NEW.source NOT IN ('web_form', 'call_button', 'referral') THEN
    RAISE EXCEPTION 'source "%" is not one S1 may declare (web_form, call_button, referral)', NEW.source
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ac_lead_is_anonymous_intake ON leads;
CREATE TRIGGER ac_lead_is_anonymous_intake
  BEFORE INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION ac_lead_is_anonymous_intake();

-- A lead is a stranger's word for itself, so nothing in it is trusted; what is
-- enforced is that it cannot be made into a customer from outside, and that it
-- cannot be edited after the fact by the namespace that wrote it.
CREATE OR REPLACE FUNCTION ac_lead_is_not_the_strangers_to_change() RETURNS trigger AS $$
BEGIN
  IF ac_anonymous() THEN
    RAISE EXCEPTION 'a lead is ours once it is made; the surface that submitted it cannot change it'
      USING ERRCODE = 'AC403';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ac_lead_is_not_the_strangers_to_change ON leads;
CREATE TRIGGER ac_lead_is_not_the_strangers_to_change
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION ac_lead_is_not_the_strangers_to_change();

-- ---------------------------------------------------------------------------
-- FOUR MORE TABLES WITH NO POLICY AT ALL, found the same way and closed here.
--
-- The method that found `leads` and `regions` — bind a transaction as the new
-- namespace and count rows on every table — does not stop at the tables the
-- item is about, and it should not. Run against a database with a day's
-- traffic in it, the anonymous binding also read:
--
--   sessions        every session row: who is signed in, on which surface, in
--                   which org and region, and when it expires. A stranger
--                   reading the shape of our staffing and our customers' from
--                   a marketing page.
--   devices         every field tablet's hardware id, kind and public key.
--   device_grants   which crew is on which device, in which window — the shift
--                   roster, by another name.
--   checklist_items the work a technician recorded on a job.
--   time_entries    hours, by crew, by job. Payroll's raw material.
--
-- None of it through a screen; all of it reachable by every external
-- namespace, not just this one. The three global reference tables
-- (`currencies`, `schema_migrations`, `term_registry`) stay open, because
-- packages/schema/src/tenancy.ts names them as global reference and the term
-- register is deliberately SELECT-able: a policy register nobody can read is
-- a policy nobody can check.
--
-- `sessions`, `devices` and `device_grants` admit the UNBOUND transaction,
-- because the gateway reads all three before it has a principal — login,
-- `assertSessionLive`, and `resolveDeviceLogin`'s first two reads, which
-- happen deliberately before it binds the grant's own tenancy (handlers/
-- devices.ts says why). `ac_unbound()` names that case, as 0007 did.
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_internal ON sessions;
DROP POLICY IF EXISTS sessions_read ON sessions;
DROP POLICY IF EXISTS sessions_open ON sessions;
DROP POLICY IF EXISTS sessions_close ON sessions;
-- Reading is the leak; writing is not, because `sessions` is the gateway's own
-- table and only the gateway role has INSERT on it (0002's grants). So the
-- shape is audit_log's from 0007: read ours, append from any bound
-- transaction.
--
-- The append half is load-bearing and was found by making it internal-only
-- first: `auth.deviceLogin` inserts its session AFTER `resolveDeviceLogin` has
-- bound the grant's own tenancy (it has to — `crews` is behind RLS), so that
-- INSERT arrives on a DEVICE-bound transaction and a policy of
-- "internal or unbound" refuses every technician a token. `auth.login` binds
-- after its insert and would never have shown it.
CREATE POLICY sessions_read ON sessions FOR SELECT USING (ac_unbound() OR ac_internal());
CREATE POLICY sessions_open ON sessions FOR INSERT WITH CHECK (true);
CREATE POLICY sessions_close ON sessions FOR UPDATE
  USING (ac_unbound() OR ac_internal()) WITH CHECK (ac_unbound() OR ac_internal());

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS devices_visibility ON devices;
CREATE POLICY devices_visibility ON devices
  USING (ac_unbound() OR ac_internal()
         OR (ac_setting('ac.namespace') = 'device' AND id::text = ac_setting('ac.device_id')))
  WITH CHECK (ac_unbound() OR ac_internal());

ALTER TABLE device_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_grants_visibility ON device_grants;
CREATE POLICY device_grants_visibility ON device_grants
  USING (ac_unbound() OR ac_internal()
         OR (ac_setting('ac.namespace') = 'device' AND device_id::text = ac_setting('ac.device_id')))
  WITH CHECK (ac_unbound() OR ac_internal());

-- The field's own records. A device writes and reads its own region's, the
-- way 0002 binds every other operational table it touches; nobody outside the
-- internal namespace has any business with either.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['checklist_items','time_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_visibility', t);
    EXECUTE format($f$CREATE POLICY %I ON %I
      USING (ac_unbound() OR ac_internal()
             OR (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id')))
      WITH CHECK (ac_unbound() OR ac_internal()
             OR (ac_setting('ac.namespace') = 'device' AND region_id::text = ac_setting('ac.region_id')))$f$,
      t || '_visibility', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- THE PUBLIC COVERAGE CLAIM. Two columns, active rows, and a name that says
-- what it is. SECURITY DEFINER because `regions` is now closed: the claim is
-- published through one function, so widening it is a diff here.
--
-- What is deliberately NOT returned: min_crew_density (D14 — the supply rule),
-- timezone, id, and any count of crews. "Are you in my city" is answerable
-- without any of them, and everything else on this row is either an internal
-- boundary or a number that would read as a promise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ac_public_coverage()
RETURNS TABLE (code TEXT, name TEXT) AS $$
  SELECT r.code, r.name
    FROM regions r
   WHERE r.active
     AND r.id <> '00000000-0000-0000-0000-000000000002'::uuid  -- UNASSIGNED is a home for orphans, not a metro
   ORDER BY r.name
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION ac_public_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ac_public_coverage() TO ac_gateway, ac_worker, ac_readonly;
