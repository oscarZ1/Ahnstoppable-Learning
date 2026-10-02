// src/routes/roster.js
// Professor-managed class rosters. Students are added by name and sign in by
// picking that name, so the roster is how students get into the app.
//   GET    /api/classes/:classId/roster                         – students in the class
//   POST   /api/classes/:classId/roster          { names }      – add students by name
//   DELETE /api/classes/:classId/roster/:userId                 – remove from this class
//   POST   /api/classes/:classId/roster/:userId/reset-password  – clear the password
// All routes require the class's own professor.

import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';
import { enrollNames } from '../services/roster.js';

const router = express.Router({ mergeParams: true });
const NUMERIC = /^\d+$/;
const MAX_NAMES = 200;

async function requireClassOwner(req, res, next) {
  const { rows } = await pool.query(`SELECT professor_id FROM classes WHERE id = $1`, [req.classId]);
  if (rows[0]?.professor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only this class\'s professor can manage its roster.' });
  }
  next();
}

const guard = [requireAuth, requireProfessor, requireClassMember, requireClassOwner];

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', ...guard, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.sort_name, u.email, (u.password IS NOT NULL) AS has_password
       FROM   class_members cm JOIN users u ON u.id = cm.user_id
       WHERE  cm.class_id = $1 AND u.role = 'student'
       ORDER  BY lower(COALESCE(u.sort_name, u.name))`,
      [req.classId]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Add by name ───────────────────────────────────────────────────────────────
router.post('/', ...guard, async (req, res) => {
  const { names } = req.body;
  const list = Array.isArray(names) ? names : typeof names === 'string' ? names.split('\n') : null;
  if (!list || list.every((n) => !String(n ?? '').trim())) {
    return res.status(400).json({ error: 'Provide at least one name.' });
  }
  if (list.length > MAX_NAMES) {
    return res.status(400).json({ error: `Add at most ${MAX_NAMES} names at a time.` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await enrollNames(client, { professorId: req.user.id, classId: req.classId, rawNames: list });
    await client.query('COMMIT');
    return res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── Remove from this class ────────────────────────────────────────────────────
router.delete('/:userId', ...guard, async (req, res) => {
  const { userId } = req.params;
  if (!NUMERIC.test(userId)) return res.status(404).json({ error: 'Student not found.' });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM class_members cm
       USING  users u
       WHERE  cm.user_id = u.id AND u.role = 'student'
         AND  cm.user_id = $1 AND cm.class_id = $2`,
      [userId, req.classId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'That student is not in this class.' });
    return res.json({ removed: Number(userId) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Reset password ────────────────────────────────────────────────────────────
// The student creates a new password the next time they pick their name.
router.post('/:userId/reset-password', ...guard, async (req, res) => {
  const { userId } = req.params;
  if (!NUMERIC.test(userId)) return res.status(404).json({ error: 'Student not found.' });
  try {
    const { rowCount } = await pool.query(
      `UPDATE users u SET password = NULL
       FROM   class_members cm
       WHERE  cm.user_id = u.id AND cm.class_id = $2
         AND  u.id = $1 AND u.role = 'student'`,
      [userId, req.classId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'That student is not in this class.' });
    return res.json({ reset: Number(userId) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
