// Create the real classes and enrol their students by name.
// Usage (from backend/):  node scripts/seed-rosters.js [professor-email]
// Safe to re-run: classes are found by (professor, title, section) and students
// already on a roster are left alone.
import 'dotenv/config';
import crypto from 'node:crypto';
import pool from '../src/db/pool.js';
import { enrollNames } from '../src/services/roster.js';
import { CLASSES } from './rosters.js';   // the real class lists

const PROFESSOR_EMAIL = (process.argv[2] ?? 'ahn@demo.edu').toLowerCase();

const { rows: profs } = await pool.query(
  `SELECT id, name FROM users WHERE email = $1 AND role = 'professor'`, [PROFESSOR_EMAIL]
);
if (!profs.length) {
  console.error(`No professor account with email ${PROFESSOR_EMAIL}.`);
  process.exit(1);
}
const prof = profs[0];
console.log(`Professor: ${prof.name} (${PROFESSOR_EMAIL})`);

const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const cls of CLASSES) {
    const label = cls.section ? `${cls.title}-${cls.section}` : cls.title;
    let { rows } = await client.query(
      `SELECT id FROM classes WHERE professor_id = $1 AND title = $2 AND section IS NOT DISTINCT FROM $3`,
      [prof.id, cls.title, cls.section]
    );
    let classId = rows[0]?.id;
    if (!classId) {
      ({ rows } = await client.query(
        `INSERT INTO classes (title, section, join_code, professor_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [cls.title, cls.section, crypto.randomBytes(3).toString('hex').toUpperCase(), prof.id]
      ));
      classId = rows[0].id;
      await client.query(`INSERT INTO class_members (user_id, class_id) VALUES ($1, $2)`, [prof.id, classId]);
      console.log(`${label}: created class ${classId}`);
    }
    const { added, already_enrolled } = await enrollNames(client, {
      professorId: prof.id, classId, rawNames: cls.students,
    });
    console.log(`${label}: ${added.length} added, ${already_enrolled.length} already enrolled`);
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
