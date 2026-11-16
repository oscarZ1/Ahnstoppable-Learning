// Course help from the students' assistant: off by default, the professor
// turns it on and gives it notes, students chat privately from the corner
// panel, and the professor gets only an anonymous summary. Runs against the
// fake Gemini API (fake-gemini.js). General help and own Gemini keys are in
// assistant-widget.spec.js.
//
// Uses alice, bob and dana (casey belongs to the summary tests), and turns the
// assistant back off at the end so later spec files see the default page.
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { STUDENTS, POST, PROFESSOR, CLASS } from './people.js';
import { API_PORT, FAKE_GEMINI_PORT, BACKEND_DIR, testDatabaseUrl } from '../test-db.js';
import { signInProfessor, signInStudent, openClass, card, unique, fixtures, studentToken, professorToken, openAssistant, assistantPanel } from './helpers.js';

const { alice, bob, dana } = STUDENTS;
const API  = `http://localhost:${API_PORT}`;
const FAKE = `http://localhost:${FAKE_GEMINI_PORT}`;
const pg = createRequire(path.join(BACKEND_DIR, 'package.json'))('pg');

async function call(method, urlPath, token, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json(), headers: res.headers };
}
const base = () => `/api/classes/${fixtures().classId}/assistant`;
const send = (token, content) => call('POST', `${base()}/messages`, token, { content });
const fakeRequests = async () => (await fetch(`${FAKE}/__requests`)).json();
const setFakeMode  = (mode, options = {}) => fetch(`${FAKE}/__mode`, { method: 'POST', body: JSON.stringify({ mode, ...options }) });
const sentText = (request) => JSON.stringify(request.body.contents) + JSON.stringify(request.body.systemInstruction);
const assistantCard = (page) => card(page, /Study Assistant/);

function localDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-CA');
}

const NOTES = unique('Key concept: reach times frequency equals gross rating points.');
const INSTRUCTIONS = unique('Use advertising examples.');
const FUTURE_POST = { title: unique('Next week plan'), content: unique('Secret future discussion about the final exam') };
const ANSWERED = { question: unique('What is a GRP?'), answer: unique('Gross rating points: reach times frequency.') };
let aliceMessages;   // what alice sent in the chat test

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const prof = await professorToken();
  const { classId } = fixtures();
  // A planned post for next week, and a question the professor has answered.
  const post = await call('POST', `/api/classes/${classId}/posts`, prof, { ...FUTURE_POST, post_date: localDateKey(7) });
  expect(post.status).toBe(201);
  const asked = await call('POST', `/api/classes/${classId}/questions`, await studentToken('dana', dana), { content: ANSWERED.question });
  expect(asked.status).toBe(201);
  const answered = await call('PATCH', `/api/classes/${classId}/questions/${asked.data.id}/answer`, prof, { answer: ANSWERED.answer });
  expect(answered.status).toBe(200);
});

test.afterEach(async () => { await setFakeMode('ok'); });

test.afterAll(async () => {
  await call('PUT', `${base()}/settings`, await professorToken(), { enabled: false });
});

test('course help is off by default: the panel offers website help, and sending is refused', async ({ page }) => {
  const token = await studentToken('alice', alice);
  const res = await send(token, 'Hello?');
  expect(res.status).toBe(403);
  expect(res.data.error).toBe('The study assistant is turned off for this class.');
  expect((await call('GET', base(), token)).data.enabled).toBe(false);

  await signInStudent(page, alice);
  await openClass(page);
  await expect(card(page, /Questions/)).toBeVisible();
  await expect(card(page, /Study Assistant/)).toHaveCount(0);   // no card on the page for students
  const panel = await openAssistant(page);
  await expect(panel.getByRole('status')).toHaveCount(0);   // no notice: it quietly gives general help
  await expect(panel.getByText(/from schoolwork, writing and coding/)).toBeVisible();
});

