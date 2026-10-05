// src/routes/classroom.js
// Understanding checks run as professor-started rounds:
//   POST   /api/classes/:classId/understand/rounds                – professor: start a round now, or prepare
//                                                                    one for a day ({ scheduled_for, prepare })
//   POST   /api/classes/:classId/understand/rounds/:roundId/start – professor: start a prepared round (its day only)
//   DELETE /api/classes/:classId/understand/rounds/:roundId       – professor: delete a prepared round
//   PATCH  /api/classes/:classId/understand/rounds/:roundId/end   – professor: end the open round
//   GET    /api/classes/:classId/understand/rounds?date=          – member: that day's rounds (+ tallies)
//   POST  /api/classes/:classId/understand                  – member: vote in the open round (409 if none)
//   GET   /api/classes/:classId/understand                  – member: current round + tally + my vote
//   GET   /api/classes/:classId/understand/history          – professor: every round, all dates, who answered what
//   GET   /api/classes/:classId/talents                     – member: sorted talent leaderboard
//
// Every round belongs to a class day (scheduled_for). A prepared round has
// started_at NULL: only professors see it, and it can only start on its day.
//
// Visibility: professors always see tallies. Students see a round's tally only
// after it has ended. Socket events follow the same rule.

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';
import { ISO_DATE, dayStatus, longDay } from '../utils/days.js';

const router = express.Router({ mergeParams: true });

