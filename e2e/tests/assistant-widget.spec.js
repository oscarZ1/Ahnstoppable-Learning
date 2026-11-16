// The students' corner assistant: the button on every signed-in page, general
// help (always on), course help with the student's own activity, and students'
// own Gemini keys. Always Gemini 3.5 Flash-Lite. Runs against the fake Gemini API
// (fake-gemini.js).
//
// Uses erin (and alice only for the key-check limit). Leaves no key behind and
// course help off, so assistant.spec.js starts from the default.
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';
import { STUDENTS, POST, CLASS } from './people.js';
import { API_PORT, FAKE_GEMINI_PORT, BACKEND_DIR, testDatabaseUrl } from '../test-db.js';
import { signInProfessor, signInStudent, openClass, unique, fixtures, studentToken, professorToken, openAssistant, assistantPanel } from './helpers.js';

const { erin, alice } = STUDENTS;
const API  = `http://localhost:${API_PORT}`;
const FAKE = `http://localhost:${FAKE_GEMINI_PORT}`;
const pg = createRequire(path.join(BACKEND_DIR, 'package.json'))('pg');

async function call(method, urlPath, token, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, data: text ? JSON.parse(text) : null };
}
const classBase = () => `/api/classes/${fixtures().classId}/assistant`;
const fakeRequests = async () => (await fetch(`${FAKE}/__requests`)).json();
const newRequests = async (before) => (await fakeRequests()).slice(before);
const systemOf = (r) => JSON.stringify(r.body.systemInstruction);
const MODEL = 'gemini-3.5-flash-lite';

async function sql(query, params) {
  const db = new pg.Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.end();
  }
}

const GEMINI_KEY    = 'AIza-test-erin-gemini-5555';
const ERIN_QUESTION = unique('Erin asked: how is reach measured?');
const BOB_QUESTION  = unique('Bob asked: is the midterm open book?');

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await call('DELETE', '/api/me/ai-key', await studentToken('erin', erin));
  await call('PUT', `${classBase()}/settings`, await professorToken(), { enabled: false });
});

test('the corner button shows for students and professors on every signed-in page', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await expect(page.locator('#class')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the study assistant' })).toHaveCount(0);

  await signInStudent(page, erin);
  const button = page.getByRole('button', { name: 'Open the study assistant' });
  await expect(button).toBeVisible();
  const panel = await openAssistant(page);
  await expect(panel.getByLabel('What the assistant helps with')).toHaveValue('site');
  await expect(panel.getByLabel('What the assistant helps with').locator('option')).toContainText(['General help', CLASS.label]);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();

  // On a class page the menu follows the page
  await openClass(page);
  await openAssistant(page);
  await expect(assistantPanel(page).getByLabel('What the assistant helps with')).toHaveValue(String(fixtures().classId));

  const prof = await (await browser.newContext()).newPage();
  await signInProfessor(prof);
  await expect(prof.getByText(CLASS.title).first()).toBeVisible();   // home has loaded
  const profPanel = await openAssistant(prof);
  await expect(profPanel.getByLabel('What the assistant helps with')).toHaveValue('site');
  await expect(profPanel.getByText(/teaching ideas/)).toBeVisible();
  await openClass(prof);
  await openAssistant(prof);
  await expect(assistantPanel(prof).getByLabel('What the assistant helps with')).toHaveValue(String(fixtures().classId));
});

