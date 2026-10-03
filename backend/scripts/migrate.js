// Apply each file in backend/migrations exactly once, in name order.
// Usage (from backend/):  node scripts/migrate.js   (or: npm run migrate)
// Applied filenames are recorded in schema_migrations, so re-running is a no-op.
//
// A brand-new database (e.g. a new Supabase project) has none of the original
// tables the migrations build on, so it is set up from schema.sql instead.
// schema.sql already reflects every existing migration, so those are recorded
// as applied; only migrations added later run as usual.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool.js';

const dir = path.resolve(import.meta.dirname, '../migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
const { rows } = await pool.query('SELECT name FROM schema_migrations');
const applied = new Set(rows.map((r) => r.name));

const { rows: [{ fresh }] } = await pool.query(`SELECT to_regclass('public.users') IS NULL AS fresh`);
if (fresh && applied.size === 0) {
  process.stdout.write('empty database: creating tables from schema.sql … ');
  const schema = fs.readFileSync(path.resolve(import.meta.dirname, '../schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schema);
    for (const file of files) {
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied.add(file);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(`ok (${files.length} existing migration(s) marked as applied)`);
}

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  process.stdout.write(`applying ${file} … `);
  await pool.query(fs.readFileSync(path.join(dir, file), 'utf8'));
  await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  console.log('ok');
  ran++;
}
console.log(ran ? `${ran} migration(s) applied` : 'nothing to apply');
await pool.end();
