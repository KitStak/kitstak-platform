import { expect, test } from '@playwright/test';
import { apiData, open, signIn, toast, watchPage } from './support';

/**
 * The Work log form takes several labor types for one day and shows the day as one line.
 * Logs a day a year back on an active job, checks the one line, edits it, then deletes it.
 */
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
  await form.getByTestId('work-date').fill(day);
  await form.getByTestId('work-good').fill('243');
  await form.getByTestId('work-people').fill('4');
  await form.getByTestId('work-hours').fill('32');
  await form.getByTestId('work-add-line').click();
  await expect(form.getByTestId('work-line-1')).toBeVisible();
  await form.getByTestId('work-people-1').fill('8');
  await form.getByTestId('work-hours-1').fill('64');
  await form.getByTestId('work-save').click();
  await expect(toast(page, 'Day added')).toBeVisible();

  const row = page.getByTestId(`work-row-${day}`);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('243');
  await expect(row).toContainText('96');

  await page.getByTestId(`work-edit-${day}`).click();
  const edit = page.getByTestId('work-edit-form');
  await expect(edit.getByTestId('work-line-1')).toBeVisible();
  await edit.getByTestId('work-line-remove-1').click();
  await edit.getByTestId('work-save').click();
  await expect(toast(page, 'Day saved')).toBeVisible();
  await expect(page.getByTestId(`work-row-${day}`)).toContainText('32');

  await page.getByTestId(`work-delete-${day}`).click();
  await expect(page.getByTestId(`work-row-${day}`)).toHaveCount(0);
  expect(watch.problems).toEqual([]);
});
