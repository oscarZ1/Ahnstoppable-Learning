-- Follow-up replies under an answered question in the Questions card, so a
-- student can respond to the professor's answer (and the professor back).
-- Applied by scripts/migrate.js. Fresh installs get the same shape from schema.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS question_replies (
    id          SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_question_replies_question ON question_replies(question_id, created_at);

COMMIT;
