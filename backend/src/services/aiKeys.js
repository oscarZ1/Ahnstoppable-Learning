// src/services/aiKeys.js
// Students' own Google Gemini API keys, stored encrypted (AES-256-GCM) with the
// server secret AI_KEY_ENCRYPTION_SECRET (32 bytes, base64; generate one with
// `openssl rand -base64 32`). Without the secret the feature is off.
//
// A key is decrypted only on the server, right before a call to its provider.
// It is never sent back to the browser or written to the logs: the browser
// only ever learns the last four characters.
import crypto from 'node:crypto';
import pool from '../db/pool.js';

function secret() {
  const raw = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function keysConfigured() {
  return secret() !== null;
}

// Fail loudly at boot on a secret that is set but unusable, rather than
// quietly turning the feature off.
if (process.env.AI_KEY_ENCRYPTION_SECRET && !keysConfigured()) {
  throw new Error('AI_KEY_ENCRYPTION_SECRET must be 32 bytes, base64-encoded (openssl rand -base64 32).');
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decrypt({ key_ciphertext, key_iv, key_tag }) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', secret(), key_iv);
  decipher.setAuthTag(key_tag);
  return Buffer.concat([decipher.update(key_ciphertext), decipher.final()]).toString('utf8');
}

// What the browser may see about a saved key.
const DESCRIBE = 'key_last4 AS last4, verified_at';

export async function describeKey(userId) {
  if (!keysConfigured()) return null;
  const { rows } = await pool.query(`SELECT ${DESCRIBE} FROM student_ai_keys WHERE user_id = $1`, [userId]);
  return rows[0] ?? null;
}

// { apiKey } for the caller's own calls, or null.
export async function loadKey(userId) {
  if (!keysConfigured()) return null;
  const { rows } = await pool.query(
    `SELECT key_ciphertext, key_iv, key_tag FROM student_ai_keys WHERE user_id = $1`,
    [userId]
  );
  if (!rows[0]) return null;
  try {
    return { apiKey: decrypt(rows[0]) };
  } catch {
    // Encrypted with a different secret (it was rotated): treat as no key.
    console.warn(`AI keys: could not decrypt the key of user ${userId}; it needs to be added again.`);
    return null;
  }
}

export async function saveKey(userId, apiKey) {
  const { ciphertext, iv, tag } = encrypt(apiKey);
  const { rows } = await pool.query(
    `INSERT INTO student_ai_keys (user_id, key_ciphertext, key_iv, key_tag, key_last4)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
       SET key_ciphertext = EXCLUDED.key_ciphertext, key_iv = EXCLUDED.key_iv, key_tag = EXCLUDED.key_tag,
           key_last4 = EXCLUDED.key_last4, verified_at = NOW(), updated_at = NOW()
     RETURNING ${DESCRIBE}`,
    [userId, ciphertext, iv, tag, apiKey.slice(-4)]
  );
  return rows[0];
}

export async function deleteKey(userId) {
  const { rowCount } = await pool.query(`DELETE FROM student_ai_keys WHERE user_id = $1`, [userId]);
  return rowCount > 0;
}
