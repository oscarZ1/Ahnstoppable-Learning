// Apply each file in supabase/migrations exactly once, in name order.
// Usage (from backend/):  node scripts/migrate.js   (or: npm run migrate)
// Applied filenames are recorded in public.schema_migrations, so re-running is
// a no-op.
//
// For LOCAL development and the e2e tests only. Production (Supabase) is
// migrated by GitHub Actions (.github/workflows/supabase-migrations.yml), which
// runs `supabase db push` on every push to main. See supabase/README.md.
//
// An empty database is built by the first migration (the baseline), so there
// is no separate schema file.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pool from '../src/db/pool.js';

const dir = path.resolve(import.meta.dirname, '../../supabase/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);
const { rows } = await pool.query('SELECT name FROM schema_migrations');
const applied = new Set(rows.map((r) => r.name));

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  process.stdout.write(`applying ${file} … `);
  // The file and its bookkeeping row commit together, like `supabase db push`.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.log('failed');
    throw err;
  } finally {
    // A migration may change session settings (the baseline sets the time
    // zone), so don't hand this connection back to the pool.
    client.release(true);
  }
  console.log('ok');
  ran++;
}
console.log(ran ? `${ran} migration(s) applied` : 'nothing to apply');
await pool.end();
