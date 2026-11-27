import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv';
import { compareRange, nextScheduleRun, rangeLabel, resolveRange, resolveScheduleRange, scheduleSentence } from '@/lib/reports';
import type { ReportDTO } from '@/lib/types';
import { escapeHtml, reportCellCsv, reportCellText, reportToCsv, reportToHtml } from './report-format';

const report: ReportDTO = {
  slug: 'job-profit',
  name: 'Job profit',
  description: 'Revenue, cost, profit and margin for every job.',
  from: '2026-11-01',
  to: '2026-11-17',
  usesDates: true,
  filtersLabel: 'Nov 1 to Nov 17, 2026, All sites',
  generatedAt: '2026-11-17T15:04:00.000Z',
  columns: [
    { key: 'job', label: 'Job', kind: 'text' },
    { key: 'risk', label: 'Health', kind: 'status' },
    { key: 'profit', label: 'Profit', kind: 'money', money: true },
    { key: 'margin', label: 'Margin', kind: 'percent', money: true },
    { key: 'units', label: 'Units', kind: 'number' },
    { key: 'due', label: 'Due', kind: 'date' },
  ],
  rows: [
    { id: '1', cells: { job: 'J-1001 <b>Kit</b>', risk: 'at_risk', profit: 123456, margin: 2236, units: 1200.5, due: '2026-12-09' } },
    { id: '2', cells: { job: '=SUM(A1)', risk: null, profit: -4500, margin: null, units: 0, due: null } },
  ],
  total: { job: 'Total', profit: 118956, margin: 2100, units: 1200.5 },
  summary: [{ label: 'Profit', value: 118956, kind: 'money' }],
  chart: null,
  aside: null,
  notes: ['Each job counts only the work dated inside these days.'],
  truncated: false,
  moneyHidden: false,
};

describe('report cells', () => {
  it('writes a cell for the screen', () => {
    expect(reportCellText(123456, 'money')).toBe('$1,234.56');
    expect(reportCellText(2236, 'percent')).toBe('22.4%');
    expect(reportCellText('at_risk', 'status')).toBe('At risk');
    expect(reportCellText('on_hold', 'job_status')).toBe('On hold');
    expect(reportCellText('2026-12-09', 'date')).toBe('Dec 9, 2026');
    expect(reportCellText(null, 'money', 'Hidden')).toBe('Hidden');
    expect(reportCellText(7.5, 'hours')).toBe('7.5');
  });

  it('writes a cell for a spreadsheet: plain numbers, words for a status', () => {
    expect(reportCellCsv(123456, 'money')).toEqual({ raw: '1234.56' });
    expect(reportCellCsv(-4500, 'money')).toEqual({ raw: '-45.00' });
    expect(reportCellCsv(2236, 'percent')).toEqual({ raw: '22.36' });
    expect(reportCellCsv('at_risk', 'status')).toBe('At risk');
    expect(reportCellCsv(null, 'money')).toBe('');
  });
});

describe('report files', () => {
  it('makes a CSV that reads back with the same rows, a total row, and no live formula', () => {
    const parsed = parseCsv(reportToCsv(report));
    expect(parsed.headers).toEqual(['Job', 'Health', 'Profit', 'Margin (%)', 'Units', 'Due']);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toEqual(['J-1001 <b>Kit</b>', 'At risk', '1234.56', '22.36', '1200.5', '2026-12-09']);
    // A cell that starts like a formula is defused.
    expect(parsed.rows[1]![0]!.startsWith('=')).toBe(false);
    expect(parsed.rows[1]!.slice(1)).toEqual(['', '-45.00', '', '0', '']);
    expect(parsed.rows[2]).toEqual(['Total', '', '1189.56', '21.00', '1200.5', '']);
  });

  it('makes a print page with every name escaped and no outside files', () => {
    const html = reportToHtml(report, { orgName: 'Acme & Sons' });
    expect(html).toContain('J-1001 &lt;b&gt;Kit&lt;/b&gt;');
    expect(html).not.toContain('<b>Kit</b>');
    expect(html).toContain('Acme &amp; Sons');
    expect(html).toContain('$1,234.56');
    expect(html).toContain('<tfoot>');
    expect(html).not.toMatch(/<link|src=|<script/);
    expect(reportToHtml(report, { orgName: 'Acme', autoPrint: true })).toContain('window.print()');
    expect(reportToHtml({ ...report, rows: [], total: null }, { orgName: 'Acme' })).toContain('Nothing to show for these filters.');
    expect(escapeHtml(`"quoted" & 'single'`)).toBe('&quot;quoted&quot; &amp; &#39;single&#39;');
  });
});

