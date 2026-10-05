// src/routes/questions.js
// Standing question box: students can ask at any time, independent of posts.
//   GET   /api/classes/:classId/questions?date=      – member: questions asked that day
//   POST  /api/classes/:classId/questions            – member: ask a question
//   PATCH /api/classes/:classId/questions/:id/answer – professor: write / update the answer
//
// Student-authored rows are masked for students (see utils/anonymity.js).

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';
import { forRequester } from '../utils/anonymity.js';
import { emitToClass } from '../socket/emit.js';
import { questionLimits } from '../middleware/rateLimit.js';
import { dayStatus } from '../utils/days.js';

const router = express.Router({ mergeParams: true });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LEN = 300;

const SELECT = `
  SELECT q.id, q.class_id, q.content, q.answer, q.answered_at, q.asked_date, q.created_at,
         u.id AS author_id, u.name AS author_name, u.role AS author_role
  FROM   questions q
  JOIN   users u ON u.id = q.author_id`;

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
      [req.classId, date]
    );
    return res.json(rows.map((r) => forRequester(req, r)));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Ask a question ────────────────────────────────────────────────────────────
router.post('/', requireAuth, requireClassMember, ...questionLimits, async (req, res) => {
  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  const { asked_date } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required.' });
  if (content.length > MAX_LEN) return res.status(400).json({ error: `content must be ${MAX_LEN} characters or fewer.` });
  if (asked_date != null && !ISO_DATE.test(String(asked_date))) {
    return res.status(400).json({ error: 'asked_date must be YYYY-MM-DD.' });
  }
  try {
    if (asked_date != null && await dayStatus(asked_date) === 'future') {
      return res.status(400).json({ error: "You can't ask a question for a day that hasn't happened yet." });
    }
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

    return res.status(201).json(forRequester(req, question));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Answer a question (professor) ─────────────────────────────────────────────
router.patch('/:id/answer', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { id } = req.params;
  const answer = typeof req.body.answer === 'string' ? req.body.answer.trim() : '';
  if (!/^\d+$/.test(id)) return res.status(404).json({ error: 'Question not found.' });
  if (!answer) return res.status(400).json({ error: 'answer is required.' });
  if (answer.length > 1000) return res.status(400).json({ error: 'answer must be 1000 characters or fewer.' });
  try {
    const { rows } = await pool.query(
      `UPDATE questions SET answer = $1, answered_at = NOW()
       WHERE  id = $2 AND class_id = $3
       RETURNING id, answer, answered_at`,
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

export default router;
