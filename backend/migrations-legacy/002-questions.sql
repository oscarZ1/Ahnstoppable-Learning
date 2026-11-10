-- Standing student question box (independent of discussion posts).
-- Applied by scripts/migrate.js.
BEGIN;

CREATE TABLE IF NOT EXISTS questions (
    id          SERIAL PRIMARY KEY,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    answer      TEXT,                                   -- professor's written answer
    answered_at TIMESTAMPTZ,
    asked_date  DATE NOT NULL DEFAULT CURRENT_DATE,     -- day-by-day view, like posts.post_date
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_questions_class_date ON questions(class_id, asked_date);

COMMIT;
