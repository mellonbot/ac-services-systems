-- ===========================================================================
-- 0032 — A PERSON SETS THEIR OWN PICTURE, STATUS AND PASSWORD.
--
-- The Account button on every signed-in surface (S2–S8) reads and writes the
-- caller's own users row and nothing else. The gateway does it as itself,
-- the way login reads users and logout writes sessions: identity belongs to
-- the gateway, not to any surface's write allowlist, and the row is always
-- WHERE id = the token's subject.
--
--   presence      available | busy | away | off — what the person says, not
--                 a state the system derives. Never drawn in a state ink.
--   status_note   one line, 80 characters.
--   avatar        the bytes, at most 64 KB. The browser scales the picture to
--                 a small square before it sends, so this is a thumbnail, not
--                 a photo; it lives in the row so it needs no object store.
--   password_changed_at
--                 when the person last set their own password. A change ends
--                 every other session the person holds — their other browsers
--                 and, for a technician, the device's shift session.
--
-- The column grants 0021 and 0027 gave ac_readonly, ac_worker and ac_logins
-- were computed then, so none of these columns is readable by those roles.
-- None of them needs one.
-- ===========================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS presence text NOT NULL DEFAULT 'available' CHECK (presence IN ('available','busy','away','off'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_note text CHECK (char_length(status_note) <= 80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar bytea CHECK (octet_length(avatar) <= 65536);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_type text CHECK (avatar_type IN ('image/jpeg','image/png'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_avatar_has_type CHECK ((avatar IS NULL) = (avatar_type IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
