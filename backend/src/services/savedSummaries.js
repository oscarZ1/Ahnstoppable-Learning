// src/services/savedSummaries.js
// The "saved summary" flow shared by the Questions card summary and the study
// assistant summary: one summary per class and day, saved so reopening the day
// doesn't call the AI again, reused when nothing changed, and one AI call
// shared when two requests for the same day arrive at once.
//
// savedSummaries({ table, dayItems, source, snapshot, sameItems }) returns
// Express handlers { get, post } for GET/POST …/summary?date=.
//   table      – 'question_summaries' or 'assistant_summaries' (whitelisted)
//   dayItems   – async (classId, date) => [{ content, … }] in order; date null = today
//   source     – passed to summarizeQuestions ('class' | 'assistant')
//   snapshot   – (items) => extra fields stored with the summary
//   sameItems  – (savedSummaryJson, items) => true if it already covers these items
//   present    – optional (req, { summary, items }) => the summary to send this
//                requester (e.g. less for students); summary may be null
import { summarizeQuestions, summariesConfigured, SummaryError } from './questionSummary.js';
import { isValidDay } from '../utils/days.js';
import pool from '../db/pool.js';

const TABLES = new Set(['question_summaries', 'assistant_summaries']);

export function summaryDate(value) {
  if (value == null || value === '') return { date: null };
  return isValidDay(String(value)) ? { date: String(value) } : { error: 'date must be YYYY-MM-DD.' };
}

export function savedSummaries({ table, dayItems, source, snapshot, sameItems, present = (_req, { summary }) => summary }) {
  if (!TABLES.has(table)) throw new Error(`Unknown summary table ${table}`);

  async function saved(classId, date) {
    const { rows } = await pool.query(
      `SELECT summary, question_count, model, created_at, summary_date
       FROM   ${table}
       WHERE  class_id = $1 AND summary_date = COALESCE($2::date, CURRENT_DATE)`,
      [classId, date]
    );
    return rows[0] ?? null;
  }

  // Summaries being made right now, by class and day, so a double-click or a
  // second tab shares one AI call instead of starting another.
  const inFlight = new Map();

  // Make (or reuse) the day's summary. Returns { summary, items, unchanged }.
  async function make(classId, date, userId) {
    const items = await dayItems(classId, date);
    const existing = await saved(classId, date);
    if (existing && sameItems(existing.summary, items)) {
      return { summary: existing, items, unchanged: true };
    }
    const { summary, model } = await summarizeQuestions(items, { source });
    const stored = { ...summary, ...snapshot(items) };
    const { rows } = await pool.query(
      `INSERT INTO ${table} (class_id, summary_date, summary, question_count, model, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6)
       ON CONFLICT (class_id, summary_date) DO UPDATE
         SET summary = EXCLUDED.summary, question_count = EXCLUDED.question_count,
             model = EXCLUDED.model, created_by = EXCLUDED.created_by, created_at = NOW()
       RETURNING summary, question_count, model, created_at, summary_date`,
      [classId, date, JSON.stringify(stored), items.length, model, userId]
    );
    return { summary: rows[0], items, unchanged: false };
  }

  async function get(req, res) {
    const { date, error } = summaryDate(req.query.date);
    if (error) return res.status(400).json({ error });
    try {
      const existing = await saved(req.classId, date);
      const current = await dayItems(req.classId, date);
      return res.json({
        summary: present(req, { summary: existing, items: current }),
        current_question_count: current.length,
        outdated: Boolean(existing) && !sameItems(existing.summary, current),   // the items changed since
        configured: summariesConfigured(),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  async function post(req, res) {
    const { date, error } = summaryDate(req.body.date);
    if (error) return res.status(400).json({ error });
    const key = `${req.classId}:${date ?? 'today'}`;
    try {
      let job = inFlight.get(key);
      const joined = Boolean(job);
      if (!job) {
        job = make(req.classId, date, req.user.id).finally(() => inFlight.delete(key));
        inFlight.set(key, job);
      }
      const { summary, items, unchanged } = await job;
      // Reusing a summary didn't call the AI, so it doesn't count toward the summary limits.
      if (joined || unchanged) res.locals.summaryReused = true;
      return res.status(unchanged ? 200 : 201).json({
        summary: present(req, { summary, items }),
        current_question_count: items.length,
        outdated: false,
        unchanged,
        configured: true,
      });
    } catch (err) {
      if (err instanceof SummaryError) {
        if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
        return res.status(err.status).json({ error: err.message, retry_after: err.retryAfter });
      }
      console.error(err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  return { get, post };
}
