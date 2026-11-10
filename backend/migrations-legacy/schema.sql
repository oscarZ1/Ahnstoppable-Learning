-- ============================================================
--  Discussion Board  –  PostgreSQL Schema
-- ============================================================
 
-- Users (students AND professors share the same table; role distinguishes them)
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    email       TEXT UNIQUE,            -- professors only; roster students have none
    password    TEXT,                   -- bcrypt hash; NULL until a roster student creates one
    name        TEXT NOT NULL,          -- "First Last"
    sort_name   TEXT,                   -- "Last, First" for the sign-in dropdown
    role        TEXT NOT NULL DEFAULT 'student'  -- 'student' | 'professor'
                CHECK (role IN ('student','professor')),
    talents     INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
 
-- Classes
CREATE TABLE classes (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,          -- e.g. "ADV 375"
    section     TEXT,                   -- e.g. "Section 01"
    start_time  TIME,
    end_time    TIME,
    join_code   TEXT NOT NULL UNIQUE,   -- professor shares this 6-char code
    professor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
 
-- Class memberships (students enrolled in classes)
CREATE TABLE class_members (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, class_id)
);
 
-- Discussion posts (created by professors)
CREATE TABLE posts (
    id          SERIAL PRIMARY KEY,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    post_date   DATE NOT NULL DEFAULT CURRENT_DATE,  -- used for day-by-day view
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
 
-- Comments on posts (students or professor)
CREATE TABLE comments (
    id          SERIAL PRIMARY KEY,
    post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at   TIMESTAMPTZ                             -- set when the author edits it
);
 
-- Replies to comments
CREATE TABLE replies (
    id          SERIAL PRIMARY KEY,
    comment_id  INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at   TIMESTAMPTZ                             -- set when the author edits it
);
 
-- Standing student questions (asked any time, independent of posts)
CREATE TABLE questions (
    id          SERIAL PRIMARY KEY,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    answer      TEXT,                                   -- professor's written answer
    answered_at TIMESTAMPTZ,
    asked_date  DATE NOT NULL DEFAULT CURRENT_DATE,     -- day-by-day view, like posts.post_date
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at        TIMESTAMPTZ,                       -- the asker edited the question
    answer_edited_at TIMESTAMPTZ                        -- the professor edited the answer
);

-- Understanding-check rounds (professor starts / ends one during class, or
-- prepares one ahead of time for a given day)
CREATE TABLE understand_rounds (
    id            SERIAL PRIMARY KEY,
    class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    label         TEXT,                                 -- e.g. "Slide 12: regression"
    scheduled_for DATE NOT NULL DEFAULT CURRENT_DATE,   -- the class day it belongs to
    started_at    TIMESTAMPTZ DEFAULT NOW(),            -- NULL = prepared, not started yet
    ended_at      TIMESTAMPTZ                           -- NULL while the round is open
);

-- Student responses (👍 👋 👎), one per student per round, upserted on change
CREATE TABLE understand_checks (
    id          SERIAL PRIMARY KEY,
    round_id    INTEGER NOT NULL REFERENCES understand_rounds(id) ON DELETE CASCADE,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    response    TEXT NOT NULL CHECK (response IN ('thumbs_up','hand','thumbs_down')),
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (round_id, user_id)
);

-- Polls (professor asks a question with 2–6 text options; one open per class;
-- can be prepared ahead of time for a given day)
CREATE TABLE polls (
    id            SERIAL PRIMARY KEY,
    class_id      INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    question      TEXT NOT NULL,
    scheduled_for DATE NOT NULL DEFAULT CURRENT_DATE,   -- the class day it belongs to
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at     TIMESTAMPTZ,                          -- NULL = prepared, not started yet
    closed_at     TIMESTAMPTZ                           -- NULL while the poll is open
);

CREATE TABLE poll_options (
    id          SERIAL PRIMARY KEY,
    poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text        TEXT NOT NULL,
    position    SMALLINT NOT NULL,                      -- 1-based display order
    UNIQUE (poll_id, position),
    UNIQUE (poll_id, id)                                -- target for the composite FK below
);

-- Poll votes, one per student per poll, upserted on change
CREATE TABLE poll_votes (
    id          SERIAL PRIMARY KEY,
    poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    option_id   INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (poll_id, user_id),
    FOREIGN KEY (poll_id, option_id) REFERENCES poll_options(poll_id, id) ON DELETE CASCADE
);

-- AI summaries of a class day's student questions (professor only, on demand)
CREATE TABLE question_summaries (
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

-- Follow-up replies under an answered question (students and the professor)
CREATE TABLE question_replies (
    id          SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at   TIMESTAMPTZ
);

-- Likes on discussion comments and replies (one per person; only counts are shown)
CREATE TABLE comment_likes (
    comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id)
);
CREATE TABLE reply_likes (
    reply_id   INTEGER NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reply_id, user_id)
);

-- Thumbs-up on questions, answers and replies in the Questions card
CREATE TABLE question_likes (
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (question_id, user_id)
);
CREATE TABLE answer_likes (
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (question_id, user_id)
);
CREATE TABLE question_reply_likes (
    reply_id   INTEGER NOT NULL REFERENCES question_replies(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (reply_id, user_id)
);

-- Indexes for common query patterns
CREATE INDEX idx_posts_class_date   ON posts(class_id, post_date);
CREATE INDEX idx_comments_post      ON comments(post_id);
CREATE INDEX idx_replies_comment    ON replies(comment_id);
CREATE INDEX idx_members_class      ON class_members(class_id);
CREATE INDEX idx_questions_class_date ON questions(class_id, asked_date);
CREATE UNIQUE INDEX idx_rounds_one_open_per_class ON understand_rounds(class_id) WHERE started_at IS NOT NULL AND ended_at IS NULL;
CREATE INDEX idx_rounds_class_day ON understand_rounds(class_id, scheduled_for);
CREATE INDEX idx_rounds_class_started ON understand_rounds(class_id, started_at);
CREATE UNIQUE INDEX idx_polls_one_open_per_class ON polls(class_id) WHERE opened_at IS NOT NULL AND closed_at IS NULL;
CREATE INDEX idx_polls_class_day ON polls(class_id, scheduled_for);
CREATE INDEX idx_polls_class_created ON polls(class_id, created_at);
CREATE INDEX idx_poll_options_poll   ON poll_options(poll_id, position);
CREATE INDEX idx_poll_votes_poll     ON poll_votes(poll_id);
CREATE INDEX idx_question_replies_question ON question_replies(question_id, created_at);
