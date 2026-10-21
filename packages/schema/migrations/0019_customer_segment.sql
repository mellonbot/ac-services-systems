-- ===========================================================================
-- 0019 — RESIDENTIAL AND COMMERCIAL CUSTOMERS; WHO IN A HOUSEHOLD DOES WHAT.
--
-- (Scope 2026-10-21, the residential / commercial split; partner answers R1, R6.)
--
--   1. organizations.segment — 'residential' | 'commercial', on customers and
--      only on customers. Every customer before this was made through the
--      multi-node door, so all of them are commercial.
--   2. The segment is fixed once set (R1). A landlord's homes becoming a
--      portfolio is a new commercial customer, not an edit; the trigger says
--      so in words (AC422, not a 500).
--   3. Customer logins get their household roles (R6). A login with none — every
--      one made before this — becomes payer AND requester, which is what one
--      person on an account always is. Nothing forces a second login; roles
--      narrow only when the office adds one and gives it one job.
-- ===========================================================================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS segment text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_segment_check') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_segment_check CHECK (segment IN ('residential','commercial'));
  END IF;
END $$;

UPDATE organizations SET segment = 'commercial' WHERE kind = 'customer' AND segment IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_segment_is_a_customers') THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_segment_is_a_customers CHECK ((kind = 'customer') = (segment IS NOT NULL));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ac_segment_is_fixed() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.segment IS DISTINCT FROM NEW.segment THEN
    RAISE EXCEPTION '% is a % customer, and a customer''s segment does not change — a home that becomes a portfolio is a new commercial customer', OLD.name, OLD.segment
      USING ERRCODE = 'AC422';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS organizations_segment_is_fixed ON organizations;
CREATE TRIGGER organizations_segment_is_fixed BEFORE UPDATE OF segment ON organizations
  FOR EACH ROW EXECUTE FUNCTION ac_segment_is_fixed();

UPDATE users SET roles = '["payer","requester"]'::jsonb WHERE namespace = 'customer' AND roles = '[]'::jsonb;
