-- Likes on discussion comments and replies: one per person per item, anonymous
-- (only counts are shown). Applied by scripts/migrate.js; fresh installs get
-- the same shape from schema.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE IF NOT EXISTS reply_likes (
    reply_id   INTEGER NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reply_id, user_id)
);
COMMIT;
