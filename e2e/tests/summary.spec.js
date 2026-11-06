// The professor's AI summary of a day's student questions, against the fake
// Gemini API (fake-gemini.js): no key, no cost, real SDK call path.
import { test, expect } from '@playwright/test';
import { STUDENTS } from './people.js';
import { API_PORT, FAKE_GEMINI_PORT } from '../test-db.js';
import { signInProfessor, signInStudent, openClass, card, unique, fixtures, studentToken, professorToken } from './helpers.js';

const { casey } = STUDENTS;
const MAIN_MODEL     = 'gemini-3.5-flash';
const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
const API  = `http://localhost:${API_PORT}`;
const FAKE = `http://localhost:${FAKE_GEMINI_PORT}`;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), headers: res.headers };
}
async function ask(token, content) {
  const res = await call('POST', `/api/classes/${fixtures().classId}/questions`, token, { content });
  expect(res.status).toBe(201);
}
const fakeRequests = async () => (await fetch(`${FAKE}/__requests`)).json();
// options: { model } to fail only that model, { times } to fail only the next N calls
const setFakeMode  = (mode, options = {}) => fetch(`${FAKE}/__mode`, { method: 'POST', body: JSON.stringify({ mode, ...options }) });
// The models the fake API was asked for since `before` requests.
const modelsCalledSince = async (before) => (await fakeRequests()).slice(before).map((r) => r.model);
const summaryPath = () => `/api/classes/${fixtures().classId}/questions/summary`;

// Change the day's questions without asking a new one (students may only ask
// a few per minute): the student edits one shared question to new text.
let editable = null;   // { id, token }
async function changeQuestions() {
  if (!editable) {
    const token = await studentToken('casey', casey);
    const asked = await call('POST', `/api/classes/${fixtures().classId}/questions`, token, { content: unique('A question that keeps being edited?') });
    expect(asked.status).toBe(201);
    editable = { id: asked.data.id, token };
  }
  const res = await call('PATCH', `/api/classes/${fixtures().classId}/questions/${editable.id}`, editable.token,
    { content: unique('A question that keeps being edited?') });
  expect(res.status).toBe(200);
}

// Sign in, open the class, and return the saved summary region and a function
// that changes the questions and clicks Refresh (Refresh with nothing changed
// doesn't call the AI).
async function openSummary(page) {
  await signInProfessor(page);
  await openClass(page);
  const summary = card(page, /Questions/).getByRole('region', { name: 'AI summary of questions' });
  await expect(summary).toBeVisible();
  const refreshAfterChange = async () => {
    await changeQuestions();
    await summary.getByRole('button', { name: /^Refresh/ }).click();
  };
  return { summary, refreshAfterChange };
}

test.describe.configure({ mode: 'serial' });

test.afterEach(async () => { await setFakeMode('ok'); });

