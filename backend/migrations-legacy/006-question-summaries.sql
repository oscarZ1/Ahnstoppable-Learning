-- AI summaries of a class day's student questions, generated on demand by the
-- professor and saved so reopening the day doesn't call the AI again.
-- One current summary per class and day; "Refresh" overwrites it.
-- Applied by scripts/migrate.js. Fresh installs get the same shape from schema.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS question_summaries (
    id             SERIAL PRIMARY KEY,
    class_id       INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    summary_date   DATE NOT NULL,
    summary        JSONB NOT NULL,                      -- structured result (overview, themes, …)
    question_count INTEGER NOT NULL,                    -- how many questions it covered
    model          TEXT NOT NULL,                       -- model that produced it
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, summary_date)
);

COMMIT;
