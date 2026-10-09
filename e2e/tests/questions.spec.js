// Student questions: browsers that format dates differently, fair rate
// limiting, and the professor's discussion post showing no time.
import { test, expect } from '@playwright/test';
import { STUDENTS, PROFESSOR, POST } from './people.js';
import { APP_TIMEZONE, API_PORT } from '../test-db.js';
import { signInStudent, openClass, card, unique, fixtures, studentToken } from './helpers.js';

const { alice, bob } = STUDENTS;
const API = `http://localhost:${API_PORT}`;

function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: APP_TIMEZONE });
}
async function ask(token, body) {
  const res = await fetch(`${API}/api/classes/${fixtures().classId}/questions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test('a student whose browser formats dates as M/D/YYYY can still use the page and ask', async ({ browser }) => {
  const context = await browser.newContext();
  // Some browsers return "10/8/2026" for toLocaleDateString("en-CA"); simulate one.
  await context.addInitScript(() => {
    const original = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (locales, options) {
      if (locales === 'en-CA' && options === undefined) {
        return `${this.getMonth() + 1}/${this.getDate()}/${this.getFullYear()}`;
      }
      return original.call(this, locales, options);
    };
  });
  const page = await context.newPage();
  await signInStudent(page, alice);
  await openClass(page);

  // The simulation is active…
  expect(await page.evaluate(() => new Date(2026, 9, 8).toLocaleDateString('en-CA'))).toBe('10/8/2026');
  // …and the page still knows what day it is.
  await expect(page.getByText('Invalid Date')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();

  const questions = card(page, /Questions/);
  const text = unique('Odd-browser question');
  await questions.getByPlaceholder(/Stuck on something\?/).fill(text);
  await questions.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(questions.getByText(text)).toBeVisible();
  await expect(page.getByText(/must be YYYY-MM-DD/)).toHaveCount(0);

  await context.close();
});

test('unreadable or wrong dates are filed under today instead of rejected', async () => {
  const token = await studentToken('alice', alice);
  for (const asked_date of ['10/8/2026', '2026-02-30', '2099-01-01', '2020-01-01']) {
    const res = await ask(token, { content: unique(`Date ${asked_date}`), asked_date });
    expect(res.status, `asked_date ${asked_date}`).toBe(201);
    expect(res.data.asked_date).toBe(todayKey());
  }
});

test('rejected questions do not count toward the limit; real ones do', async () => {
  const token = await studentToken('bob', bob);
  for (let i = 0; i < 6; i++) {
    expect((await ask(token, { content: '   ' })).status).toBe(400);   // empty: rejected
  }
  for (let i = 0; i < 5; i++) {
    expect((await ask(token, { content: unique(`Bob question ${i}`) })).status).toBe(201);
  }
  const sixth = await ask(token, { content: unique('One too many') });
  expect(sixth.status).toBe(429);
  expect(sixth.data.error).toMatch(/too quickly/);
});

test("the professor's discussion post shows the name without a time", async ({ page }) => {
  await signInStudent(page, alice);
  await openClass(page);
  const post = page.locator('div.rounded-lg').filter({ has: page.getByRole('heading', { name: POST.title }) });
  const byline = post.locator('p', { hasText: PROFESSOR.name }).first();
  await expect(byline).toHaveText(PROFESSOR.name);
  await expect(byline).not.toContainText(/\d{1,2}:\d{2}/);
});
