// Runs once before the tests: rebuild the test database from scratch with the
// real migration runner, then add a small, known set of people and content.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { BACKEND_DIR, STATE_FILE, APP_TIMEZONE, testDatabaseUrl, adminDatabaseUrl } from './test-db.js';
import { PROFESSOR, STUDENTS, CLASS, POST, BOB_COMMENT } from './tests/people.js';

// Use the backend's own copies of pg and bcrypt.
const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
const pg = require('pg');
const bcrypt = require('bcrypt');

function localDateKey(d = new Date()) {
  return d.toLocaleDateString('en-CA');   // what the site treats as "today"
}

export default async function globalSetup() {
  const url  = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);

  const admin = new pg.Client({ connectionString: adminDatabaseUrl(url) });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  // Like production (Supabase): the database itself runs in UTC. The app must
  // still use the class's timezone (APP_TIMEZONE) for "today".
  await admin.query(`ALTER DATABASE "${name}" SET timezone TO 'UTC'`);
  await admin.end();

  const migrate = spawnSync(process.execPath, ['scripts/migrate.js'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: '', APP_TIMEZONE: APP_TIMEZONE },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) throw new Error(`Migration failed:\n${migrate.stdout}\n${migrate.stderr}`);

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const hash = (pw) => (pw ? bcrypt.hash(pw, 4) : null);

    const { rows: [prof] } = await db.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, 'professor') RETURNING id`,
      [PROFESSOR.email, await hash(PROFESSOR.password), PROFESSOR.name]
    );
    const { rows: [cls] } = await db.query(
      `INSERT INTO classes (title, section, join_code, professor_id) VALUES ($1, $2, 'E2E001', $3) RETURNING id`,
      [CLASS.title, CLASS.section, prof.id]
    );
    await db.query(`INSERT INTO class_members (user_id, class_id) VALUES ($1, $2)`, [prof.id, cls.id]);

    const ids = {};
    for (const [key, s] of Object.entries(STUDENTS)) {
      const { rows: [u] } = await db.query(
        `INSERT INTO users (name, sort_name, role, password) VALUES ($1, $2, 'student', $3) RETURNING id`,
        [s.name, s.label, await hash(s.password)]
      );
      await db.query(`INSERT INTO class_members (user_id, class_id) VALUES ($1, $2)`, [u.id, cls.id]);
      ids[key] = u.id;
    }

    const { rows: [post] } = await db.query(
      `INSERT INTO posts (class_id, author_id, title, content, post_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cls.id, prof.id, POST.title, POST.content, localDateKey()]
    );
    await db.query(
      `INSERT INTO comments (post_id, author_id, content) VALUES ($1, $2, $3)`,
      [post.id, ids.bob, BOB_COMMENT]
    );

    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ classId: cls.id, postId: post.id, professorId: prof.id, studentIds: ids }, null, 2));
  } finally {
    await db.end();
  }
}
