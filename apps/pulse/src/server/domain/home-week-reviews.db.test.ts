/**
 * Home's "N of M work days reviewed this week" counts days, not site approvals. With two sites
 * approving the same days, and today approved too, N never runs past M.
 * The suite makes its own organization and removes it at the end. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { todayInZone, type DomainContext } from './_shared';
import * as domain from './test-exports';

const ready = await databaseReady();
const TIMEZONE = 'America/Chicago';

describe.skipIf(!ready)('home week review count (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let today: string;
  let pastWorkDays: string[];

  beforeAll(async () => {
    org = await createTestOrg('pulse-week-reviews');
    owner = await org.member('owner', 'Olive Owner');
    // Every day of the week is a working day, so the days before today in this week are all counted.
    const settings = await domain.updateSettings(owner, { weekStart: 1, workingDays: [0, 1, 2, 3, 4, 5, 6] });
    // Home reads "today" in the default site's time zone, so the extra sites use the same zone.
    const [main] = await domain.listSites(owner);
    const zone = main?.timezone ?? TIMEZONE;
    const north = await domain.createSite(owner, { name: 'North dock', timezone: zone });
    const south = await domain.createSite(owner, { name: 'South dock', timezone: zone });
    today = todayInZone(zone);
    const offset = (new Date(`${today}T00:00:00Z`).getUTCDay() - settings.weekStart + 7) % 7;
    pastWorkDays = Array.from({ length: offset }, (_, i) => domain.addDaysForTest(today, i - offset));
    // Both sites approve every day so far this week, and today as well.
    for (const date of [...pastWorkDays, today]) {
      for (const site of [north, south])
        await domain.reviewDay(owner, { siteId: site.id, date, decision: 'approve' });
    }
  });

  afterAll(async () => {
    await org?.destroy();
  });

  it('counts each day once and only the days before today', async () => {
    const monthStart = `${today.slice(0, 7)}-01`;
    const summary = await domain.getSummary(owner, { from: monthStart, to: today });
    expect(summary.entryProgress.workDaysThisWeek).toBe(pastWorkDays.length);
    expect(summary.entryProgress.daysReviewedThisWeek).toBe(pastWorkDays.length);
  });
});
