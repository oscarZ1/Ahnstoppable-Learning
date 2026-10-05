// Regression for the "Only students can vote." bug: two accounts in tabs of
// the same browser. Sign-in is shared by every tab, so a tab must switch when
// another tab signs in as someone else, instead of acting as the new account
// while still showing the old person's screen.
import { test, expect } from '@playwright/test';
import { STUDENTS } from './people.js';
import { signInStudent, signInProfessor, openClass, card, unique, professorToken, server } from './helpers.js';

const { alice } = STUDENTS;

test.beforeEach(async () => {
  await server.closeEverything(await professorToken());
});

test('signing in as someone else in another tab switches this tab to that account', async ({ context }) => {
  const studentTab = await context.newPage();
  await signInStudent(studentTab, alice);
  await openClass(studentTab);
  // Student layout: the ask box is there and the professor's Results link isn't.
  await expect(studentTab.getByPlaceholder(/Stuck on something\?/)).toBeVisible();
  await expect(studentTab.getByRole('link', { name: /Results/ })).toHaveCount(0);

  const professorTab = await context.newPage();
  await signInProfessor(professorTab);

  // The student tab follows: it reloads as the professor rather than keeping
  // a student screen that would send the professor's sign-in.
  await studentTab.waitForURL('**/home');
  const stored = await studentTab.evaluate(() => JSON.parse(localStorage.getItem('user')));
  expect(stored.role).toBe('professor');
  await openClass(studentTab);
  await expect(studentTab.getByRole('link', { name: /Results/ })).toBeVisible();
});

test('signing out in another tab signs this tab out too', async ({ context }) => {
  const tabA = await context.newPage();
  await signInProfessor(tabA);
  await openClass(tabA);

  const tabB = await context.newPage();
  await tabB.goto('/home');
  await tabB.getByRole('button', { name: '☰' }).click();
  await tabB.getByRole('button', { name: 'Sign Out' }).click();

  await tabA.waitForURL((url) => url.pathname === '/');
  await expect(tabA.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a student can vote after a professor used the same browser', async ({ context }) => {
  const prof = await professorToken();
  const poll = await server.createPoll(prof, unique('Shared browser poll'), ['Yes', 'No']);

  const tab = await context.newPage();
  await signInProfessor(tab);
  await tab.goto('/home');
  await tab.getByRole('button', { name: '☰' }).click();
  await tab.getByRole('button', { name: 'Sign Out' }).click();

  await signInStudent(tab, alice);
  await openClass(tab);
  const polls = card(tab, /Polls/);
  await polls.getByRole('button', { name: 'Yes' }).click();
  await expect(polls.getByText('Answer recorded')).toBeVisible();
  await expect(tab.getByText('Only students can vote')).toHaveCount(0);

  await server.closePoll(prof, poll.id);
});
