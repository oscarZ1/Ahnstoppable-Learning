-- Comments and replies can be edited by their author; remember when, so the
-- page can show "(edited)". Applied by scripts/migrate.js; fresh installs get
-- the same shape from schema.sql.
BEGIN;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE replies  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
COMMIT;
