-- ===========================================================================
-- 0035 — MESSAGES BETWEEN AC SERVICES EMPLOYEES.
--
-- A direct message names one employee. An everyone message is copied, at the
-- moment it is sent, to every other active employee. The sender gets no copy
-- of their own.
--
-- An employee is an active internal login with no firm, and not on a crew
-- that belongs to a firm. A customer, a vendor, a firm's coordinator and a
-- person on a firm's crew are not senders and not recipients. The gateway
-- checks that before it writes; the policies below are the same line for a
-- statement that is not the gateway's.
--
-- The message row is the sender's org and home region. Each receipt is the
-- recipient's, so the copy sits on that person's shard.
-- Dismissing a receipt is the only change a receipt ever takes.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS staff_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  audience text NOT NULL CHECK (audience IN ('direct','everyone')),
  recipient_id uuid REFERENCES users(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT staff_messages_direct_names_one CHECK ((audience = 'direct') = (recipient_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS staff_messages_region_id_idx ON staff_messages (region_id);
CREATE INDEX IF NOT EXISTS staff_messages_sender_id_created_at_idx ON staff_messages (sender_id, created_at);

CREATE TABLE IF NOT EXISTS staff_message_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  region_id uuid NOT NULL REFERENCES regions(id),
  message_id uuid NOT NULL REFERENCES staff_messages(id),
  user_id uuid NOT NULL REFERENCES users(id),
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS staff_message_receipts_region_id_idx ON staff_message_receipts (region_id);
CREATE INDEX IF NOT EXISTS staff_message_receipts_user_id_dismissed_at_idx ON staff_message_receipts (user_id, dismissed_at);
CREATE INDEX IF NOT EXISTS staff_message_receipts_message_id_idx ON staff_message_receipts (message_id);

-- On a fresh database 0002's GRANT ON ALL TABLES reached these tables first
-- and handed out UPDATE. Narrow it back. An existing database meets the
-- tables here for the first time, and gets the same narrow grants.
REVOKE ALL ON staff_messages FROM ac_gateway, ac_worker, ac_readonly;
REVOKE ALL ON staff_message_receipts FROM ac_gateway, ac_worker, ac_readonly;
GRANT SELECT, INSERT ON staff_messages TO ac_gateway;
GRANT SELECT, INSERT ON staff_message_receipts TO ac_gateway;
GRANT UPDATE (dismissed_at) ON staff_message_receipts TO ac_gateway;

ALTER TABLE staff_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_message_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_message_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_messages_read ON staff_messages;
DROP POLICY IF EXISTS staff_messages_send ON staff_messages;
CREATE POLICY staff_messages_read ON staff_messages FOR SELECT
  USING (ac_unbound()
         OR sender_id::text = ac_setting('ac.actor_id')
         OR EXISTS (SELECT 1 FROM staff_message_receipts r WHERE r.message_id = staff_messages.id AND r.user_id::text = ac_setting('ac.actor_id')));
CREATE POLICY staff_messages_send ON staff_messages FOR INSERT
  WITH CHECK (ac_unbound() OR sender_id::text = ac_setting('ac.actor_id'));

DROP POLICY IF EXISTS staff_message_receipts_read ON staff_message_receipts;
DROP POLICY IF EXISTS staff_message_receipts_deliver ON staff_message_receipts;
DROP POLICY IF EXISTS staff_message_receipts_dismiss ON staff_message_receipts;
CREATE POLICY staff_message_receipts_read ON staff_message_receipts FOR SELECT
  USING (ac_unbound() OR user_id::text = ac_setting('ac.actor_id'));
-- Copies are written by the gateway acting as itself. A bound caller does not insert one.
CREATE POLICY staff_message_receipts_deliver ON staff_message_receipts FOR INSERT
  WITH CHECK (ac_unbound());
CREATE POLICY staff_message_receipts_dismiss ON staff_message_receipts FOR UPDATE
  USING (ac_unbound() OR user_id::text = ac_setting('ac.actor_id'))
  WITH CHECK (ac_unbound() OR user_id::text = ac_setting('ac.actor_id'));
