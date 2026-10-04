// One-time fix: ADV 375 section 02 was first seeded with section 01's list by
// mistake. This takes those section-01 students off section 02 (they stay in
// section 01, and their accounts are untouched) and enrols the real 02 list.
// Other students in 02 (e.g. a demo student) are left alone. Safe to re-run.
//
// Usage (from backend/):  node scripts/fix-adv375-02-roster.js <professor-email>
import 'dotenv/config';
import pool from '../src/db/pool.js';
import { enrollNames } from '../src/services/roster.js';
import { parseRosterName } from '../src/utils/names.js';
import { ADV_375_01, ADV_375_02 } from './rosters.js';

const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error('Usage: node scripts/fix-adv375-02-roster.js <professor-email>');
  process.exit(1);
}

const client = await pool.connect();
try {
  const { rows: [cls] } = await client.query(
    `SELECT c.id, c.professor_id FROM classes c JOIN users p ON p.id = c.professor_id
     WHERE p.email = $1 AND c.title = 'ADV 375' AND c.section = '02'`,
    [email]
  );
  if (!cls) throw new Error(`No ADV 375 section 02 class owned by ${email}.`);

  const keep  = new Set(ADV_375_02.map((n) => parseRosterName(n).name.toLowerCase()));
  const wrong = ADV_375_01.map((n) => parseRosterName(n).name.toLowerCase()).filter((n) => !keep.has(n));

  await client.query('BEGIN');
  const { rows: removed } = await client.query(
    `DELETE FROM class_members cm
     USING  users u
     WHERE  cm.user_id = u.id AND cm.class_id = $1
       AND  u.role = 'student' AND lower(u.name) = ANY($2)
     RETURNING u.name`,
    [cls.id, wrong]
  );
  const { added, already_enrolled } = await enrollNames(client, {
    professorId: cls.professor_id, classId: cls.id, rawNames: ADV_375_02,
  });
  await client.query('COMMIT');

  const { rows: [{ n }] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM class_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.class_id = $1 AND u.role = 'student'`, [cls.id]
  );
  console.log(`ADV 375-02 (class ${cls.id}): removed ${removed.length} section-01 students, ` +
              `added ${added.length}, already enrolled ${already_enrolled.length}; now ${n} students.`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
