-- Understanding checks become professor-started rounds.
-- Applied by scripts/migrate.js (runs each file once; see schema_migrations).
-- Fresh installs get the same shape from schema.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS understand_rounds (
    id          SERIAL PRIMARY KEY,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    label       TEXT,                                   -- e.g. "Slide 12: regression"
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at    TIMESTAMPTZ                             -- NULL while the round is open
);

-- At most one open round per class.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_one_open_per_class
    ON understand_rounds(class_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rounds_class_started
    ON understand_rounds(class_id, started_at);

-- Responses now belong to a round. Pre-round rows carried no round, so they are
-- dropped rather than guessed at.
DELETE FROM understand_checks;
ALTER TABLE understand_checks
    ADD COLUMN IF NOT EXISTS round_id INTEGER NOT NULL REFERENCES understand_rounds(id) ON DELETE CASCADE;
ALTER TABLE understand_checks DROP CONSTRAINT IF EXISTS understand_checks_class_id_user_id_key;
DO $$ BEGIN
  ALTER TABLE understand_checks ADD CONSTRAINT understand_checks_round_user_key UNIQUE (round_id, user_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

COMMIT;
