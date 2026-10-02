// src/services/roster.js
// Enrol students in a class by name. Shared by the roster route and the
// seed script so both follow the same matching rules:
//   - A name matches an existing student (case-insensitive) only if that
//     student is already in another class owned by the same professor, so the
//     same person in two sections gets one account.
//   - Otherwise a new student account is created with no email or password.

import { parseRosterName } from '../utils/names.js';

// `db` is a pg client inside a transaction (or the pool). `rawNames` is an
// array of strings or one newline-separated string.
export async function enrollNames(db, { professorId, classId, rawNames }) {
  const list = Array.isArray(rawNames) ? rawNames : String(rawNames ?? '').split('\n');

  const seen = new Set();
  const parsed = [];
  for (const raw of list) {
    const p = parseRosterName(raw);
    if (!p || seen.has(p.name.toLowerCase())) continue;
    seen.add(p.name.toLowerCase());
    parsed.push(p);
  }

  const added = [];
  const already_enrolled = [];
  for (const { name, sort_name } of parsed) {
    const { rows: found } = await db.query(
      `SELECT u.id
       FROM   users u
       WHERE  u.role = 'student'
         AND  lower(u.name) = lower($1)
         AND  EXISTS (SELECT 1
                      FROM   class_members cm JOIN classes c ON c.id = cm.class_id
                      WHERE  cm.user_id = u.id AND c.professor_id = $2)
       ORDER  BY u.id
       LIMIT  1`,
      [name, professorId]
    );

    let userId;
    if (found.length) {
      userId = found[0].id;
      await db.query(`UPDATE users SET sort_name = COALESCE(sort_name, $2) WHERE id = $1`, [userId, sort_name]);
    } else {
      const { rows } = await db.query(
        `INSERT INTO users (name, sort_name, role) VALUES ($1, $2, 'student') RETURNING id`,
        [name, sort_name]
      );
      userId = rows[0].id;
    }

    const { rowCount } = await db.query(
      `INSERT INTO class_members (user_id, class_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, classId]
    );
    (rowCount ? added : already_enrolled).push({ id: userId, name, sort_name });
  }
  return { added, already_enrolled };
}
