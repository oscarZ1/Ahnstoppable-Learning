// src/routes/polls.js
// Professor-run polls (a question with 2–6 text options):
//   POST   /api/classes/:classId/polls                – professor: start a poll now, or prepare one
//                                                       for a day ({ scheduled_for, prepare })
//   POST   /api/classes/:classId/polls/:pollId/start  – professor: start a prepared poll (its day only)
//   DELETE /api/classes/:classId/polls/:pollId        – professor: delete a prepared poll
//   PATCH  /api/classes/:classId/polls/:pollId/close  – professor: close the open poll
//   GET   /api/classes/:classId/polls/current         – member: open poll (or today's latest) + my vote
//   POST  /api/classes/:classId/polls/:pollId/votes   – student: pick an option (upsert until closed)
//   GET   /api/classes/:classId/polls?date=           – member: polls opened that day
//   GET   /api/classes/:classId/polls/history         – professor: every poll, all dates, with voters
//
// Every poll belongs to a class day (scheduled_for). A prepared poll has
// opened_at NULL: only professors ever see it, and it can only be started on
// its own day. "Open" means started and not closed.
//
// Visibility: professors always see the tally AND who picked each option.
// Students see counts only, and only once the poll has closed. Socket events
// follow the same rule.

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';
import { ISO_DATE, dayStatus, longDay } from '../utils/days.js';

const router = express.Router({ mergeParams: true });

const NUMERIC      = /^\d+$/;
const MAX_QUESTION = 300;
const MAX_OPTION   = 100;
const MIN_OPTIONS  = 2;
const MAX_OPTIONS  = 6;

// ── Helpers ───────────────────────────────────────────────────────────────────
// Polls with their options embedded, ordered by position.
async function selectPolls(whereSql, params, tail = '') {
  const { rows } = await pool.query(
    `SELECT p.id, p.class_id, p.question, p.scheduled_for, p.created_at, p.opened_at, p.closed_at,
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

// Tell the professor's other screens that a day's prepared polls changed.
function emitPrepared(io, classId, date) {
  io.to(`class:${classId}:professor`).emit('poll:prepared', { date });
}

// ── Start a poll now, or prepare one (professor) ─────────────────────────────
router.post('/', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : '';
  const raw      = req.body.options;
  const date     = req.body.scheduled_for ?? null;
  if (date !== null && !ISO_DATE.test(String(date))) {
    return res.status(400).json({ error: 'scheduled_for must be YYYY-MM-DD.' });
  }

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

  const when = await dayStatus(date);
  if (when === 'past') return res.status(400).json({ error: "You can't plan a poll for a day that has passed." });
  // Start now only for today and when not asked to prepare it.
  const startNow = when === 'today' && req.body.prepare !== true;

  const client = await pool.connect();
  let pollId;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO polls (class_id, question, scheduled_for, opened_at)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), CASE WHEN $4 THEN NOW() END)
       RETURNING id`,
      [req.classId, question, date, startNow]
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
    if (startNow) await emitPoll(req.app.get('io'), req.classId, poll);
    else          emitPrepared(req.app.get('io'), req.classId, poll.scheduled_for);
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
       WHERE  id = $1 AND class_id = $2 AND opened_at IS NOT NULL AND closed_at IS NULL`,
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

// ── Start a prepared poll (professor) ────────────────────────────────────────
router.post('/:pollId/start', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { pollId } = req.params;
  if (!NUMERIC.test(pollId)) return res.status(404).json({ error: 'Poll not found.' });
  try {
    const existing = await getPollById(pollId, req.classId);
    if (!existing) return res.status(404).json({ error: 'Poll not found.' });
    if (existing.opened_at) return res.status(409).json({ error: 'This poll has already started.' });
    if (await dayStatus(existing.scheduled_for) !== 'today') {
      return res.status(409).json({ error: `This poll is planned for ${longDay(existing.scheduled_for)}. You can start it on that day.` });
    }
    const { rowCount } = await pool.query(
      `UPDATE polls SET opened_at = NOW()
       WHERE  id = $1 AND class_id = $2 AND opened_at IS NULL AND scheduled_for = CURRENT_DATE`,
      [pollId, req.classId]
    );
    if (rowCount === 0) return res.status(409).json({ error: 'This poll has already started.' });
    const poll = await getPollById(pollId, req.classId);
    await emitPoll(req.app.get('io'), req.classId, poll);
    emitPrepared(req.app.get('io'), req.classId, poll.scheduled_for);
    return res.json({ ...(await pollSnapshot(poll, req.classId, true)), my_option_id: null });
  } catch (err) {
    if (err.code === '23505') { // one open poll per class
      return res.status(409).json({ error: 'A poll is already open. Close it before starting another.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a prepared poll (professor) ───────────────────────────────────────
router.delete('/:pollId', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { pollId } = req.params;
  if (!NUMERIC.test(pollId)) return res.status(404).json({ error: 'Poll not found.' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM polls WHERE id = $1 AND class_id = $2 AND opened_at IS NULL RETURNING scheduled_for`,
      [pollId, req.classId]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: "Only prepared polls that haven't started can be deleted." });
    }
    emitPrepared(req.app.get('io'), req.classId, rows[0].scheduled_for);
    return res.json({ deleted: Number(pollId) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Current state (member) ────────────────────────────────────────────────────
// Declared before the /:pollId routes so "current" is never read as an id.
router.get('/current', requireAuth, requireClassMember, async (req, res) => {
  try {
    // Open poll if any, else the most recent poll started TODAY (so results stay
    // visible for the rest of the session but never bleed into another day).
    // Prepared polls never count.
    const rows = await selectPolls(
      `p.class_id = $1 AND p.opened_at IS NOT NULL
       AND (p.closed_at IS NULL OR p.scheduled_for = CURRENT_DATE)`,
      [req.classId],
      'ORDER BY (p.closed_at IS NULL) DESC, p.opened_at DESC LIMIT 1'
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
    const polls = await selectPolls('p.class_id = $1 AND p.opened_at IS NOT NULL', [req.classId], 'ORDER BY p.opened_at DESC');
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
    if (!poll.opened_at) return res.status(409).json({ error: "This poll hasn't started yet." });
    if (poll.closed_at)  return res.status(409).json({ error: 'This poll has closed.' });
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

// ── Polls for a day ───────────────────────────────────────────────────────────
// Professors: everything planned for that day, prepared polls included.
// Students: only polls that ran and closed, and never a day after today.
router.get('/', requireAuth, requireClassMember, async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : null;
  if (date !== null && !ISO_DATE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  }
  const isProfessor = req.user.role === 'professor';
  try {
    const polls = await selectPolls(
      `p.class_id = $1
       AND p.scheduled_for = COALESCE($2::date, CURRENT_DATE)
       AND ($3 OR (p.opened_at IS NOT NULL AND p.closed_at IS NOT NULL
                   AND p.scheduled_for <= CURRENT_DATE))`,
      [req.classId, date, isProfessor],
      'ORDER BY p.opened_at ASC NULLS LAST, p.created_at ASC'
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
