-- Students are added by name to a class roster by their professor and sign in
-- by picking their name; they no longer have an email address.
-- Applied by scripts/migrate.js (runs each file once; see schema_migrations).
-- Fresh installs get the same shape from schema.sql.

BEGIN;

-- Roster students have no email. UNIQUE still allows any number of NULLs.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
-- NULL = the student hasn't created a password yet (or the professor reset it).
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
-- "Last, First" as the professor entered it; used to sort the sign-in dropdown.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sort_name TEXT;

COMMIT;
