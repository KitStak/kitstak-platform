import { expect, test } from '@playwright/test';
import { apiData, open, signIn, toast, watchPage } from './support';

/**
 * Undo in a toast must work with a finger. On a touch screen every button gets a 44px hit area
 * (globals.css), and the toast's close button once drew its hit area over the whole toast, so a
 * tap on Undo landed on Close. This saves a day on a job, taps Undo, and checks the day came back,
 * at a phone, a tablet and a laptop width, all with touch on.
 */
for (const [width, height] of [
  [390, 844],
  [768, 1024],
  [1366, 1024],
] as const) {
  test.describe(`touch at ${width}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    test('a tap on Undo puts the day back', async ({ page }) => {
      await signIn(page);
      const watch = watchPage(page);
      const jobs = await apiData<{ id: string; number: string; status: string }[]>(page, 'jobs');
      const job = jobs.find((item) => item.status === 'active');
      test.skip(!job, 'no active job in the seed');
      const today = (await apiData<{ date: string }>(page, 'log')).date;
      // A day two years back on this job, far from real work, one per width so runs do not meet.
      const day = `${Number(today.slice(0, 4)) - 2}-02-${String(10 + [390, 768, 1366].indexOf(width)).padStart(2, '0')}`;
      const classes = await apiData<{ id: string }[]>(page, 'labor-classes');
      const before = await apiData<{ id: string }[]>(page, `production?job=${job!.id}&from=${day}&to=${day}`);
      if (before.length === 0) {
        const made = await page.request.put('/api/v1/log/days', {
          data: { jobId: job!.id, workDate: day, mode: 'create', lines: [{ laborClassId: classes[0]!.id, unitsGood: '10', unitsScrap: '0', headcount: '2', hours: '16', setupHours: '0', overtimeHours: '0', note: null }] },
        });
        expect(made.ok(), `making the test day answered ${made.status()}`).toBeTruthy();
      }

      await open(page, `/jobs/${job!.number}/work`);
      const edit = page.locator(`[data-testid="work-edit-${day}"], [data-testid="work-card-edit-${day}"]`).filter({ visible: true }).first();
      await edit.tap();
      const form = page.getByTestId('work-edit-form');
      const good = form.getByTestId('work-good');
      const was = await good.inputValue();
      await good.fill(String(Number(was) + 1));
      await form.getByTestId('work-save').tap();

      const saved = toast(page, 'Saved the work for');
      await expect(saved).toBeVisible();
      const undo = saved.getByRole('button', { name: 'Undo' });
      // The middle and both ends of Undo belong to Undo, not to the close button (once the toast has slid in).
      const hits = async (): Promise<(string | null)[]> => {
        const box = (await undo.boundingBox())!;
        return page.evaluate(
          ({ x, y, w }) => [x + 2, x + w / 2, x + w - 2].map((left) => document.elementFromPoint(left, y)?.closest('button')?.textContent ?? null),
          { x: box.x, y: box.y + box.height / 2, w: box.width },
        );
      };
      await expect.poll(hits).toEqual(['Undo', 'Undo', 'Undo']);
      expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      await undo.tap();
      await expect(toast(page, 'Put the work for')).toBeVisible();
      const after = await apiData<{ unitsGood: string }[]>(page, `production?job=${job!.id}&from=${day}&to=${day}`);
      expect(Number(after[0]!.unitsGood)).toBe(Number(was));

      // Clean up: the day goes, with the question first.
      await page.locator(`[data-testid="work-delete-${day}"], [data-testid="work-card-delete-${day}"]`).filter({ visible: true }).first().tap();
      await page.getByRole('button', { name: 'Delete the day' }).tap();
      await expect(page.locator(`[data-testid="work-card-${day}"], [data-testid="work-row-${day}"]`)).toHaveCount(0);
      expect(watch.problems).toEqual([]);
    });
  });
}
