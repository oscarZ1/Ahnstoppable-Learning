-- Professors can prepare polls and understanding checks for any day ahead of
-- time, then start them during class. Every poll/check now belongs to a day
-- (scheduled_for); a prepared one hasn't started yet:
--   polls:             opened_at  IS NULL
--   understand_rounds: started_at IS NULL
-- Applied by scripts/migrate.js, whose connections use the class timezone
-- (APP_TIMEZONE), so ::date below gives the class's local day. That also moves
-- existing evening items that UTC had filed under the next day.
-- Fresh installs get the same shape from schema.sql.

BEGIN;

-- ── Polls ──
ALTER TABLE polls ADD COLUMN IF NOT EXISTS scheduled_for DATE;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
UPDATE polls SET opened_at = created_at WHERE opened_at IS NULL;
UPDATE polls SET scheduled_for = created_at::date WHERE scheduled_for IS NULL;
ALTER TABLE polls ALTER COLUMN scheduled_for SET DEFAULT CURRENT_DATE;
ALTER TABLE polls ALTER COLUMN scheduled_for SET NOT NULL;

-- Only a started, unclosed poll counts as "open".
DROP INDEX IF EXISTS idx_polls_one_open_per_class;
CREATE UNIQUE INDEX idx_polls_one_open_per_class
    ON polls(class_id) WHERE opened_at IS NOT NULL AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_polls_class_day ON polls(class_id, scheduled_for);

-- ── Understanding checks ──
ALTER TABLE understand_rounds ADD COLUMN IF NOT EXISTS scheduled_for DATE;
UPDATE understand_rounds SET scheduled_for = started_at::date WHERE scheduled_for IS NULL;
ALTER TABLE understand_rounds ALTER COLUMN scheduled_for SET DEFAULT CURRENT_DATE;
ALTER TABLE understand_rounds ALTER COLUMN scheduled_for SET NOT NULL;
ALTER TABLE understand_rounds ALTER COLUMN started_at DROP NOT NULL;

-- Only a started, unended check counts as "running".
DROP INDEX IF EXISTS idx_rounds_one_open_per_class;
CREATE UNIQUE INDEX idx_rounds_one_open_per_class
    ON understand_rounds(class_id) WHERE started_at IS NOT NULL AND ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rounds_class_day ON understand_rounds(class_id, scheduled_for);

COMMIT;
