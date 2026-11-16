// src/services/retention.js
// Study-assistant chats are kept for ASSISTANT_RETENTION_DAYS (default 120),
// then deleted, along with the professor's daily summaries of them. Runs when
// the server starts and once a day after that (see index.js). Railway runs a
// single instance, so no separate scheduled job is needed; the assistant's
// GET route also hides anything older, in case a purge was missed.
import pool from '../db/pool.js';

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const RETENTION_DAYS = positiveInt(process.env.ASSISTANT_RETENTION_DAYS, 120);

export async function purgeOldAssistantMessages() {
  const messages = await pool.query(
    `DELETE FROM assistant_messages WHERE created_at < NOW() - make_interval(days => $1)`,
    [RETENTION_DAYS]
  );
  const summaries = await pool.query(
    `DELETE FROM assistant_summaries WHERE summary_date < CURRENT_DATE - $1::int`,
    [RETENTION_DAYS]
  );
  if (messages.rowCount || summaries.rowCount) {
    console.info(`Retention: deleted ${messages.rowCount} study-assistant message(s) and ${summaries.rowCount} summary(ies) older than ${RETENTION_DAYS} days.`);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Purge now, then every 24 hours. Never crashes the server.
export function scheduleRetention() {
  const run = () => purgeOldAssistantMessages().catch((err) => console.error('Retention purge failed:', err.message));
  run();
  setInterval(run, DAY_MS).unref();
}
