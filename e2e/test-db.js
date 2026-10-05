// Where the browser tests keep their data: a throwaway local database that is
// dropped and rebuilt on every run. Derived from backend/.env's DATABASE_URL
// with the database name swapped, or set explicitly with E2E_DATABASE_URL.
// Refuses anything that isn't a localhost database whose name ends in "_test",
// so a misconfigured .env can never point the tests at real data.
import fs from 'node:fs';
import path from 'node:path';

export const E2E_DIR     = path.dirname(new URL(import.meta.url).pathname);
export const BACKEND_DIR = path.resolve(E2E_DIR, '../backend');
export const CLIENT_DIR  = path.resolve(E2E_DIR, '../client');
export const STATE_FILE  = path.join(E2E_DIR, '.state', 'fixtures.json');

export const API_PORT = 4310;
export const WEB_PORT = 5310;

function readBackendEnv() {
  const file = path.join(BACKEND_DIR, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function testDatabaseUrl() {
  let raw = process.env.E2E_DATABASE_URL;
  if (!raw) {
    const base = readBackendEnv().DATABASE_URL;
    if (!base) throw new Error('Set E2E_DATABASE_URL, or DATABASE_URL in backend/.env, to a local Postgres.');
    const u = new URL(base);
    u.pathname = '/ahnstoppable_test';
    u.search = '';
    raw = u.toString();
  }
  const u = new URL(raw);
  const name = u.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) || !name.endsWith('_test')) {
    throw new Error(`Refusing to use ${u.hostname}/${name} for tests: it must be a localhost database whose name ends in "_test".`);
  }
  return raw;
}

// Connection used only to drop/create the test database.
export function adminDatabaseUrl(testUrl) {
  const u = new URL(testUrl);
  u.pathname = '/postgres';
  return u.toString();
}
