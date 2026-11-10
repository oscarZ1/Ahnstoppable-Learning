-- Questions card: edit, delete and thumbs-up on questions, the professor's
-- answer, and replies to the answer (like discussion comments).
-- Applied by scripts/migrate.js; fresh installs get the same shape from schema.sql.
BEGIN;
ALTER TABLE questions        ADD COLUMN IF NOT EXISTS edited_at        TIMESTAMPTZ;
ALTER TABLE questions        ADD COLUMN IF NOT EXISTS answer_edited_at TIMESTAMPTZ;
ALTER TABLE question_replies ADD COLUMN IF NOT EXISTS edited_at        TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS question_likes (
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (question_id, user_id)
);
CREATE TABLE IF NOT EXISTS answer_likes (
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (question_id, user_id)
);
CREATE TABLE IF NOT EXISTS question_reply_likes (
    reply_id   INTEGER NOT NULL REFERENCES question_replies(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reply_id, user_id)
);
COMMIT;
