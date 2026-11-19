import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiData, open, signIn, toast, watchPage } from './support';

/**
 * The Work log form takes several labor classes for one day and shows the day as one line.
 * Logs a day a year back on an active job, checks the one line, tries to add the same day again
 * (refused before anything is saved), edits it, undoes the edit, then deletes it after the question.
 */

/** Picks a day in the KitStak date picker: back one month at a time until the day is on the grid. */
async function pickDay(page: Page, form: Locator, day: string): Promise<void> {
  await form.getByTestId('work-date').click();
  const cell = page.locator(`.ks-day-picker td[data-day="${day}"]:not([data-outside])`);
  for (let step = 0; step < 14 && (await cell.count()) === 0; step += 1) await page.getByRole('button', { name: /previous month/i }).click();
  await cell.getByRole('button').click();
}

test.beforeEach(async ({ page }) => signIn(page));

test('add two labor types to one day and see one line', async ({ page }) => {
  const watch = watchPage(page);
  const jobs = await apiData<{ number: string; status: string }[]>(page, 'jobs');
  const job = jobs.find((item) => item.status === 'active');
  test.skip(!job, 'no active job in the seed');
  const today = (await apiData<{ date: string }>(page, 'log')).date;
  const day = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

  await open(page, `/jobs/${job!.number}/work`);
  const form = page.getByTestId('work-add-form');
  await pickDay(page, form, day);
  await form.getByTestId('work-good').fill('243');
  await form.getByTestId('work-people').fill('4');
  await form.getByTestId('work-hours').fill('32');
  await form.getByTestId('work-add-line').click();
  await expect(form.getByTestId('work-line-1')).toBeVisible();
  await form.getByTestId('work-people-1').fill('8');
  await form.getByTestId('work-hours-1').fill('64');
  await form.getByTestId('work-save').click();
  await expect(toast(page, 'Added the work for')).toBeVisible();

  const row = page.getByTestId(`work-row-${day}`);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('243');
  await expect(row).toContainText('96');

  // The same day again: the form says the day has work, saves nothing and offers to open it.
  await pickDay(page, form, day);
  await expect(form.getByTestId('work-day-exists')).toContainText('already has work on this job');
  await expect(form.getByTestId('work-save')).toBeDisabled();
  await form.getByTestId('work-open-existing').click();

  // One form at a time: the add form became the edit form of that day.
  const edit = page.getByTestId('work-edit-form');
  await expect(page.getByTestId('work-add-form')).toHaveCount(0);
  await expect(edit.getByTestId('work-line-1')).toBeVisible();
  await edit.getByTestId('work-line-remove-1').click();
  await edit.getByTestId('work-save').click();
  await expect(toast(page, 'Saved the work for')).toBeVisible();
  await expect(row).toContainText('32');
  await expect(row).not.toContainText('96');

  // Undo puts both labor classes and their hours back.
  await toast(page, 'Saved the work for').getByRole('button', { name: 'Undo' }).click();
  await expect(row).toContainText('96');

  // Delete asks first and says what will go.
  await page.getByTestId(`work-delete-${day}`).click();
  await expect(page.getByTestId('work-delete-words')).toContainText('243');
  await expect(page.getByTestId('work-delete-words')).toContainText('96');
  await page.getByRole('button', { name: 'Delete the day' }).click();
  await expect(page.getByTestId(`work-row-${day}`)).toHaveCount(0);
  expect(watch.problems).toEqual([]);
});