test('the professor summarizes the day, and it is saved for next time', async ({ page }) => {
  const token = await studentToken('casey', casey);
  const asked = [unique('What does CPM measure?'), unique('How is CPC different from CPM?'), unique('When is the midterm?')];
  for (const q of asked) await ask(token, q);

  await signInProfessor(page);
  await openClass(page);
  const questions = card(page, /Questions/);
  const before = (await fakeRequests()).length;

  await questions.getByRole('button', { name: '✨ Summarize questions' }).click();
  const summary = questions.getByRole('region', { name: 'AI summary of questions' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText(/^Fake overview of \d+ questions\.$/)).toBeVisible();
  await expect(summary.getByText('Fake confusion')).toBeVisible();
  await expect(summary.getByText('Fake follow-up')).toBeVisible();
  await expect(summary.getByText(/AI-generated, may contain mistakes/)).toBeVisible();

  // Expanding the theme lists the questions it covers
  await summary.getByText('Fake theme').click();
  for (const q of asked) await expect(summary.getByText(`“${q}”`)).toBeVisible();

  // What was sent to the AI: the model, the schema, the questions, and no names
  const requests = await fakeRequests();
  expect(requests.length).toBe(before + 1);
  const { model, body, headers } = requests.at(-1);
  expect(model).toBe(MAIN_MODEL);
  expect(headers.apiKey).toBe('test-key');
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  expect(body.generationConfig.responseJsonSchema.required).toContain('themes');
  const sent = JSON.stringify(body.contents) + JSON.stringify(body.systemInstruction);
  for (const q of asked) expect(sent).toContain(q);
  // Every question counts the same: nothing about which ones were answered
  expect(sent).not.toMatch(/answered/i);
  for (const s of Object.values(STUDENTS)) {
    expect(sent).not.toContain(s.name);
    expect(sent).not.toContain(s.label);
  }

  // Reopening the day shows the saved summary without calling the AI again
  await page.reload();
  await expect(card(page, /Questions/).getByRole('region', { name: 'AI summary of questions' })).toBeVisible();
  expect((await fakeRequests()).length).toBe(before + 1);
});

test('new questions show a Refresh hint, and Refresh updates the summary', async ({ page }) => {
  await signInProfessor(page);
  await openClass(page);
  const questions = card(page, /Questions/);
  const summary = questions.getByRole('region', { name: 'AI summary of questions' });
  const footer = summary.getByText(/^Summarized at .* from \d+ questions?/);
  const countBefore = Number((await footer.textContent()).match(/from (\d+) question/)[1]);

  await ask(await studentToken('casey', casey), unique('Can we get practice problems?'));
  const refresh = summary.getByRole('button', { name: 'Refresh (1 new question)' });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(footer).toContainText(`from ${countBefore + 1} questions`);
  await expect(summary.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
});

test('a per-minute limit that clears in a second is retried on the same model', async ({ page }) => {
  const { summary, refreshAfterChange } = await openSummary(page);
  const before = (await fakeRequests()).length;

  await setFakeMode('rate_limit_brief', { times: 1 });
  await refreshAfterChange();
  await expect(summary.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  expect(await modelsCalledSince(before)).toEqual([MAIN_MODEL, MAIN_MODEL]);
});

test('a longer per-minute limit says how long to wait and counts down on the button', async ({ page }) => {
  const { summary, refreshAfterChange } = await openSummary(page);
  const before = (await fakeRequests()).length;

  await setFakeMode('rate_limit_minute');
  const response = page.waitForResponse((r) => r.url().includes('/questions/summary') && r.request().method() === 'POST');
  await refreshAfterChange();
  expect((await response).status()).toBe(429);
  expect((await response).headers()['retry-after']).toBe('40');
  await expect(summary.getByText('Please try again in about 40 seconds.', { exact: false })).toBeVisible();
  await expect(summary.getByRole('button', { name: /^Try again in \d+s$/ })).toBeDisabled();
  // Waiting 40 seconds won't help in the same minute, so neither model was retried.
  expect(await modelsCalledSince(before)).toEqual([MAIN_MODEL, FALLBACK_MODEL]);
});

test('a per-day limit is not retried, and the message says it is used up for today', async ({ page }) => {
  const { summary, refreshAfterChange } = await openSummary(page);
  const before = (await fakeRequests()).length;

  await setFakeMode('rate_limit_daily');
  await refreshAfterChange();
  await expect(summary.getByText(/Today's free AI limit has been used up/)).toBeVisible();
  expect(await modelsCalledSince(before)).toEqual([MAIN_MODEL, FALLBACK_MODEL]);
});

test('nothing new means no AI call, and two requests at once share one call', async ({ page }) => {
  await changeQuestions();
  const token = await professorToken();
  const before = (await fakeRequests()).length;

  // A double-click (or two tabs) at the same moment: one AI call, the same summary for both.
  const [a, b] = await Promise.all([
    call('POST', summaryPath(), token, {}),
    call('POST', summaryPath(), token, {}),
  ]);
  expect([a.status, b.status]).toEqual([201, 201]);
  expect(a.data.summary.created_at).toBe(b.data.summary.created_at);
  expect(await modelsCalledSince(before)).toEqual([MAIN_MODEL]);

  // Again with nothing new: the saved summary comes back without calling the AI.
  const again = await call('POST', summaryPath(), token, {});
  expect(again.status).toBe(200);
  expect(again.data.unchanged).toBe(true);
  expect(again.data.summary.created_at).toBe(a.data.summary.created_at);

  await signInProfessor(page);
  await openClass(page);
  const summary = card(page, /Questions/).getByRole('region', { name: 'AI summary of questions' });
  await summary.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(summary.getByText(/Nothing has changed since this summary/)).toBeVisible();
  expect(await modelsCalledSince(before)).toEqual([MAIN_MODEL]);
});

// An overloaded main model is skipped for a few minutes afterwards (the server
// remembers), so the tests that count which models were called run before this one.
test('when the main model is overloaded, the fallback makes the summary and is used straight away for a while', async ({ page }) => {
  const { summary, refreshAfterChange } = await openSummary(page);
  const before = (await fakeRequests()).length;

  await setFakeMode('overloaded', { model: MAIN_MODEL });
  await refreshAfterChange();
  await expect(summary.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  // No waiting on the overloaded model: straight to the fallback
  expect(await modelsCalledSince(before)).toEqual([MAIN_MODEL, FALLBACK_MODEL]);
  const saved = await call('GET', summaryPath(), await professorToken());
  expect(saved.data.summary.model).toBe(FALLBACK_MODEL);

  // The next summary doesn't try the main model at all, even though it's fine again
  await setFakeMode('ok');
  const middle = (await fakeRequests()).length;
  await refreshAfterChange();
  await expect(summary.getByText(/^Summarized at .* from \d+ questions?/)).toBeVisible();
  await expect.poll(() => modelsCalledSince(middle)).toEqual([FALLBACK_MODEL]);
});

test('an AI refusal, rate limit or overload shows a message and keeps the saved summary', async ({ page }) => {
  const { summary, refreshAfterChange } = await openSummary(page);
  const before = await summary.getByText(/^Summarized at .* from \d+ questions?/).textContent();

  await setFakeMode('refusal');
  await refreshAfterChange();
  await expect(summary.getByText("The AI couldn't summarize these questions.")).toBeVisible();

  await setFakeMode('rate_limit');
  await refreshAfterChange();
  await expect(summary.getByText(/usage limit/)).toBeVisible();

  await setFakeMode('overloaded');
  await refreshAfterChange();
  await expect(summary.getByText(/overloaded right now/)).toBeVisible();

  await page.reload();
  await expect(card(page, /Questions/).getByText(/^Summarized at .* from \d+ questions?/)).toHaveText(before);
});

test('students cannot see or create summaries', async ({ page }) => {
  const token = await studentToken('casey', casey);
  const { classId } = fixtures();
  expect((await call('GET',  `/api/classes/${classId}/questions/summary`, token)).status).toBe(403);
  expect((await call('POST', `/api/classes/${classId}/questions/summary`, token, {})).status).toBe(403);

  await signInStudent(page, casey);
  await openClass(page);
  const questions = card(page, /Questions/);
  await expect(questions.getByRole('button', { name: /Summarize questions/ })).toHaveCount(0);
  await expect(questions.getByRole('region', { name: 'AI summary of questions' })).toHaveCount(0);
});
