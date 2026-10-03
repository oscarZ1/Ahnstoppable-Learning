// src/middleware/rateLimit.js
// Brute-force protection for the sign-in endpoints.
//
// A whole class usually signs in from one school network, so everyone shares a
// single public IP address. Limiting mainly by IP would lock the class out at
// the start of a lecture. Instead:
//   - accountLimiter counts FAILED attempts per account (student id or
//     professor email). Successful sign-ins don't count.
//   - ipLimiter is a generous ceiling per IP on all sign-in requests, to stop
//     one machine from cycling through many accounts.
// contentLimits() caps how fast one student can post questions, comments and
// replies, which also stops spam from farming talent points.
//
// Counters live in server memory, which is fine for a single backend instance
// and reset when the server restarts.

import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

function tooMany(message) {
  return (_req, res, _next, options) => res.status(options.statusCode).json({ error: message });
}

// Which account a sign-in request is aimed at.
function accountKey(req) {
  const { user_id, email } = req.body ?? {};
  if (user_id != null && user_id !== '') return `student:${String(user_id)}`;
  if (typeof email === 'string' && email.trim()) return `email:${email.trim().toLowerCase()}`;
  return `ip:${ipKeyGenerator(req.ip)}`;
}

export const accountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.LOGIN_FAILURES_PER_ACCOUNT ?? 8),
  skipSuccessfulRequests: true,
  keyGenerator: accountKey,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: tooMany('Too many wrong attempts for this account. Wait 15 minutes, or ask your professor to reset your password.'),
});

export const ipLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: Number(process.env.LOGIN_REQUESTS_PER_IP ?? 300),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: tooMany('Too many sign-in attempts from this network. Try again in a few minutes.'),
});

// Clear a student's failed-attempt count, e.g. when their professor resets
// their password, so they can sign in right away instead of waiting.
export async function clearStudentLockout(userId) {
  await accountLimiter.resetKey(`student:${String(userId)}`);
}

// ── Posting limits ────────────────────────────────────────────────────────────
// Two windows per student: a short one that stops bursts and an hourly one that
// stops a slow drip. Counted per signed-in user (never per IP, since a class
// shares one), so it must come after requireAuth. Professors are exempt.
// Every request counts, so deleting and re-posting doesn't reset anything.
export function contentLimits({ name, perMinute, perHour, what }) {
  const shared = {
    keyGenerator: (req) => `${name}:${req.user.id}`,
    skip: (req) => req.user?.role === 'professor',
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  };
  return [
    rateLimit({
      ...shared,
      windowMs: 60 * 1000,
      limit: perMinute,
      handler: tooMany(`You're posting ${what} too quickly. Wait a minute and try again.`),
    }),
    rateLimit({
      ...shared,
      windowMs: 60 * 60 * 1000,
      limit: perHour,
      handler: tooMany(`You've reached the limit of ${perHour} ${what} per hour. Try again later.`),
    }),
  ];
}

// Comments and replies share one budget: both are discussion posts.
export const questionLimits   = contentLimits({ name: 'questions',  perMinute: 3, perHour: 20, what: 'questions' });
export const discussionLimits = contentLimits({ name: 'discussion', perMinute: 6, perHour: 60, what: 'comments and replies' });
