// What a professor can do, with a student open alongside to check that
// everything shows up live on both screens.
import { test, expect } from '@playwright/test';
import { STUDENTS, BOB_COMMENT, PROFESSOR } from './people.js';
import { signInStudent, signInProfessor, openClass, card, unique, professorToken, server } from './helpers.js';

const { alice } = STUDENTS;

test.beforeEach(async () => {
  await server.closeEverything(await professorToken());
});

// A professor page and a student (Alice) page in separate browser sessions.
async function professorAndStudent(browser) {
  const profCtx = await browser.newContext();
  const stuCtx  = await browser.newContext();
  const prof = await profCtx.newPage();
  const stu  = await stuCtx.newPage();
  await signInProfessor(prof);
  await signInStudent(stu, alice);
  await openClass(prof);
  await openClass(stu);
  return { prof, stu, close: () => Promise.all([profCtx.close(), stuCtx.close()]) };
}

test('a professor comments and replies, and students see it live with the professor name', async ({ browser }) => {
  const { prof, stu, close } = await professorAndStudent(browser);

  const comment = unique('Professor note:');
  await prof.getByLabel('Write a comment').fill(comment);
  await prof.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(prof.getByTestId('comment').filter({ hasText: comment })).toBeVisible();

  const onStudentScreen = stu.getByTestId('comment').filter({ hasText: comment });
  await expect(onStudentScreen).toBeVisible();
  await expect(onStudentScreen.getByText(PROFESSOR.name)).toBeVisible();

  const reply = unique('Professor reply:');
  const bobsComment = prof.getByTestId('comment').filter({ hasText: BOB_COMMENT });
  await bobsComment.getByRole('button', { name: 'Reply', exact: true }).click();
  await bobsComment.getByLabel('Write a reply').fill(reply);
  await bobsComment.getByRole('button', { name: 'Reply', exact: true }).click();
  await bobsComment.getByRole('button', { name: /View \d+ repl/ }).click();
  await expect(bobsComment.getByText(reply)).toBeVisible();

  await close();
});

test('a professor runs an understanding check and watches answers arrive', async ({ browser }) => {
  const { prof, stu, close } = await professorAndStudent(browser);
  const profCheck = card(prof, /Understanding Check/);
  const stuCheck  = card(stu, /Understanding Check/);

  const label = unique('Chapter 2 check');
  await profCheck.getByPlaceholder('What are you checking? (optional)').fill(label);
  await profCheck.getByRole('button', { name: 'Start check' }).click();
  await expect(profCheck.getByText('Live', { exact: true })).toBeVisible();

  await expect(stuCheck.getByText(label)).toBeVisible();
  await stuCheck.getByRole('button', { name: 'Got it' }).click();

  await expect(profCheck.getByText(/^1 of \d+ students? responded/)).toBeVisible();
  await profCheck.getByRole('button', { name: 'End check' }).click();
  await expect(profCheck.getByText('No check running')).toBeVisible();
  await expect(stuCheck.getByText("Here's how the class answered.")).toBeVisible();

  await close();
});

test('a professor creates a poll, sees who voted live, and closes it', async ({ browser }) => {
  const { prof, stu, close } = await professorAndStudent(browser);
  const profPolls = card(prof, /Polls/);
  const stuPolls  = card(stu, /Polls/);

  const question = unique('Which topic next?');
  await profPolls.getByPlaceholder('Ask the class a question…').fill(question);
  await profPolls.getByPlaceholder('Option 1').fill('Branding');
  await profPolls.getByPlaceholder('Option 2').fill('Media planning');
  await profPolls.getByRole('button', { name: 'Start poll' }).click();
  await expect(profPolls.getByText('Live', { exact: true })).toBeVisible();

  await stuPolls.getByRole('button', { name: 'Branding' }).click();
  await expect(stuPolls.getByText('Answer recorded')).toBeVisible();

  // Her name appears under the bar live (the first match; earlier polls in the
  // list below may also show her name).
  await expect(profPolls.getByText(alice.name).first()).toBeVisible();
  await expect(profPolls.getByText(/^1 of \d+ students? responded/).first()).toBeVisible();

  await profPolls.getByRole('button', { name: 'Close poll & show results' }).click();
  await expect(stuPolls.getByText(/Here's how the class answered/)).toBeVisible();
  await expect(stuPolls.getByText(alice.name)).toHaveCount(0);

  await close();
});

test('"View as student" shows the student layout and sends nothing', async ({ page }) => {
  const token = await professorToken();
  const poll = await server.createPoll(token, unique('Preview poll'), ['Yes', 'No']);

  await signInProfessor(page);
  await openClass(page);
  await expect(page.getByRole('heading', { name: /Roster/ })).toBeVisible();

  await page.getByRole('button', { name: /View as student/ }).click();
  await expect(page.getByText('Viewing as a student.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Roster/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Results/ })).toHaveCount(0);

  const polls = card(page, /Polls/);
  await polls.getByRole('button', { name: 'Yes' }).click();
  await expect(polls.getByText(/nothing was sent/)).toBeVisible();
  const current = await server.currentPoll(token);
  expect(current.responded).toBe(0);

  await page.getByRole('button', { name: 'Exit student view' }).click();
  await expect(page.getByRole('heading', { name: /Roster/ })).toBeVisible();
  await server.closePoll(token, poll.id);
});
