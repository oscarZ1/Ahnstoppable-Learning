// src/routes/posts.js
// GET    /api/classes/:classId/posts          – get all posts for a date (default: today, class timezone)
// GET    /api/classes/:classId/posts/dates    – per-day post/comment counts for a year (calendar markers)
// POST   /api/classes/:classId/posts          – professor: create a post (any day, including future days)
//
// Professors can plan ahead: a post for a future day is only ever sent to
// professors, and students never get a day after today.
// DELETE /api/classes/:classId/posts/:postId  – professor: delete own post

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';
import { emitToClass } from '../socket/emit.js';
import { dayStatus } from '../utils/days.js';

const router = express.Router({ mergeParams: true });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Get posts for a date ──────────────────────────────────────────────────────
router.get('/', requireAuth, requireClassMember, async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : null;
  if (date !== null && !ISO_DATE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.content, p.post_date, p.created_at,
              u.id AS author_id, u.name AS author_name, u.role AS author_role
       FROM   posts p
       JOIN   users u ON u.id = p.author_id
       WHERE  p.class_id = $1 AND p.post_date = COALESCE($2::date, CURRENT_DATE)
         AND  ($3 OR p.post_date <= CURRENT_DATE)
       ORDER  BY p.created_at ASC`,
      [req.classId, date, req.user.role === 'professor']
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Activity per day for a year ──────────────────────────────────────────────
// Returns [{ date: 'YYYY-MM-DD', posts, comments, questions, prepared }] for
// every day with activity. Comments count toward their post's day. Students
// never get future days; professors also get "prepared" (polls and checks
// waiting to be started) so planned days show up in the calendar.
router.get('/dates', requireAuth, requireClassMember, async (req, res) => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: 'year must be a four-digit year.' });
  }

  try {
    const { rows } = await pool.query(
      `WITH post_days AS (
         SELECT p.post_date AS date, COUNT(DISTINCT p.id)::int AS posts, COUNT(c.id)::int AS comments
         FROM   posts p LEFT JOIN comments c ON c.post_id = p.id
         WHERE  p.class_id = $1 AND p.post_date >= make_date($2, 1, 1) AND p.post_date < make_date($2 + 1, 1, 1)
           AND  ($3 OR p.post_date <= CURRENT_DATE)
         GROUP  BY p.post_date
       ), question_days AS (
         SELECT asked_date AS date, COUNT(*)::int AS questions
         FROM   questions
         WHERE  class_id = $1 AND asked_date >= make_date($2, 1, 1) AND asked_date < make_date($2 + 1, 1, 1)
           AND  ($3 OR asked_date <= CURRENT_DATE)
         GROUP  BY asked_date
       ), prepared_days AS (
         SELECT scheduled_for AS date, COUNT(*)::int AS prepared
         FROM (
           SELECT scheduled_for FROM polls
           WHERE  class_id = $1 AND opened_at IS NULL AND $3
           UNION ALL
           SELECT scheduled_for FROM understand_rounds
           WHERE  class_id = $1 AND started_at IS NULL AND $3
         ) x
         WHERE  scheduled_for >= make_date($2, 1, 1) AND scheduled_for < make_date($2 + 1, 1, 1)
         GROUP  BY scheduled_for
       )
       SELECT date,
              SUM(posts)::int AS posts, SUM(comments)::int AS comments,
              SUM(questions)::int AS questions, SUM(prepared)::int AS prepared
       FROM (
         SELECT date, posts, comments, 0 AS questions, 0 AS prepared FROM post_days
         UNION ALL SELECT date, 0, 0, questions, 0 FROM question_days
         UNION ALL SELECT date, 0, 0, 0, prepared FROM prepared_days
       ) t
       GROUP  BY date
       ORDER  BY date`,
      [req.classId, year, req.user.role === 'professor']
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Create a post (professor only) ───────────────────────────────────────────
router.post('/', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { title, content, post_date } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required.' });
  }
  // The client sends its local calendar date so the post lands on the
  // professor's "today" regardless of the DB server's timezone.
  if (post_date != null && !ISO_DATE.test(String(post_date))) {
    return res.status(400).json({ error: 'post_date must be YYYY-MM-DD.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO posts (class_id, author_id, title, content, post_date)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
       RETURNING id, class_id, author_id, title, content, post_date, created_at`,
      [req.classId, req.user.id, title, content, post_date ?? null]
    );

    const post = {
      ...rows[0],
      author_name: req.user.name ?? null,
      author_role: 'professor',
    };

    // A post for a future day is only announced to professors.
    if (await dayStatus(post.post_date) === 'future') {
      req.app.get('io').to(`class:${req.classId}:professor`).emit('post:new', post);
    } else {
      emitToClass(req.app.get('io'), req.classId, 'post:new', post);
    }

    return res.status(201).json(post);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a post ─────────────────────────────────────────────────────────────
router.delete('/:postId', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { postId } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM posts WHERE id = $1 AND class_id = $2 AND author_id = $3`,
      [postId, req.classId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Post not found.' });

    const io = req.app.get('io');
    io.to(`class:${req.classId}`).emit('post:deleted', { postId: Number(postId) });

    return res.json({ message: 'Post deleted.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