describe('date ranges', () => {
  const today = '2026-11-17'; // a Tuesday

  it('turns presets into days, ending today for periods still running', () => {
    expect(resolveRange('this_week', today, 1)).toEqual({ from: '2026-11-16', to: '2026-11-17' });
    expect(resolveRange('this_week', today, 0)).toEqual({ from: '2026-11-15', to: '2026-11-17' });
    expect(resolveRange('last_week', today, 1)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(resolveRange('this_month', today)).toEqual({ from: '2026-11-01', to: '2026-11-17' });
    expect(resolveRange('last_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolveRange('last_month', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(resolveRange('last_30', today)).toEqual({ from: '2026-10-19', to: '2026-11-17' });
    expect(resolveRange('last_90', today)).toEqual({ from: '2026-08-20', to: '2026-11-17' });
    expect(resolveRange('this_quarter', today)).toEqual({ from: '2026-10-01', to: '2026-11-17' });
    expect(resolveRange('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-11-17' });
    expect(resolveRange('custom', today, 1, { from: '2026-11-10', to: '2026-11-03' })).toEqual({ from: '2026-11-03', to: '2026-11-10' });
    expect(resolveScheduleRange('yesterday', today)).toEqual({ from: '2026-11-16', to: '2026-11-16' });
  });

  it('finds the period to compare with', () => {
    expect(compareRange('none', { from: '2026-11-01', to: '2026-11-17' })).toBeNull();
    expect(compareRange('prior', { from: '2026-11-01', to: '2026-11-17' })).toEqual({ from: '2026-10-15', to: '2026-10-31' });
    expect(compareRange('last_year', { from: '2026-11-01', to: '2026-11-17' })).toEqual({ from: '2025-11-01', to: '2025-11-17' });
    expect(compareRange('last_year', { from: '2028-02-01', to: '2028-02-29' })).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });

  it('names a range in plain words', () => {
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-17' })).toBe('Nov 1 to Nov 17, 2026');
    expect(rangeLabel({ from: '2025-12-29', to: '2026-01-04' })).toBe('Dec 29, 2025 to Jan 4, 2026');
    expect(rangeLabel({ from: '2026-11-17', to: '2026-11-17' })).toBe('Nov 17, 2026');
  });
});

describe('report schedules', () => {
  // 2026-11-17 15:30 UTC is 9:30 AM in Chicago (UTC-6 in November).
  const after = new Date('2026-11-17T15:30:00Z');

  it('finds the next build in the site time zone', () => {
    expect(nextScheduleRun({ cadence: 'daily', hour: 7 }, 'America/Chicago', after).toISOString()).toBe('2026-11-18T13:00:00.000Z');
    expect(nextScheduleRun({ cadence: 'daily', hour: 10 }, 'America/Chicago', after).toISOString()).toBe('2026-11-17T16:00:00.000Z');
    expect(nextScheduleRun({ cadence: 'weekly', weekday: 1, hour: 7 }, 'America/Chicago', after).toISOString()).toBe('2026-11-23T13:00:00.000Z');
    expect(nextScheduleRun({ cadence: 'monthly', dayOfMonth: 1, hour: 6 }, 'America/Chicago', after).toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(nextScheduleRun({ cadence: 'daily', hour: 7 }, 'UTC', after).toISOString()).toBe('2026-11-18T07:00:00.000Z');
  });

  it('builds on the last day of a short month when the day does not exist', () => {
    expect(nextScheduleRun({ cadence: 'monthly', dayOfMonth: 31, hour: 8 }, 'UTC', new Date('2026-11-17T00:00:00Z')).toISOString()).toBe('2026-11-30T08:00:00.000Z');
    expect(nextScheduleRun({ cadence: 'monthly', dayOfMonth: 30, hour: 8 }, 'UTC', new Date('2027-02-01T00:00:00Z')).toISOString()).toBe('2027-02-28T08:00:00.000Z');
  });

  it('is always in the future, and survives a bad time zone', () => {
    const exact = new Date('2026-11-18T07:00:00Z');
    expect(nextScheduleRun({ cadence: 'daily', hour: 7 }, 'UTC', exact).getTime()).toBeGreaterThan(exact.getTime());
    expect(nextScheduleRun({ cadence: 'daily', hour: 7 }, 'Not/AZone', after).toISOString()).toBe('2026-11-18T07:00:00.000Z');
  });

  it('says when in plain words', () => {
    expect(scheduleSentence({ cadence: 'daily', hour: 7 })).toBe('Every day at 7 AM');
    expect(scheduleSentence({ cadence: 'weekly', weekday: 1, hour: 13 })).toBe('Every Monday at 1 PM');
    expect(scheduleSentence({ cadence: 'monthly', dayOfMonth: 1, hour: 0 })).toBe('On the 1st of each month at 12 AM');
    expect(scheduleSentence({ cadence: 'monthly', dayOfMonth: 22, hour: 12 })).toBe('On the 22nd of each month at 12 PM');
    expect(scheduleSentence({ cadence: 'monthly', dayOfMonth: 13, hour: 9 })).toBe('On the 13th of each month at 9 AM');
  });
});
