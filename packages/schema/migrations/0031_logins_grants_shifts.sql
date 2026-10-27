-- ===========================================================================
-- 0031 — THE LOGINS APP GRANTS A TECHNICIAN'S SHIFT ON A DEVICE.
--
-- S5's sign-in (auth.deviceLogin) needs three rows to agree: the technician's
-- login, an active device, and a live device_grants row for that technician
-- whose window covers now. The logins app already writes the first; this
-- lets it write the other two, so whoever makes a technician's login can
-- also let them sign in, without a second tool.
--
-- It widens nothing the role could not already reach: ac_logins sets any
-- user's password and roles, which is strictly more than admitting that user
-- to one device for one window. The checks a grant must pass are the
-- gateway's own (apps/gateway/src/handlers/devices.ts), which the app calls
-- in its transaction; every write lands in audit_log and outbox as the app's
-- actor, as its user writes do.
--
-- devices.public_key is not a secret (a public key), so the whole row is read.
-- ===========================================================================
GRANT SELECT, INSERT ON devices TO ac_logins;
GRANT INSERT ON device_grants TO ac_logins;
