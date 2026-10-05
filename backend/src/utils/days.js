// src/utils/days.js
// "Today" comes from the database, whose connections use the class timezone
// (APP_TIMEZONE, see db/pool.js), so it matches the classroom's calendar.
import pool from '../db/pool.js';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// 'past' | 'today' | 'future' for a YYYY-MM-DD date (null means today).
export async function dayStatus(date) {
  const { rows: [{ status }] } = await pool.query(
    `SELECT CASE WHEN COALESCE($1::date, CURRENT_DATE) < CURRENT_DATE THEN 'past'
                 WHEN COALESCE($1::date, CURRENT_DATE) > CURRENT_DATE THEN 'future'
                 ELSE 'today' END AS status`,
    [date]
  );
  return status;
}

// Long form for messages, e.g. "Friday, October 10".
export function longDay(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}
