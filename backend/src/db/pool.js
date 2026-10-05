// src/db/pool.js
// Single pg Pool instance shared across the whole app.

import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.');
}

// Return DATE columns (OID 1082) as plain 'YYYY-MM-DD' strings. pg's default
// parses them into JS Dates at local midnight, which serialize to a shifted
// ISO timestamp and break equality checks against 'YYYY-MM-DD' on the client.
pg.types.setTypeParser(1082, (value) => value);

// Hosted Postgres (Supabase) requires TLS. Set DATABASE_SSL=true in production.
// With DATABASE_CA_CERT (the provider's CA certificate, PEM text) the server's
// certificate is fully verified; without it the connection is still encrypted
// but the certificate isn't checked. Don't also put sslmode= in DATABASE_URL:
// URL parameters override this setting.
function sslConfig() {
  if (process.env.DATABASE_SSL !== 'true') return undefined;
  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true } : { rejectUnauthorized: false };
}

// Days (what "today" is, which day a poll or check belongs to) follow the
// class's local time, not the database server's. Hosted Postgres runs in UTC,
// which filed anything after ~5 PM Pacific under the next day. Every
// connection is set to APP_TIMEZONE before it's used, so CURRENT_DATE and
// timestamptz::date match the classroom's calendar.
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Los_Angeles';
if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(APP_TIMEZONE)) {
  throw new Error(`APP_TIMEZONE "${APP_TIMEZONE}" is not a valid timezone name (e.g. America/Los_Angeles).`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  // Awaited by the pool before the connection runs any other query.
  onConnect: (client) => client.query(`SET TIME ZONE '${APP_TIMEZONE}'`),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

export default pool;
