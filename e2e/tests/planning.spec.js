// Professors planning ahead: future days, prepared polls and checks that
// students can't see until the professor starts them in class, and the class
// timezone (the test database runs in UTC, like production).
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { STUDENTS } from './people.js';
import { BACKEND_DIR, APP_TIMEZONE, API_PORT, testDatabaseUrl } from '../test-db.js';
import { signInStudent, signInProfessor, openClass, card, unique, fixtures, professorToken, studentToken, server } from './helpers.js';

const { alice } = STUDENTS;
const API = `http://localhost:${API_PORT}`;

// Calendar days in the class timezone.
function dayKey(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return now.toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
}
async function get(path, token) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, data: await res.json() };
}
async function send(method, path, token, body) {
  const res = await fetch(API + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

test.beforeEach(async () => {
  await server.closeEverything(await professorToken());
});

test('the app uses the class timezone even though the database runs in UTC', async () => {
  const require = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const pg = require('pg');

  const raw = new pg.Client({ connectionString: testDatabaseUrl() });
  await raw.connect();
  const { rows: [dbDefault] } = await raw.query(`SELECT current_setting('TimeZone') AS tz`);
  await raw.end();
  expect(dbDefault.tz).toBe('UTC');

  // A poll started now belongs to today in the class timezone.
  const prof = await professorToken();
  const poll = await server.createPoll(prof, unique('Timezone poll'), ['Yes', 'No']);
  expect(poll.scheduled_for).toBe(dayKey(0));
  await server.closePoll(prof, poll.id);
});

test('a professor plans a future day, and students cannot see any of it', async ({ browser }) => {
  const { classId } = fixtures();
  const tomorrow = dayKey(1);
  const profCtx = await browser.newContext();
  const page = await profCtx.newPage();
  await signInProfessor(page);
  await openClass(page);

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByText(/^Planning /)).toBeVisible();

  // Discussion for tomorrow
  const topic = unique('Tomorrow topic');
  await page.getByRole('button', { name: /^Plan a Discussion for/ }).click();
  await page.locator('#post-title').fill(topic);
  await page.locator('#post-content').fill('Read chapter 4 before class.');
  await page.getByRole('button', { name: /^Schedule for/ }).click();
  await expect(page.getByText(topic)).toBeVisible();

  // Poll for tomorrow
  const polls = card(page, /Polls/);
  const question = unique('Planned poll');
  await polls.getByPlaceholder('Ask the class a question…').fill(question);
  await polls.getByPlaceholder('Option 1').fill('Agree');
  await polls.getByPlaceholder('Option 2').fill('Disagree');
  await polls.getByRole('button', { name: /^Save for/ }).click();
  await expect(polls.getByRole('list', { name: /Prepared for/ })).toContainText(question);

  // Check for tomorrow, then delete it again
  const checks = card(page, /Understanding Check/);
  const label = unique('Planned check');
  await checks.getByPlaceholder('What are you checking? (optional)').fill(label);
  await checks.getByRole('button', { name: /^Save for/ }).click();
  await expect(checks.getByRole('list', { name: /Prepared for/ })).toContainText(label);

  // Calendar marks the planned day
  await page.getByRole('button', { name: /\d{4}/ }).filter({ hasText: /\w{3}, / }).first().click();
  await expect(page.getByRole('button', { name: new RegExp(`^${tomorrow},.*prepared`) })).toBeVisible();
  await page.keyboard.press('Escape');

  // Students: no way forward, and the server gives them nothing for tomorrow
  const stuCtx = await browser.newContext();
  const stu = await stuCtx.newPage();
  await signInStudent(stu, alice);
  await openClass(stu);
  await expect(stu.getByRole('button', { name: 'Next day' })).toBeDisabled();

  const aliceTok = await studentToken('alice', alice);
  expect((await get(`/api/classes/${classId}/posts?date=${tomorrow}`, aliceTok)).data).toEqual([]);
  expect((await get(`/api/classes/${classId}/polls?date=${tomorrow}`, aliceTok)).data).toEqual([]);
  expect((await get(`/api/classes/${classId}/understand/rounds?date=${tomorrow}`, aliceTok)).data).toEqual([]);
  const year = tomorrow.slice(0, 4);
  const cal = (await get(`/api/classes/${classId}/posts/dates?year=${year}`, aliceTok)).data;
  expect(cal.some((d) => d.date === tomorrow)).toBe(false);

  // A poll planned for tomorrow can't be started today
  const prof = await professorToken();
  const planned = (await get(`/api/classes/${classId}/polls?date=${tomorrow}`, prof)).data.find((s) => s.poll.question === question);
  const early = await send('POST', `/api/classes/${classId}/polls/${planned.poll.id}/start`, prof);
  expect(early.status).toBe(409);
  expect(early.data.error).toMatch(/planned for/);

  // Deleting a prepared check
  page.on('dialog', (d) => d.accept());
  await checks.getByRole('button', { name: `Delete prepared check: ${label}` }).click();
  await expect(checks.getByText(label)).toHaveCount(0);

  await Promise.all([profCtx.close(), stuCtx.close()]);
});

test('a professor prepares a poll and a check for today, then starts them in class', async ({ browser }) => {
  const profCtx = await browser.newContext();
  const stuCtx  = await browser.newContext();
  const prof = await profCtx.newPage();
  const stu  = await stuCtx.newPage();
  await signInProfessor(prof);
  await signInStudent(stu, alice);
  await openClass(prof);
  await openClass(stu);

  // Poll: save for later → invisible to students → Start → live
  const profPolls = card(prof, /Polls/);
  const stuPolls  = card(stu, /Polls/);
  const question = unique('Prepared poll');
  await profPolls.getByPlaceholder('Ask the class a question…').fill(question);
  await profPolls.getByPlaceholder('Option 1').fill('Red');
  await profPolls.getByPlaceholder('Option 2').fill('Blue');
  await profPolls.getByRole('button', { name: 'Save for later' }).click();
  await expect(profPolls.getByRole('list', { name: 'Prepared for today' })).toContainText(question);
  await expect(profPolls.getByText('No poll running')).toBeVisible();
  await expect(stuPolls.getByText(question)).toHaveCount(0);

  await profPolls.getByRole('button', { name: `Start prepared poll: ${question}` }).click();
  await expect(profPolls.getByText('Live', { exact: true })).toBeVisible();
  await stuPolls.getByRole('button', { name: 'Blue' }).click();
  await expect(stuPolls.getByText('Answer recorded')).toBeVisible();
  await expect(profPolls.getByText(alice.name).first()).toBeVisible();
  await expect(profPolls.getByRole('button', { name: `Start prepared poll: ${question}` })).toHaveCount(0);

  // A poll that has started can't be deleted
  const token = await professorToken();
  const current = await server.currentPoll(token);
  expect((await send('DELETE', `/api/classes/${fixtures().classId}/polls/${current.poll.id}`, token)).status).toBe(409);
  await profPolls.getByRole('button', { name: 'Close poll & show results' }).click();

  // Check: save for later → Start → live for the student
  const profCheck = card(prof, /Understanding Check/);
  const stuCheck  = card(stu, /Understanding Check/);
  const label = unique('Prepared check');
  await profCheck.getByPlaceholder('What are you checking? (optional)').fill(label);
  await profCheck.getByRole('button', { name: 'Save for later' }).click();
  await expect(profCheck.getByRole('list', { name: 'Prepared for today' })).toContainText(label);
  await expect(stuCheck.getByText(label)).toHaveCount(0);

  await profCheck.getByRole('button', { name: `Start prepared check: ${label}` }).click();
  await expect(stuCheck.getByText(label)).toBeVisible();
  await stuCheck.getByRole('button', { name: 'Got it' }).click();
  await expect(profCheck.getByText(/^1 of \d+ students? responded/)).toBeVisible();
  await profCheck.getByRole('button', { name: 'End check' }).click();

  // The Results page lists only polls/checks that ran
  const history = await get(`/api/classes/${fixtures().classId}/polls/history`, token);
  expect(history.data.every((s) => s.poll.opened_at)).toBe(true);

  await Promise.all([profCtx.close(), stuCtx.close()]);
});