test('general help is a general assistant that knows the site, in its own thread', async ({ page }) => {
  await signInStudent(page, erin);
  const panel = await openAssistant(page);
  await expect(panel.getByText(/from schoolwork, writing and coding/)).toBeVisible();
  const before = (await fakeRequests()).length;
  const text = unique('How do I reply without my name showing?');
  const box = panel.getByLabel('Message the study assistant');
  await box.fill(text);
  await box.press('Enter');
  await expect(panel.getByText(`Fake reply to: ${text}`)).toBeVisible();

  const [request] = await newRequests(before);
  expect(request.model).toBe(MODEL);
  expect(request.headers.apiKey).toBe('test-key');   // the shared key
  const system = systemOf(request);
  expect(system).toContain('How this website works');
  expect(system).toContain('general-purpose AI assistant');
  expect(system).not.toContain('out of scope');
  expect(system).toContain(CLASS.title);             // the student's classes, by title
  expect(system).not.toContain(POST.title);          // no class material in general help
  for (const s of Object.values(STUDENTS)) expect(system).not.toContain(s.name);

  // The same thread follows the student to a class page whose course help is
  // off, with no notice about it
  await openClass(page);
  const again = assistantPanel(page);
  await expect(again.getByLabel('What the assistant helps with')).toHaveValue(String(fixtures().classId));
  await expect(again.getByText(`Fake reply to: ${text}`)).toBeVisible();
  await expect(again.getByRole('status')).toHaveCount(0);
  await expect(again.getByText(/hasn't turned on/)).toHaveCount(0);

  // It's a separate thread from the class's
  const token = await studentToken('erin', erin);
  expect((await call('GET', '/api/me/assistant', token)).data.messages.map((m) => m.content)).toContain(text);
  expect((await call('GET', classBase(), token)).data.messages.map((m) => m.content)).not.toContain(text);
  const [row] = await sql(`SELECT class_id FROM assistant_messages WHERE content = $1`, [text]);
  expect(row.class_id).toBeNull();
});

test('the professor uses the assistant too: course help in their own class even when it is off for students', async ({ page }) => {
  const prof = await professorToken();
  expect((await call('PUT', `${classBase()}/settings`, prof, { enabled: false })).status).toBe(200);
  const student = await studentToken('erin', erin);
  expect((await call('GET', classBase(), student)).data.available).toBe(false);
  expect((await call('GET', classBase(), prof)).data.available).toBe(true);

  // In the corner panel on the class page: course help, with the class material
  await signInProfessor(page);
  await openClass(page);
  const panel = await openAssistant(page);
  await expect(panel.getByText(/from this course's material and teaching ideas/)).toBeVisible();
  await expect(panel.getByText(/never part of the students' summary/)).toBeVisible();
  let before = (await fakeRequests()).length;
  const text = unique('Suggest a quiz question about reach');
  await panel.getByLabel('Message the study assistant').fill(text);
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByText(`Fake reply to: ${text}`)).toBeVisible();
  const [request] = await newRequests(before);
  expect(request.model).toBe(MODEL);
  let system = systemOf(request);
  expect(system).toContain('the professor who teaches this course');
  expect(system).toContain(POST.title);
  expect(system).toContain('How this website works (for professors)');
  expect(system).toContain('How this website works (for students)');
  expect(system).not.toContain('Talent points (one per');   // no "own activity" for professors
  for (const s of Object.values(STUDENTS)) expect(system).not.toContain(s.name);

  // General help knows it's a professor too
  before = (await fakeRequests()).length;
  expect((await call('POST', '/api/me/assistant/messages', prof, { content: 'How do I reset a password?' })).status).toBe(201);
  system = systemOf((await newRequests(before))[0]);
  expect(system).toContain('a professor who teaches here');
  expect(system).toContain('Reset password');

  // Students still can't use course help while it's off
  expect((await call('POST', `${classBase()}/messages`, student, { content: 'Can I?' })).status).toBe(403);
});

test("course help includes the student's own activity, but nobody else's", async ({ page }) => {
  const { classId, studentIds } = fixtures();
  // Two questions from three days ago: erin's own, and bob's (unanswered, so
  // not class material either)
  await sql(
    `INSERT INTO questions (class_id, author_id, content, asked_date)
     VALUES ($1, $2, $3, CURRENT_DATE - 3), ($1, $4, $5, CURRENT_DATE - 3)`,
    [classId, studentIds.erin, ERIN_QUESTION, studentIds.bob, BOB_QUESTION]
  );
  expect((await call('PUT', `${classBase()}/settings`, await professorToken(), { enabled: true })).status).toBe(200);

  await signInStudent(page, erin);
  await openClass(page);
  const panel = await openAssistant(page);
  await expect(panel.getByText(/from this course's material/)).toBeVisible();
  const before = (await fakeRequests()).length;
  const text = unique('Did my question get answered?');
  await panel.getByLabel('Message the study assistant').fill(text);
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByText(`Fake reply to: ${text}`)).toBeVisible();

  const [request] = await newRequests(before);
  expect(request.model).toBe(MODEL);
  const system = systemOf(request);
  expect(system).toContain(POST.title);
  expect(system).toContain(ERIN_QUESTION);
  expect(system).toContain('Not answered yet.');
  expect(system).toContain('Talent points');
  expect(system).toContain('How this website works');
  expect(system).not.toContain(BOB_QUESTION);
  for (const s of Object.values(STUDENTS)) expect(system).not.toContain(s.name);
});

test('a student adds their own Gemini key: checked first, stored encrypted, never shown again', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await signInStudent(page, erin);
  let panel = await openAssistant(page);
  await panel.getByRole('button', { name: 'Use your own Gemini key' }).click();
  const form = panel.getByRole('form', { name: 'Add your own Gemini key' });
  await expect(panel.getByText(/No key added/)).toBeVisible();
  await expect(panel.getByText(/app subscription isn't an API key/)).toBeVisible();
  await expect(panel.getByText(/runs on Google's gemini-3\.5-flash-lite/)).toBeVisible();
  await expect(form.getByLabel('Provider')).toHaveCount(0);   // Gemini only
  await expect(form.getByLabel(/Model/)).toHaveCount(0);       // one model

  // A rejected key isn't saved
  await form.getByLabel('Gemini API key').fill('bad-gemini-key-123');
  await form.getByRole('button', { name: 'Save key' }).click();
  await expect(panel.getByRole('alert')).toHaveText(/Your Gemini API key was rejected/);
  const token = await studentToken('erin', erin);
  expect((await call('GET', '/api/me/ai-key', token)).data.key).toBeNull();

  // A good key is checked with a test call on the assistant's model, then saved
  let before = (await fakeRequests()).length;
  await form.getByLabel('Gemini API key').fill(GEMINI_KEY);
  await form.getByRole('button', { name: 'Save key' }).click();
  await expect(panel.getByText('Using your Gemini key ••••5555')).toBeVisible();
  await expect(form.getByLabel('Gemini API key')).toHaveValue('');
  const [check] = await newRequests(before);
  expect(check).toMatchObject({ model: MODEL, headers: { apiKey: GEMINI_KEY } });

  // The key never comes back, and the database only has ciphertext
  const described = await call('GET', '/api/me/ai-key', token);
  expect(described.data).toMatchObject({ available: true, model: MODEL, key: { last4: '5555' } });
  expect(described.text).not.toContain(GEMINI_KEY);
  expect((await call('GET', '/api/me/assistant', token)).text).not.toContain(GEMINI_KEY);
  const [stored] = await sql(
    `SELECT key_ciphertext, key_last4 FROM student_ai_keys WHERE user_id = $1`, [fixtures().studentIds.erin]
  );
  expect(stored.key_last4).toBe('5555');
  expect(stored.key_ciphertext.toString('latin1')).not.toContain('erin-gemini');

  // Back in the chat, answers come from the student's own key, same model and rules
  await panel.getByRole('button', { name: 'Back to the chat' }).click();
  panel = assistantPanel(page);
  await expect(panel.getByText(/Answering with your Gemini key \(••••5555\)/)).toBeVisible();
  before = (await fakeRequests()).length;
  const text = unique('Where do I see my talent points?');
  await panel.getByLabel('Message the study assistant').fill(text);
  await panel.getByRole('button', { name: 'Send' }).click();
  await expect(panel.getByText(`Fake reply to: ${text}`)).toBeVisible();
  const [chat] = await newRequests(before);
  expect(chat).toMatchObject({ model: MODEL, headers: { apiKey: GEMINI_KEY } });
  expect(chat.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  expect(systemOf(chat)).toContain('general-purpose AI assistant');
  expect(systemOf(chat)).toContain('How this website works');
  const [reply] = await sql(
    `SELECT model FROM assistant_messages WHERE user_id = $1 AND role = 'model' ORDER BY id DESC LIMIT 1`,
    [fixtures().studentIds.erin]
  );
  expect(reply.model).toBe(`own:${MODEL}`);   // so it doesn't count toward the shared daily caps
});

test('an own key works for course help; removing it goes back to the shared key', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const token = await studentToken('erin', erin);

  let before = (await fakeRequests()).length;
  const text = unique('Explain gross rating points');
  const sent = await call('POST', `${classBase()}/messages`, token, { content: text });
  expect(sent.status).toBe(201);
  expect(sent.data.messages[1].content).toBe(`Fake reply to: ${text}`);
  const [own] = await newRequests(before);
  expect(own).toMatchObject({ model: MODEL, headers: { apiKey: GEMINI_KEY } });
  expect(systemOf(own)).toContain(POST.title);

  // Removing the key in the panel goes back to the shared key, same model
  await signInStudent(page, erin);
  const panel = await openAssistant(page);
  await panel.getByRole('button', { name: 'Use your own Gemini key' }).click();
  await expect(panel.getByText('Using your Gemini key ••••5555')).toBeVisible();
  await panel.getByRole('button', { name: 'Remove' }).click();
  await expect(panel.getByRole('status')).toHaveText(/Removed/);
  await panel.getByRole('button', { name: 'Back to the chat' }).click();
  await expect(assistantPanel(page).getByText(/Answering with your/)).toHaveCount(0);
  before = (await fakeRequests()).length;
  expect((await call('POST', '/api/me/assistant/messages', token, { content: 'Back on the shared key?' })).status).toBe(201);
  const [shared] = await newRequests(before);
  expect(shared).toMatchObject({ model: MODEL, headers: { apiKey: 'test-key' } });
});

test('adding a key is validated and limited to 5 tries per 15 minutes', async () => {
  const token = await studentToken('alice', alice);
  const tries = [
    {},
    { api_key: 'short' },
    { api_key: 'has spaces in it' },
    { api_key: 12345678901 },
    { api_key: 'bad-alice-key-0000' },
  ];
  const statuses = [];
  for (const body of tries) statuses.push((await call('PUT', '/api/me/ai-key', token, body)).status);
  expect(statuses).toEqual([400, 400, 400, 400, 400]);
  const sixth = await call('PUT', '/api/me/ai-key', token, { api_key: 'AIza-test-alice-0000' });
  expect(sixth.status).toBe(429);
  expect(sixth.data.error).toMatch(/too many times/);
  expect((await call('GET', '/api/me/ai-key', token)).data.key).toBeNull();
});
