// src/routes/classes.js
// GET    /api/classes              – list all classes the current user belongs to
// POST   /api/classes              – professor: create a class (auto-generates join code)
// POST   /api/classes/join         – student: join a class by code
// GET    /api/classes/:id          – get a single class (must be a member)
// DELETE /api/classes/:id/leave    – student leaves a class
//
// join_code is only ever returned to the class's own professor.

import express from 'express';
import crypto from 'node:crypto';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember } from '../middleware/auth.js';

const router = express.Router();

// ── List my classes ───────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.section, c.start_time, c.end_time, c.professor_id,
              CASE WHEN c.professor_id = $1 THEN c.join_code END AS join_code,
              u.name AS professor_name,
              (SELECT COUNT(*)::int
               FROM   class_members m JOIN users s ON s.id = m.user_id
               WHERE  m.class_id = c.id AND s.role = 'student') AS student_count
       FROM   classes c
       JOIN   class_members cm ON cm.class_id = c.id
       JOIN   users u          ON u.id = c.professor_id
       WHERE  cm.user_id = $1
       ORDER  BY c.title, c.section NULLS FIRST`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Create a class (professor only) ──────────────────────────────────────────
router.post('/', requireAuth, requireProfessor, async (req, res) => {
  const { title, section, start_time, end_time } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });

  const join_code = crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9C2"

  // Class row + professor membership in one transaction, so a failure on the
  // second insert can't leave a class its own professor is locked out of.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO classes (title, section, start_time, end_time, join_code, professor_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, section ?? null, start_time ?? null, end_time ?? null, join_code, req.user.id]
    );
    const cls = rows[0];
    await client.query(
      `INSERT INTO class_members (user_id, class_id) VALUES ($1, $2)`,
      [req.user.id, cls.id]
    );
    await client.query('COMMIT');
    return res.status(201).json(cls);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    client.release();
  }
});

// ── Join a class by code ──────────────────────────────────────────────────────
router.post('/join', requireAuth, async (req, res) => {
  const { join_code } = req.body;
  if (!join_code) return res.status(400).json({ error: 'join_code is required.' });

  try {
    const { rows: cls } = await pool.query(
      `SELECT c.id, c.title, c.section, c.start_time, c.end_time, c.professor_id,
              u.name AS professor_name
       FROM   classes c
       JOIN   users u ON u.id = c.professor_id
       WHERE  c.join_code = $1`,
      [String(join_code).toUpperCase()]
    );
    if (cls.length === 0) {
      return res.status(404).json({ error: 'No class found with that code.' });
    }

    await pool.query(
      `INSERT INTO class_members (user_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, cls[0].id]
    );

    return res.json(cls[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Get a single class ────────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireClassMember, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.name AS professor_name
       FROM   classes c
       JOIN   users u ON u.id = c.professor_id
       WHERE  c.id = $1`,
      [req.classId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Class not found.' });

    const cls = rows[0];
    if (cls.professor_id !== req.user.id) delete cls.join_code;
    return res.json(cls);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Leave a class ─────────────────────────────────────────────────────────────
router.delete('/:id/leave', requireAuth, async (req, res) => {
  const classId = req.params.id;
  if (!/^\d+$/.test(classId)) return res.status(404).json({ error: 'Class not found.' });

  try {
    const { rows } = await pool.query(`SELECT professor_id FROM classes WHERE id = $1`, [classId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Class not found.' });
    if (rows[0].professor_id === req.user.id) {
      return res.status(403).json({ error: 'Professors cannot leave their own class.' });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM class_members WHERE user_id = $1 AND class_id = $2`,
      [req.user.id, classId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'You are not enrolled in this class.' });

    return res.json({ message: 'Left class successfully.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

export default router;
