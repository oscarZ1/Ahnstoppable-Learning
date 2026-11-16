// Polls with a correct answer: the professor marks it (when writing the poll,
// or later), students never get it while the poll is open, and once it closes
// they see which answer was right and whether they got it. The Results page
// and its CSV show it too.
import { test, expect } from '@playwright/test';
import { STUDENTS } from './people.js';
import { API_PORT } from '../test-db.js';
import { signInStudent, signInProfessor, openClass, card, unique, fixtures, professorToken, studentToken, server } from './helpers.js';

const { alice } = STUDENTS;
const API = `http://localhost:${API_PORT}`;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const polls = () => `/api/classes/${fixtures().classId}/polls`;

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await server.closeEverything(await professorToken());
});

test('the professor marks the correct answer; students learn it only after the poll closes', async ({ browser }) => {
  const profCtx = await browser.newContext();
  const stuCtx  = await browser.newContext();
  const prof = await profCtx.newPage();
  const stu  = await stuCtx.newPage();
  await signInProfessor(prof);
  await signInStudent(stu, alice);
  await openClass(prof);
  await openClass(stu);
  const profPolls = card(prof, /Polls/);
  const stuPolls  = card(stu, /Polls/);

  // Write the poll and mark option 2 as correct
  const question = unique('What does CPM stand for?');
  await profPolls.getByPlaceholder('Ask the class a question…').fill(question);
  await profPolls.getByPlaceholder('Option 1').fill('Clicks per minute');
  await profPolls.getByPlaceholder('Option 2').fill('Cost per mille');
  await profPolls.getByRole('button', { name: 'Mark option 2 as the correct answer' }).click();
  await expect(profPolls.getByRole('button', { name: 'Mark option 2 as the correct answer' })).toHaveAttribute('aria-pressed', 'true');
  await profPolls.getByRole('button', { name: 'Start poll' }).click();
  await expect(profPolls.getByText('Live', { exact: true })).toBeVisible();
  await expect(profPolls.getByLabel(`Correct answer: ${question}`)).toHaveValue(/\d+/);
  await expect(profPolls.getByText('Correct', { exact: true })).toBeVisible();   // the professor sees it while open

  // While it's open, nothing tells the student which answer is right
  await expect(stuPolls.getByText(question)).toBeVisible();
  const token = await studentToken('alice', alice);
  const current = await call('GET', `${polls()}/current`, token);
  expect(current.data.poll.question).toBe(question);
  expect(current.data.poll).not.toHaveProperty('correct_option_id');
  await expect(stuPolls.getByText('Correct', { exact: true })).toHaveCount(0);

  // Alice picks the wrong one; after closing she's told the right answer
  await stuPolls.getByRole('button', { name: 'Clicks per minute' }).click();
  await expect(stuPolls.getByText('Answer recorded')).toBeVisible();
  await profPolls.getByRole('button', { name: 'Close poll & show results' }).click();
  await expect(stuPolls.getByText('Not quite. The correct answer is "Cost per mille".')).toBeVisible();
  await expect(stuPolls.getByText('Correct', { exact: true })).toBeVisible();
  const closed = await call('GET', `${polls()}/current`, token);
  const right = closed.data.poll.options.find((o) => o.text === 'Cost per mille').id;
  expect(closed.data.poll.correct_option_id).toBe(right);

  // The professor changes the correct answer after the fact: students see it live
  const wrong = closed.data.poll.options.find((o) => o.text === 'Clicks per minute').id;
  await profPolls.getByLabel(`Correct answer: ${question}`).selectOption(String(wrong));
  await expect(stuPolls.getByText('✓ You got it right!')).toBeVisible();

  // And can clear it: an opinion poll again, no verdict
  await profPolls.getByLabel(`Correct answer: ${question}`).selectOption('');
  await expect(stuPolls.getByText(/You got it right|correct answer is/)).toHaveCount(0);
  await expect(stuPolls.getByText('Correct', { exact: true })).toHaveCount(0);

  // Put it back for the checks below
  await profPolls.getByLabel(`Correct answer: ${question}`).selectOption(String(right));
  await expect(stuPolls.getByText('Not quite. The correct answer is "Cost per mille".')).toBeVisible();

  // The day's list tells the student their own pick
  const day = await call('GET', polls(), token);
  const listed = day.data.find((s) => s.poll.question === question);
  expect(listed.my_option_id).toBe(wrong);
  expect(listed.poll.correct_option_id).toBe(right);

  // The Results page marks it and counts who got it right
  await prof.goto(`/class/${fixtures().classId}/results`);
  const row = prof.getByRole('table', { name: 'Polls' }).locator('tr').filter({ hasText: question });
  await expect(row.getByText('0 of 1 got it right')).toBeVisible();
  await expect(row.getByLabel('Correct answer')).toBeVisible();
  const download = prof.waitForEvent('download');
  await prof.getByRole('button', { name: 'Download CSV' }).first().click();
  const csv = await (await (await download).createReadStream()).toArray();
  const text = Buffer.concat(csv).toString('utf8');
  expect(text.split('\r\n')[0]).toBe('Date,Time,Question,Student,Answer,Correct?');
  expect(text).toMatch(new RegExp(`${question.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},${alice.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},Clicks per minute,No`));

  await Promise.all([profCtx.close(), stuCtx.close()]);
});

