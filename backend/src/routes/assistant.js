// src/routes/assistant.js
// The assistant's course help in one class: a private AI chat per user per
// class, answered with the class's own material (services/studyAssistant.js).
// Off for students until the class's professor turns it on; the class's
// professor can always use it.
// General help (not tied to a class) and students' own Gemini keys live in
// routes/me.js.
//   GET    /api/classes/:classId/assistant           – member: { enabled, available, configured, retention_days, messages, own_key } (own thread)
//                                                      available: enabled, or the requester owns the class
//   POST   /api/classes/:classId/assistant/messages  – member: send { content }; returns { messages: [user, model] }
//   DELETE /api/classes/:classId/assistant/messages  – member: clear their own thread
//   GET / PUT /api/classes/:classId/assistant/settings – class owner: { enabled, instructions, course_notes }
//   GET / POST /api/classes/:classId/assistant/summary?date= – class owner: anonymous AI summary of
//                                                      what students asked the assistant that day
//
// A student's thread is visible only to them. The professor only ever gets the
// anonymous summary: students' messages as text, no names; the professor's own
// test messages are left out.
import express from 'express';
import pool from '../db/pool.js';
import { requireAuth, requireProfessor, requireClassMember, requireClassOwner } from '../middleware/auth.js';
import { assistantLimits, summaryLimit } from '../middleware/rateLimit.js';
import { chat, loadSettings, MAX_INSTRUCTIONS, MAX_COURSE_NOTES } from '../services/studyAssistant.js';
import { aiConfigured, AiError } from '../services/gemini.js';
import { RETENTION_DAYS } from '../services/retention.js';
import { savedSummaries } from '../services/savedSummaries.js';
import { thread, clearThread, readMessage, sharedMessagesToday, saveExchange, sendAiError } from '../services/assistantThreads.js';
import { describeKey, loadKey } from '../services/aiKeys.js';
import { createHash } from 'node:crypto';

const router = express.Router({ mergeParams: true });

const n = Number(process.env.ASSISTANT_DAILY_CLASS_LIMIT);
const DAILY_CLASS_LIMIT = Number.isInteger(n) && n > 0 ? n : 300;

router.get('/', requireAuth, requireClassMember, async (req, res) => {
  const [settings, ownKey, messages] = await Promise.all([
    loadSettings(req.classId), describeKey(req.user.id), thread(req.classId, req.user.id),
  ]);
  return res.json({
    enabled: settings.enabled,
    available: settings.enabled || req.isClassOwner,
    configured: aiConfigured() || Boolean(ownKey),
    retention_days: RETENTION_DAYS,
    own_key: ownKey,
    messages,
  });
});

router.post('/messages', requireAuth, requireClassMember, ...assistantLimits, async (req, res) => {
  const settings = await loadSettings(req.classId);
  if (!settings.enabled && !req.isClassOwner) {
    return res.status(403).json({ error: 'The study assistant is turned off for this class.' });
  }
  const { content, error } = readMessage(req.body);
  if (error) return res.status(400).json({ error });

  // A student's own key uses their own quota. The shared Gemini quota is one
  // for everyone, so a class-wide daily cap keeps one class from using it all up.
  const byo = await loadKey(req.user.id);
  if (!byo && await sharedMessagesToday(req.classId) >= DAILY_CLASS_LIMIT) {
    return res.status(429).json({ error: "The class has used today's study-assistant limit. It resets tomorrow." });
  }

  const sentAt = new Date();
  let reply;
  try {
    const history = await thread(req.classId, req.user.id);
    reply = await chat({ classId: req.classId, userId: req.user.id, role: req.user.role, history, text: content, settings, byo });
  } catch (err) {
    if (err instanceof AiError) return sendAiError(res, err);
    throw err;
  }
  const messages = await saveExchange({ classId: req.classId, userId: req.user.id, content, reply, sentAt });
  return res.status(201).json({ messages });
});

router.delete('/messages', requireAuth, requireClassMember, async (req, res) => {
  return res.json({ deleted: await clearThread(req.classId, req.user.id) });
});

// ── Settings (the class's professor) ────────────────────────────────────────
router.get('/settings', requireAuth, requireClassMember, requireClassOwner, async (req, res) => {
  const { enabled, instructions, course_notes, updated_at } = await loadSettings(req.classId);
  return res.json({
    enabled, instructions, course_notes, updated_at,
    max_instructions: MAX_INSTRUCTIONS, max_course_notes: MAX_COURSE_NOTES,
  });
});

router.put('/settings', requireAuth, requireClassMember, requireClassOwner, async (req, res) => {
  const current = await loadSettings(req.classId);
  const { enabled = current.enabled, instructions = current.instructions, course_notes = current.course_notes } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be true or false.' });
  if (typeof instructions !== 'string' || typeof course_notes !== 'string') {
    return res.status(400).json({ error: 'instructions and course_notes must be text.' });
  }
  if (instructions.length > MAX_INSTRUCTIONS) {
    return res.status(400).json({ error: `Instructions can be up to ${MAX_INSTRUCTIONS.toLocaleString('en-US')} characters.` });
  }
  if (course_notes.length > MAX_COURSE_NOTES) {
    return res.status(400).json({ error: `Course notes can be up to ${MAX_COURSE_NOTES.toLocaleString('en-US')} characters.` });
  }
  const { rows: [saved] } = await pool.query(
    `INSERT INTO class_ai_settings (class_id, enabled, instructions, course_notes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (class_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, instructions = EXCLUDED.instructions,
           course_notes = EXCLUDED.course_notes, updated_at = NOW()
     RETURNING enabled, instructions, course_notes, updated_at`,
    [req.classId, enabled, instructions.trim(), course_notes.trim()]
  );
  return res.json(saved);
});

// ── Anonymous summary for the professor ─────────────────────────────────────
// A day's messages from students (not the professor's own tests), text only.
async function dayMessages(classId, date) {
  const { rows } = await pool.query(
    `SELECT m.id, m.content
     FROM   assistant_messages m
     JOIN   users u ON u.id = m.user_id
     WHERE  m.class_id = $1 AND m.role = 'user' AND u.role = 'student'
       AND  m.created_at >= COALESCE($2::date, CURRENT_DATE)
       AND  m.created_at <  COALESCE($2::date, CURRENT_DATE) + 1
     ORDER  BY m.created_at ASC, m.id ASC`,
    [classId, date]
  );
  return rows;
}

// Chats are private, so unlike the Questions summary the saved summary keeps
// no copy of the students' words: only a fingerprint to tell whether the day's
// messages changed since.
const fingerprint = (messages) =>
  createHash('sha256').update(JSON.stringify(messages.map((m) => [m.id, m.content]))).digest('hex');

const summaries = savedSummaries({
  table: 'assistant_summaries',
  source: 'assistant',
  dayItems: dayMessages,
  snapshot: (messages) => ({ fingerprint: fingerprint(messages) }),
  sameItems: (summary, messages) => summary?.fingerprint === fingerprint(messages),
});

router.get('/summary', requireAuth, requireProfessor, requireClassMember, requireClassOwner, summaries.get);
router.post('/summary', requireAuth, requireProfessor, requireClassMember, requireClassOwner, summaryLimit, summaries.post);

export default router;
