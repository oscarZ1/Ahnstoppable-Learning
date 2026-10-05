// src/routes/polls.js
// Professor-run polls (a question with 2–6 text options):
//   POST  /api/classes/:classId/polls                 – professor: open a poll (409 if one is open)
//   PATCH /api/classes/:classId/polls/:pollId/close   – professor: close the open poll
//   GET   /api/classes/:classId/polls/current         – member: open poll (or today's latest) + my vote
//   POST  /api/classes/:classId/polls/:pollId/votes   – student: pick an option (upsert until closed)
//   GET   /api/classes/:classId/polls?date=           – member: polls opened that day
//   GET   /api/classes/:classId/polls/history         – professor: every poll, all dates, with voters
//
// Visibility: professors always see the tally AND who picked each option.
// Students see counts only, and only once the poll has closed. Socket events
// follow the same rule.

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';

const router = express.Router({ mergeParams: true });

const ISO_DATE     = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC      = /^\d+$/;
const MAX_QUESTION = 300;
const MAX_OPTION   = 100;
const MIN_OPTIONS  = 2;
const MAX_OPTIONS  = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────
// Polls with their options embedded, ordered by position.
async function selectPolls(whereSql, params, tail = '') {
  const { rows } = await pool.query(
    `SELECT p.id, p.class_id, p.question, p.created_at, p.closed_at,
            (SELECT COALESCE(json_agg(json_build_object('id', o.id, 'text', o.text, 'position', o.position)
                                      ORDER BY o.position), '[]'::json)
             FROM   poll_options o
             WHERE  o.poll_id = p.id) AS options
     FROM   polls p
     WHERE  ${whereSql}
     ${tail}`,
    params
  );
  return rows;
}

async function getPollById(pollId, classId) {
  const rows = await selectPolls('p.id = $1 AND p.class_id = $2', [pollId, classId]);
  return rows[0] ?? null;
}

// Per-option counts in display order. Voter names only when asked for.
async function getTally(pollId, withVoters) {
  const { rows } = await pool.query(
    `SELECT o.id AS option_id,
            COUNT(v.id)::int AS count,
            COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name) ORDER BY u.name)
                     FILTER (WHERE v.id IS NOT NULL), '[]'::json) AS voters
     FROM   poll_options o
     LEFT JOIN poll_votes v ON v.option_id = o.id
     LEFT JOIN users u      ON u.id = v.user_id
     WHERE  o.poll_id = $1
     GROUP  BY o.id, o.position
     ORDER  BY o.position`,
    [pollId]
  );
  const responded = rows.reduce((n, r) => n + r.count, 0);
  const tally = withVoters ? rows : rows.map(({ option_id, count }) => ({ option_id, count }));
  return { tally, responded };
}