test('a prepared poll keeps its correct answer hidden until it has run and closed', async () => {
  const prof = await professorToken();
  const token = await studentToken('alice', alice);
  const created = await call('POST', polls(), prof, {
    question: unique('Prepared quiz'), options: ['A', 'B', 'C'], correct_option: 2, prepare: true,
  });
  expect(created.status).toBe(201);
  const pollId = created.data.poll.id;
  expect(created.data.poll.correct_option_id).toBe(created.data.poll.options[2].id);

  expect((await call('POST', `${polls()}/${pollId}/start`, prof)).status).toBe(200);
  expect((await call('GET', `${polls()}/current`, token)).data.poll).not.toHaveProperty('correct_option_id');
  expect((await call('GET', polls(), token)).data.some((s) => s.poll.id === pollId)).toBe(false);   // open polls aren't listed for students
  await server.closePoll(prof, pollId);
  const listed = (await call('GET', polls(), token)).data.find((s) => s.poll.id === pollId);
  expect(listed.poll.correct_option_id).toBe(created.data.poll.options[2].id);
  expect(listed.my_option_id).toBeNull();
});

test('correct answers are validated, and only the professor can set them', async () => {
  const prof = await professorToken();
  const token = await studentToken('alice', alice);
  const base = { question: unique('Validated'), options: ['Yes', 'No'] };
  for (const bad of [2, -1, 1.5, '1']) {
    expect((await call('POST', polls(), prof, { ...base, correct_option: bad, prepare: true })).status).toBe(400);
  }
  const a = (await call('POST', polls(), prof, { ...base, prepare: true })).data.poll;
  const b = (await call('POST', polls(), prof, { ...base, question: unique('Other'), prepare: true })).data.poll;
  expect(a.correct_option_id).toBeNull();
  // Another poll's option, a student, and clearing it
  expect((await call('PATCH', `${polls()}/${a.id}/correct`, prof, { option_id: b.options[0].id })).status).toBe(400);
  expect((await call('PATCH', `${polls()}/${a.id}/correct`, token, { option_id: a.options[0].id })).status).toBe(403);
  const set = await call('PATCH', `${polls()}/${a.id}/correct`, prof, { option_id: a.options[1].id });
  expect(set.status).toBe(200);
  expect(set.data.poll.correct_option_id).toBe(a.options[1].id);
  expect((await call('PATCH', `${polls()}/${a.id}/correct`, prof, { option_id: null })).data.poll.correct_option_id).toBeNull();
  // A prepared poll with a correct answer can still be deleted
  await call('PATCH', `${polls()}/${b.id}/correct`, prof, { option_id: b.options[0].id });
  for (const p of [a, b]) expect((await call('DELETE', `${polls()}/${p.id}`, prof)).status).toBe(200);
});
