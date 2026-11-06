// src/routes/questions.js
// Standing question box: students can ask at any time, independent of posts.
//   GET   /api/classes/:classId/questions?date=      – member: questions asked that day
//   POST  /api/classes/:classId/questions            – member: ask a question
//   PATCH /api/classes/:classId/questions/:id/answer – professor: write / update the answer
//   POST  /api/classes/:classId/questions/:id/replies – member: reply under an answered question
//   PATCH / DELETE /:id                    – edit (asker) / delete (asker or the class's professor) a question
//   DELETE /:id/answer                     – professor: remove the answer (and replies to it)
//   PATCH / DELETE /:id/replies/:replyId   – edit (author) / delete (author or professor) a reply
//   PUT / DELETE /:id/like, /:id/answer/like, /:id/replies/:replyId/like – thumbs up / take it back
//
// Rows carry is_mine (and liked_by_me) for the requester; students never get
// other students' identities.
//   GET   /api/classes/:classId/questions/summary?date= – professor: the saved AI summary of that day
//   POST  /api/classes/:classId/questions/summary      – professor: create / refresh it ({ date })
//
// Student-authored rows are masked for students (see utils/anonymity.js).

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember, requireClassOwner, isId } from '../middleware/auth.js';
import { forRequester } from '../utils/anonymity.js';
import { emitToClass } from '../socket/emit.js';
import { questionLimits, summaryLimit, discussionLimits, likeLimits } from '../middleware/rateLimit.js';
import { summarizeQuestions, summariesConfigured, SummaryError } from '../services/questionSummary.js';
import { dayStatus, isValidDay } from '../utils/days.js';
import { isClassProfessor, takeBackPoints } from '../utils/moderation.js';

const router = express.Router({ mergeParams: true });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEN = 300;
const MAX_REPLY_LEN = 1000;

// Replies for a set of questions, attached as question.replies (oldest first).
// Student authors are masked for students by forRequester / emitToClass.
async function attachReplies(questions, userId) {
  if (questions.length === 0) return questions;
  const { rows } = await pool.query(
    `SELECT r.id, r.question_id, r.content, r.created_at, r.edited_at,
            u.id AS author_id, u.name AS author_name, u.role AS author_role,
            (r.author_id = $2) AS is_mine,
            (SELECT COUNT(*)::int FROM question_reply_likes l WHERE l.reply_id = r.id) AS like_count,
            EXISTS (SELECT 1 FROM question_reply_likes l WHERE l.reply_id = r.id AND l.user_id = $2) AS liked_by_me
     FROM   question_replies r
     JOIN   users u ON u.id = r.author_id
     WHERE  r.question_id = ANY($1)
     ORDER  BY r.created_at ASC, r.id ASC`,
    [questions.map((q) => q.id), userId]
  );
  const byQuestion = new Map(questions.map((q) => [q.id, []]));
  for (const r of rows) byQuestion.get(r.question_id)?.push(r);
  return questions.map((q) => ({ ...q, replies: byQuestion.get(q.id) ?? [] }));
}

// $3 is the requesting user's id (for is_mine / liked_by_me).
const SELECT = `
  SELECT q.id, q.class_id, q.content, q.answer, q.answered_at, q.asked_date, q.created_at,
         q.edited_at, q.answer_edited_at,
         u.id AS author_id, u.name AS author_name, u.role AS author_role,
         (q.author_id = $3) AS is_mine,
         (SELECT COUNT(*)::int FROM question_likes l WHERE l.question_id = q.id) AS like_count,
         EXISTS (SELECT 1 FROM question_likes l WHERE l.question_id = q.id AND l.user_id = $3) AS liked_by_me,
         (SELECT COUNT(*)::int FROM answer_likes l WHERE l.question_id = q.id) AS answer_like_count,
         EXISTS (SELECT 1 FROM answer_likes l WHERE l.question_id = q.id AND l.user_id = $3) AS answer_liked_by_me
  FROM   questions q
  JOIN   users u ON u.id = q.author_id`;