async function countStudents(classId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM   class_members cm JOIN users u ON u.id = cm.user_id
     WHERE  cm.class_id = $1 AND u.role = 'student'`,
    [classId]
  );
  return rows[0].n;
}

// Shape { poll, tally, responded, total_students } for a given audience.
async function pollSnapshot(poll, classId, forProfessor, total_students = null) {
  const total  = total_students ?? await countStudents(classId);
  const canSee = forProfessor || (poll && poll.closed_at);
  const { tally, responded } = poll && canSee
    ? await getTally(poll.id, forProfessor)
    : { tally: null, responded: null };
  return { poll, tally, responded, total_students: total };
}

// Broadcast the poll state to both role rooms with role-appropriate tallies.
async function emitPoll(io, classId, poll) {
  const total = await countStudents(classId);
  io.to(`class:${classId}:professor`).emit('poll:state', await pollSnapshot(poll, classId, true,  total));
  io.to(`class:${classId}:student`).emit('poll:state',   await pollSnapshot(poll, classId, false, total));
}

// ── Open a poll (professor) ───────────────────────────────────────────────────
router.post('/', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : '';
  const raw      = req.body.options;

  if (!question) return res.status(400).json({ error: 'question is required.' });
  if (question.length > MAX_QUESTION) {
    return res.status(400).json({ error: `question must be ${MAX_QUESTION} characters or fewer.` });
  }
  if (!Array.isArray(raw) || raw.length < MIN_OPTIONS || raw.length > MAX_OPTIONS) {
    return res.status(400).json({ error: `Provide between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.` });
  }
  const options = raw.map((o) => (typeof o === 'string' ? o.trim() : ''));
  if (options.some((o) => !o)) return res.status(400).json({ error: 'Every option needs text.' });
  if (options.some((o) => o.length > MAX_OPTION)) {
    return res.status(400).json({ error: `Options must be ${MAX_OPTION} characters or fewer.` });
  }
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return res.status(400).json({ error: 'Options must be different from each other.' });
  }

  const client = await pool.connect();
  let pollId;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO polls (class_id, question) VALUES ($1, $2) RETURNING id`,
      [req.classId, question]
    );
    pollId = rows[0].id;
    await client.query(
      `INSERT INTO poll_options (poll_id, text, position)
       SELECT $1, t, i FROM unnest($2::text[]) WITH ORDINALITY AS u(t, i)`,
      [pollId, options]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') { // partial unique index: one open poll per class
      return res.status(409).json({ error: 'A poll is already open. Close it before starting another.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }

  try {
    const poll = await getPollById(pollId, req.classId);
    await emitPoll(req.app.get('io'), req.classId, poll);
    return res.status(201).json({ ...(await pollSnapshot(poll, req.classId, true)), my_option_id: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Close a poll (professor) ──────────────────────────────────────────────────
router.patch('/:pollId/close', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { pollId } = req.params;
  if (!NUMERIC.test(pollId)) return res.status(404).json({ error: 'Poll not found.' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE polls SET closed_at = NOW()
       WHERE  id = $1 AND class_id = $2 AND closed_at IS NULL`,
      [pollId, req.classId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'No open poll with that id.' });
    const poll = await getPollById(pollId, req.classId);
    await emitPoll(req.app.get('io'), req.classId, poll);
    return res.json({ ...(await pollSnapshot(poll, req.classId, true)), my_option_id: null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Current state (member) ────────────────────────────────────────────────────
// Declared before the /:pollId routes so "current" is never read as an id.
router.get('/current', requireAuth, requireClassMember, async (req, res) => {
  try {
    // Open poll if any, else the most recent poll opened TODAY (so results stay
    // visible for the rest of the session but never bleed into another day).
    const rows = await selectPolls(
      'p.class_id = $1 AND (p.closed_at IS NULL OR p.created_at::date = CURRENT_DATE)',
      [req.classId],
      'ORDER BY (p.closed_at IS NULL) DESC, p.created_at DESC LIMIT 1'
    );
    const poll = rows[0] ?? null;
    const snapshot = await pollSnapshot(poll, req.classId, req.user.role === 'professor');

    let my_option_id = null;
    if (poll) {
      const { rows: mine } = await pool.query(
        `SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
        [poll.id, req.user.id]
      );
      my_option_id = mine[0]?.option_id ?? null;
    }
    return res.json({ ...snapshot, my_option_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Every poll, all dates (professor Results page) ───────────────────────────
// Declared before the /:pollId routes so "history" is never read as an id.
router.get('/history', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  try {
    const polls = await selectPolls('p.class_id = $1', [req.classId], 'ORDER BY p.created_at DESC');
    const total = await countStudents(req.classId);
    const snapshots = await Promise.all(polls.map((p) => pollSnapshot(p, req.classId, true, total)));
    return res.json(snapshots);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Vote (student) ────────────────────────────────────────────────────────────
router.post('/:pollId/votes', requireAuth, requireClassMember, async (req, res) => {
  const { pollId } = req.params;
  if (!NUMERIC.test(pollId)) return res.status(404).json({ error: 'Poll not found.' });
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Only students can vote.' });

  const optionId = Number(req.body.option_id);
  if (!Number.isInteger(optionId) || optionId <= 0) {
    return res.status(400).json({ error: 'option_id must be a positive integer.' });
  }

  try {
    const poll = await getPollById(pollId, req.classId);
    if (!poll) return res.status(404).json({ error: 'Poll not found.' });
    if (poll.closed_at) return res.status(409).json({ error: 'This poll has closed.' });
    if (!poll.options.some((o) => o.id === optionId)) {
      return res.status(400).json({ error: 'That option does not belong to this poll.' });
    }

    await pool.query(
      `INSERT INTO poll_votes (poll_id, option_id, class_id, user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (poll_id, user_id)
       DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = NOW()`,
      [poll.id, optionId, req.classId, req.user.id]
    );

    const { tally, responded } = await getTally(poll.id, true);
    const total_students = await countStudents(req.classId);
    req.app.get('io').to(`class:${req.classId}:professor`)
      .emit('poll:update', { poll_id: poll.id, tally, responded, total_students });

    return res.status(201).json({ poll_id: poll.id, option_id: optionId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Polls for a day (history) ─────────────────────────────────────────────────
router.get('/', requireAuth, requireClassMember, async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : null;
  if (date !== null && !ISO_DATE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  }
  const isProfessor = req.user.role === 'professor';
  try {
    const polls = await selectPolls(
      `p.class_id = $1
       AND p.created_at::date = COALESCE($2::date, CURRENT_DATE)
       AND ($3 OR p.closed_at IS NOT NULL)`,
      [req.classId, date, isProfessor],
      'ORDER BY p.created_at ASC'
    );
    const total = await countStudents(req.classId);
    const snapshots = await Promise.all(polls.map((p) => pollSnapshot(p, req.classId, isProfessor, total)));
    return res.json(snapshots);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
