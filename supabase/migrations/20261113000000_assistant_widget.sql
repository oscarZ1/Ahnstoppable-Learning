-- The students' corner assistant.
--
-- Website help isn't tied to a class: those messages are stored with
-- class_id NULL, one thread per student. Course help keeps using the class's
-- thread as before.
--
-- Students can use their own Google Gemini API key instead of the shared one.
-- The key is stored encrypted (AES-256-GCM, services/aiKeys.js) and never sent
-- back to the browser; only its last four characters are kept in plain text.

ALTER TABLE assistant_messages ALTER COLUMN class_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS assistant_messages_site_thread
    ON assistant_messages (user_id, created_at) WHERE class_id IS NULL;

CREATE TABLE IF NOT EXISTS student_ai_keys (
    user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    key_ciphertext BYTEA NOT NULL,
    key_iv         BYTEA NOT NULL,
    key_tag        BYTEA NOT NULL,
    key_last4      TEXT  NOT NULL,
    verified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- when a test call last succeeded
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE student_ai_keys ENABLE ROW LEVEL SECURITY;
