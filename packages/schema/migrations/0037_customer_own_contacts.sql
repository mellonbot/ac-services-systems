-- ===========================================================================
-- 0037 — THE CUSTOMER EDITS ITS OWN ON-SITE CONTACTS (OPEN-S6-CONTACTS).
--
-- Until now only the internal namespace could write account_contacts
-- (ac_site_record_writable = namespace = 'internal'). A facility manager
-- who arrives at 2 a.m. and needs to change the gate number, or name a
-- replacement while the regular is on leave, could only read.
--
-- The decision (OPEN-S6-CONTACTS): yes, a customer may set or replace a
-- contact at a node in its own scope. The contact is who a crew is told
-- to trust on arrival, so the write is still held at the table: the
-- customer can only touch rows whose account is visible to them under
-- the existing node visibility rule (ac_node_row_visible). No other
-- namespace is widened.
--
-- The operation stays contacts.set (already on S2; now also admitted to
-- S6 under the contact_update label already in the registry). The
-- handler already refuses an invisible node; the policy now agrees.
-- ===========================================================================

-- Contacts are writable by internal, or by the customer. Visibility is
-- enforced separately by the policy so a customer cannot invent a contact
-- at a node they cannot see.
CREATE OR REPLACE FUNCTION ac_contact_writable() RETURNS BOOLEAN AS $$
  SELECT ac_setting('ac.namespace') IN ('internal', 'customer')
$$ LANGUAGE sql STABLE;

-- Recreate the write policies. Both the namespace and the node visibility
-- are required.
DROP POLICY IF EXISTS account_contacts_insert ON account_contacts;
DROP POLICY IF EXISTS account_contacts_update ON account_contacts;
CREATE POLICY account_contacts_insert ON account_contacts FOR INSERT
  WITH CHECK (ac_contact_writable() AND ac_node_row_visible(account_id));
CREATE POLICY account_contacts_update ON account_contacts FOR UPDATE
  USING (ac_contact_writable() AND ac_node_row_visible(account_id))
  WITH CHECK (ac_contact_writable() AND ac_node_row_visible(account_id));
