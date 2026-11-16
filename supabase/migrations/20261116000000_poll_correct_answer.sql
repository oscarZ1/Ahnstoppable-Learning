-- Polls can have one correct answer (optional: opinion polls have none).
-- Students only learn which option it is once the poll has closed
-- (backend/src/routes/polls.js).
--
-- The composite key makes sure the correct option belongs to the same poll;
-- when correct_option_id is NULL the key isn't checked.

ALTER TABLE polls ADD COLUMN IF NOT EXISTS correct_option_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'polls_correct_option_fk') THEN
    ALTER TABLE polls
      ADD CONSTRAINT polls_correct_option_fk
      FOREIGN KEY (id, correct_option_id) REFERENCES poll_options (poll_id, id);
  END IF;
END $$;
