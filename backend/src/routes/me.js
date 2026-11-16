// src/routes/me.js
// The signed-in user's own things, not tied to a class.
//
// General help (the corner assistant when no class is picked, or when the
// class's course help is off): one private thread per user, stored with
// class_id NULL. See services/studyAssistant.js siteChat().
//   GET    /api/me/assistant           – { configured, retention_days, messages, own_key }
//   POST   /api/me/assistant/messages  – send { content }; returns { messages: [user, model] }
//   DELETE /api/me/assistant/messages  – clear the thread
//
// Own Google Gemini API key (services/aiKeys.js): used for both website and
// course help, with the same model (Gemini 3.5 Flash-Lite).
//   GET    /api/me/ai-key   – { available, model, key: { last4, verified_at } | null }
//   PUT    /api/me/ai-key   – { api_key }: test call first, then save
//   DELETE /api/me/ai-key
// The key itself is never sent back.
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { assistantLimits, keyCheckLimit } from '../middleware/rateLimit.js';
import { siteChat, ASSISTANT_MODEL, ASSISTANT_CONFIG } from '../services/studyAssistant.js';
import { aiConfigured, AiError } from '../services/gemini.js';
import { RETENTION_DAYS } from '../services/retention.js';
import { thread, clearThread, readMessage, sharedMessagesToday, saveExchange, sendAiError } from '../services/assistantThreads.js';
import { keysConfigured, describeKey, loadKey, saveKey, deleteKey } from '../services/aiKeys.js';
import { verifyKey } from '../services/ownGeminiKey.js';

const router = express.Router();

const n = Number(process.env.ASSISTANT_DAILY_SITE_LIMIT);
const DAILY_SITE_LIMIT = Number.isInteger(n) && n > 0 ? n : 300;

// Keys are a few dozen to a couple of hundred characters, printable, no spaces.
const API_KEY = /^[\x21-\x7E]{8,512}$/;

// ── General help ─────────────────────────────────────────────────────────────
router.get('/assistant', requireAuth, async (req, res) => {
  const [ownKey, messages] = await Promise.all([describeKey(req.user.id), thread(null, req.user.id)]);
  return res.json({
    configured: aiConfigured() || Boolean(ownKey),
    retention_days: RETENTION_DAYS,
    own_key: ownKey,
    messages,
  });
});

router.post('/assistant/messages', requireAuth, ...assistantLimits, async (req, res) => {
  const { content, error } = readMessage(req.body);
  if (error) return res.status(400).json({ error });

  const byo = await loadKey(req.user.id);
  if (!byo && await sharedMessagesToday(null) >= DAILY_SITE_LIMIT) {
    return res.status(429).json({ error: "The assistant has reached today's limit. It resets tomorrow." });
  }

  const sentAt = new Date();
  let reply;
  try {
    const history = await thread(null, req.user.id);
    reply = await siteChat({ userId: req.user.id, role: req.user.role, history, text: content, byo });
  } catch (err) {
    if (err instanceof AiError) return sendAiError(res, err);
    throw err;
  }
  const messages = await saveExchange({ classId: null, userId: req.user.id, content, reply, sentAt });
  return res.status(201).json({ messages });
});

router.delete('/assistant/messages', requireAuth, async (req, res) => {
  return res.json({ deleted: await clearThread(null, req.user.id) });
});

// ── Own AI key ───────────────────────────────────────────────────────────────
router.get('/ai-key', requireAuth, async (req, res) => {
  return res.json({
    available: keysConfigured(),
    model: ASSISTANT_MODEL,
    key: await describeKey(req.user.id),
  });
});

router.put('/ai-key', requireAuth, keyCheckLimit, async (req, res) => {
  if (!keysConfigured()) {
    return res.status(503).json({ error: "Using your own AI key isn't set up on this server." });
  }
  const apiKey = typeof req.body.api_key === 'string' ? req.body.api_key.trim() : '';
  if (!API_KEY.test(apiKey)) {
    return res.status(400).json({ error: "That doesn't look like an API key. Paste the whole key, with no spaces." });
  }

  try {
    // The same model and settings the assistant uses, so a key that passes works.
    await verifyKey({ apiKey, model: ASSISTANT_MODEL, config: ASSISTANT_CONFIG });
  } catch (err) {
    if (err instanceof AiError) return sendAiError(res, err);
    throw err;
  }
  const key = await saveKey(req.user.id, apiKey);
  return res.json({ key });
});

router.delete('/ai-key', requireAuth, async (req, res) => {
  return res.json({ deleted: await deleteKey(req.user.id) });
});

export default router;
