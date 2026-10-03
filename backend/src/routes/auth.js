// src/routes/auth.js
// Professors (email + password):
//   POST /api/auth/register               – create a professor account (needs signup code)
//   POST /api/auth/login                  – exchange email + password for a JWT
// Students (added by name to a class roster by their professor):
//   GET  /api/auth/classes                – classes for the sign-in dropdown
//   GET  /api/auth/classes/:id/students   – that class's roster names
//   POST /api/auth/student-login          – class + name + password → JWT
//   POST /api/auth/student-setup          – first sign-in: create the password → JWT

import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import { accountLimiter, ipLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

const SALT_ROUNDS  = 12;
const MIN_PASSWORD = 6;
const NUMERIC      = /^\d+$/;

// ── Register ──────────────────────────────────────────────────────────────────
router.post('/register', ipLimiter, accountLimiter, async (req, res) => {
  const { email, password, name, role = 'professor', professor_code } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required.' });
  }
  // Students no longer self-register; their professor adds them to a roster.
  if (role !== 'professor') {
    return res.status(400).json({ error: 'Students are added to a class by their professor.' });
  }
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  // Professor accounts require the invite code from PROFESSOR_SIGNUP_CODE.
  // If the env var is unset, professor signup is disabled entirely.
  const expected = process.env.PROFESSOR_SIGNUP_CODE;
  if (!expected || professor_code !== expected) {
    return res.status(403).json({ error: 'Invalid professor signup code.' });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role`,
      [email.toLowerCase(), hash, name, role]
    );
    const user  = rows[0];
    const token = signToken(user);
    return res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', ipLimiter, accountLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, password AS hash FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = rows[0];
    const match = user.hash ? await bcrypt.compare(password, user.hash) : false;
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const { hash: _removed, ...safeUser } = user;
    const token = signToken(safeUser);
    return res.json({ user: safeUser, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Student sign-in: classes for the dropdown ────────────────────────────────
router.get('/classes', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.section, u.name AS professor_name
       FROM   classes c JOIN users u ON u.id = c.professor_id
       ORDER  BY c.title, c.section NULLS FIRST, c.id`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Student sign-in: names in one class ──────────────────────────────────────
router.get('/classes/:classId/students', async (req, res) => {
  const { classId } = req.params;
  if (!NUMERIC.test(classId)) return res.status(404).json({ error: 'Class not found.' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id, COALESCE(u.sort_name, u.name) AS label, (u.password IS NOT NULL) AS has_password
       FROM   class_members cm JOIN users u ON u.id = cm.user_id
       WHERE  cm.class_id = $1 AND u.role = 'student'
       ORDER  BY lower(COALESCE(u.sort_name, u.name))`,
      [classId]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// A student enrolled in the given class, with their password hash, or null.
async function findRosterStudent(classId, userId) {
  if (!NUMERIC.test(String(classId)) || !NUMERIC.test(String(userId))) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.password AS hash
     FROM   users u
     JOIN   class_members cm ON cm.user_id = u.id AND cm.class_id = $2
     WHERE  u.id = $1 AND u.role = 'student'`,
    [userId, classId]
  );
  return rows[0] ?? null;
}

// ── Student sign-in: name + password ─────────────────────────────────────────
router.post('/student-login', ipLimiter, accountLimiter, async (req, res) => {
  const { class_id, user_id, password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required.' });
  try {
    const student = await findRosterStudent(class_id, user_id);
    if (!student) return res.status(401).json({ error: 'Invalid credentials.' });
    if (!student.hash) {
      return res.status(409).json({ error: 'Create a password to finish setting up your account.', needs_password: true });
    }
    if (!(await bcrypt.compare(String(password), student.hash))) {
      return res.status(401).json({ error: 'Wrong password. Ask your professor to reset it if you forgot it.' });
    }
    const { hash: _removed, ...safeUser } = student;
    return res.json({ user: safeUser, token: signToken(safeUser) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Student sign-in: first time, create a password ───────────────────────────
router.post('/student-setup', ipLimiter, accountLimiter, async (req, res) => {
  const { class_id, user_id, password } = req.body;
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  try {
    const student = await findRosterStudent(class_id, user_id);
    if (!student) return res.status(401).json({ error: 'Invalid credentials.' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    // Only fills an empty password, so this can't overwrite an existing one.
    const { rows } = await pool.query(
      `UPDATE users SET password = $2
       WHERE  id = $1 AND password IS NULL
       RETURNING id, email, name, role`,
      [student.id, hash]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'This account already has a password. Sign in with it instead.' });
    }
    const user = rows[0];
    return res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export default router;
