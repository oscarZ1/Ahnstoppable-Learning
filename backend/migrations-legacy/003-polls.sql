-- Professor-run polls: one question, 2–6 text options, at most one open per class.
-- Applied by scripts/migrate.js (runs each file once; see schema_migrations).
-- Fresh installs get the same shape from schema.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS polls (
    id          SERIAL PRIMARY KEY,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMPTZ                             -- NULL while the poll is open
);

CREATE TABLE IF NOT EXISTS poll_options (
    id          SERIAL PRIMARY KEY,
    poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    position    SMALLINT NOT NULL,                      -- 1-based display order
    UNIQUE (poll_id, position),
    UNIQUE (poll_id, id)                                -- target for the composite FK below
);

-- One vote per student per poll, upserted when they change their pick.
CREATE TABLE IF NOT EXISTS poll_votes (
    id          SERIAL PRIMARY KEY,
    poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id   INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (poll_id, user_id),
    -- the chosen option must belong to the same poll
    FOREIGN KEY (poll_id, option_id) REFERENCES poll_options(poll_id, id) ON DELETE CASCADE
);

-- At most one open poll per class.
CREATE UNIQUE INDEX IF NOT EXISTS idx_polls_one_open_per_class
    ON polls(class_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_polls_class_created ON polls(class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll   ON poll_options(poll_id, position);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll     ON poll_votes(poll_id);

COMMIT;
