// Shared steps for the browser tests.
import fs from 'node:fs';
import { expect } from '@playwright/test';
import { API_PORT, STATE_FILE } from '../test-db.js';
import { PROFESSOR, CLASS } from './people.js';

const API = `http://localhost:${API_PORT}`;

export function fixtures() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

// A short unique suffix so repeated runs never match old text.
export function unique(text) {
  return `${text} ${Date.now().toString(36)}`;
}

// ── Signing in through the real forms ────────────────────────────────────────
export async function signInStudent(page, student) {
  await page.goto('/');
  await page.locator('#class').selectOption({ label: CLASS.label });
  await page.locator('#name').selectOption({ label: student.label });
  await page.locator('input[type=password]').first().fill(student.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/home');
}

export async function signInProfessor(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in with email' }).click();
  await page.locator('#email').fill(PROFESSOR.email);
  await page.locator('input[type=password]').fill(PROFESSOR.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/home');
}

export async function openClass(page) {
  await page.goto(`/class/${fixtures().classId}`);
  await expect(page.getByRole('heading', { name: /Polls/ })).toBeVisible();
}

// The card (Polls, Understanding Check, Questions, …) whose heading matches.
export function card(page, heading) {
  return page.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: heading }) });
}

// ── Direct server calls, for setting the scene quickly ───────────────────────
async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

export async function professorToken() {
  return (await call('/api/auth/login', { method: 'POST', body: { email: PROFESSOR.email, password: PROFESSOR.password } })).token;
}

export async function studentToken(key, student) {
  const { classId, studentIds } = fixtures();
  return (await call('/api/auth/student-login', {
    method: 'POST', body: { class_id: classId, user_id: studentIds[key], password: student.password },
  })).token;
}

export const server = {
  async createPoll(token, question, options) {
    return (await call(`/api/classes/${fixtures().classId}/polls`, { token, method: 'POST', body: { question, options } })).poll;
  },
  async closePoll(token, pollId) {
    return call(`/api/classes/${fixtures().classId}/polls/${pollId}/close`, { token, method: 'PATCH' });
  },
  async vote(token, pollId, optionId) {
    return call(`/api/classes/${fixtures().classId}/polls/${pollId}/votes`, { token, method: 'POST', body: { option_id: optionId } });
  },
  async currentPoll(token) {
    return call(`/api/classes/${fixtures().classId}/polls/current`, { token });
  },
  async startCheck(token, label) {
    return call(`/api/classes/${fixtures().classId}/understand/rounds`, { token, method: 'POST', body: { label } });
  },
  async endCheck(token, roundId) {
    return call(`/api/classes/${fixtures().classId}/understand/rounds/${roundId}/end`, { token, method: 'PATCH' });
  },
  async answerCheck(token, response) {
    return call(`/api/classes/${fixtures().classId}/understand`, { token, method: 'POST', body: { response } });
  },
  // Close anything a previous (possibly failed) test left open, since a class
  // allows only one open poll and one running check at a time.
  async closeEverything(token) {
    const { classId } = fixtures();
    const poll = await call(`/api/classes/${classId}/polls/current`, { token });
    if (poll.poll && !poll.poll.closed_at) await this.closePoll(token, poll.poll.id);
    const check = await call(`/api/classes/${classId}/understand`, { token });
    if (check.round && !check.round.ended_at) await this.endCheck(token, check.round.id);
  },
};