// ── AI summary of a day's questions (professor only) ─────────────────────────
// The summary stores a snapshot of the questions it covered (text only, as
// Q1…Qn), so its themes keep matching even after more questions arrive.
async function dayQuestions(classId, date) {
  const { rows } = await pool.query(
    `SELECT id, content, (answer IS NOT NULL) AS answered
     FROM   questions
     WHERE  class_id = $1 AND asked_date = COALESCE($2::date, CURRENT_DATE)
     ORDER  BY created_at ASC, id ASC`,
    [classId, date]
  );
  return rows;
}

function summaryDate(value) {
  if (value == null || value === '') return { date: null };
  return isValidDay(String(value)) ? { date: String(value) } : { error: 'date must be YYYY-MM-DD.' };
}

router.get('/summary', requireAuth, requireProfessor, requireClassMember, requireClassOwner, async (req, res) => {
  const { date, error } = summaryDate(req.query.date);
  if (error) return res.status(400).json({ error });
  try {
    const saved = await savedSummary(req.classId, date);
    const current = await dayQuestions(req.classId, date);
    return res.json({
      summary: saved,
      current_question_count: current.length,
      configured: summariesConfigured(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// The saved summary covers exactly these questions (same text, same order). Answering
// a question doesn't change what the AI sees, so it doesn't need a new summary.
function coversSameQuestions(saved, questions) {
  const covered = saved?.summary?.questions;
  return Array.isArray(covered) && covered.length === questions.length
    && covered.every((q, i) => q.content === questions[i].content);
}

async function savedSummary(classId, date) {
  const { rows } = await pool.query(
    `SELECT summary, question_count, model, created_at, summary_date
     FROM   question_summaries
     WHERE  class_id = $1 AND summary_date = COALESCE($2::date, CURRENT_DATE)`,
    [classId, date]
  );
  return rows[0] ?? null;
}

// Summaries being made right now, by class and day, so a double-click or a
// second tab shares one AI call instead of starting another.
const inFlight = new Map();

// Make (or reuse) the day's summary. Returns { summary, current_question_count, unchanged }.
async function makeSummary(classId, date, userId) {
  const questions = await dayQuestions(classId, date);
  const saved = await savedSummary(classId, date);
  if (saved && coversSameQuestions(saved, questions)) {
    return { summary: saved, current_question_count: questions.length, unchanged: true };
  }
  const { summary, model } = await summarizeQuestions(questions);
  const stored = {
    ...summary,
    questions: questions.map((q, i) => ({ number: i + 1, content: q.content, answered: q.answered })),
  };
  const { rows } = await pool.query(
    `INSERT INTO question_summaries (class_id, summary_date, summary, question_count, model, created_by)
     VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)
     ON CONFLICT (class_id, summary_date) DO UPDATE
       SET summary = EXCLUDED.summary, question_count = EXCLUDED.question_count,
           model = EXCLUDED.model, created_by = EXCLUDED.created_by, created_at = NOW()
     RETURNING summary, question_count, model, created_at, summary_date`,
    [classId, date, JSON.stringify(stored), questions.length, model, userId]
  );
  return { summary: rows[0], current_question_count: questions.length, unchanged: false };
}

router.post('/summary', requireAuth, requireProfessor, requireClassMember, requireClassOwner, summaryLimit, async (req, res) => {
  const { date, error } = summaryDate(req.body.date);
  if (error) return res.status(400).json({ error });
  const key = `${req.classId}:${date ?? 'today'}`;
  try {
    let job = inFlight.get(key);
    const joined = Boolean(job);
    if (!job) {
      job = makeSummary(req.classId, date, req.user.id).finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    const result = await job;
    // Reusing a summary didn't call the AI, so it doesn't count toward summaryLimit.
    if (joined || result.unchanged) res.locals.summaryReused = true;
    return res.status(result.unchanged ? 200 : 201).json({ ...result, configured: true });
  } catch (err) {
    if (err instanceof SummaryError) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      return res.status(err.status).json({ error: err.message, retry_after: err.retryAfter });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── List questions for a day ──────────────────────────────────────────────────
router.get('/', requireAuth, requireClassMember, async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : null;
  if (date !== null && !ISO_DATE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  }
  try {
    const { rows } = await pool.query(
      `${SELECT}
       WHERE  q.class_id = $1 AND q.asked_date = COALESCE($2::date, CURRENT_DATE)
       ORDER  BY q.created_at ASC`,
      [req.classId, date, req.user.id]
    );
    const withReplies = await attachReplies(rows, req.user.id);
    return res.json(withReplies.map((r) => forRequester(req, r)));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Ask a question ────────────────────────────────────────────────────────────
router.post('/', requireAuth, requireClassMember, ...questionLimits, async (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  // A question is always asked "today" (in the class timezone). The browser
  // sends its local date; if that's unreadable (some browsers format dates
  // differently) or not today, use the class's today instead of rejecting it.
  let asked_date = req.body.asked_date ?? null;
  if (asked_date !== null && !isValidDay(String(asked_date))) {
    console.warn(`questions: unreadable asked_date ${JSON.stringify(asked_date)} from user ${req.user.id}; using today`);
    asked_date = null;
  }
  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length > MAX_LEN) return res.status(400).json({ error: `content must be ${MAX_LEN} characters or fewer.` });
  try {
    // A device set to another timezone (or a wrong clock) can be a day off;
    // the question still belongs to the class's today.
    if (asked_date != null && await dayStatus(asked_date) !== 'today') asked_date = null;
    const { rows } = await pool.query(
      `INSERT INTO questions (class_id, author_id, content, asked_date)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))
       RETURNING id, class_id, content, answer, answered_at, asked_date, created_at`,
      [req.classId, req.user.id, content, asked_date ?? null]
    );
    const question = {
      ...rows[0],
      author_id:   req.user.id,
      author_name: req.user.name ?? null,
      author_role: req.user.role,
    };

    emitToClass(req.app.get('io'), req.classId, 'question:new', question);

    // Asking counts as participation, same as commenting.
    await pool.query(`UPDATE users SET talents = talents + 1 WHERE id = $1`, [req.user.id]);

    return res.status(201).json(forRequester(req, {
      ...question, is_mine: true, like_count: 0, liked_by_me: false,
      answer_like_count: 0, answer_liked_by_me: false, replies: [],
    }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Answer a question (professor) ─────────────────────────────────────────────
// ── Reply under an answered question (member) ────────────────────────────────
router.post('/:id/replies', requireAuth, requireClassMember, ...discussionLimits, async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length > MAX_REPLY_LEN) {
    return res.status(400).json({ error: `content must be ${MAX_REPLY_LEN} characters or fewer.` });
  }
  try {
    const { rows: [question] } = await pool.query(
      `SELECT id, asked_date, (answer IS NOT NULL) AS answered FROM questions WHERE id = $1 AND class_id = $2`,
      [id, req.classId]
    );
    if (!question) return res.status(404).json({ error: 'Question not found.' });
    if (!question.answered) {
      return res.status(409).json({ error: 'You can reply once the professor has answered this question.' });
    }
    const { rows: [row] } = await pool.query(
      `INSERT INTO question_replies (question_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, question_id, content, created_at`,
      [question.id, req.user.id, content]
    );
    const reply = {
      ...row,
      asked_date:  question.asked_date,
      author_id:   req.user.id,
      author_name: req.user.name ?? null,
      author_role: req.user.role,
    };
    emitToClass(req.app.get('io'), req.classId, 'question:reply', reply);

    // Replying counts as participation, same as replying in a discussion.
    await pool.query(`UPDATE users SET talents = talents + 1 WHERE id = $1`, [req.user.id]);

    return res.status(201).json(forRequester(req, { ...reply, is_mine: true, like_count: 0, liked_by_me: false }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.patch('/:id/answer', requireAuth, requireProfessor, requireClassMember, requireClassOwner, async (req, res) => {
  const { id } = req.params;
  const answer = typeof req.body.answer === 'string' ? req.body.answer.trim() : '';
  if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
  if (!answer) return res.status(400).json({ error: 'answer is required.' });
  if (answer.length > 1000) return res.status(400).json({ error: 'answer must be 1000 characters or fewer.' });
  try {
    // A first answer sets answered_at; changing it later marks it edited.
    const { rows } = await pool.query(
      `UPDATE questions
       SET    answer = $1,
              answered_at      = COALESCE(answered_at, NOW()),
              answer_edited_at = CASE WHEN answer IS NULL THEN NULL ELSE NOW() END
       WHERE  id = $2 AND class_id = $3
       RETURNING id, answer, answered_at, answer_edited_at`,
      [answer, id, req.classId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Question not found.' });

    // No author fields in this payload, so everyone can get the same copy.
    req.app.get('io').to(`class:${req.classId}`).emit('question:answered', rows[0]);
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Edit your own question ────────────────────────────────────────────────────
router.patch('/:id', requireAuth, requireClassMember, async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length > MAX_LEN) return res.status(400).json({ error: `content must be ${MAX_LEN} characters or fewer.` });
  try {
    const { rows } = await pool.query(
      `UPDATE questions SET content = $4, edited_at = NOW()
       WHERE  id = $1 AND class_id = $2 AND author_id = $3
       RETURNING id, content, edited_at`,
      [id, req.classId, req.user.id, content]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Question not found, or it isn't yours to edit." });
    req.app.get('io').to(`class:${req.classId}`).emit('question:updated', rows[0]);
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a question (asker, or the class's professor) ──────────────────────
router.delete('/:id', requireAuth, requireClassMember, async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
  const client = await pool.connect();
  try {
    const moderator = await isClassProfessor(req);
    await client.query('BEGIN');
    const { rows: [question] } = await client.query(
      `SELECT id, author_id FROM questions WHERE id = $1 AND class_id = $2 AND ($3 OR author_id = $4) FOR UPDATE`,
      [id, req.classId, moderator, req.user.id]
    );
    if (!question) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Question not found, or it isn't yours to delete." });
    }
    const { rows: replyAuthors } = await client.query(`SELECT author_id FROM question_replies WHERE question_id = $1`, [question.id]);
    await client.query(`DELETE FROM questions WHERE id = $1`, [question.id]);
    await takeBackPoints(client, [question.author_id, ...replyAuthors.map((r) => r.author_id)]);
    await client.query('COMMIT');
    req.app.get('io').to(`class:${req.classId}`).emit('question:deleted', { id: question.id });
    return res.json({ deleted: question.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── Remove the answer (the class's professor) ────────────────────────────────
// Replies were follow-ups to that answer, so they go with it.
router.delete('/:id/answer', requireAuth, requireProfessor, requireClassMember, requireClassOwner, async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [question] } = await client.query(
      `UPDATE questions SET answer = NULL, answered_at = NULL, answer_edited_at = NULL
       WHERE  id = $1 AND class_id = $2 AND answer IS NOT NULL
       RETURNING id`,
      [id, req.classId]
    );
    if (!question) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That question has no answer to remove.' });
    }
    const { rows: replyAuthors } = await client.query(
      `DELETE FROM question_replies WHERE question_id = $1 RETURNING author_id`, [question.id]
    );
    await client.query(`DELETE FROM answer_likes WHERE question_id = $1`, [question.id]);
    await takeBackPoints(client, replyAuthors.map((r) => r.author_id));
    await client.query('COMMIT');
    req.app.get('io').to(`class:${req.classId}`).emit('question:answer_deleted', { id: question.id });
    return res.json({ id: question.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── Edit your own reply ───────────────────────────────────────────────────────
router.patch('/:id/replies/:replyId', requireAuth, requireClassMember, async (req, res) => {
  const { id, replyId } = req.params;
  if (!isId(id) || !isId(replyId)) return res.status(404).json({ error: 'Reply not found.' });
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length > MAX_REPLY_LEN) return res.status(400).json({ error: `content must be ${MAX_REPLY_LEN} characters or fewer.` });
  try {
    const { rows } = await pool.query(
      `UPDATE question_replies r SET content = $5, edited_at = NOW()
       FROM   questions q
       WHERE  r.id = $1 AND r.question_id = $2 AND q.id = r.question_id AND q.class_id = $3 AND r.author_id = $4
       RETURNING r.id, r.question_id, r.content, r.edited_at`,
      [replyId, id, req.classId, req.user.id, content]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Reply not found, or it isn't yours to edit." });
    req.app.get('io').to(`class:${req.classId}`).emit('question_reply:updated', rows[0]);
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a reply (author, or the class's professor) ────────────────────────
router.delete('/:id/replies/:replyId', requireAuth, requireClassMember, async (req, res) => {
  const { id, replyId } = req.params;
  if (!isId(id) || !isId(replyId)) return res.status(404).json({ error: 'Reply not found.' });
  const client = await pool.connect();
  try {
    const moderator = await isClassProfessor(req);
    await client.query('BEGIN');
    const { rows: [reply] } = await client.query(
      `DELETE FROM question_replies r
       USING  questions q
       WHERE  r.id = $1 AND r.question_id = $2 AND q.id = r.question_id AND q.class_id = $3
         AND  ($4 OR r.author_id = $5)
       RETURNING r.id, r.question_id, r.author_id`,
      [replyId, id, req.classId, moderator, req.user.id]
    );
    if (!reply) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Reply not found, or it isn't yours to delete." });
    }
    await takeBackPoints(client, [reply.author_id]);
    await client.query('COMMIT');
    req.app.get('io').to(`class:${req.classId}`).emit('question_reply:deleted', { id: reply.id, question_id: reply.question_id });
    return res.json({ deleted: reply.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── Thumbs up ─────────────────────────────────────────────────────────────────
// PUT adds yours, DELETE takes it back; both are safe to repeat. Everyone gets
// the new count live; who liked is never sent.
async function setLike(req, res, { table, keyColumn, keyValue, check, event, payload }, liked) {
  try {
    const { rowCount } = await pool.query(check.sql, check.params);
    if (rowCount === 0) return res.status(404).json({ error: check.notFound });
    if (liked) {
      await pool.query(`INSERT INTO ${table} (${keyColumn}, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [keyValue, req.user.id]);
    } else {
      await pool.query(`DELETE FROM ${table} WHERE ${keyColumn} = $1 AND user_id = $2`, [keyValue, req.user.id]);
    }
    const { rows: [{ n }] } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${keyColumn} = $1`, [keyValue]);
    const update = { ...payload, like_count: n };
    req.app.get('io').to(`class:${req.classId}`).emit(event, update);
    return res.json({ ...update, liked_by_me: liked });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
}

function questionLike(liked) {
  return (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
    return setLike(req, res, {
      table: 'question_likes', keyColumn: 'question_id', keyValue: id,
      check: { sql: `SELECT 1 FROM questions WHERE id = $1 AND class_id = $2`, params: [id, req.classId], notFound: 'Question not found.' },
      event: 'question:likes', payload: { id: Number(id), target: 'question' },
    }, liked);
  };
}
function answerLike(liked) {
  return (req, res) => {
    const { id } = req.params;
    if (!isId(id)) return res.status(404).json({ error: 'Question not found.' });
    return setLike(req, res, {
      table: 'answer_likes', keyColumn: 'question_id', keyValue: id,
      check: { sql: `SELECT 1 FROM questions WHERE id = $1 AND class_id = $2 AND answer IS NOT NULL`, params: [id, req.classId], notFound: 'That question has no answer yet.' },
      event: 'question:likes', payload: { id: Number(id), target: 'answer' },
    }, liked);
  };
}
function replyLike(liked) {
  return (req, res) => {
    const { id, replyId } = req.params;
    if (!isId(id) || !isId(replyId)) return res.status(404).json({ error: 'Reply not found.' });
    return setLike(req, res, {
      table: 'question_reply_likes', keyColumn: 'reply_id', keyValue: replyId,
      check: {
        sql: `SELECT 1 FROM question_replies r JOIN questions q ON q.id = r.question_id
              WHERE r.id = $1 AND r.question_id = $2 AND q.class_id = $3`,
        params: [replyId, id, req.classId], notFound: 'Reply not found.',
      },
      event: 'question_reply:likes', payload: { id: Number(replyId), question_id: Number(id) },
    }, liked);
  };
}

router.put('/:id/like',                       requireAuth, requireClassMember, ...likeLimits, questionLike(true));
router.delete('/:id/like',                    requireAuth, requireClassMember, ...likeLimits, questionLike(false));
router.put('/:id/answer/like',                requireAuth, requireClassMember, ...likeLimits, answerLike(true));
router.delete('/:id/answer/like',             requireAuth, requireClassMember, ...likeLimits, answerLike(false));
router.put('/:id/replies/:replyId/like',      requireAuth, requireClassMember, ...likeLimits, replyLike(true));
router.delete('/:id/replies/:replyId/like',   requireAuth, requireClassMember, ...likeLimits, replyLike(false));

export default router;
