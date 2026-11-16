// src/services/assistantThreads.js
// Storage for the students' assistant chats, shared by the course-help routes
// (routes/assistant.js, one thread per student per class) and the website-help
// routes (routes/me.js, one thread per student, stored with class_id NULL).
import pool from '../db/pool.js';
import { RETENTION_DAYS } from './retention.js';
import { MAX_MESSAGE } from './studyAssistant.js';

const MESSAGE_COLUMNS = 'id, role, content, created_at';

// The caller's own thread within the retention window, oldest first.
// classId null = the website-help thread.
export async function thread(classId, userId) {
  const { rows } = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM   assistant_messages
     WHERE  class_id IS NOT DISTINCT FROM $1 AND user_id = $2
       AND  created_at >= NOW() - make_interval(days => $3)
     ORDER  BY created_at ASC, id ASC`,
    [classId, userId, RETENTION_DAYS]
  );
  return rows;
}

export async function clearThread(classId, userId) {
  const { rowCount } = await pool.query(
    `DELETE FROM assistant_messages WHERE class_id IS NOT DISTINCT FROM $1 AND user_id = $2`,
    [classId, userId]
  );
  return rowCount;
}

// The message text from a request body, or an error for the student.
export function readMessage(body) {
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) return { error: 'Type a message first.' };
  if (content.length > MAX_MESSAGE) return { error: `Messages can be up to ${MAX_MESSAGE} characters.` };
  return { content };
}

// How many messages were answered today on the shared key: in one class, or
// (classId null) in general help across everyone. Messages and replies are
// saved in pairs, so this counts replies; a reply from a student's own key has
// its model stored as "own:<model>" and doesn't count.
export async function sharedMessagesToday(classId) {
  const { rows: [{ used }] } = await pool.query(
    `SELECT COUNT(*)::int AS used
     FROM   assistant_messages
     WHERE  class_id IS NOT DISTINCT FROM $1 AND role = 'model' AND created_at >= CURRENT_DATE
       AND  model NOT LIKE 'own:%'`,
    [classId]
  );
  return used;
}

// Save the student's message and the reply together, once the AI has answered,
// so a failure stores nothing. Returns both rows.
export async function saveExchange({ classId, userId, content, reply, sentAt }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows: [userRow] } = await db.query(
      `INSERT INTO assistant_messages (class_id, user_id, role, content, created_at)
       VALUES ($1, $2, 'user', $3, $4)
       RETURNING ${MESSAGE_COLUMNS}`,
      [classId, userId, content, sentAt]
    );
    const { rows: [modelRow] } = await db.query(
      `INSERT INTO assistant_messages (class_id, user_id, role, content, model, input_tokens, output_tokens, created_at)
       VALUES ($1, $2, 'model', $3, $4, $5, $6, GREATEST(clock_timestamp(), $7::timestamptz))
       RETURNING ${MESSAGE_COLUMNS}`,
      [classId, userId, reply.text, reply.model, reply.usage.input, reply.usage.output, sentAt]
    );
    await db.query('COMMIT');
    return [userRow, modelRow];
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

export function sendAiError(res, err) {
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
  return res.status(err.status).json({ error: err.message, retry_after: err.retryAfter });
}
