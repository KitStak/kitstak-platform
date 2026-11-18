/**
 * The profit team's server reads against a seeded throwaway org: the pivot, the drill down rows,
 * every report of the library, "How we got this" and report schedules. The rule under test is
 * always the same one: every one of these views adds up to `getProfit`, the number the Profit
 * page shows. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { seedMinimal } from '@/server/db/seed/minimal';
import { reportToCsv, reportToHtml } from '@/features/reports/report-format';
import { parseCsv } from '@/lib/csv';
import { sumFacts } from '@/lib/profit';
import { REPORTS } from '@/lib/reports';
import type { DomainContext } from './_shared';
import {
  buildReport,
  deleteReportSchedule,
  explain,
  getProfit,
  getProfitPivot,
  getReportRunFile,
  listProfitEntries,
  listReportRuns,
  listReportSchedules,
  listSites,
  restoreReportSchedule,
  runDueReportSchedules,
  runReportSchedule,
  saveReportSchedule,
  setMemberRole,
  setReportScheduleEnabled,
} from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('reports, pivot, drill down and explain add up to the Profit page', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let viewer: DomainContext;
  let range: { from: string; to: string };

  beforeAll(async () => {
    org = await createTestOrg('pulse-reports');
    owner = await org.member('owner', 'Report Owner');
    await seedMinimal(owner);
    viewer = await org.member('member', 'No Money Viewer');
    await setMemberRole(owner, viewer.userId, { role: 'viewer', seesMoney: false });
    const [site] = await listSites(owner);
    const today = site!.today;
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 60);
    range = { from: start.toISOString().slice(0, 10), to: today };
  }, 120_000);

  afterAll(async () => {
    await org?.destroy();
  });

  it('pivot: every row total, column total and the grand total match getProfit', async () => {
    const profit = await getProfit(owner, 'client', range);
    const byWeek = await getProfit(owner, 'week', range);
    const pivot = await getProfitPivot(owner, 'client', 'week', range);
    expect(pivot.total.profitCents).toBe(profit.total.profitCents);
    expect(pivot.total.revenueCents).toBe(profit.total.revenueCents);
    expect(pivot.total.costCents).toBe(profit.total.costCents);
    for (const row of profit.rows) expect(pivot.rowTotals[row.key]?.profitCents, `client ${row.label}`).toBe(row.profitCents);
    for (const row of byWeek.rows) expect(pivot.colTotals[row.key]?.profitCents, `week ${row.key}`).toBe(row.profitCents);
    // Cells of a row add up to its total.
    for (const row of pivot.rows) {
      const sum = Object.values(pivot.cells[row.key] ?? {}).reduce((total, cell) => total + (cell.profitCents ?? 0), 0);
      expect(sum, `cells of ${row.label}`).toBe(pivot.rowTotals[row.key]?.profitCents);
    }
    expect(profit.rows.length).toBeGreaterThan(0);
  });

  it('pivot refuses the same grouping twice and hides money from a reader without it', async () => {
    await expect(getProfitPivot(owner, 'client', 'client', range)).rejects.toMatchObject({ code: 'VALIDATION' });
    const hidden = await getProfitPivot(viewer, 'client', 'month', range);
    expect(hidden.moneyHidden).toBe(true);
    expect(hidden.total.profitCents).toBeNull();
    expect(Number(hidden.total.unitsGood)).toBeGreaterThan(0);
  });

  it('drill down: the entries behind a job sum to that job in getProfit', async () => {
    const profit = await getProfit(owner, 'job', range);
    const job = profit.rows.find((row) => row.key !== 'none' && (row.revenueCents ?? 0) > 0)!;
    const entries = await listProfitEntries(owner, { ...range, jobId: job.key, limit: 2000 });
    expect(entries.truncated).toBe(false);
    const totals = sumFacts(entries.rows.map((row) => ({ kind: row.kind, amountCents: row.amountCents ?? 0 })));
    expect(Number(totals.revenueCents)).toBe(job.revenueCents);
    expect(Number(totals.laborCents)).toBe(job.laborCents);
    expect(Number(totals.materialCents)).toBe(job.materialCents);
    expect(Number(totals.sharedCents)).toBe(job.sharedCents);
    expect(entries.rows.every((row) => row.jobNumber !== null && row.sourceLabel.length > 0)).toBe(true);
    const hidden = await listProfitEntries(viewer, { ...range, jobId: job.key });
    expect(hidden.moneyHidden).toBe(true);
    expect(hidden.rows.every((row) => row.amountCents === null)).toBe(true);
  });

  it('explain: the lines hold the same figures as getProfit, and the total line is the answer', async () => {
    const profit = await getProfit(owner, 'month', range);
    const total = profit.total;
    const answer = async (metric: string) => (await explain(owner, metric, range)).lines.find((line) => line.op === 'total')?.value;
    expect(await answer('revenue')).toBe(total.revenueCents);
    expect(await answer('cost')).toBe(total.costCents);
    expect(await answer('profit')).toBe(total.profitCents);
    expect(await answer('labor')).toBe(total.laborCents);
    const margin = await explain(owner, 'margin', range);
    expect(margin.lines[margin.lines.length - 1]?.value).toBe(total.marginBp);
    expect(margin.formula.length).toBeGreaterThan(10);
    expect(margin.links.length).toBeGreaterThan(0);
    const labor = await explain(owner, 'labor', range);
    // An owner sees how the hour splits; the split adds back up to labor cost.
    const notes = labor.lines.filter((line) => line.op === 'note').reduce((sum, line) => sum + (line.value ?? 0), 0);
    expect(notes).toBe(total.laborCents);
    await expect(explain(owner, 'not_a_metric', range)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('explain: a reader without money gets the words, units and hours, never a money figure', async () => {
    const profit = await explain(viewer, 'profit', range);
    expect(profit.moneyHidden).toBe(true);
    expect(profit.lines.every((line) => line.value === null)).toBe(true);
    expect(profit.formula).toContain('Profit');
    const pace = await explain(viewer, 'uph', range);
    expect(pace.lines.find((line) => line.op === 'total')?.value).not.toBeNull();
  });

  it('every report of the library builds, with a total that matches the Profit page where it has one', async () => {
    const profit = await getProfit(owner, 'month', range);
    for (const info of REPORTS) {
      const report = await buildReport(owner, info.slug, range);
      expect(report.slug).toBe(info.slug);
      expect(report.columns.length, info.slug).toBeGreaterThan(2);
      for (const row of report.rows.slice(0, 20)) for (const key of Object.keys(row.cells)) expect(report.columns.some((column) => column.key === key), `${info.slug} has a cell with no column: ${key}`).toBe(true);
      const csv = parseCsv(reportToCsv(report));
      expect(csv.rows.length, `${info.slug} csv rows`).toBe(report.rows.length + (report.total ? 1 : 0));
      expect(csv.headers.length, `${info.slug} csv columns`).toBe(report.columns.length);
    }
    for (const slug of ['job-profit', 'profit-by-client', 'profit-by-job-type', 'profit-by-service', 'profit-by-site', 'monthly-profit-and-loss']) {
      const report = await buildReport(owner, slug, range);
      expect(report.total?.profit, slug).toBe(profit.total.profitCents);
      expect(report.total?.revenue, slug).toBe(profit.total.revenueCents);
    }
    const serve = await buildReport(owner, 'cost-to-serve', range);
    expect(serve.total?.cost).toBe(profit.total.costCents);
    expect(serve.total?.profit).toBe(profit.total.profitCents);
    const why = await buildReport(owner, 'why-profit-changed', range);
    if (why.total) {
      // The bars sum exactly to the change.
      const bars = ['volume', 'price', 'labor_rate', 'labor_efficiency', 'scrap', 'material', 'shared', 'other'].reduce((sum, key) => sum + ((why.total?.[key] as number | null) ?? 0), 0);
      expect(bars).toBe(why.total.total);
      expect((why.total.start as number) + (why.total.total as number)).toBe(why.total.end);
    }
  }, 120_000);

  it('reports: money reports are refused without money, open reports come back with money blank', async () => {
    await expect(buildReport(viewer, 'job-profit', range)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const paid = await buildReport(viewer, 'paid-time-not-on-any-job', range);
    expect(paid.moneyHidden).toBe(true);
    expect(paid.rows.every((row) => row.cells.missing_cost === null)).toBe(true);
    const blank = await buildReport(owner, 'job-profit', range, { hideMoney: true });
    expect(blank.rows.every((row) => row.cells.revenue === null && row.cells.margin === null)).toBe(true);
    expect(blank.rows.some((row) => typeof row.cells.units === 'number')).toBe(true);
    expect(blank.chart).toBeNull();
    await expect(buildReport(owner, 'no-such-report', range)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(buildReport(owner, 'job-profit', { from: range.to, to: range.from })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('the print page escapes names and carries the same rows', async () => {
    await org.query(`update pulse.clients set name = name || ' <script>alert(1)</script>' where org_id = $1`, [org.orgId]);
    const report = await buildReport(owner, 'profit-by-client', range);
    const html = reportToHtml(report, { orgName: 'Test & Co' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Test &amp; Co');
    expect((html.match(/<tr>/g) ?? []).length).toBe(report.rows.length + 2);
    await org.query(`update pulse.clients set name = replace(name, ' <script>alert(1)</script>', '') where org_id = $1`, [org.orgId]);
  });

  it('schedules: save, build now, files, turn off, delete, undo and the due run', async () => {
    await expect(saveReportSchedule(owner, { name: ' ', report: 'job-profit', cadence: 'weekly', weekday: 1, hour: 7, range: 'last_week' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(saveReportSchedule(viewer, { name: 'Money', report: 'job-profit', cadence: 'daily', hour: 7, range: 'yesterday' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const saved = await saveReportSchedule(owner, { name: 'Job profit, weekly', report: 'job-profit', cadence: 'weekly', weekday: 1, hour: 7, range: 'last_90', recipientUserIds: [viewer.userId, owner.userId] });
    expect(saved.includeMoney).toBe(true);
    expect(saved.nextRunAt).not.toBeNull();
    expect(new Date(saved.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    // A schedule that builds money is not listed for a reader without money.
    expect((await listReportSchedules(viewer)).length).toBe(0);
    expect((await listReportSchedules(owner)).map((item) => item.id)).toContain(saved.id);

    const run = await runReportSchedule(owner, saved.id);
    expect(run.status).toBe('ready');
    expect(run.rowCount).toBeGreaterThan(0);
    const csv = await getReportRunFile(owner, run.id, 'csv');
    expect(csv.fileName).toMatch(/^job-profit-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(parseCsv(csv.body).rows.length).toBe(run.rowCount + 1);
    expect((await getReportRunFile(owner, run.id, 'html')).body).toContain('<table>');
    await expect(getReportRunFile(viewer, run.id, 'csv')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await listReportRuns(viewer)).length).toBe(0);
    // Only the recipient who may see money is told; the builder is not told about their own build.
    const told = await org.query<{ user_id: string }>(`select user_id from pulse.notifications where org_id = $1 and kind = 'report_ready'`, [org.orgId]);
    expect(told.map((row) => row.user_id)).toEqual([]);

    const open = await saveReportSchedule(viewer, { name: 'Production log, daily', report: 'daily-production-log', cadence: 'daily', hour: 6, range: 'last_90' });
    expect(open.includeMoney).toBe(false);
    await expect(deleteReportSchedule(viewer, saved.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const openRun = await runReportSchedule(viewer, open.id);
    expect((await getReportRunFile(viewer, openRun.id, 'csv')).body).toContain('Units good');

    const off = await setReportScheduleEnabled(owner, saved.id, false);
    expect(off.enabled).toBe(false);
    expect(off.nextRunAt).toBeNull();
    await setReportScheduleEnabled(owner, saved.id, true);
    // Nothing is due yet; make one due and the scheduler builds exactly that one.
    expect(await runDueReportSchedules(owner)).toEqual({ built: 0, failed: 0 });
    await org.query(`update pulse.report_schedules set next_run_at = now() - interval '1 minute' where id = $1`, [saved.id]);
    expect(await runDueReportSchedules(owner)).toEqual({ built: 1, failed: 0 });
    const [after] = (await listReportSchedules(owner)).filter((item) => item.id === saved.id);
    expect(new Date(after!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());

    await deleteReportSchedule(owner, saved.id);
    expect((await listReportSchedules(owner)).map((item) => item.id)).not.toContain(saved.id);
    const back = await restoreReportSchedule(owner, saved.id);
    expect(back.id).toBe(saved.id);
    expect((await listReportSchedules(owner)).map((item) => item.id)).toContain(saved.id);
  }, 120_000);
});