test('the professor turns it on with notes; a student chats, and the chat survives a reload', async ({ browser }) => {
  const profPage = await (await browser.newContext()).newPage();
  await signInProfessor(profPage);
  await openClass(profPage);
  const settings = assistantCard(profPage);
  await expect(settings.getByRole('switch')).not.toBeChecked();
  await settings.getByRole('switch').check();
  await settings.getByLabel('Instructions for the assistant').fill(INSTRUCTIONS);
  await settings.getByLabel('Course notes').fill(NOTES);
  await settings.getByRole('button', { name: 'Save settings' }).click();
  await expect(settings.getByText('Saved. Students can use the study assistant.')).toBeVisible();
  // No chat in the card: the professor uses the corner button like everyone
  await expect(settings.getByRole('log')).toHaveCount(0);
  await expect(settings.getByLabel('Message the study assistant')).toHaveCount(0);

  const page = await (await browser.newContext()).newPage();
  await signInStudent(page, alice);
  await openClass(page);
  const chat = await openAssistant(page);
  await expect(chat.getByText(/Your chat is private/)).toContainText('Messages are deleted after 120 days.');
  const box = chat.getByLabel('Message the study assistant');
  const before = (await fakeRequests()).length;

  aliceMessages = [unique('What is reach?'), unique('And what about frequency?')];
  for (const text of aliceMessages) {
    await box.fill(text);
    await box.press('Enter');
    await expect(chat.getByText(`Fake reply to: ${text}`)).toBeVisible();
    await expect(box).toHaveValue('');
  }

  // Shift+Enter makes a new line instead of sending
  await box.fill('line one');
  await box.press('Shift+Enter');
  await box.pressSequentially('line two');
  await expect(box).toHaveValue('line one\nline two');
  await box.fill('');

  await page.reload();
  const log = assistantPanel(page).getByRole('log');   // the panel stays open across page loads
  for (const text of aliceMessages) {
    await expect(log.getByText(text, { exact: false }).first()).toBeVisible();
    await expect(log.getByText(`Fake reply to: ${text}`)).toBeVisible();
  }

  // What the AI received: today's post, the notes and instructions, the answered
  // question, and (with the second message) the first turn
  const requests = (await fakeRequests()).slice(before);
  expect(requests).toHaveLength(2);
  const [first, second] = requests;
  const sent = sentText(second);
  expect(sent).toContain(POST.title);
  expect(sent).toContain(POST.content);
  expect(sent).toContain(NOTES);
  expect(sent).toContain(INSTRUCTIONS);
  expect(sent).toContain(ANSWERED.question);
  expect(sent).toContain(ANSWERED.answer);
  // The general-assistant rules and the website guide go with every message,
  // always to Gemini 3.5 Flash-Lite
  expect(sent).toContain('general-purpose AI assistant');
  expect(sent).toContain('How this website works');
  expect(second.body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  expect(second.body.contents[0].parts[0].text).toBe(aliceMessages[0]);
  expect(second.body.contents[1].parts[0].text).toBe(`Fake reply to: ${aliceMessages[0]}`);
  expect(first.body.contents).toHaveLength(1);
  for (const r of requests) expect(r.model).toBe('gemini-3.5-flash-lite');
  expect(second.body.generationConfig.maxOutputTokens).toBe(8192);
  expect(second.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  // Never a planned future day, and no names
  for (const r of requests) {
    const text = sentText(r);
    expect(text).not.toContain(FUTURE_POST.title);
    expect(text).not.toContain(FUTURE_POST.content);
    expect(text).not.toContain(PROFESSOR.name);
    for (const s of Object.values(STUDENTS)) {
      expect(text).not.toContain(s.name);
      expect(text).not.toContain(s.label);
    }
  }
});

test('each student sees only their own thread', async ({ page }) => {
  const bobToken = await studentToken('bob', bob);
  const res = await call('GET', base(), bobToken);
  expect(res.status).toBe(200);
  expect(res.data.enabled).toBe(true);
  expect(res.data.messages).toEqual([]);

  await signInStudent(page, bob);
  await openClass(page);
  const chat = await openAssistant(page);
  await expect(chat.getByText(/from this course's material/)).toBeVisible();
  for (const text of aliceMessages) await expect(page.getByText(text, { exact: false })).toHaveCount(0);
});

test('when the AI fails, the error shows under the box, the text stays, and nothing is saved', async ({ page }) => {
  // A rate limit (the assistant has one model and no fallback).
  const token = await studentToken('dana', dana);
  const before = (await call('GET', base(), token)).data.messages.length;

  await signInStudent(page, dana);
  await openClass(page);
  const chat = await openAssistant(page);
  const box = chat.getByLabel('Message the study assistant');
  const text = unique('Will this one get through?');

  await setFakeMode('rate_limit');
  await box.fill(text);
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByRole('alert')).toContainText(/usage limit/);
  await expect(box).toHaveValue(text);
  expect((await call('GET', base(), token)).data.messages).toHaveLength(before);

  // Once the AI is back, the same text goes through
  await setFakeMode('ok');
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.getByText(`Fake reply to: ${text}`)).toBeVisible();
  expect((await call('GET', base(), token)).data.messages).toHaveLength(before + 2);

  // A refusal is a plain message, and bad input is refused before any AI call
  await setFakeMode('refusal');
  const refused = await send(token, 'Something the AI declines');
  expect(refused.status).toBe(422);
  expect(refused.data.error).toBe("The assistant can't help with that one. Try rephrasing, or ask your professor.");
  await setFakeMode('ok');
  const calls = (await fakeRequests()).length;
  expect((await send(token, '   ')).status).toBe(400);
  expect((await send(token, 'x'.repeat(1001))).status).toBe(400);
  expect((await fakeRequests()).length).toBe(calls);
  expect((await call('GET', base(), token)).data.messages).toHaveLength(before + 2);
});

test('the 7th message in a minute is blocked with a message in the card', async ({ page }) => {
  const token = await studentToken('bob', bob);
  for (let i = 1; i <= 6; i++) expect((await send(token, `Quick question ${i}`)).status).toBe(201);

  await signInStudent(page, bob);
  await openClass(page);
  const chat = await openAssistant(page);
  const box = chat.getByLabel('Message the study assistant');
  await box.fill('One more?');
  await box.press('Enter');
  await expect(chat.getByRole('alert')).toHaveText("You're posting messages to the study assistant too quickly. Wait a minute and try again.");
  await expect(box).toHaveValue('One more?');
});

test('Clear chat empties the thread', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signInStudent(page, bob);
  await openClass(page);
  const chat = await openAssistant(page);
  await expect(chat.getByText('Fake reply to: Quick question 6')).toBeVisible();
  await chat.getByRole('button', { name: 'Clear chat' }).click();
  await expect(chat.getByText(/from this course's material/)).toBeVisible();
  await page.reload();
  await expect(assistantPanel(page).getByText(/from this course's material/)).toBeVisible();
  expect((await call('GET', base(), await studentToken('bob', bob))).data.messages).toEqual([]);
});

test('messages older than the retention window are not returned', async () => {
  const { classId, studentIds } = fixtures();
  const oldText = unique('A message from 121 days ago');
  const recentText = unique('A message from 119 days ago');
  const db = new pg.Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO assistant_messages (class_id, user_id, role, content, created_at)
       VALUES ($1, $2, 'user', $3, NOW() - INTERVAL '121 days'), ($1, $2, 'user', $4, NOW() - INTERVAL '119 days')`,
      [classId, studentIds.alice, oldText, recentText]
    );
  } finally {
    await db.end();
  }
  const { data } = await call('GET', base(), await studentToken('alice', alice));
  expect(data.retention_days).toBe(120);
  const contents = data.messages.map((m) => m.content);
  expect(contents).toContain(recentText);
  expect(contents).not.toContain(oldText);
});

test("the professor's summary of assistant questions is anonymous and leaves out the professor", async ({ page }) => {
  const prof = await professorToken();
  const profText = unique('Professor testing the assistant');
  expect((await send(prof, profText)).status).toBe(201);

  // Students can't see or make it
  const studentTok = await studentToken('alice', alice);
  expect((await call('GET', `${base()}/summary`, studentTok)).status).toBe(403);
  expect((await call('POST', `${base()}/summary`, studentTok, {})).status).toBe(403);
  expect((await call('GET', `${base()}/settings`, studentTok)).status).toBe(403);
  expect((await call('PUT', `${base()}/settings`, studentTok, { enabled: false })).status).toBe(403);

  await signInProfessor(page);
  await openClass(page);
  const settings = assistantCard(page);
  const before = (await fakeRequests()).length;
  await settings.getByRole('button', { name: '✨ Summarize assistant questions' }).click();
  const summary = settings.getByRole('region', { name: 'AI summary of study-assistant questions' });
  await expect(summary.getByText(/^Fake overview of \d+ questions\.$/)).toBeVisible();
  await expect(summary.getByText(/^Summarized at .* from \d+ messages?/)).toBeVisible();

  const requests = (await fakeRequests()).slice(before);
  expect(requests).toHaveLength(1);
  const sent = sentText(requests[0]);
  expect(sent).toContain('study assistant');
  for (const text of aliceMessages) expect(sent).toContain(text);
  expect(sent).not.toContain(profText);
  expect(sent).not.toContain('Fake reply to');   // only what students asked
  expect(sent).not.toContain(PROFESSOR.name);
  expect(sent).not.toContain(CLASS.title);
  for (const s of Object.values(STUDENTS)) {
    expect(sent).not.toContain(s.name);
    expect(sent).not.toContain(s.label);
  }

  // The saved summary keeps no copy of the students' words
  const saved = await call('GET', `${base()}/summary`, prof);
  expect(JSON.stringify(saved.data.summary)).not.toContain(aliceMessages[0]);
});