const VALID_RESPONSES = ['thumbs_up', 'hand', 'thumbs_down'];
const ROUND_COLS = 'id, class_id, label, scheduled_for, started_at, ended_at';
const NUMERIC = /^\d+$/;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getTally(roundId) {
  const { rows } = await pool.query(
    `SELECT response, COUNT(*)::int AS count
     FROM   understand_checks
     WHERE  round_id = $1
     GROUP  BY response`,
    [roundId]
  );
  const responded = rows.reduce((n, r) => n + r.count, 0);
  return { tally: rows, responded };
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

async function getOpenRound(classId) {
  const { rows } = await pool.query(
    `SELECT ${ROUND_COLS}
     FROM   understand_rounds
     WHERE  class_id = $1 AND started_at IS NOT NULL AND ended_at IS NULL`,
    [classId]
  );
  return rows[0] ?? null;
}

// Shape { round, tally, responded, total_students } for a given audience.
async function roundSnapshot(round, classId, forProfessor) {
  const total_students = await countStudents(classId);
  const canSee = forProfessor || (round && round.ended_at);
  const { tally, responded } = round && canSee ? await getTally(round.id) : { tally: null, responded: null };
  return { round, tally, responded, total_students };
}

// Broadcast the round state to both role rooms with role-appropriate tallies.
async function emitRound(io, classId, round) {
  io.to(`class:${classId}:professor`).emit('understand:round', await roundSnapshot(round, classId, true));
  io.to(`class:${classId}:student`).emit('understand:round',   await roundSnapshot(round, classId, false));
}

// Tell the professor's other screens that a day's prepared checks changed.
function emitPrepared(io, classId, date) {
  io.to(`class:${classId}:professor`).emit('understand:prepared', { date });
}

// ── Start a round now, or prepare one (professor) ────────────────────────────
router.post('/understand/rounds', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 120) : null;
  const date  = req.body.scheduled_for ?? null;
  if (date !== null && !ISO_DATE.test(String(date))) {
    return res.status(400).json({ error: 'scheduled_for must be YYYY-MM-DD.' });
  }
  try {
    const when = await dayStatus(date);
    if (when === 'past') return res.status(400).json({ error: "You can't plan a check for a day that has passed." });
    const startNow = when === 'today' && req.body.prepare !== true;

    const { rows } = await pool.query(
      `INSERT INTO understand_rounds (class_id, label, scheduled_for, started_at)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), CASE WHEN $4 THEN NOW() END)
       RETURNING ${ROUND_COLS}`,
      [req.classId, label || null, date, startNow]
    );
    const round = rows[0];
    if (startNow) await emitRound(req.app.get('io'), req.classId, round);
    else          emitPrepared(req.app.get('io'), req.classId, round.scheduled_for);
    return res.status(201).json(round);
  } catch (err) {
    if (err.code === '23505') { // partial unique index: one open round per class
      return res.status(409).json({ error: 'A check is already running. End it before starting another.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── End a round (professor) ───────────────────────────────────────────────────
router.patch('/understand/rounds/:roundId/end', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { roundId } = req.params;
  if (!/^\d+$/.test(roundId)) return res.status(404).json({ error: 'Round not found.' });
  try {
    const { rows } = await pool.query(
      `UPDATE understand_rounds SET ended_at = NOW()
       WHERE  id = $1 AND class_id = $2 AND started_at IS NOT NULL AND ended_at IS NULL
       RETURNING ${ROUND_COLS}`,
      [roundId, req.classId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No open round with that id.' });
    const round = rows[0];
    await emitRound(req.app.get('io'), req.classId, round);
    return res.json(await roundSnapshot(round, req.classId, true));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Start a prepared round (professor) ───────────────────────────────────────
router.post('/understand/rounds/:roundId/start', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { roundId } = req.params;
  if (!NUMERIC.test(roundId)) return res.status(404).json({ error: 'Round not found.' });
  try {
    const { rows: [existing] } = await pool.query(
      `SELECT ${ROUND_COLS} FROM understand_rounds WHERE id = $1 AND class_id = $2`, [roundId, req.classId]
    );
    if (!existing) return res.status(404).json({ error: 'Round not found.' });
    if (existing.started_at) return res.status(409).json({ error: 'This check has already started.' });
    if (await dayStatus(existing.scheduled_for) !== 'today') {
      return res.status(409).json({ error: `This check is planned for ${longDay(existing.scheduled_for)}. You can start it on that day.` });
    }
    const { rows } = await pool.query(
      `UPDATE understand_rounds SET started_at = NOW()
       WHERE  id = $1 AND class_id = $2 AND started_at IS NULL AND scheduled_for = CURRENT_DATE
       RETURNING ${ROUND_COLS}`,
      [roundId, req.classId]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'This check has already started.' });
    await emitRound(req.app.get('io'), req.classId, rows[0]);
    emitPrepared(req.app.get('io'), req.classId, rows[0].scheduled_for);
    return res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') { // one running round per class
      return res.status(409).json({ error: 'A check is already running. End it before starting another.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Delete a prepared round (professor) ──────────────────────────────────────
router.delete('/understand/rounds/:roundId', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  const { roundId } = req.params;
  if (!NUMERIC.test(roundId)) return res.status(404).json({ error: 'Round not found.' });
  try {
    const { rows } = await pool.query(
      `DELETE FROM understand_rounds WHERE id = $1 AND class_id = $2 AND started_at IS NULL RETURNING scheduled_for`,
      [roundId, req.classId]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: "Only prepared checks that haven't started can be deleted." });
    }
    emitPrepared(req.app.get('io'), req.classId, rows[0].scheduled_for);
    return res.json({ deleted: Number(roundId) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Rounds for a day ──────────────────────────────────────────────────────────
// Professors: everything planned for that day, prepared rounds included.
// Students: only rounds that ran and ended, and never a day after today.
router.get('/understand/rounds', requireAuth, requireClassMember, async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : null;
  if (date !== null && !ISO_DATE.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD.' });
  }
  const isProfessor = req.user.role === 'professor';
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.label, r.scheduled_for, r.started_at, r.ended_at,
              COUNT(c.id)::int                                            AS responded,
              COUNT(c.id) FILTER (WHERE c.response = 'thumbs_up')::int    AS thumbs_up,
              COUNT(c.id) FILTER (WHERE c.response = 'hand')::int         AS hand,
              COUNT(c.id) FILTER (WHERE c.response = 'thumbs_down')::int  AS thumbs_down
       FROM   understand_rounds r
       LEFT JOIN understand_checks c ON c.round_id = r.id
       WHERE  r.class_id = $1
         AND  r.scheduled_for = COALESCE($2::date, CURRENT_DATE)
         AND  ($3 OR (r.started_at IS NOT NULL AND r.ended_at IS NOT NULL
                      AND r.scheduled_for <= CURRENT_DATE))
       GROUP  BY r.id
       ORDER  BY r.started_at ASC NULLS LAST, r.id ASC`,
      [req.classId, date, isProfessor]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Every round, all dates (professor Results page) ─────────────────────────
router.get('/understand/history', requireAuth, requireProfessor, requireClassMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.label, r.started_at, r.ended_at,
              COUNT(c.id)::int                                            AS responded,
              COUNT(c.id) FILTER (WHERE c.response = 'thumbs_up')::int    AS thumbs_up,
              COUNT(c.id) FILTER (WHERE c.response = 'hand')::int         AS hand,
              COUNT(c.id) FILTER (WHERE c.response = 'thumbs_down')::int  AS thumbs_down,
              COALESCE(json_agg(json_build_object('user_id', u.id, 'name', u.name, 'response', c.response)
                                ORDER BY u.name) FILTER (WHERE c.id IS NOT NULL), '[]'::json) AS responses
       FROM   understand_rounds r
       LEFT JOIN understand_checks c ON c.round_id = r.id
       LEFT JOIN users u             ON u.id = c.user_id
       WHERE  r.class_id = $1 AND r.started_at IS NOT NULL
       GROUP  BY r.id
       ORDER  BY r.started_at DESC`,
      [req.classId]
    );
    return res.json({ rounds: rows, total_students: await countStudents(req.classId) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Vote in the open round (member) ───────────────────────────────────────────
router.post('/understand', requireAuth, requireClassMember, async (req, res) => {
  const { response } = req.body;
  if (!VALID_RESPONSES.includes(response)) {
    return res.status(400).json({ error: `response must be one of: ${VALID_RESPONSES.join(', ')}` });
  }
  try {
    const round = await getOpenRound(req.classId);
    if (!round) return res.status(409).json({ error: 'No check is running right now.' });

    await pool.query(
      `INSERT INTO understand_checks (round_id, class_id, user_id, response)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (round_id, user_id)
       DO UPDATE SET response = EXCLUDED.response, checked_at = NOW()`,
      [round.id, req.classId, req.user.id, response]
    );

    const { tally, responded } = await getTally(round.id);
    const total_students = await countStudents(req.classId);
    req.app.get('io').to(`class:${req.classId}:professor`)
      .emit('understand:update', { round_id: round.id, tally, responded, total_students });

    return res.status(201).json({ round_id: round.id, response });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Current state (member) ────────────────────────────────────────────────────
router.get('/understand', requireAuth, requireClassMember, async (req, res) => {
  try {
    // Open round if any, else the most recent round started TODAY (so results
    // stay visible for the rest of the session but never bleed into another day).
    const { rows } = await pool.query(
      `SELECT ${ROUND_COLS}
       FROM   understand_rounds
       WHERE  class_id = $1 AND started_at IS NOT NULL
         AND  (ended_at IS NULL OR scheduled_for = CURRENT_DATE)
       ORDER  BY (ended_at IS NULL) DESC, started_at DESC
       LIMIT  1`,
      [req.classId]
    );
    const round = rows[0] ?? null;
    const snapshot = await roundSnapshot(round, req.classId, req.user.role === 'professor');

    let my_response = null;
    if (round) {
      const { rows: mine } = await pool.query(
        `SELECT response FROM understand_checks WHERE round_id = $1 AND user_id = $2`,
        [round.id, req.user.id]
      );
      my_response = mine[0]?.response ?? null;
    }
    return res.json({ ...snapshot, my_response });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Talent leaderboard ────────────────────────────────────────────────────────
router.get('/talents', requireAuth, requireClassMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.talents
       FROM   users u
       JOIN   class_members cm ON cm.user_id = u.id
       WHERE  cm.class_id = $1
       ORDER  BY u.talents DESC`,
      [req.classId]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
