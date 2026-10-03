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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

export default pool;
