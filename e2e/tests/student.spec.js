// What a student can do: sign in for the first time, comment, reply,
// answer an understanding check, and vote in a poll.
import { test, expect } from '@playwright/test';
import { STUDENTS, BOB_COMMENT, CLASS } from './people.js';
import { signInStudent, openClass, card, unique, professorToken, server } from './helpers.js';

const { alice, newbie } = STUDENTS;

test.beforeEach(async () => {
  await server.closeEverything(await professorToken());
});

test('a first-time student creates a password and signs in', async ({ page }) => {
  await page.goto('/');
  await page.locator('#class').selectOption({ label: CLASS.label });
  await page.locator('#name').selectOption({ label: newbie.label });

  await expect(page.getByText('First time signing in?')).toBeVisible();
  const [pw, confirm] = await page.locator('input[type=password]').all();
  await pw.fill('newbiepass1');
  await confirm.fill('newbiepass1');
  await page.getByRole('button', { name: 'Create password & sign in' }).click();

  await page.waitForURL('**/home');
  await expect(page.getByText(CLASS.title)).toBeVisible();
});

test('a student posts a comment and replies to a classmate', async ({ page }) => {
  await signInStudent(page, alice);
  await openClass(page);

  const comment = unique('Alice comment:');
  await page.getByLabel('Write a comment').fill(comment);
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.getByTestId('comment').filter({ hasText: comment })).toBeVisible();

  const reply = unique('Alice reply:');
  const bobsComment = page.getByTestId('comment').filter({ hasText: BOB_COMMENT });
  await bobsComment.getByRole('button', { name: 'Reply', exact: true }).click();
  await bobsComment.getByLabel('Write a reply').fill(reply);
  await bobsComment.getByRole('button', { name: 'Reply', exact: true }).click();

  await bobsComment.getByRole('button', { name: /View \d+ repl/ }).click();
  await expect(bobsComment.getByText(reply)).toBeVisible();
});

test('a student answers an understanding check and sees results once it ends', async ({ page }) => {
  const prof = await professorToken();
  const round = await server.startCheck(prof, unique('Slide 4 check'));

  await signInStudent(page, alice);
  await openClass(page);
  const check = card(page, /Understanding Check/);
  await expect(check.getByText('Live')).toBeVisible();
  await expect(check.getByText(/students responded/)).toHaveCount(0);   // no counts while it runs

  await check.getByRole('button', { name: 'Got it' }).click();
  await expect(check.getByText('Answer recorded')).toBeVisible();
  await expect(check.getByRole('button', { name: 'Got it' })).toHaveAttribute('aria-pressed', 'true');

  await server.endCheck(prof, round.id);
  await expect(check.getByText("Here's how the class answered.")).toBeVisible();
});

test('a student votes in a poll, can change the vote, and sees results without names', async ({ page }) => {
  const prof = await professorToken();
  const poll = await server.createPoll(prof, unique('Is this working?'), ['Yes', 'No']);

  await signInStudent(page, alice);
  await openClass(page);
  const polls = card(page, /Polls/);
  await expect(polls.getByText(poll.question)).toBeVisible();

  await polls.getByRole('button', { name: 'Yes' }).click();
  await expect(polls.getByText('Answer recorded')).toBeVisible();
  await polls.getByRole('button', { name: 'No' }).click();
  await expect(polls.getByRole('button', { name: 'No' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Only students can vote')).toHaveCount(0);

  const current = await server.currentPoll(prof);
  const noOption = poll.options.find((o) => o.text === 'No').id;
  expect(current.tally.find((t) => t.option_id === noOption).voters.map((v) => v.name)).toContain(alice.name);

  await server.closePoll(prof, poll.id);
  await expect(polls.getByText(/Here's how the class answered/)).toBeVisible();
  await expect(polls.getByText('Your pick')).toBeVisible();
  await expect(polls.getByText(alice.name)).toHaveCount(0);   // students never see who voted
});
