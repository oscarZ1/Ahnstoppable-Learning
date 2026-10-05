// The professor's Results page: every poll and understanding check, with who
// answered what, and CSV downloads.
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { STUDENTS } from './people.js';
import { signInProfessor, signInStudent, fixtures, unique, professorToken, studentToken, server } from './helpers.js';

const { alice, bob } = STUDENTS;

test.beforeEach(async () => {
  await server.closeEverything(await professorToken());
});

test('the Results page lists polls and checks with who answered, and downloads CSV', async ({ page }) => {
  const prof = await professorToken();
  const aliceTok = await studentToken('alice', alice);
  const bobTok   = await studentToken('bob', bob);

  const question = unique('Favourite channel?');
  const poll = await server.createPoll(prof, question, ['TV', 'Social']);
  await server.vote(aliceTok, poll.id, poll.options.find((o) => o.text === 'Social').id);
  await server.vote(bobTok,   poll.id, poll.options.find((o) => o.text === 'TV').id);
  await server.closePoll(prof, poll.id);

  const label = unique('Week 3 check');
  const round = await server.startCheck(prof, label);
  await server.answerCheck(aliceTok, 'hand');
  await server.endCheck(prof, round.id);

  await signInProfessor(page);
  await page.goto(`/class/${fixtures().classId}`);
  await page.getByRole('link', { name: /Results/ }).click();
  await page.waitForURL(`**/class/${fixtures().classId}/results`);

  // Polls table
  const pollsTable = page.getByRole('table', { name: 'Polls' });
  const pollRow = pollsTable.getByRole('row').filter({ hasText: question });
  await expect(pollRow).toContainText('Social: 1');
  await expect(pollRow).toContainText('TV: 1');
  await pollRow.getByRole('button', { name: `Who answered: ${question}` }).click();
  await expect(pollsTable.getByText(alice.name)).toBeVisible();
  await expect(pollsTable.getByText(bob.name)).toBeVisible();

  // Understanding checks table
  const checksTable = page.getByRole('table', { name: 'Understanding checks' });
  const checkRow = checksTable.getByRole('row').filter({ hasText: label });
  await expect(checkRow.getByRole('cell')).toHaveText([/./, label, '0', '1', '0', /^1 of \d+$/, /Who answered/]);
  await checkRow.getByRole('button', { name: `Who answered: ${label}` }).click();
  await expect(checksTable.getByText(`👋 ${alice.name}`)).toBeVisible();

  // CSV downloads
  const pollsCard = page.locator('div.rounded-lg').filter({ has: pollsTable });
  const [pollCsv] = await Promise.all([page.waitForEvent('download'), pollsCard.getByRole('button', { name: 'Download CSV' }).click()]);
  const pollText = fs.readFileSync(await pollCsv.path(), 'utf8');
  expect(pollText.split('\r\n')[0]).toBe('Date,Time,Question,Student,Answer');
  expect(pollText).toContain(`${question},${alice.name},Social`);

  const checksCard = page.locator('div.rounded-lg').filter({ has: checksTable });
  const [checkCsv] = await Promise.all([page.waitForEvent('download'), checksCard.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(fs.readFileSync(await checkCsv.path(), 'utf8')).toContain(`${label},${alice.name},Question`);
});

test('students cannot open the Results page', async ({ page }) => {
  await signInStudent(page, alice);
  await page.goto(`/class/${fixtures().classId}/results`);
  await page.waitForURL(`**/class/${fixtures().classId}`);
  await expect(page.getByRole('table')).toHaveCount(0);
});
